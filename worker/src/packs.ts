/**
 * POST /api/pack — the bot creates a custom emoji pack owned by the user (or adds to one it created earlier).
 *
 * Form fields: initData, title, set (optional existing pack name), files[] (.tgs) and emojis[] (one per file).
 */
import { json, json as jsonResponse, telegram, TelegramError, type Env } from './shared.js';
import { packTexts, pickLang, validateInitData } from './telegram.js';
import { toEmojiCanvas } from './tgs.js';

const MAX_FILES = 50; // createNewStickerSet accepts up to 50 initial stickers
const MAX_TGS_BYTES = 64 * 1024;
const DEFAULT_EMOJI = '⭐';

/** Errors that mean "Telegram did not like the sticker file" — worth retrying with the other canvas size. */
const FORMAT_ERROR = /TGS|DIMENSION|FILE_INVALID|STICKER_FILE|wrong file|invalid file|file is too big|STICKER_VIDEO|ANIMATED/i;
const FORBIDDEN_ERROR = /PEER_ID_INVALID|user not found|can't initiate|blocked by the user|USER_IS_BLOCKED|USER_DEACTIVATED/i;
const NAME_TAKEN_ERROR = /already occupied|STICKERSET_NAME_OCCUPIED/i;

const botCache = new Map<string, Promise<{ id: number; username: string }>>();

function botInfo(env: Env): Promise<{ id: number; username: string }> {
  let p = botCache.get(env.TELEGRAM_BOT_TOKEN);
  if (!p) {
    p = telegram(env, 'getMe', {}) as Promise<{ id: number; username: string }>;
    p.catch(() => botCache.delete(env.TELEGRAM_BOT_TOKEN));
    botCache.set(env.TELEGRAM_BOT_TOKEN, p);
  }
  return p;
}

const EMOJI = /\p{Extended_Pictographic}|\p{Regional_Indicator}|[#*0-9]️?⃣/u;

/** Keeps one emoji (which may be a multi-code-point sequence) or falls back to ⭐. */
export function sanitizeEmoji(input: unknown): string {
  const s = typeof input === 'string' ? input.trim() : '';
  return s && s.length <= 16 && EMOJI.test(s) && !/[\p{L}\p{N}]/u.test(s.replace(/[#*0-9]️?⃣/gu, '')) ? s : DEFAULT_EMOJI;
}

export function sanitizeTitle(input: unknown): string {
  const s = (typeof input === 'string' ? input : '').replace(/\s+/g, ' ').trim();
  return Array.from(s).slice(0, 64).join('') || 'Emoji Studio';
}

/** Pack names: letters/digits/underscores, start with a letter, no "__", end with _by_<bot>, ≤ 64 chars. */
export function newPackName(userId: number, botUsername: string, random = Math.random): string {
  const suffix = `_by_${botUsername}`;
  const rnd = Math.floor(random() * 36 ** 5)
    .toString(36)
    .padStart(5, '0');
  const base = `e${Math.abs(userId).toString(36)}_${rnd}`.slice(0, 64 - suffix.length);
  return `${base}${suffix}`.replace(/_+/g, '_');
}

export function isOwnPackName(name: string, botUsername: string): boolean {
  return (
    name.length <= 64 &&
    /^[A-Za-z][A-Za-z0-9_]*$/.test(name) &&
    !name.includes('__') &&
    name.toLowerCase().endsWith(`_by_${botUsername.toLowerCase()}`)
  );
}

interface Sticker {
  data: Uint8Array;
  emoji: string;
}

function stickerBlob(data: Uint8Array): Blob {
  return new Blob([data as Uint8Array<ArrayBuffer>], { type: 'application/x-tgsticker' });
}

async function createSet(env: Env, userId: number, name: string, title: string, stickers: Sticker[]): Promise<void> {
  const form = new FormData();
  form.set('user_id', String(userId));
  form.set('name', name);
  form.set('title', title);
  form.set('sticker_type', 'custom_emoji');
  form.set('stickers', JSON.stringify(stickers.map((s, i) => ({ sticker: `attach://s${i}`, format: 'animated', emoji_list: [s.emoji] }))));
  stickers.forEach((s, i) => form.set(`s${i}`, stickerBlob(s.data), `s${i}.tgs`));
  await telegram(env, 'createNewStickerSet', form);
}

async function addToSet(env: Env, userId: number, name: string, sticker: Sticker): Promise<void> {
  const form = new FormData();
  form.set('user_id', String(userId));
  form.set('name', name);
  form.set('sticker', JSON.stringify({ sticker: 'attach://s0', format: 'animated', emoji_list: [sticker.emoji] }));
  form.set('s0', stickerBlob(sticker.data), 's0.tgs');
  await telegram(env, 'addStickerToSet', form);
}

const isFormatError = (err: unknown) => err instanceof TelegramError && FORMAT_ERROR.test(err.message);

/** `progress`: what was done before the error (stickers already in the pack), so the client can continue. */
function errorResponse(err: unknown, cors: Record<string, string>, progress: { added: number; name?: string } = { added: 0 }): Response {
  const json = (body: Record<string, unknown>, status: number, headers: Record<string, string>) => jsonResponse({ ...body, ...progress }, status, headers);
  if (!(err instanceof TelegramError)) {
    console.error('pack failed', err instanceof Error ? err.message : err);
    return json({ ok: false, error: 'server' }, 500, cors);
  }
  const detail = err.message;
  if (err.status === 429) return json({ ok: false, error: 'flood', retryAfter: err.retryAfter ?? 30, detail }, 429, cors);
  if (err.status === 403 || FORBIDDEN_ERROR.test(detail)) return json({ ok: false, error: 'forbidden', detail }, 403, cors);
  if (/STICKERS_TOO_MUCH|too many stickers|STICKERSET_FULL/i.test(detail)) return json({ ok: false, error: 'pack-full', detail }, 409, cors);
  if (/STICKERSET_INVALID|sticker set not found|not found/i.test(detail)) return json({ ok: false, error: 'pack-not-found', detail }, 404, cors);
  if (/emoji/i.test(detail)) return json({ ok: false, error: 'bad-emoji', detail }, 400, cors);
  console.error('pack failed', detail);
  return json({ ok: false, error: 'telegram', detail }, 502, cors);
}

export async function handlePack(req: Request, env: Env, cors: Record<string, string>): Promise<Response> {
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
    if (!f.name.endsWith('.tgs') || f.size === 0 || f.size > MAX_TGS_BYTES) return json({ ok: false, error: 'bad-files', file: f.name }, 400, cors);
  }
  const emojis = form.getAll('emojis');
  const title = sanitizeTitle(form.get('title'));
  const existing = String(form.get('set') ?? '').trim();
  const userId = auth.user.id;
  const texts = packTexts(pickLang(auth.user.language_code));

  try {
    const bot = await botInfo(env);
    if (existing && !isOwnPackName(existing, bot.username)) return json({ ok: false, error: 'pack-not-found' }, 404, cors);

    const originals = await Promise.all(files.map(async (f) => new Uint8Array(await f.arrayBuffer())));
    // Custom emoji use a 100×100 canvas; keep the 512×512 originals as a fallback if Telegram rejects the format.
    const emojiCanvas = await Promise.all(originals.map((b) => toEmojiCanvas(b, 100)));
    const variants: Record<100 | 512, Sticker[]> = {
      100: emojiCanvas.map((data, i) => ({ data, emoji: sanitizeEmoji(emojis[i]) })),
      512: originals.map((data, i) => ({ data, emoji: sanitizeEmoji(emojis[i]) })),
    };
    let canvas: 100 | 512 = 100;
    let name = existing;

    if (existing) {
      for (let i = 0; i < files.length; i++) {
        try {
          try {
            await addToSet(env, userId, name, variants[canvas][i]);
          } catch (err) {
            if (canvas !== 100 || !isFormatError(err)) throw err;
            canvas = 512;
            await addToSet(env, userId, name, variants[canvas][i]);
          }
        } catch (err) {
          // Stickers before this one are in the pack: tell the client, it continues from here.
          return errorResponse(err, cors, { added: i, name });
        }
      }
    } else {
      name = newPackName(userId, bot.username);
      for (let attempt = 0; ; attempt++) {
        try {
          await createSet(env, userId, name, title, variants[canvas]);
          break;
        } catch (err) {
          if (canvas === 100 && isFormatError(err)) canvas = 512;
          else if (attempt < 2 && err instanceof TelegramError && NAME_TAKEN_ERROR.test(err.message)) name = newPackName(userId, bot.username);
          else throw err;
          if (attempt >= 3) throw err;
        }
      }
    }

    const url = `https://t.me/addemoji/${name}`;
    // Big packs arrive in several requests: the client asks for the chat message only with the last one.
    if (form.get('notify') !== '0') {
      const count = Number(form.get('total')) || files.length;
      const fresh = !existing || form.get('fresh') === '1';
      try {
        await telegram(env, 'sendMessage', {
          chat_id: userId,
          text: fresh ? texts.created(title, count) : texts.updated(title, count),
          reply_markup: { inline_keyboard: [[{ text: texts.open, url }]] },
        });
      } catch {
        // The pack exists even if the notification could not be delivered.
      }
    }
    return json({ ok: true, name, url, title, added: files.length, canvas }, 200, cors);
  } catch (err) {
    return errorResponse(err, cors);
  }
}
