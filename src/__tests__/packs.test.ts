// @vitest-environment node
import { gunzipSync, strFromU8 } from 'fflate';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { toTgs } from '../lottie/export';
import { compose } from '../lottie/compose';
import { solid } from '../lottie/paint';
import { BUILTIN_TEMPLATES } from '../templates/builtin';
import { handle, type Env } from '../../worker/src/app';
import { isOwnPackName, newPackName, sanitizeEmoji, sanitizeTitle } from '../../worker/src/packs';
import { signInitData } from '../../worker/src/telegram';
import { toEmojiCanvas } from '../../worker/src/tgs';

const TOKEN = '777:PACKS-token';
const env: Env = { TELEGRAM_BOT_TOKEN: TOKEN, APP_URL: 'https://example.github.io/app/', ALLOWED_ORIGINS: 'https://example.github.io', TELEGRAM_API: 'https://tg.test' };
const user = { id: 1234567, first_name: 'Ann', language_code: 'uk' };

const tgs = (i = 0) =>
  toTgs(
    compose({
      template: BUILTIN_TEMPLATES[i],
      art: null,
      artStyle: { mode: 'paint', fill: solid('#fff'), outline: null, outlineWidth: 0 },
      colors: { body: solid('#7c3aed'), outline: solid('#111111'), accent: solid('#f59e0b') },
      outlineWidth: 12,
      scale: 1,
      offsetY: 0,
    }),
  );

const readAnim = async (f: File) => JSON.parse(strFromU8(gunzipSync(new Uint8Array(await f.arrayBuffer()))));

type Responder = (method: string, n: number) => { ok: boolean; result?: unknown; error_code?: number; description?: string };
function mockTelegram(respond: Responder = () => ({ ok: true, result: true })) {
  const calls: { method: string; body: FormData | Record<string, unknown> }[] = [];
  const counts = new Map<string, number>();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      const method = url.split('/').pop()!;
      const n = (counts.get(method) ?? 0) + 1;
      counts.set(method, n);
      calls.push({ method, body: init.body instanceof FormData ? init.body : JSON.parse(String(init.body)) });
      if (method === 'getMe') return new Response(JSON.stringify({ ok: true, result: { id: 777, username: 'Test_Emoji_bot' } }));
      return new Response(JSON.stringify(respond(method, n)));
    }),
  );
  return calls;
}

async function packRequest(opts: { files?: number; emojis?: string[]; title?: string; set?: string } = {}) {
  const form = new FormData();
  form.set('initData', await signInitData({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify(user) }, TOKEN));
  form.set('title', opts.title ?? 'My   pack ');
  if (opts.set) form.set('set', opts.set);
  for (let i = 0; i < (opts.files ?? 2); i++) {
    form.append('files', new File([tgs(i) as Uint8Array<ArrayBuffer>], `e-${i}.tgs`));
    form.append('emojis', opts.emojis?.[i] ?? '🔥');
  }
  return new Request('https://api.test/api/pack', { method: 'POST', body: form, headers: { origin: 'https://example.github.io' } });
}

afterEach(() => vi.unstubAllGlobals());

describe('pack helpers', () => {
  it('builds valid pack names', () => {
    const name = newPackName(1234567, 'Test_Emoji_bot', () => 0.5);
    expect(name).toMatch(/^e[a-z0-9]+_[a-z0-9]{5}_by_Test_Emoji_bot$/);
    expect(name.length).toBeLessThanOrEqual(64);
    expect(isOwnPackName(name, 'test_emoji_bot')).toBe(true);
    expect(isOwnPackName('other_by_somebot', 'test_emoji_bot')).toBe(false);
    expect(isOwnPackName('a__b_by_test_emoji_bot', 'test_emoji_bot')).toBe(false);
  });

  it('sanitizes emoji and titles', () => {
    expect(sanitizeEmoji('❤️')).toBe('❤️');
    expect(sanitizeEmoji('👩‍💻')).toBe('👩‍💻');
    expect(sanitizeEmoji('1️⃣')).toBe('1️⃣');
    expect(sanitizeEmoji('abc')).toBe('⭐');
    expect(sanitizeEmoji('')).toBe('⭐');
    expect(sanitizeTitle('  My   pack ')).toBe('My pack');
    expect(sanitizeTitle('')).toBe('Emoji Studio');
    expect(Array.from(sanitizeTitle('я'.repeat(100)))).toHaveLength(64);
  });

  it('re-targets a TGS to the 100×100 emoji canvas without touching the scene', async () => {
    const original = tgs(0);
    const small = await toEmojiCanvas(original, 100);
    const anim = JSON.parse(strFromU8(gunzipSync(small)));
    const before = JSON.parse(strFromU8(gunzipSync(original)));
    expect(anim.tgs).toBe(1);
    expect([anim.w, anim.h]).toEqual([100, 100]);
    const root = anim.layers[anim.layers.length - 1];
    expect(root.ty).toBe(3);
    expect(root.ks.s.k[0]).toBeCloseTo(19.53125, 5);
    for (const l of anim.layers.slice(0, -1)) expect(l.parent).toBeDefined();
    // Layers that already had a parent keep it.
    const parented = before.layers.filter((l: { parent?: number }) => l.parent).map((l: { ind: number; parent: number }) => [l.ind, l.parent]);
    for (const [ind, parent] of parented) expect(anim.layers.find((l: { ind: number }) => l.ind === ind).parent).toBe(parent);
    expect(await toEmojiCanvas(small, 100)).toBe(small);
  });
});

describe('POST /api/pack', () => {
  it('creates a custom emoji pack owned by the user and sends the link', async () => {
    const calls = mockTelegram();
    const res = await handle(await packRequest({ emojis: ['🔥', 'nope'] }), env);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, title: 'My pack', added: 2, canvas: 100 });
    expect(body.url).toBe(`https://t.me/addemoji/${body.name}`);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://example.github.io');

    const create = calls.find((c) => c.method === 'createNewStickerSet')!.body as FormData;
    expect(create.get('user_id')).toBe('1234567');
    expect(create.get('sticker_type')).toBe('custom_emoji');
    expect(create.get('title')).toBe('My pack');
    expect(String(create.get('name'))).toMatch(/_by_Test_Emoji_bot$/);
    const stickers = JSON.parse(String(create.get('stickers')));
    expect(stickers).toEqual([
      { sticker: 'attach://s0', format: 'animated', emoji_list: ['🔥'] },
      { sticker: 'attach://s1', format: 'animated', emoji_list: ['⭐'] },
    ]);
    expect((await readAnim(create.get('s0') as File)).w).toBe(100);

    const msg = calls.find((c) => c.method === 'sendMessage')!.body as { chat_id: number; text: string; reply_markup: { inline_keyboard: { url: string }[][] } };
    expect(msg.chat_id).toBe(1234567);
    expect(msg.text).toContain('My pack');
    expect(msg.reply_markup.inline_keyboard[0][0].url).toBe(body.url);
  });

  it('falls back to the 512×512 canvas when Telegram rejects the emoji file', async () => {
    const calls = mockTelegram((method, n) =>
      method === 'createNewStickerSet' && n === 1 ? { ok: false, error_code: 400, description: 'Bad Request: STICKER_TGS_NOTGS' } : { ok: true, result: true },
    );
    const res = await handle(await packRequest({ files: 1 }), env);
    expect(await res.json()).toMatchObject({ ok: true, canvas: 512 });
    const creates = calls.filter((c) => c.method === 'createNewStickerSet').map((c) => c.body as FormData);
    expect(creates).toHaveLength(2);
    expect((await readAnim(creates[0].get('s0') as File)).w).toBe(100);
    expect((await readAnim(creates[1].get('s0') as File)).w).toBe(512);
  });

  it('picks a new name when the generated one is taken', async () => {
    const calls = mockTelegram((method, n) =>
      method === 'createNewStickerSet' && n === 1 ? { ok: false, error_code: 400, description: 'Bad Request: sticker set name is already occupied' } : { ok: true, result: true },
    );
    const res = await handle(await packRequest({ files: 1 }), env);
    expect(res.status).toBe(200);
    const names = calls.filter((c) => c.method === 'createNewStickerSet').map((c) => (c.body as FormData).get('name'));
    expect(names).toHaveLength(2);
  });

  it('adds emoji to an existing pack created by the bot', async () => {
    const calls = mockTelegram();
    const set = 'eabc_12345_by_test_emoji_bot';
    const res = await handle(await packRequest({ files: 3, set }), env);
    expect(await res.json()).toMatchObject({ ok: true, name: set, added: 3 });
    const adds = calls.filter((c) => c.method === 'addStickerToSet').map((c) => c.body as FormData);
    expect(adds).toHaveLength(3);
    expect(adds[0].get('name')).toBe(set);
    expect(JSON.parse(String(adds[0].get('sticker')))).toMatchObject({ format: 'animated', emoji_list: ['🔥'] });
    expect(calls.some((c) => c.method === 'createNewStickerSet')).toBe(false);
  });

  it('refuses packs of other bots and maps Telegram errors', async () => {
    let calls = mockTelegram();
    let res = await handle(await packRequest({ set: 'someone_by_other_bot' }), env);
    expect(res.status).toBe(404);
    expect(calls.some((c) => c.method === 'addStickerToSet')).toBe(false);

    mockTelegram((method) => (method === 'createNewStickerSet' ? { ok: false, error_code: 400, description: 'Bad Request: PEER_ID_INVALID' } : { ok: true }));
    res = await handle(await packRequest(), env);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: 'forbidden' });

    calls = mockTelegram((method) => (method === 'addStickerToSet' ? { ok: false, error_code: 400, description: 'Bad Request: STICKERS_TOO_MUCH' } : { ok: true }));
    res = await handle(await packRequest({ set: 'eabc_12345_by_test_emoji_bot' }), env);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'pack-full' });
  });

  it('rejects unsigned requests and non-TGS files', async () => {
    const calls = mockTelegram();
    const bad = new FormData();
    bad.set('initData', 'user=%7B%22id%22%3A1%7D&hash=00');
    bad.append('files', new File([tgs(0) as Uint8Array<ArrayBuffer>], 'a.tgs'));
    expect((await handle(new Request('https://api.test/api/pack', { method: 'POST', body: bad }), env)).status).toBe(401);

    const json = new FormData();
    json.set('initData', await signInitData({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify(user) }, TOKEN));
    json.append('files', new File(['{}'], 'a.json'));
    expect((await handle(new Request('https://api.test/api/pack', { method: 'POST', body: json }), env)).status).toBe(400);
    expect(calls).toHaveLength(0);
  });
});
