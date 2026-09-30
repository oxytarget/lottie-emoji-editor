/** Telegram helpers shared by the worker — pure Web Crypto, no platform-specific APIs. */

const encoder = new TextEncoder();
const bytes = (s: string): Uint8Array<ArrayBuffer> => encoder.encode(s) as Uint8Array<ArrayBuffer>;

async function hmac(key: BufferSource, data: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', k, bytes(data));
}

const toHex = (buf: ArrayBuffer): string => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export interface TelegramUser {
  id: number;
  first_name?: string;
  username?: string;
  language_code?: string;
}

export type InitDataResult = { ok: true; user: TelegramUser; authDate: number } | { ok: false; reason: 'missing' | 'bad-hash' | 'expired' | 'no-user' };

/**
 * Validates Mini App `initData` as described in
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
export async function validateInitData(initData: string, botToken: string, maxAgeSeconds = 24 * 3600, now = Date.now()): Promise<InitDataResult> {
  if (!initData) return { ok: false, reason: 'missing' };
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return { ok: false, reason: 'missing' };

  const secret = await hmac(bytes('WebAppData'), botToken);
  const checkString = (exclude: string[]) =>
    [...params.entries()]
      .filter(([k]) => !exclude.includes(k))
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');

  // Newer clients also send `signature` (for third-party validation); accept either data-check-string variant.
  let valid = false;
  for (const exclude of [['hash'], ['hash', 'signature']]) {
    if (timingSafeEqual(toHex(await hmac(secret, checkString(exclude))), hash.toLowerCase())) {
      valid = true;
      break;
    }
  }
  if (!valid) return { ok: false, reason: 'bad-hash' };

  const authDate = Number(params.get('auth_date'));
  if (!Number.isFinite(authDate) || now / 1000 - authDate > maxAgeSeconds) return { ok: false, reason: 'expired' };

  try {
    const user = JSON.parse(params.get('user') ?? 'null') as TelegramUser | null;
    if (!user || typeof user.id !== 'number') return { ok: false, reason: 'no-user' };
    return { ok: true, user, authDate };
  } catch {
    return { ok: false, reason: 'no-user' };
  }
}

/** Builds signed initData — used by tests and local tooling. */
export async function signInitData(fields: Record<string, string>, botToken: string): Promise<string> {
  const secret = await hmac(bytes('WebAppData'), botToken);
  const checkString = Object.entries(fields)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const params = new URLSearchParams(fields);
  params.set('hash', toHex(await hmac(secret, checkString)));
  return params.toString();
}

/** Webhook secret derived from the bot token, so no extra secret has to be configured. */
export async function webhookSecret(botToken: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes(`emoji-studio-webhook:${botToken}`));
  return toHex(digest).slice(0, 48);
}

export type Lang = 'uk' | 'ru' | 'en';

export function pickLang(code: string | undefined): Lang {
  const c = (code ?? '').slice(0, 2).toLowerCase();
  return c === 'uk' || c === 'ru' ? c : 'en';
}

export const TEXTS: Record<Lang, { caption: string; welcome: string; open: string }> = {
  uk: {
    caption: 'Готово! Щоб додати емодзі в Telegram, перешліть ці файли боту @Stickers після команди /newemojipack.',
    welcome: 'Привіт! Emoji Studio створює анімовані емодзі з тексту або вашого SVG-логотипа.\n\nНатисніть кнопку нижче, налаштуйте емодзі, натисніть «Завантажити» і «Створити емодзі-пак» — я зберу пак і надішлю посилання сюди в чат.\n\nМаєте готовий пак? Надішліть мені стікер чи емодзі з нього або посилання — зроблю з нього шаблони з вашим лого.',
    open: '🎨 Відкрити редактор',
  },
  ru: {
    caption: 'Готово! Чтобы добавить эмодзи в Telegram, перешлите эти файлы боту @Stickers после команды /newemojipack.',
    welcome: 'Привет! Emoji Studio создаёт анимированные эмодзи из текста или вашего SVG-логотипа.\n\nНажмите кнопку ниже, настройте эмодзи, нажмите «Скачать» и «Создать эмодзи-пак» — я соберу пак и пришлю ссылку сюда в чат.\n\nЕсть готовый пак? Пришлите мне стикер или эмодзи из него либо ссылку — сделаю из него шаблоны с вашим лого.',
    open: '🎨 Открыть редактор',
  },
  en: {
    caption: 'Done! To add the emoji to Telegram, forward these files to @Stickers after sending /newemojipack.',
    welcome: 'Hi! Emoji Studio turns text or your SVG logo into animated emoji.\n\nTap the button below, tune your emoji, press “Download” and “Create emoji pack” — I will build the pack and send you the link here.\n\nHave a ready-made pack? Send me a sticker or emoji from it, or its link — I will turn it into templates with your logo.',
    open: '🎨 Open the editor',
  },
};

export function packTexts(lang: Lang): { created: (title: string, n: number) => string; updated: (title: string, n: number) => string; open: string } {
  if (lang === 'uk') {
    return {
      created: (t, n) => `✨ Емодзі-пак «${t}» готовий! Додано емодзі: ${n}.\nНатисніть кнопку, щоб додати його собі.`,
      updated: (t, n) => `✨ До паку «${t}» додано емодзі: ${n}.`,
      open: '➕ Додати емодзі-пак',
    };
  }
  if (lang === 'ru') {
    return {
      created: (t, n) => `✨ Эмодзи-пак «${t}» готов! Добавлено эмодзи: ${n}.\nНажмите кнопку, чтобы добавить его себе.`,
      updated: (t, n) => `✨ В пак «${t}» добавлено эмодзи: ${n}.`,
      open: '➕ Добавить эмодзи-пак',
    };
  }
  return {
    created: (t, n) => `✨ Emoji pack “${t}” is ready with ${n} emoji.\nTap the button to add it.`,
    updated: (t, n) => `✨ Added ${n} emoji to “${t}”.`,
    open: '➕ Add emoji pack',
  };
}
