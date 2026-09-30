// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { envFromProcess, handle, type Env } from '../../worker/src/app';
import cfWorker from '../../worker/src/index';
import { signInitData, validateInitData, webhookSecret } from '../../worker/src/telegram';

const TOKEN = '123456:TEST-token';
const env: Env = { TELEGRAM_BOT_TOKEN: TOKEN, APP_URL: 'https://example.github.io/app/', ALLOWED_ORIGINS: 'https://example.github.io', TELEGRAM_API: 'https://tg.test' };
const user = { id: 42, first_name: 'Ann', language_code: 'uk' };
const nowSec = () => Math.floor(Date.now() / 1000);

async function initData(extra: Record<string, string> = {}) {
  return signInitData({ auth_date: String(nowSec()), query_id: 'AAE', user: JSON.stringify(user), ...extra }, TOKEN);
}

interface Call {
  method: string;
  body: FormData | Record<string, unknown>;
}

function mockTelegram(respond: (method: string) => { ok: boolean; result?: unknown; error_code?: number; description?: string } = () => ({ ok: true, result: true })) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      const method = url.split('/').pop()!;
      expect(url.startsWith(`https://tg.test/bot${TOKEN}/`)).toBe(true);
      const body = init.body instanceof FormData ? init.body : JSON.parse(String(init.body));
      calls.push({ method, body });
      return new Response(JSON.stringify(respond(method)));
    }),
  );
  return calls;
}

function sendRequest(form: FormData, origin = 'https://example.github.io') {
  return new Request('https://worker.test/api/send', { method: 'POST', body: form, headers: { origin } });
}

const tgs = (name: string, size = 100) => new File([new Uint8Array(size).fill(1)], name, { type: 'application/x-tgsticker' });

afterEach(() => vi.unstubAllGlobals());

describe('validateInitData', () => {
  it('accepts correctly signed data and returns the user', async () => {
    const res = await validateInitData(await initData(), TOKEN);
    expect(res).toMatchObject({ ok: true, user: { id: 42 } });
  });

  it('accepts data signed including the newer signature field', async () => {
    const res = await validateInitData(await initData({ signature: 'abc' }), TOKEN);
    expect(res.ok).toBe(true);
  });

  it('rejects tampered, foreign, expired and empty data', async () => {
    const data = await initData();
    expect((await validateInitData(data.replace('Ann', 'Bob'), TOKEN)).ok).toBe(false);
    expect(await validateInitData(data, '999:other')).toMatchObject({ ok: false, reason: 'bad-hash' });
    const old = await signInitData({ auth_date: String(nowSec() - 3 * 86400), user: JSON.stringify(user) }, TOKEN);
    expect(await validateInitData(old, TOKEN)).toMatchObject({ ok: false, reason: 'expired' });
    expect(await validateInitData('', TOKEN)).toMatchObject({ ok: false, reason: 'missing' });
  });
});

describe('POST /api/send', () => {
  it('sends a single file with sendDocument to the user chat', async () => {
    const calls = mockTelegram();
    const form = new FormData();
    form.set('initData', await initData());
    form.append('files', tgs('emoji-classic.tgs'));
    const res = await handle(sendRequest(form), env);
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://example.github.io');
    expect(await res.json()).toEqual({ ok: true, sent: 1 });
    expect(calls.map((c) => c.method)).toEqual(['sendDocument']);
    const body = calls[0].body as FormData;
    expect(body.get('chat_id')).toBe('42');
    expect((body.get('document') as File).name).toBe('emoji-classic.tgs');
    expect(body.get('disable_content_type_detection')).toBe('true');
    expect(String(body.get('caption'))).toContain('@Stickers');
  });

  it('groups many files into albums of at most 10', async () => {
    const calls = mockTelegram();
    const form = new FormData();
    form.set('initData', await initData());
    for (let i = 0; i < 12; i++) form.append('files', tgs(`e-${i}.tgs`));
    const res = await handle(sendRequest(form), env);
    expect(res.status).toBe(200);
    expect(calls.map((c) => c.method)).toEqual(['sendMediaGroup', 'sendMediaGroup']);
    const first = calls[0].body as FormData;
    const media = JSON.parse(String(first.get('media')));
    expect(media).toHaveLength(10);
    expect(media[0]).toMatchObject({ type: 'document', media: 'attach://file0', disable_content_type_detection: true });
    expect((first.get('file9') as File).name).toBe('e-9.tgs');
    // Caption only on the very last album item.
    expect(media.some((m: { caption?: string }) => m.caption)).toBe(false);
    const second = JSON.parse(String((calls[1].body as FormData).get('media')));
    expect(second).toHaveLength(2);
    expect(second[1].caption).toContain('@Stickers');
  });

  it('rejects bad signatures, bad names and oversize files', async () => {
    const calls = mockTelegram();
    const bad = new FormData();
    bad.set('initData', (await initData()).replace('hash=', 'hash=0'));
    bad.append('files', tgs('a.tgs'));
    expect((await handle(sendRequest(bad), env)).status).toBe(401);

    const names = new FormData();
    names.set('initData', await initData());
    names.append('files', tgs('../../etc/passwd.tgs'));
    expect((await handle(sendRequest(names), env)).status).toBe(400);

    const big = new FormData();
    big.set('initData', await initData());
    big.append('files', tgs('big.tgs', 70 * 1024));
    expect((await handle(sendRequest(big), env)).status).toBe(400);

    const none = new FormData();
    none.set('initData', await initData());
    expect((await handle(sendRequest(none), env)).status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('maps "bot can\'t initiate conversation" to 403 so the app can ask for write access', async () => {
    mockTelegram(() => ({ ok: false, error_code: 403, description: "Forbidden: bot can't initiate conversation with a user" }));
    const form = new FormData();
    form.set('initData', await initData());
    form.append('files', tgs('a.tgs'));
    const res = await handle(sendRequest(form), env);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: 'forbidden' });
  });

  it('answers CORS preflight only for allowed origins', async () => {
    const ok = await handle(new Request('https://worker.test/api/send', { method: 'OPTIONS', headers: { origin: 'https://example.github.io' } }), env);
    expect(ok.headers.get('access-control-allow-methods')).toContain('POST');
    const other = await handle(new Request('https://worker.test/api/send', { method: 'OPTIONS', headers: { origin: 'https://evil.test' } }), env);
    expect(other.headers.get('access-control-allow-origin')).toBeNull();
  });
});

describe('POST /api/telegram (webhook)', () => {
  const update = (text: string) => ({ message: { chat: { id: 7, type: 'private' }, text, from: { language_code: 'ru' } } });

  it('replies to /start with a button that opens the Mini App', async () => {
    const calls = mockTelegram();
    const res = await handle(
      new Request('https://worker.test/api/telegram', {
        method: 'POST',
        body: JSON.stringify(update('/start')),
        headers: { 'x-telegram-bot-api-secret-token': await webhookSecret(TOKEN) },
      }),
      env,
    );
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('sendMessage');
    const body = calls[0].body as { chat_id: number; text: string; reply_markup: { inline_keyboard: { web_app: { url: string } }[][] } };
    expect(body.chat_id).toBe(7);
    expect(body.text).toContain('Привет');
    expect(body.reply_markup.inline_keyboard[0][0].web_app.url).toBe(env.APP_URL);
  });

  it('ignores requests without the webhook secret', async () => {
    const calls = mockTelegram();
    const res = await handle(new Request('https://worker.test/api/telegram', { method: 'POST', body: JSON.stringify(update('/start')) }), env);
    expect(res.status).toBe(403);
    expect(calls).toHaveLength(0);
  });
});

describe('platform entry points', () => {
  it('derives settings from environment variables (Vercel)', () => {
    const e = envFromProcess({ TELEGRAM_BOT_TOKEN: ' 1:x ', VERCEL_PROJECT_PRODUCTION_URL: 'emoji.vercel.app' });
    expect(e.TELEGRAM_BOT_TOKEN).toBe('1:x');
    expect(e.APP_URL).toBe('https://oxytarget.github.io/lottie-emoji-editor/');
    expect(e.ALLOWED_ORIGINS).toBe('https://oxytarget.github.io,https://emoji.vercel.app');
  });

  it('Vercel function sends files using TELEGRAM_BOT_TOKEN from the environment', async () => {
    const calls = mockTelegram();
    vi.stubEnv('TELEGRAM_BOT_TOKEN', TOKEN);
    vi.stubEnv('TELEGRAM_API', 'https://tg.test');
    try {
      const { POST } = await import('../../api/send');
      const form = new FormData();
      form.set('initData', await initData());
      form.append('files', tgs('emoji-classic.tgs'));
      const res = await POST(new Request('https://emoji.vercel.app/api/send', { method: 'POST', body: form }));
      expect(res.status).toBe(200);
      expect(calls.map((c) => c.method)).toEqual(['sendDocument']);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('reports a missing token instead of crashing', async () => {
    vi.stubEnv('TELEGRAM_BOT_TOKEN', '');
    try {
      const { GET } = await import('../../api/health');
      const res = await GET(new Request('https://emoji.vercel.app/api/health'));
      expect(res.status).toBe(500);
      expect(await res.json()).toMatchObject({ error: 'not-configured' });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('Cloudflare entry delegates to the shared handler', async () => {
    const res = await cfWorker.fetch(new Request('https://worker.test/'), env);
    expect(await res.json()).toMatchObject({ ok: true });
  });
});
