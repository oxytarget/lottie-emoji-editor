/** HTTP + Telegram Bot API helpers shared by the backend handlers. */

export interface Env {
  TELEGRAM_BOT_TOKEN: string;
  APP_URL: string;
  ALLOWED_ORIGINS?: string;
  TELEGRAM_API?: string;
}

export class TelegramError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function corsHeaders(req: Request, env: Env): Record<string, string> {
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

export function json(body: unknown, status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers } });
}

export async function telegram(env: Env, method: string, body: FormData | Record<string, unknown>): Promise<unknown> {
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
