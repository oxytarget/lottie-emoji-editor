/** HTTP + Telegram Bot API helpers shared by the backend handlers. */

export interface Env {
  TELEGRAM_BOT_TOKEN: string;
  APP_URL: string;
  ALLOWED_ORIGINS?: string;
  TELEGRAM_API?: string;
  /** Telegram user ids (comma separated) allowed to add template packs for everyone. */
  ADMIN_IDS?: string;
}

export class TelegramError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** Seconds Telegram asks to wait (flood control, HTTP 429). */
    readonly retryAfter?: number,
  ) {
    super(message);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Short flood waits are sat out here; longer ones go back to the client, which waits and continues. */
const MAX_INLINE_WAIT = 8;

export function corsHeaders(req: Request, env: Env): Record<string, string> {
  const origin = req.headers.get('origin') ?? '';
  const allowed = (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!origin || !allowed.includes(origin)) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
    vary: 'origin',
  };
}

export function json(body: unknown, status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers } });
}

const apiBase = (env: Env) => (env.TELEGRAM_API ?? 'https://api.telegram.org').replace(/\/$/, '');

/** Download URL of a file from getFile (contains the token — never hand it to clients). */
export const telegramFileUrl = (env: Env, path: string): string => `${apiBase(env)}/file/bot${env.TELEGRAM_BOT_TOKEN}/${path}`;

export async function telegram(env: Env, method: string, body: FormData | Record<string, unknown>): Promise<unknown> {
  const base = apiBase(env);
  const init: RequestInit =
    body instanceof FormData
      ? { method: 'POST', body }
      : { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } };
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${base}/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, init);
    const data = (await res.json().catch(() => ({ ok: false, description: `HTTP ${res.status}` }))) as {
      ok: boolean;
      result?: unknown;
      description?: string;
      error_code?: number;
      parameters?: { retry_after?: number };
    };
    if (data.ok) return data.result;
    const code = data.error_code ?? res.status;
    const retryAfter = code === 429 ? data.parameters?.retry_after ?? (Number(/retry after (\d+)/i.exec(data.description ?? '')?.[1]) || 5) : undefined;
    if (retryAfter !== undefined && retryAfter <= MAX_INLINE_WAIT && attempt < 2) {
      await sleep(retryAfter * 1000 + 300);
      continue;
    }
    throw new TelegramError(code, data.description ?? 'Telegram API error', retryAfter);
  }
}
