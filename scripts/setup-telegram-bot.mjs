#!/usr/bin/env node
/**
 * One-off Telegram bot configuration for the Emoji Studio Mini App:
 * menu button that opens the editor, /start command, bot descriptions (uk / ru / en).
 *
 * Usage:
 *   TELEGRAM_BOT_TOKEN=123:abc APP_URL=https://you.github.io/lottie-emoji-editor/ node scripts/setup-telegram-bot.mjs
 *
 * APP_URL defaults to the GitHub Pages URL of the current repository when run in GitHub Actions.
 * The token is never printed.
 */

const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
const apiBase = (process.env.TELEGRAM_API ?? 'https://api.telegram.org').replace(/\/$/, '');

function defaultAppUrl() {
  const repo = process.env.GITHUB_REPOSITORY; // "owner/name"
  if (!repo) return null;
  const [owner, name] = repo.split('/');
  return `https://${owner.toLowerCase()}.github.io/${name}/`;
}

const appUrl = process.env.APP_URL?.trim() || defaultAppUrl();

if (!token) {
  console.error('TELEGRAM_BOT_TOKEN is not set. Add it as a repository secret: Settings → Secrets and variables → Actions.');
  process.exit(1);
}
if (!appUrl || !/^https:\/\//.test(appUrl)) {
  console.error(`APP_URL must be an https:// URL (got: ${appUrl ?? 'nothing'}). Telegram only opens Mini Apps over HTTPS.`);
  process.exit(1);
}

async function call(method, params = {}) {
  const res = await fetch(`${apiBase}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params),
  });
  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error(`${method}: HTTP ${res.status}`);
  }
  if (!data.ok) throw new Error(`${method}: ${data.description ?? `HTTP ${res.status}`}`);
  return data.result;
}

const TEXTS = {
  uk: {
    command: 'Відкрити редактор емодзі',
    short: 'Створюйте анімовані емодзі для Telegram з тексту або SVG-логотипа.',
    description:
      'Emoji Studio — редактор анімованих емодзі для Telegram.\n\n' +
      '• Текст або ваш SVG-логотип\n' +
      '• 22 анімовані персонажі, кольори та градієнти\n' +
      '• Експорт у .tgs — готово для @Stickers\n\n' +
      'Натисніть кнопку «Emoji Studio» внизу, щоб відкрити редактор.',
  },
  ru: {
    command: 'Открыть редактор эмодзи',
    short: 'Создавайте анимированные эмодзи для Telegram из текста или SVG-логотипа.',
    description:
      'Emoji Studio — редактор анимированных эмодзи для Telegram.\n\n' +
      '• Текст или ваш SVG-логотип\n' +
      '• 22 анимированных персонажа, цвета и градиенты\n' +
      '• Экспорт в .tgs — готово для @Stickers\n\n' +
      'Нажмите кнопку «Emoji Studio» внизу, чтобы открыть редактор.',
  },
  en: {
    command: 'Open the emoji editor',
    short: 'Make animated Telegram emoji from text or an SVG logo.',
    description:
      'Emoji Studio — an editor for animated Telegram emoji.\n\n' +
      '• Text or your own SVG logo\n' +
      '• 22 animated characters, colors and gradients\n' +
      '• Export to .tgs — ready for @Stickers\n\n' +
      'Tap the “Emoji Studio” button below to open the editor.',
  },
};

// Ukrainian is the default for every language without its own texts.
const LOCALES = [
  ['', TEXTS.uk],
  ['uk', TEXTS.uk],
  ['ru', TEXTS.ru],
  ['en', TEXTS.en],
];

async function main() {
  const me = await call('getMe');
  console.log(`Bot: @${me.username} (${me.first_name})`);
  console.log(`Mini App URL: ${appUrl}`);

  await call('setChatMenuButton', {
    menu_button: { type: 'web_app', text: 'Emoji Studio', web_app: { url: appUrl } },
  });
  console.log('✓ Menu button opens the editor');

  for (const [language_code, t] of LOCALES) {
    const lang = language_code ? { language_code } : {};
    await call('setMyCommands', { commands: [{ command: 'start', description: t.command }], ...lang });
    await call('setMyShortDescription', { short_description: t.short, ...lang });
    await call('setMyDescription', { description: t.description, ...lang });
    console.log(`✓ Commands and descriptions (${language_code || 'default'})`);
  }

  console.log('\nDone. Open the bot in Telegram — the "Emoji Studio" button next to the message field launches the editor.');
  console.log('Optional: @BotFather → /mybots → your bot → Bot Settings → Configure Mini App → Enable, same URL (adds "Open App" to the bot profile).');
}

try {
  await main();
} catch (err) {
  // Never leak the token (it is part of the request URL) into public CI logs.
  const message = String(err instanceof Error ? err.message : err).replaceAll(token, '***');
  console.error(`Telegram setup failed: ${message}`);
  process.exit(1);
}
