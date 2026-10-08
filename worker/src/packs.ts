/**
 * POST /api/pack — the bot creates a custom emoji pack owned by the user (or adds to one it created earlier).
 *
 * Form fields: initData (or link — a link code), title, set (optional existing pack name), files[] (.tgs) and emojis[] (one per file).
 * Repeating a request is safe: a new pack is named after the client's `nonce`, and for an existing pack the client says how
 * many stickers it counts (`size`) — what an earlier request added although its answer was lost is not added again.
 */
import { json, json as jsonResponse, MAX_INLINE_WAIT, sleep, telegram, TelegramError, type Env } from './shared.js';
import { authenticate, packTexts, pickLang } from './telegram.js';
import { toEmojiCanvas } from './tgs.js';
import { paidFor } from './account.js';

const MAX_FILES = 50; // createNewStickerSet accepts up to 50 initial stickers
/** Custom emoji in one pack. */
const PACK_LIMIT = 200;
/** Adding stops after this long and the client sends the rest in the next request (Vercel ends a function at 60 s). */
const REQUEST_BUDGET_MS = 40_000;
const MAX_PACE_MS = 15_000;
const MAX_TGS_BYTES = 64 * 1024;
const DEFAULT_EMOJI = '⭐';

/** Errors that mean "Telegram did not like the sticker file" — worth retrying with the other canvas size. */
const FORMAT_ERROR = /TGS|DIMENSION|FILE_INVALID|STICKER_FILE|wrong file|invalid file|file is too big|STICKER_VIDEO|ANIMATED/i;
const FORBIDDEN_ERROR = /PEER_ID_INVALID|user not found|can't initiate|blocked by the user|USER_IS_BLOCKED|USER_DEACTIVATED/i;
const NAME_TAKEN_ERROR = /already occupied|STICKERSET_NAME_OCCUPIED/i;

const botCache = new Map<string, Promise<{ id: number; username: string }>>();

export function botInfo(env: Env): Promise<{ id: number; username: string }> {
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
export function newPackName(userId: number, botUsername: string, random: (() => number) | string = Math.random): string {
  const suffix = `_by_${botUsername}`;
  const rnd =
    typeof random === 'string'
      ? random
      : Math.floor(random() * 36 ** 5)
          .toString(36)
          .padStart(5, '0');
  const base = `e${Math.abs(userId).toString(36)}_${rnd}`.slice(0, 64 - suffix.length);
  return `${base}${suffix}`.replace(/_+/g, '_');
}

const NONCE = /^[a-z0-9]{5,10}$/;

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
  // No blind repeat on flood control: the sticker may be in already (the caller checks the pack).
  await telegram(env, 'addStickerToSet', form, { floodRetry: false });
}

const isFormatError = (err: unknown) => err instanceof TelegramError && FORMAT_ERROR.test(err.message);

/** What a pack holds now (null when Telegram does not say: no such pack, or an error). */
async function packState(env: Env, name: string): Promise<{ size: number; emojis: string[] } | null> {
  try {
    const set = (await telegram(env, 'getStickerSet', { name }, { floodRetry: false })) as { stickers?: Array<{ emoji?: string }> } | null;
    if (!set || !Array.isArray(set.stickers)) return null;
    return { size: set.stickers.length, emojis: set.stickers.map((s) => s.emoji ?? '') };
  } catch {
    return null;
  }
}

const sameEmoji = (a: string, b: string) => a.replace(/\uFE0F/g, '') === b.replace(/\uFE0F/g, '');

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
  const started = Date.now();
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
    if (!f.name.endsWith('.tgs') || f.size === 0 || f.size > MAX_TGS_BYTES) return json({ ok: false, error: 'bad-files', file: f.name }, 400, cors);
  }
  if (!(await paidFor(env, auth.user.id, String(form.get('gens') ?? '').split(','), files.length))) return json({ ok: false, error: 'not-paid' }, 402, cors);
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
    /** Stickers of this request that are in the pack. */
    let added = 0;
    /** Stickers in the pack afterwards, when known. */
    let size: number | undefined;
    /** Telegram's wait after the last sticker went in anyway (the client waits before its next request). */
    let retryAfter: number | undefined;
    const addOne = async (i: number) => {
      try {
        await addToSet(env, userId, name, variants[canvas][i]);
      } catch (err) {
        if (canvas !== 100 || !isFormatError(err)) throw err;
        canvas = 512;
        await addToSet(env, userId, name, variants[canvas][i]);
      }
    };

    if (existing) {
      // Telegram adds custom emoji one by one and punishes bursts with long waits: the client sets the pace.
      // The pause comes before every sticker, the first one too — the previous request may have just added one.
      const pace = Math.min(Math.max(Number(form.get('pace')) || 0, 0), MAX_PACE_MS);
      const state = await packState(env, name);
      if (state && state.size >= PACK_LIMIT) return json({ ok: false, error: 'pack-full', added: 0, name }, 409, cors);
      // More stickers than the client counts, the same emoji in the same order: an earlier request added them, but its
      // answer was lost (a timeout, a dropped connection, flood control right after the sticker went in) — skip them.
      const counted = Number(form.get('size'));
      if (state && form.has('size') && Number.isInteger(counted) && counted >= 0 && state.size > counted) {
        const extra = Math.min(state.size - counted, files.length);
        if (state.emojis.slice(counted, counted + extra).every((e, k) => sameEmoji(e, variants[100][k].emoji))) added = extra;
      }
      const skipped = added;
      /** Stickers of this request in the pack after an error: Telegram may take one and still answer with an error. */
      const landed = async () => {
        const now = state ? await packState(env, name) : null;
        return state && now ? Math.min(Math.max(skipped + now.size - state.size, added), added + 1) : added;
      };
      let shortWaits = 0;
      while (added < files.length && Date.now() - started < REQUEST_BUDGET_MS) {
        if (pace) await sleep(pace);
        try {
          await addOne(added);
          added++;
        } catch (err) {
          const done = await landed();
          const wait = err instanceof TelegramError ? err.retryAfter : undefined;
          if (done === files.length) {
            // The last one went in before Telegram refused: this request is done (and the chat message goes out).
            added = done;
            retryAfter = wait;
            break;
          }
          if (wait !== undefined && wait <= MAX_INLINE_WAIT && shortWaits < 3 && Date.now() - started + wait * 1000 < REQUEST_BUDGET_MS) {
            // A short flood wait: sit it out here, then go on from what is really in the pack.
            shortWaits++;
            await sleep(wait * 1000 + 300);
            added = done;
            continue;
          }
          return errorResponse(err, cors, { added: done, name });
        }
      }
      if (state) size = state.size + added - skipped;
    } else {
      // Named after the client's nonce, a repeated request finds the pack its lost first attempt made.
      const fromClient = String(form.get('nonce') ?? '');
      const nonce = NONCE.test(fromClient) ? fromClient : undefined;
      name = newPackName(userId, bot.username, nonce);
      for (let attempt = 0; ; attempt++) {
        try {
          await createSet(env, userId, name, title, variants[canvas]);
          added = files.length;
          break;
        } catch (err) {
          if (canvas === 100 && isFormatError(err)) {
            canvas = 512;
          } else {
            // Created already (by an earlier attempt or request, or before flood control answered)?
            const state = nonce || attempt > 0 ? await packState(env, name) : null;
            if (state && state.size > 0) {
              added = Math.min(state.size, files.length);
              break;
            }
            if (attempt < 2 && err instanceof TelegramError && NAME_TAKEN_ERROR.test(err.message)) name = newPackName(userId, bot.username);
            else throw err;
          }
          if (attempt >= 3) throw err;
        }
      }
      size = added;
    }

    const url = `https://t.me/addemoji/${name}`;
    // Big packs arrive in several requests: the client asks for the chat message only with the last one
    // (and a request cut short by its time budget is not the last).
    if (form.get('notify') !== '0' && added === files.length) {
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
    return json({ ok: true, name, url, title, added, canvas, ...(size !== undefined && { size }), ...(retryAfter !== undefined && { retryAfter }) }, 200, cors);
  } catch (err) {
    return errorResponse(err, cors);
  }
}
