import { useEffect, useRef } from 'react';

/** Optional Telegram Mini App integration — everything is a no-op in a regular browser. */

interface NativeButton {
  setParams(params: { text?: string; is_visible?: boolean; is_active?: boolean; color?: string; text_color?: string; has_shine_effect?: boolean }): void;
  onClick(cb: () => void): void;
  offClick(cb: () => void): void;
  hide(): void;
}

interface ThemeParams {
  bg_color?: string;
  secondary_bg_color?: string;
  section_bg_color?: string;
  text_color?: string;
  hint_color?: string;
  button_color?: string;
  button_text_color?: string;
  accent_text_color?: string;
  destructive_text_color?: string;
}

interface TelegramWebApp {
  initData?: string;
  ready(): void;
  expand(): void;
  close?(): void;
  requestWriteAccess?(callback?: (granted: boolean) => void): void;
  setHeaderColor?(color: string): void;
  setBackgroundColor?(color: string): void;
  setBottomBarColor?(color: string): void;
  disableVerticalSwipes?(): void;
  onEvent?(event: string, cb: () => void): void;
  themeParams?: ThemeParams;
  colorScheme?: 'light' | 'dark';
  MainButton?: NativeButton;
  BackButton?: { show(): void; hide(): void; onClick(cb: () => void): void; offClick(cb: () => void): void };
  isVersionAtLeast?(version: string): boolean;
  showConfirm?(message: string, callback: (ok: boolean) => void): void;
  openLink?(url: string): void;
  openTelegramLink?(url: string): void;
  HapticFeedback?: { selectionChanged(): void; impactOccurred(style: string): void };
  initDataUnsafe?: { user?: { language_code?: string } };
  platform?: string;
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

export function webApp(): TelegramWebApp | undefined {
  const app = window.Telegram?.WebApp;
  // telegram-web-app.js defines the object everywhere; `platform` is "unknown" outside Telegram.
  return app && app.platform && app.platform !== 'unknown' ? app : undefined;
}

export const isTelegram = (): boolean => !!webApp();

/** Loads telegram-web-app.js only when the page was opened as a Mini App (Telegram passes tgWebApp* params in the hash). */
export function initTelegram(): Promise<void> {
  if (typeof window === 'undefined' || !/tgWebApp/.test(window.location.hash + window.location.search)) return Promise.resolve();
  return new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = 'https://telegram.org/js/telegram-web-app.js';
    script.onload = () => {
      const app = webApp();
      app?.ready();
      app?.expand();
      if (app) {
        applyTelegramTheme(app);
        app.onEvent?.('themeChanged', () => applyTelegramTheme(app));
        // Dragging on the canvas must not pull the Mini App down.
        try {
          app.disableVerticalSwipes?.();
        } catch {
          /* older clients */
        }
      }
      resolve();
    };
    script.onerror = () => resolve();
    document.head.appendChild(script);
  });
}

const HEX = /^#[0-9a-f]{6}$/i;

/** Uses the user's Telegram theme, so the editor looks like part of Telegram in light and dark mode. */
function applyTelegramTheme(app: TelegramWebApp): void {
  const p = app.themeParams ?? {};
  if (!p.bg_color || !p.text_color) return;
  const root = document.documentElement;
  const card = p.section_bg_color ?? p.bg_color;
  const bg = p.secondary_bg_color ?? p.bg_color;
  const text = p.text_color;
  const accent = p.button_color ?? p.accent_text_color ?? '#2481cc';
  const vars: Record<string, string | undefined> = {
    '--bg': bg,
    '--card': card,
    '--text': text,
    '--muted': p.hint_color,
    '--accent': accent,
    '--accent-strong': p.accent_text_color ?? accent,
    '--on-accent': p.button_text_color,
    '--accent-soft': `color-mix(in srgb, ${accent} 14%, ${card})`,
    '--accent-line': `color-mix(in srgb, ${accent} 35%, ${card})`,
    '--sub': `color-mix(in srgb, ${text} 5%, ${card})`,
    '--sub-2': `color-mix(in srgb, ${text} 9%, ${card})`,
    '--line': `color-mix(in srgb, ${text} 12%, ${card})`,
    '--danger': p.destructive_text_color,
  };
  for (const [k, v] of Object.entries(vars)) if (v) root.style.setProperty(k, v);
  root.style.colorScheme = app.colorScheme ?? '';
  root.dataset.tg = app.colorScheme ?? 'light';
  try {
    if (HEX.test(bg)) {
      app.setHeaderColor?.(bg);
      app.setBackgroundColor?.(bg);
      app.setBottomBarColor?.(bg);
    }
  } catch {
    /* older clients */
  }
}

/**
 * Telegram's own bottom button (where available) for the main action. Returns true when it is used,
 * so the page can hide its own button.
 */
export function useMainButton(opts: { text: string; visible: boolean; enabled: boolean; onClick: () => void }): boolean {
  const button = webApp()?.MainButton;
  const handler = useRef(opts.onClick);
  handler.current = opts.onClick;
  useEffect(() => {
    if (!button) return;
    const click = () => handler.current();
    button.onClick(click);
    return () => {
      button.offClick(click);
      button.hide();
    };
  }, [button]);
  useEffect(() => {
    button?.setParams({ text: opts.text, is_visible: opts.visible, is_active: opts.enabled });
  }, [button, opts.text, opts.visible, opts.enabled]);
  return !!button;
}

/** Telegram's Back button in the header while `visible` (e.g. to close a sheet). */
export function useBackButton(visible: boolean, onBack: () => void): void {
  const button = webApp()?.BackButton;
  const handler = useRef(onBack);
  handler.current = onBack;
  useEffect(() => {
    if (!button || !visible) return;
    const click = () => handler.current();
    button.onClick(click);
    button.show();
    return () => {
      button.offClick(click);
      button.hide();
    };
  }, [button, visible]);
}

/** Asks for confirmation — Telegram's own dialog in the Mini App, the browser's elsewhere. */
export function confirmAction(message: string): Promise<boolean> {
  const app = webApp();
  if (app?.showConfirm) {
    return new Promise((resolve) => {
      try {
        app.showConfirm!(message, (ok) => resolve(!!ok));
      } catch {
        resolve(window.confirm(message));
      }
    });
  }
  return Promise.resolve(window.confirm(message));
}

export function haptic(): void {
  try {
    webApp()?.HapticFeedback?.selectionChanged();
  } catch {
    /* not supported */
  }
}

/** Signed launch data, sent to the bot backend to prove who the user is. */
export function initData(): string {
  return webApp()?.initData ?? '';
}

/** Asks the user to let the bot message them (needed if they never pressed Start). */
export function requestWriteAccess(): Promise<boolean> {
  const app = webApp();
  if (!app?.requestWriteAccess) return Promise.resolve(false);
  return new Promise((resolve) => {
    try {
      app.requestWriteAccess!((granted) => resolve(granted));
    } catch {
      resolve(false);
    }
  });
}

export function closeApp(): void {
  webApp()?.close?.();
}

/** Opens a t.me link inside Telegram (e.g. "add emoji pack"), or in a new tab elsewhere. */
export function openTelegramLink(url: string): void {
  const app = webApp();
  if (app?.openTelegramLink) app.openTelegramLink(url);
  else window.open(url, '_blank', 'noopener');
}

export function openExternal(url: string): void {
  const app = webApp();
  if (app?.openLink) app.openLink(url);
  else window.open(url, '_blank', 'noopener');
}
