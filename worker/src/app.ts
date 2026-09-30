/**
 * Emoji Studio bot backend — plain Web `Request → Response`, runs on Vercel (api/*.ts) and Cloudflare Workers (index.ts).
 *
 *   POST /api/send       — the Mini App uploads exported files; the bot sends them to the user's chat.
 *   POST /api/telegram   — bot webhook: answers /start with a button that opens the editor.
 *   GET  /               — health check.
 *
 * Settings: TELEGRAM_BOT_TOKEN (secret), APP_URL, ALLOWED_ORIGINS (comma separated), TELEGRAM_API (optional, for tests).
 */
import { pickLang, TEXTS, validateInitData, webhookSecret } from './telegram.js';

export interface Env {
  TELEGRAM_BOT_TOKEN: string;
  APP_URL: string;
  ALLOWED_ORIGINS?: string;
  TELEGRAM_API?: string;
}

const MAX_FILES = 20;
const MAX_TGS_BYTES = 64 * 1024;
const MAX_JSON_BYTES = 512 * 1024;
const FILE_NAME = /^[\p{L}\p{N}._-]{1,80}\.(tgs|json)$/u;

class TelegramError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function corsHeaders(req: Request, env: Env): Record<string, string> {
  const origin = req.headers.get('origin') ?? '';
  const allowed = (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!origin || !allowed.includes(origin)) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
    vary: 'origin',
  };
}

function json(body: unknown, status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers } });
}

async function telegram(env: Env, method: string, body: FormData | Record<string, unknown>): Promise<unknown> {
  const base = (env.TELEGRAM_API ?? 'https://api.telegram.org').replace(/\/$/, '');
  const init: RequestInit =
    body instanceof FormData
      ? { method: 'POST', body }
      : { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } };
  const res = await fetch(`${base}/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, init);
  const data = (await res.json().catch(() => ({ ok: false, description: `HTTP ${res.status}` }))) as {
    ok: boolean;
    result?: unknown;
    description?: string;
    error_code?: number;
  };
  if (!data.ok) throw new TelegramError(data.error_code ?? res.status, data.description ?? 'Telegram API error');
  return data.result;
}

/** Sends documents to a chat: sendDocument for one file, sendMediaGroup (≤ 10 per album) for more. */
async function sendFiles(env: Env, chatId: number, files: File[], caption: string): Promise<void> {
  for (let start = 0; start < files.length; start += 10) {
    const chunk = files.slice(start, start + 10);
    const isLast = start + 10 >= files.length;
    const form = new FormData();
    form.set('chat_id', String(chatId));
    if (chunk.length === 1) {
      form.set('document', chunk[0], chunk[0].name);
      // Keep .tgs as a file (instead of converting it to a sticker) so it can be forwarded to @Stickers.
      form.set('disable_content_type_detection', 'true');
      if (isLast) form.set('caption', caption);
      await telegram(env, 'sendDocument', form);
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
  }
}

async function handleSend(req: Request, env: Env, cors: Record<string, string>): Promise<Response> {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json({ ok: false, error: 'bad-request' }, 400, cors);
  }

  const auth = await validateInitData(String(form.get('initData') ?? ''), env.TELEGRAM_BOT_TOKEN);
  if (!auth.ok) return json({ ok: false, error: 'unauthorized', reason: auth.reason }, 401, cors);

  const files = form.getAll('files').filter((f): f is File => typeof f !== 'string');
  if (files.length === 0 || files.length > MAX_FILES) return json({ ok: false, error: 'bad-files' }, 400, cors);
  for (const f of files) {
    const limit = f.name.endsWith('.tgs') ? MAX_TGS_BYTES : MAX_JSON_BYTES;
    if (!FILE_NAME.test(f.name) || f.size === 0 || f.size > limit) return json({ ok: false, error: 'bad-files', file: f.name }, 400, cors);
  }

  try {
    await sendFiles(env, auth.user.id, files, TEXTS[pickLang(auth.user.language_code)].caption);
  } catch (err) {
    if (err instanceof TelegramError && err.status === 403) {
      // The user has not started the bot yet (or blocked it): the Mini App asks for write access and retries.
      return json({ ok: false, error: 'forbidden' }, 403, cors);
    }
    console.error('send failed', err instanceof Error ? err.message : err);
    return json({ ok: false, error: 'telegram' }, 502, cors);
  }
  return json({ ok: true, sent: files.length }, 200, cors);
}

interface Update {
  message?: { chat: { id: number; type: string }; text?: string; from?: { language_code?: string } };
}

async function handleWebhook(req: Request, env: Env): Promise<Response> {
  if (req.headers.get('x-telegram-bot-api-secret-token') !== (await webhookSecret(env.TELEGRAM_BOT_TOKEN))) {
    return new Response('forbidden', { status: 403 });
  }
  const update = (await req.json().catch(() => ({}))) as Update;
  const msg = update.message;
  if (msg && msg.chat.type === 'private' && msg.text?.startsWith('/start')) {
    const t = TEXTS[pickLang(msg.from?.language_code)];
    try {
      await telegram(env, 'sendMessage', {
        chat_id: msg.chat.id,
        text: t.welcome,
        reply_markup: { inline_keyboard: [[{ text: t.open, web_app: { url: env.APP_URL } }]] },
      });
    } catch (err) {
      console.error('reply failed', err instanceof Error ? err.message : err);
    }
  }
  // Always 200 so Telegram does not retry the update.
  return new Response('ok');
}

export async function handle(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const cors = corsHeaders(req, env);

  if (!env.TELEGRAM_BOT_TOKEN) return json({ ok: false, error: 'not-configured' }, 500, cors);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method === 'POST' && url.pathname === '/api/send') return handleSend(req, env, cors);
  if (req.method === 'POST' && url.pathname === '/api/telegram') return handleWebhook(req, env);
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/api/health')) return json({ ok: true, service: 'emoji-studio-bot' }, 200, cors);
  return json({ ok: false, error: 'not-found' }, 404, cors);
}

const DEFAULT_APP_URL = 'https://oxytarget.github.io/lottie-emoji-editor/';
const DEFAULT_ORIGIN = 'https://oxytarget.github.io';

/** Settings from environment variables (Vercel / Node). */
export function envFromProcess(vars: Record<string, string | undefined>): Env {
  const production = vars.VERCEL_PROJECT_PRODUCTION_URL ? `https://${vars.VERCEL_PROJECT_PRODUCTION_URL}` : '';
  return {
    TELEGRAM_BOT_TOKEN: (vars.TELEGRAM_BOT_TOKEN ?? '').trim(),
    APP_URL: vars.APP_URL || DEFAULT_APP_URL,
    ALLOWED_ORIGINS: vars.ALLOWED_ORIGINS || [DEFAULT_ORIGIN, production].filter(Boolean).join(','),
    TELEGRAM_API: vars.TELEGRAM_API,
  };
}
