/** Optional Telegram Mini App integration — everything is a no-op in a regular browser. */

interface TelegramWebApp {
  initData?: string;
  ready(): void;
  expand(): void;
  close?(): void;
  requestWriteAccess?(callback?: (granted: boolean) => void): void;
  setHeaderColor?(color: string): void;
  setBackgroundColor?(color: string): void;
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
      app?.setHeaderColor?.('#8b5cf6');
      resolve();
    };
    script.onerror = () => resolve();
    document.head.appendChild(script);
  });
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
