import { useEffect, useState } from 'react';
import { setTelegramChrome, TG_THEME_EVENT, webApp } from './telegram';

/** Light and dark studio themes (see `:root` and `:root[data-theme='light']` in styles.css). */
export type Theme = 'light' | 'dark';

/** Page background and accent of each theme: Telegram's header and native button take them. */
export const THEME_COLORS: Record<Theme, { bg: string; accent: string }> = {
  dark: { bg: '#0e0e15', accent: '#7c5cf6' },
  light: { bg: '#f4f4f9', accent: '#8b5cf6' },
};

/** The theme on the page right now (index.html sets it before anything else runs). */
export const pageTheme = (): Theme =>
  typeof document !== 'undefined' && document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';

/** Light or dark by the brightness of a `#rrggbb` colour. */
const schemeOf = (hex: string): Theme | null => {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return null;
  const n = parseInt(hex.slice(1), 16);
  return ((n >> 16) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000 > 140 ? 'light' : 'dark';
};

/**
 * The theme the user did not choose themselves: Telegram's colour scheme inside Telegram (from the launch
 * parameters until its script is loaded), otherwise the system's. Dark when nothing says otherwise.
 * index.html runs the same logic before the first paint.
 */
export function systemTheme(): Theme {
  const app = webApp();
  if (app?.colorScheme) return app.colorScheme;
  const params = /tgWebAppThemeParams=([^&]+)/.exec(window.location.hash);
  if (params) {
    try {
      const bg = (JSON.parse(decodeURIComponent(params[1])) as { bg_color?: string }).bg_color;
      const scheme = bg ? schemeOf(bg) : null;
      if (scheme) return scheme;
    } catch {
      /* malformed parameters */
    }
  }
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

/** `systemTheme()`, kept up to date (system setting or Telegram theme changes). */
export function useSystemTheme(): Theme {
  const [theme, setTheme] = useState(systemTheme);
  useEffect(() => {
    const update = () => setTheme(systemTheme());
    const media = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: light)') : null;
    media?.addEventListener('change', update);
    window.addEventListener(TG_THEME_EVENT, update);
    return () => {
      media?.removeEventListener('change', update);
      window.removeEventListener(TG_THEME_EVENT, update);
    };
  }, []);
  return theme;
}

/** Puts `theme` on the page: the CSS tokens, the browser's theme colour and Telegram's header. */
export function useApplyTheme(theme: Theme): void {
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    const { bg, accent } = THEME_COLORS[theme];
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg);
    setTelegramChrome(bg, accent);
    // Telegram may load after the first render: give it the colours once it is there.
    const onTelegram = () => setTelegramChrome(bg, accent);
    window.addEventListener(TG_THEME_EVENT, onTelegram);
    return () => window.removeEventListener(TG_THEME_EVENT, onTelegram);
  }, [theme]);
}
