/** Optional Telegram Mini App integration — everything is a no-op in a regular browser. */

interface TelegramWebApp {
  ready(): void;
  expand(): void;
  setHeaderColor?(color: string): void;
  setBackgroundColor?(color: string): void;
  openLink?(url: string): void;
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

export function openExternal(url: string): void {
  const app = webApp();
  if (app?.openLink) app.openLink(url);
  else window.open(url, '_blank', 'noopener');
}
