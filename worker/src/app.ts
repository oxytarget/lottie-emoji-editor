/**
 * Emoji Studio bot backend — plain Web `Request → Response`, runs on Vercel (api/*.ts) and Cloudflare Workers (index.ts).
 *
 *   POST /api/send       — the Mini App uploads exported files; the bot sends them to the user's chat.
 *   POST /api/pack       — the bot creates a custom emoji pack for the user (or adds to one it made before).
 *   POST /api/telegram   — bot webhook: /start, and sticker packs sent to the bot (→ editor templates).
 *   GET  /api/stickerset, /api/sticker, /api/templates — sticker packs as templates (see templates.ts).
 *   GET  /api/link       — checks a link code (the editor in a browser acts for a user — see linkCode).
 *   /api/app/*           — accounts, generations, payments, PRO and the admin panel (account.ts, payments.ts).
 *   GET  /               — health check.
 *
 * Settings: TELEGRAM_BOT_TOKEN (secret), APP_URL, ALLOWED_ORIGINS (comma separated), ADMIN_IDS (optional,
 * Telegram ids allowed to add template packs for everyone), TELEGRAM_API (optional, for tests).
 */
import { corsHeaders, json, telegram, TelegramError, type Env } from './shared.js';
import { authenticate, LINK_DAYS, linkCode, pickLang, TEXTS, validateLinkCode, webhookSecret } from './telegram.js';
import { botInfo, handlePack } from './packs.js';
import { handleAdmin, handleCatalog, handleGenerate, handleMe, handleTemplateEdits, handleWallet, paidFor } from './account.js';
import { handleCryptoPayWebhook, handlePay, handlePayStatus } from './payments.js';
import {
  handleSticker,
  handleStickerSet,
  handleTemplateCallback,
  handleTemplates,
  packFromMessage,
  replyWithHelp,
  replyWithPack,
  replyWithTemplates,
  type CallbackQuery,
  type Message,
} from './templates.js';

export type { Env } from './shared.js';

const MAX_FILES = 20;
const MAX_TGS_BYTES = 64 * 1024;
const MAX_JSON_BYTES = 512 * 1024;
const FILE_NAME = /^[\p{L}\p{N}._-]{1,80}\.(tgs|json)$/u;

/** Sends documents to a chat: sendDocument for one file, sendMediaGroup (≤ 10 per album) for more. `progress.sent` counts delivered files. */
async function sendFiles(env: Env, chatId: number, files: File[], caption: string | null, progress: { sent: number }): Promise<void> {
  for (let start = 0; start < files.length; start += 10) {
    const chunk = files.slice(start, start + 10);
    const isLast = start + 10 >= files.length && caption !== null;
    const form = new FormData();
    form.set('chat_id', String(chatId));
    if (chunk.length === 1) {
      form.set('document', chunk[0], chunk[0].name);
      // Keep .tgs as a file (instead of converting it to a sticker) so it can be forwarded to @Stickers.
      form.set('disable_content_type_detection', 'true');
      if (isLast && caption) form.set('caption', caption);
      await telegram(env, 'sendDocument', form);
      progress.sent += 1;
      continue;
    }
    const media = chunk.map((_file, i) => ({
      type: 'document',
      media: `attach://file${i}`,
      disable_content_type_detection: true,
      ...(isLast && i === chunk.length - 1 ? { caption } : {}),
    }));
    form.set('media', JSON.stringify(media));
    chunk.forEach((file, i) => form.set(`file${i}`, file, file.name));
    await telegram(env, 'sendMediaGroup', form);
    progress.sent += chunk.length;
  }
}

async function handleSend(req: Request, env: Env, cors: Record<string, string>): Promise<Response> {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json({ ok: false, error: 'bad-request' }, 400, cors);
  }

  const auth = await authenticate(form, env.TELEGRAM_BOT_TOKEN);
  if (!auth.ok) return json({ ok: false, error: 'unauthorized', reason: auth.reason }, 401, cors);

  const files = form.getAll('files').filter((f): f is File => typeof f !== 'string');
  if (files.length === 0 || files.length > MAX_FILES) return json({ ok: false, error: 'bad-files' }, 400, cors);
  for (const f of files) {
    const limit = f.name.endsWith('.tgs') ? MAX_TGS_BYTES : MAX_JSON_BYTES;
    if (!FILE_NAME.test(f.name) || f.size === 0 || f.size > limit) return json({ ok: false, error: 'bad-files', file: f.name }, 400, cors);
  }

  // With accounts on, clients receive only designs they generated (paid for).
  if (!(await paidFor(env, auth.user.id, String(form.get('gens') ?? '').split(','), files.length))) return json({ ok: false, error: 'not-paid' }, 402, cors);

  const progress = { sent: 0 };
  // Big exports arrive in several requests: the instructions go with the last one only.
  const caption = form.get('last') === '0' ? null : TEXTS[pickLang(auth.user.language_code)].caption;
  try {
    await sendFiles(env, auth.user.id, files, caption, progress);
  } catch (err) {
    if (err instanceof TelegramError && err.status === 403) {
      // The user has not started the bot yet (or blocked it): the Mini App asks for write access and retries.
      return json({ ok: false, error: 'forbidden', ...progress }, 403, cors);
    }
    if (err instanceof TelegramError && err.status === 429) {
      return json({ ok: false, error: 'flood', retryAfter: err.retryAfter ?? 30, ...progress }, 429, cors);
    }
    console.error('send failed', err instanceof Error ? err.message : err);
    return json({ ok: false, error: 'telegram', detail: err instanceof Error ? err.message : undefined, ...progress }, 502, cors);
  }
  return json({ ok: true, sent: files.length }, 200, cors);
}

interface Update {
  message?: Message;
  callback_query?: CallbackQuery;
}

async function onMessage(env: Env, msg: Message): Promise<void> {
  const text = msg.text?.trim() ?? '';
  const command = /^\/([a-z]+)(?:@\w+)?/i.exec(text)?.[1]?.toLowerCase();
  if (command === 'start' && /^\/start(?:@\w+)?\s+link$/i.test(text) && msg.from) {
    // The editor in a browser: a code that lets it act for this user (see linkCode).
    const lang = pickLang(msg.from.language_code);
    const t = TEXTS[lang];
    const code = await linkCode(msg.from.id, lang, env.TELEGRAM_BOT_TOKEN);
    const back = `${env.APP_URL.replace(/#.*$/, '')}#tglink=${code}`;
    await telegram(env, 'sendMessage', {
      chat_id: msg.chat.id,
      text: t.link.replace('{code}', code).replace('{days}', String(LINK_DAYS)),
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[{ text: t.linkBack, url: back }], [{ text: t.linkCopy, copy_text: { text: code } }]] },
    });
    return;
  }
  if (command === 'start') {
    const t = TEXTS[pickLang(msg.from?.language_code)];
    await telegram(env, 'sendMessage', {
      chat_id: msg.chat.id,
      text: t.welcome,
      reply_markup: { inline_keyboard: [[{ text: t.open, web_app: { url: env.APP_URL } }]] },
    });
    return;
  }
  if (command === 'id') return replyWithHelp(env, msg, 'id');
  if (command === 'templates') return replyWithTemplates(env, msg);
  const pack = await packFromMessage(env, msg);
  if (pack) return replyWithPack(env, msg, pack);
  if (command === 'help' || text) return replyWithHelp(env, msg, 'help');
}

async function handleWebhook(req: Request, env: Env): Promise<Response> {
  if (req.headers.get('x-telegram-bot-api-secret-token') !== (await webhookSecret(env.TELEGRAM_BOT_TOKEN))) {
    return new Response('forbidden', { status: 403 });
  }
  const update = (await req.json().catch(() => ({}))) as Update;
  try {
    if (update.callback_query) await handleTemplateCallback(env, update.callback_query);
    else if (update.message && update.message.chat.type === 'private') await onMessage(env, update.message);
  } catch (err) {
    console.error('update failed', err instanceof Error ? err.message : err);
  }
  // Always 200 so Telegram does not retry the update.
  return new Response('ok');
}

/** GET /api/link?code= — whether a link code is good (the editor checks it before keeping it). */
async function handleLink(url: URL, env: Env, cors: Record<string, string>): Promise<Response> {
  const auth = await validateLinkCode(url.searchParams.get('code') ?? '', env.TELEGRAM_BOT_TOKEN);
  return auth.ok ? json({ ok: true }, 200, cors) : json({ ok: false, error: 'unauthorized', reason: auth.reason }, 401, cors);
}

export async function handle(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const cors = corsHeaders(req, env);

  if (!env.TELEGRAM_BOT_TOKEN) return json({ ok: false, error: 'not-configured' }, 500, cors);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method === 'POST' && url.pathname === '/api/send') return handleSend(req, env, cors);
  if (req.method === 'POST' && url.pathname === '/api/pack') return handlePack(req, env, cors);
  if (req.method === 'POST' && url.pathname === '/api/telegram') return handleWebhook(req, env);
  if (req.method === 'GET' && url.pathname === '/api/stickerset') return handleStickerSet(url, env);
  if (req.method === 'GET' && url.pathname === '/api/sticker') return handleSticker(url, env);
  if (req.method === 'GET' && url.pathname === '/api/templates') return handleTemplates(env);
  if (req.method === 'GET' && url.pathname === '/api/link') return handleLink(url, env, cors);
  if (url.pathname.startsWith('/api/app/')) {
    const action = url.pathname.slice('/api/app/'.length);
    if (req.method === 'POST' && action === 'cryptopay') return handleCryptoPayWebhook(req, env);
    if (req.method === 'GET' && action === 'catalog') return handleCatalog(env, cors);
    if (req.method === 'GET' && action === 'template-edits') return handleTemplateEdits(url, env, cors);
    if (req.method === 'POST' && action === 'me') return handleMe(req, env, cors);
    if (req.method === 'POST' && action === 'generate') return handleGenerate(req, env, cors);
    if (req.method === 'POST' && action === 'pay') return handlePay(req, env, cors);
    if (req.method === 'POST' && action === 'pay-status') return handlePayStatus(req, env, cors);
    if (req.method === 'POST' && action === 'wallet') return handleWallet(req, env, cors);
    if (req.method === 'POST' && action === 'admin') return handleAdmin(req, env, cors);
  }
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/api/health')) {
    // The numeric bot id (token prefix) is public; it lets setup scripts check the right token is configured.
    const bot = Number(env.TELEGRAM_BOT_TOKEN.split(':')[0]) || null;
    // The username lets the editor in a browser open the bot (t.me/<username>?start=link).
    const username = await botInfo(env).then((b) => b.username, () => null);
    return json({ ok: true, service: 'emoji-studio-bot', bot, username }, 200, cors);
  }
  return json({ ok: false, error: 'not-found' }, 404, cors);
}

const DEFAULT_APP_URL = 'https://oxytarget.github.io/lottie-emoji-editor/';
const DEFAULT_ORIGIN = 'https://oxytarget.github.io';

/**
 * The Upstash Redis REST address and token: KV_REST_API_* / UPSTASH_REDIS_REST_*, or <PREFIX>_REST_API_* /
 * <PREFIX>_KV_REST_API_* when the Vercel integration was connected with a custom prefix.
 */
export function redisFromEnv(vars: Record<string, string | undefined>): { url?: string; token?: string } {
  const pairs: Array<[string, string]> = [
    ['KV_REST_API_URL', 'KV_REST_API_TOKEN'],
    ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'],
    ...Object.keys(vars)
      .filter((k) => k.endsWith('_REST_API_URL') || k.endsWith('_REDIS_REST_URL'))
      .sort()
      .map((k): [string, string] => [k, k.replace(/_URL$/, '_TOKEN')]),
  ];
  for (const [u, t] of pairs) {
    const url = vars[u]?.trim();
    const token = vars[t]?.trim();
    if (url && token && /^https:\/\//.test(url)) return { url, token };
  }
  return {};
}

/** Settings from environment variables (Vercel / Node). */
export function envFromProcess(vars: Record<string, string | undefined>): Env {
  const redis = redisFromEnv(vars);
  const production = vars.VERCEL_PROJECT_PRODUCTION_URL ? `https://${vars.VERCEL_PROJECT_PRODUCTION_URL}` : '';
  return {
    TELEGRAM_BOT_TOKEN: (vars.TELEGRAM_BOT_TOKEN ?? '').trim(),
    APP_URL: vars.APP_URL || DEFAULT_APP_URL,
    ALLOWED_ORIGINS: vars.ALLOWED_ORIGINS || [DEFAULT_ORIGIN, production].filter(Boolean).join(','),
    TELEGRAM_API: vars.TELEGRAM_API,
    ADMIN_IDS: vars.ADMIN_IDS,
    KV_URL: redis.url,
    KV_TOKEN: redis.token,
    STORE: vars.STORE,
    CRYPTO_PAY_TOKEN: vars.CRYPTO_PAY_TOKEN?.trim(),
    CRYPTO_PAY_NETWORK: vars.CRYPTO_PAY_NETWORK?.trim().toLowerCase(),
    // Toncoin is Gram (GRAM) now; GRAM_* names work too.
    TON_WALLET: (vars.GRAM_WALLET || vars.TON_WALLET)?.trim(),
    TON_NETWORK: (vars.GRAM_NETWORK || vars.TON_NETWORK)?.trim().toLowerCase(),
    TONCENTER_API_KEY: vars.TONCENTER_API_KEY?.trim(),
    TON_USD_RATE: vars.GRAM_USD_RATE || vars.TON_USD_RATE,
  };
}
