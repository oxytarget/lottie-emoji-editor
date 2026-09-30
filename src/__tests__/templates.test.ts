// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { handle, type Env } from '../../worker/src/app';
import { webhookSecret } from '../../worker/src/telegram';
import { formatStore, parsePackLink, parseStore, STORE_HEAD } from '../../worker/src/templates';

const TOKEN = '555:TPL-token';
const ADMIN = 900;
const env: Env = { TELEGRAM_BOT_TOKEN: TOKEN, APP_URL: 'https://example.github.io/app/', ALLOWED_ORIGINS: 'https://example.github.io', TELEGRAM_API: 'https://tg.test' };
const adminEnv: Env = { ...env, ADMIN_IDS: `${ADMIN}, 901` };

const set = {
  name: 'Brand_by_somebot',
  title: 'Brand pack',
  sticker_type: 'custom_emoji',
  stickers: [
    { file_id: 'FILEID-animated-1', file_unique_id: 'U1', emoji: '😀', is_animated: true, is_video: false },
    { file_id: 'FILEID-video-2', file_unique_id: 'U2', emoji: '🔥', is_animated: false, is_video: true },
    { file_id: 'FILEID-animated-3', file_unique_id: 'U3', emoji: '❤️', is_animated: true, is_video: false },
  ],
};

interface Call {
  method: string;
  body: Record<string, unknown>;
}
type Reply = { ok: boolean; result?: unknown; error_code?: number; description?: string };

function mockTelegram(respond: (method: string, body: Record<string, unknown>) => Reply | Uint8Array) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith(`https://tg.test/file/bot${TOKEN}/`)) {
        calls.push({ method: 'download', body: { path: url.split(`/file/bot${TOKEN}/`)[1] } });
        const r = respond('download', {});
        return new Response(r instanceof Uint8Array ? (r as Uint8Array<ArrayBuffer>) : null);
      }
      const method = url.split('/').pop()!;
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      calls.push({ method, body });
      return new Response(JSON.stringify(respond(method, body)));
    }),
  );
  return calls;
}

const telegramDefaults = (method: string): Reply => {
  if (method === 'getStickerSet') return { ok: true, result: set };
  if (method === 'sendMessage') return { ok: true, result: { message_id: 77 } };
  if (method === 'getChat') return { ok: true, result: { id: ADMIN } };
  return { ok: true, result: true };
};

const webhook = async (update: unknown, e = env) =>
  handle(
    new Request('https://api.test/api/telegram', {
      method: 'POST',
      body: JSON.stringify(update),
      headers: { 'x-telegram-bot-api-secret-token': await webhookSecret(TOKEN) },
    }),
    e,
  );

const message = (extra: Record<string, unknown>, from = 42) => ({ message: { message_id: 5, chat: { id: from, type: 'private' }, from: { id: from, language_code: 'uk' }, ...extra } });
type Keyboard = { inline_keyboard: Array<Array<{ text: string; web_app?: { url: string }; callback_data?: string }>> };

afterEach(() => vi.unstubAllGlobals());

describe('pack links', () => {
  it('reads pack names from sticker and emoji links', () => {
    expect(parsePackLink('look https://t.me/addstickers/Cats_by_bot !')).toBe('Cats_by_bot');
    expect(parsePackLink('t.me/addemoji/Brand_pack')).toBe('Brand_pack');
    expect(parsePackLink('tg://addstickers?set=Dogs')).toBe('Dogs');
    expect(parsePackLink('hello')).toBeNull();
  });

  it('stores the template list in a readable message and reads it back', () => {
    const packs = [
      { name: 'A_pack', title: 'First  pack\nwith newline' },
      { name: 'B', title: 'B — dash' },
    ];
    const text = formatStore(packs, 'uk');
    expect(text.startsWith(STORE_HEAD)).toBe(true);
    expect(parseStore(text)).toEqual([
      { name: 'A_pack', title: 'First pack with newline' },
      { name: 'B', title: 'B — dash' },
    ]);
  });
});

describe('GET /api/stickerset and /api/sticker', () => {
  it('lists only animated stickers, publicly and cacheable', async () => {
    mockTelegram(telegramDefaults);
    const res = await handle(new Request('https://api.test/api/stickerset?name=Brand_by_somebot'), env);
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('cache-control')).toContain('s-maxage');
    const body = await res.json();
    expect(body).toMatchObject({ name: 'Brand_by_somebot', title: 'Brand pack', skipped: 1 });
    expect(body.items).toEqual([
      { id: 'FILEID-animated-1', uid: 'U1', emoji: '😀' },
      { id: 'FILEID-animated-3', uid: 'U3', emoji: '❤️' },
    ]);
  });

  it('answers 404 for unknown packs and 400 for bad names', async () => {
    mockTelegram(() => ({ ok: false, error_code: 400, description: 'Bad Request: STICKERSET_INVALID' }));
    expect((await handle(new Request('https://api.test/api/stickerset?name=Nope'), env)).status).toBe(404);
    expect((await handle(new Request('https://api.test/api/stickerset?name=bad%20name'), env)).status).toBe(400);
  });

  it('proxies .tgs sticker files without exposing the token', async () => {
    const tgs = new Uint8Array([0x1f, 0x8b, 1, 2, 3]);
    const calls = mockTelegram((method) => (method === 'download' ? tgs : { ok: true, result: { file_path: 'stickers/file_1.tgs', file_size: 5 } }));
    const res = await handle(new Request('https://api.test/api/sticker?id=FILEID-animated-1'), env);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/x-tgsticker');
    expect(res.headers.get('cache-control')).toContain('immutable');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(tgs);
    expect(calls.map((c) => c.method)).toEqual(['getFile', 'download']);
  });

  it('refuses files that are not animated stickers', async () => {
    mockTelegram(() => ({ ok: true, result: { file_path: 'documents/secret.pdf', file_size: 5 } }));
    expect((await handle(new Request('https://api.test/api/sticker?id=FILEID-document-9'), env)).status).toBe(404);
    expect((await handle(new Request('https://api.test/api/sticker?id=x'), env)).status).toBe(400);
  });
});

describe('bot chat: packs → templates', () => {
  it('answers a sticker with a button that opens its pack in the editor (and how to become admin)', async () => {
    const calls = mockTelegram(telegramDefaults);
    await webhook(message({ sticker: { ...set.stickers[0], set_name: 'Brand_by_somebot' } }));
    const reply = calls.find((c) => c.method === 'sendMessage')!.body as { text: string; reply_markup: Keyboard };
    expect(reply.text).toContain('Brand pack');
    expect(reply.text).toContain('ADMIN_IDS=42');
    expect(reply.reply_markup.inline_keyboard).toHaveLength(1);
    expect(reply.reply_markup.inline_keyboard[0][0].web_app!.url).toBe('https://example.github.io/app/?pack=Brand_by_somebot');
  });

  it('finds the pack of a custom emoji and of a link', async () => {
    const calls = mockTelegram((method) =>
      method === 'getCustomEmojiStickers' ? { ok: true, result: [{ ...set.stickers[0], set_name: 'Brand_by_somebot' }] } : telegramDefaults(method),
    );
    await webhook(message({ text: '😀', entities: [{ type: 'custom_emoji', offset: 0, length: 2, custom_emoji_id: '123' }] }));
    await webhook(message({ text: 'https://t.me/addemoji/Brand_by_somebot' }));
    expect(calls.filter((c) => c.method === 'getStickerSet').map((c) => c.body.name)).toEqual(['Brand_by_somebot', 'Brand_by_somebot']);
    expect(calls.filter((c) => c.method === 'sendMessage')).toHaveLength(2);
  });

  it('gives admins a button that adds the pack to the bot templates (kept in a pinned message)', async () => {
    let pinned: { message_id: number; text: string; from: { id: number } } | undefined;
    const calls = mockTelegram((method, body) => {
      if (method === 'getChat') return { ok: true, result: { id: ADMIN, pinned_message: pinned } };
      if (method === 'pinChatMessage') pinned = { message_id: body.message_id as number, text: String(calls.find((c) => c.method === 'sendMessage' && c.body.chat_id === ADMIN)!.body.text), from: { id: 555 } };
      return telegramDefaults(method);
    });

    await webhook(message({ text: 't.me/addemoji/Brand_by_somebot' }, ADMIN), adminEnv);
    const offer = calls.find((c) => c.method === 'sendMessage')!.body as { text: string; reply_markup: Keyboard };
    expect(offer.text).not.toContain('ADMIN_IDS');
    expect(offer.reply_markup.inline_keyboard[1][0].callback_data).toBe('tpl:add');

    calls.length = 0;
    const callback = (data: string) => ({
      callback_query: { id: 'cb1', from: { id: ADMIN, language_code: 'uk' }, data, message: { message_id: 5, chat: { id: ADMIN, type: 'private' }, reply_markup: offer.reply_markup } },
    });
    await webhook(callback('tpl:add'), adminEnv);
    expect(calls.map((c) => c.method)).toEqual(['getChat', 'getStickerSet', 'sendMessage', 'pinChatMessage', 'answerCallbackQuery', 'editMessageReplyMarkup']);
    expect(String(calls[2].body.text)).toContain('• Brand_by_somebot — Brand pack');
    expect((calls[5].body.reply_markup as Keyboard).inline_keyboard[1][0].callback_data).toBe('tpl:del');

    const list = await (await handle(new Request('https://api.test/api/templates'), adminEnv)).json();
    expect(list.packs).toEqual([{ name: 'Brand_by_somebot', title: 'Brand pack' }]);

    // Removing edits the same pinned message.
    calls.length = 0;
    await webhook(callback('tpl:del'), adminEnv);
    const edit = calls.find((c) => c.method === 'editMessageText')!;
    expect(edit.body.message_id).toBe(77);
    expect(String(edit.body.text)).not.toContain('Brand_by_somebot');
  });

  it('does not let other users change the bot templates', async () => {
    const calls = mockTelegram(telegramDefaults);
    await webhook({ callback_query: { id: 'cb', from: { id: 42, language_code: 'uk' }, data: 'tpl:add', message: { message_id: 1, chat: { id: 42, type: 'private' } } } }, adminEnv);
    expect(calls.map((c) => c.method)).toEqual(['answerCallbackQuery']);
    expect(String(calls[0].body.text)).toContain('адміністратор');
  });

  it('lists templates and explains itself for other messages', async () => {
    const calls = mockTelegram(telegramDefaults);
    await webhook(message({ text: '/templates' }), adminEnv);
    await webhook(message({ text: 'hi' }));
    await webhook(message({ text: '/id' }));
    const texts = calls.filter((c) => c.method === 'sendMessage').map((c) => String(c.body.text));
    expect(texts[0]).toContain('Шаблонів бота поки немає');
    expect(texts[1]).toContain('t.me/addstickers');
    expect(texts[2]).toBe('Ваш Telegram ID: 42');
  });

  it('returns an empty template list when no admin is configured', async () => {
    const calls = mockTelegram(telegramDefaults);
    const body = await (await handle(new Request('https://api.test/api/templates'), env)).json();
    expect(body.packs).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});
