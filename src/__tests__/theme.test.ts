import { afterEach, describe, expect, it } from 'vitest';
import { pageTheme, systemTheme } from '../lib/theme';

describe('themes', () => {
  afterEach(() => {
    window.location.hash = '';
    delete document.documentElement.dataset.theme;
  });

  it("takes Telegram's scheme from the launch parameters", () => {
    const params = (bg: string) => `#tgWebAppData=x&tgWebAppThemeParams=${encodeURIComponent(JSON.stringify({ bg_color: bg }))}&tgWebAppVersion=8.0`;
    window.location.hash = params('#ffffff');
    expect(systemTheme()).toBe('light');
    window.location.hash = params('#17212b');
    expect(systemTheme()).toBe('dark');
  });

  it('is dark when nothing says otherwise', () => {
    window.location.hash = '#tgWebAppThemeParams=%7Bbroken';
    expect(systemTheme()).toBe('dark');
    expect(pageTheme()).toBe('dark');
    document.documentElement.dataset.theme = 'light';
    expect(pageTheme()).toBe('light');
  });
});
