import { linkedCode, setLinkedCode } from './botLink';
import { initData, requestWriteAccess } from './telegram';

/**
 * Bot backend base URL, baked in at build time: an absolute URL (GitHub Pages → Vercel/Cloudflare)
 * or "/" when the API is served from the same origin (Vercel). Empty disables the bot features.
 */
const RAW_API_URL = (import.meta.env.VITE_BOT_API_URL ?? '').trim();
export const BOT_API_URL = RAW_API_URL.replace(/\/+$/, '');

export interface OutgoingFile {
  name: string;
  data: Uint8Array | string;
  type: string;
}

export type BotError = 'denied' | 'unauthorized' | 'network' | 'server' | 'pack-full' | 'pack-not-found' | 'bad-emoji' | 'flood' | 'bad-files' | 'stopped';

/** What the backend managed before an error (so a big job can continue instead of starting over). */
interface Progress {
  /** Stickers added to the pack by this request. */
  added?: number;
  /** Files delivered to the chat by this request. */
  sent?: number;
  /** Seconds Telegram asks to wait. */
  retryAfter?: number;
  name?: string;
}

/** `retry`: the request may simply not have arrived or finished (a dropped connection, a timeout) — worth repeating. */
type Failure = { ok: false; error: BotError; detail?: string; retry?: boolean } & Progress;

/** True when a bot backend is configured and the user is known: the Mini App, or a browser linked to the bot. */
export function canUseBot(): boolean {
  return !!RAW_API_URL && (!!initData() || !!linkedCode());
}

/** The editor runs in a browser and acts with a link code from the bot. */
export const usesLink = (): boolean => !initData() && !!linkedCode();

/** Who is asking: the Mini App's signed launch data, or the browser's link code. */
function signIn(form: FormData): void {
  const data = initData();
  if (data) form.set('initData', data);
  else form.set('link', linkedCode());
}

const blobOf = (f: OutgoingFile) => new Blob([typeof f.data === 'string' ? f.data : new Uint8Array(f.data)], { type: f.type });

/** POSTs a form to the backend; when the bot may not message the user yet, asks for permission and retries once. */
async function call<T>(path: string, build: () => FormData): Promise<{ ok: true; data: T } | Failure> {
  const post = () => fetch(`${BOT_API_URL}${path}`, { method: 'POST', body: build() });
  try {
    let res = await post();
    if (res.status === 403) {
      if (!(await requestWriteAccess())) return { ok: false, error: 'denied' };
      res = await post();
    }
    const body = (await res.json().catch(() => ({}))) as { error?: string; detail?: string } & Progress & T;
    if (res.ok) return { ok: true, data: body };
    const progress: Progress = { added: body.added, sent: body.sent, retryAfter: body.retryAfter, name: body.name };
    const known: BotError[] = ['pack-full', 'pack-not-found', 'bad-emoji', 'flood', 'bad-files'];
    if (res.status === 401) {
      // An expired (or foreign) link code: the editor asks to link again.
      if (usesLink()) setLinkedCode(null);
      return { ok: false, error: 'unauthorized', ...progress };
    }
    if (res.status === 403) return { ok: false, error: 'denied', ...progress };
    if (res.status === 413) return { ok: false, error: 'bad-files', detail: 'HTTP 413' };
    if (body.error && known.includes(body.error as BotError)) return { ok: false, error: body.error as BotError, detail: body.detail, ...progress };
    // No answer of ours (the platform's timeout page) or an unexpected failure: unlike Telegram's own refusals, worth repeating.
    const retry = !body.error || body.error === 'server';
    return { ok: false, error: 'server', detail: body.detail ?? (body.error ? body.error : `HTTP ${res.status}`), retry, ...progress };
  } catch {
    return { ok: false, error: 'network', retry: true };
  }
}

/** Asks the bot to send the files to the current user's chat (one request; see `sendAllToChat`). */
export async function sendToChat(files: OutgoingFile[], last = true) {
  return call<{ sent: number }>('/api/send', () => {
    const form = new FormData();
    signIn(form);
    if (!last) form.set('last', '0');
    for (const f of files) form.append('files', blobOf(f), f.name);
    return form;
  });
}

// ---------------------------------------------------------------------------
// Big jobs: split into requests the backend accepts (count and ~4.5 MB body limit on Vercel), wait when Telegram
// asks to slow down, and continue from where an error stopped.
// ---------------------------------------------------------------------------

const MAX_REQUEST_BYTES = 3_500_000;
const MAX_TOTAL_WAIT = 15 * 60;

const sizeOf = (f: OutgoingFile) => (typeof f.data === 'string' ? f.data.length : f.data.length);

/** The next batch: at most `count` files and MAX_REQUEST_BYTES (always at least one file). */
export function takeBatch<T extends OutgoingFile>(items: readonly T[], count: number): T[] {
  const out: T[] = [];
  let bytes = 0;
  for (const item of items) {
    if (out.length >= count || (out.length && bytes + sizeOf(item) > MAX_REQUEST_BYTES)) break;
    out.push(item);
    bytes += sizeOf(item);
  }
  return out;
}

export interface JobProgress {
  done: number;
  total: number;
  /** Seconds left while Telegram asks to wait. */
  waiting?: number;
}

async function waitSeconds(seconds: number, report: (left: number) => void): Promise<void> {
  for (let left = Math.ceil(seconds); left > 0; left--) {
    report(left);
    await new Promise((r) => setTimeout(r, 1000));
  }
}

export type JobResult<T> = { ok: true; data: T } | (Failure & { data?: T });

/** Sends any number of files to the chat in several requests. `onSent` gets the files delivered so far. */
export async function sendAllToChat<T extends OutgoingFile>(
  items: readonly T[],
  onProgress: (p: JobProgress) => void,
  onSent: (items: T[]) => void,
): Promise<JobResult<{ sent: number }>> {
  let queue = [...items];
  let done = 0;
  let waited = 0;
  while (queue.length) {
    const batch = takeBatch(queue, 20);
    const res = await sendToChat(batch, batch.length === queue.length);
    const sent = res.ok ? batch.length : Math.min(res.sent ?? 0, batch.length);
    if (sent) {
      onSent(batch.slice(0, sent));
      queue = queue.slice(sent);
      done += sent;
    }
    onProgress({ done, total: items.length });
    if (res.ok) continue;
    if (res.error === 'flood' && waited < MAX_TOTAL_WAIT) {
      const wait = res.retryAfter ?? 10;
      waited += wait;
      await waitSeconds(wait, (left) => onProgress({ done, total: items.length, waiting: left }));
      continue;
    }
    return { ...res, data: { sent: done } };
  }
  return { ok: true, data: { sent: done } };
}

export interface PackResult {
  name: string;
  url: string;
  title: string;
  added: number;
  canvas: number;
  /** Stickers in the pack now, when the backend knows. */
  size?: number;
  /** Telegram asked to wait after the last sticker of the request. */
  retryAfter?: number;
}

/** Asks the bot to create a custom emoji pack (or add to `set`, a pack it created before) — one request. */
export async function createPack(opts: {
  title: string;
  set?: string;
  items: Array<OutgoingFile & { emoji: string }>;
  /** Chat message: false for all but the last request of a big pack. */
  notify?: boolean;
  /** Number of emoji to mention in the chat message. */
  total?: number;
  /** The pack was created by an earlier request of the same job ("created", not "added to"). */
  fresh?: boolean;
  /** Pause between stickers added to an existing pack, ms. */
  pace?: number;
  /** Stickers the existing pack holds as far as we know (the backend skips what a request with a lost answer added). */
  size?: number;
  /** Names a new pack, so repeating the request cannot make a second one. */
  nonce?: string;
}) {
  return call<PackResult>('/api/pack', () => {
    const form = new FormData();
    signIn(form);
    form.set('title', opts.title);
    if (opts.set) form.set('set', opts.set);
    if (opts.notify === false) form.set('notify', '0');
    if (opts.total) form.set('total', String(opts.total));
    if (opts.fresh) form.set('fresh', '1');
    if (opts.pace) form.set('pace', String(Math.round(opts.pace)));
    if (opts.size !== undefined) form.set('size', String(opts.size));
    if (opts.nonce) form.set('nonce', opts.nonce);
    for (const item of opts.items) {
      form.append('files', blobOf(item), item.name);
      form.append('emojis', item.emoji);
    }
    return form;
  });
}

/**
 * Telegram creates a pack with up to 50 stickers in one call, but adds the rest one by one, and only so many in a few
 * minutes: then it answers "retry after N s" (minutes, longer when asked again too early). So: 50 at once, then a steady
 * pace; a short wait means "slower", a long one is the quota — sat out (however long, while the editor is open), then on.
 */
export const CREATE_BATCH = 50;
const ADD_BATCH = 10;
export const PACE = { start: 1000, min: 800, max: 12_000 };
/** Stickers per request so that a paced request stays well within the function time limit. */
const addBatch = (pace: number) => Math.max(1, Math.min(ADD_BATCH, Math.floor(36_000 / (pace + 800))));
/* The backend pauses `pace` ms before each sticker it adds (the first of a request too), so requests never burst. */
/** Waits longer than this are Telegram's quota for a few minutes, not a hint to go slower. */
const SHORT_FLOOD = 30;
/** Pauses before repeating a request that got no answer (the backend skips what it already did). */
const RETRY_AFTER = [3, 10, 30];

// Telegram's wait applies to the next pack request whatever it is (another pack, another window, after a reload):
// asking early only makes it longer.
const FLOOD_KEY = 'emoji-studio-flood-until';

export function floodUntil(): number {
  try {
    return Number(localStorage.getItem(FLOOD_KEY)) || 0;
  } catch {
    return 0;
  }
}

function setFloodUntil(until: number): void {
  try {
    localStorage.setItem(FLOOD_KEY, String(until));
  } catch {
    /* the wait still happens in this job */
  }
}

/** Waits until `until` (by the clock: a phone that sleeps meanwhile loses nothing). False when stopped. */
async function waitUntil(until: number, report: (left: number) => void, signal?: AbortSignal): Promise<boolean> {
  for (let left = until - Date.now(); left > 0; left = until - Date.now()) {
    if (signal?.aborted) return false;
    report(Math.ceil(left / 1000));
    await new Promise((r) => setTimeout(r, Math.min(1000, left)));
  }
  return !signal?.aborted;
}

const newNonce = () =>
  Math.floor(Math.random() * 36 ** 6)
    .toString(36)
    .padStart(6, '0');

/**
 * Creates (or extends) a pack with any number of emoji: the first request creates it, the next ones add the rest.
 * `onAdded` gets the emoji that made it into the pack — after an error, calling again with `set` continues.
 */
export async function createPackAll<T extends OutgoingFile & { emoji: string }>(
  opts: {
    title: string;
    set?: string;
    items: readonly T[];
    /** Size of the whole job when continuing an earlier one (for the chat message). */
    total?: number;
    /** The pack was created by the earlier part of this job. */
    fresh?: boolean;
    /** Stickers `set` holds now, as far as we know. */
    size?: number;
    /** Stops the job between requests and during waits (progress so far is reported as usual). */
    signal?: AbortSignal;
  },
  onProgress: (p: JobProgress) => void,
  onAdded: (items: T[], pack: PackResult) => void,
): Promise<JobResult<PackResult>> {
  let queue = [...opts.items];
  let name = opts.set;
  let pack: PackResult | undefined;
  const fresh = !opts.set;
  const nonce = newNonce();
  let size = opts.size;
  let done = 0;
  let pace = PACE.start;
  /** Never faster than the pace Telegram last asked to slow down from. */
  let floor = PACE.min;
  let failures = 0;
  const report = (waiting?: number) => onProgress({ done, total: opts.items.length, waiting });
  const stopped = (): JobResult<PackResult> => ({ ok: false, error: 'stopped', data: pack });
  while (queue.length) {
    if (!(await waitUntil(floodUntil(), report, opts.signal))) return stopped();
    const batch = takeBatch(queue, name ? addBatch(pace) : CREATE_BATCH);
    const last = batch.length === queue.length;
    const res = await createPack({
      title: opts.title,
      set: name,
      items: batch,
      notify: last,
      total: opts.total ?? opts.items.length,
      fresh: !!opts.fresh || (fresh && !!name),
      pace: name ? pace : undefined,
      size: name ? size : undefined,
      nonce: name ? undefined : nonce,
    });
    // A request may be cut short by its time budget: what it did not add goes in the next one.
    const added = Math.min(res.ok ? (res.data.added ?? batch.length) : (res.added ?? 0), batch.length);
    const packName = res.ok ? res.data.name : res.name;
    if (added && packName) {
      name = packName;
      pack = res.ok ? res.data : { name: packName, url: `https://t.me/addemoji/${packName}`, title: opts.title, added: 0, canvas: pack?.canvas ?? 100 };
      size = (res.ok ? res.data.size : undefined) ?? (size ?? 0) + added;
      done += added;
      pack = { ...pack, added: done, size };
      onAdded(batch.slice(0, added), pack);
      queue = queue.slice(added);
    }
    report();
    if (res.ok) {
      failures = 0;
      pace = Math.max(floor, pace * 0.9);
      if (res.data.retryAfter) setFloodUntil(Date.now() + res.data.retryAfter * 1000 + 1500);
      if (!added) return { ok: false, error: 'server', data: pack };
      continue;
    }
    if (res.error === 'flood') {
      const wait = res.retryAfter ?? 10;
      if (wait <= SHORT_FLOOD) floor = pace = Math.min(PACE.max, Math.max(pace * 1.5, 1500));
      setFloodUntil(Date.now() + wait * 1000 + 1500);
      continue;
    }
    if (res.retry && failures < RETRY_AFTER.length) {
      if (!(await waitUntil(Date.now() + RETRY_AFTER[failures++] * 1000, report, opts.signal))) return stopped();
      continue;
    }
    return { ...res, data: pack };
  }
  return pack ? { ok: true, data: pack } : { ok: false, error: 'server' };
}

// ---------------------------------------------------------------------------
// Linking the editor in a browser to the bot
// ---------------------------------------------------------------------------

let username: Promise<string | null> | undefined;

/** The bot's @username (to open it with t.me/<username>?start=link), from the backend. */
export function botUsername(): Promise<string | null> {
  username ??= fetch(`${BOT_API_URL}/api/health`)
    .then((res) => res.json() as Promise<{ username?: string | null }>)
    .then((body) => (typeof body.username === 'string' && /^\w{4,64}$/.test(body.username) ? body.username : null))
    .catch(() => null)
    .then((name) => {
      if (!name) username = undefined;
      return name;
    });
  return username;
}

/** Whether the backend accepts a link code (it is the bot's and has not expired). */
export async function checkLinkCode(code: string): Promise<'ok' | 'bad' | 'network'> {
  try {
    const res = await fetch(`${BOT_API_URL}/api/link?code=${encodeURIComponent(code)}`);
    if (res.ok) return 'ok';
    return res.status === 401 ? 'bad' : 'network';
  } catch {
    return 'network';
  }
}

// ---------------------------------------------------------------------------
// Sticker packs as templates (public reads through the bot, no Telegram login needed)
// ---------------------------------------------------------------------------

/** True when a bot backend is configured (packs can be loaded in Telegram and in a browser). */
export const packsAvailable = (): boolean => !!RAW_API_URL;

/** Pack name from a link (t.me/addstickers/…, t.me/addemoji/…, tg://addstickers?set=…) or a bare name. */
export function parsePackLink(input: string): string | null {
  const text = input.trim();
  const link = /(?:t(?:elegram)?\.me\/|tg:\/\/)add(?:stickers|emoji)(?:\/|\?set=)([A-Za-z0-9_]{1,64})/i.exec(text);
  if (link) return link[1];
  return /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(text) ? text : null;
}

export interface StickerSetInfo {
  name: string;
  title: string;
  items: Array<{ id: string; uid: string; emoji: string }>;
  /** Video and static stickers (not Lottie). */
  skipped: number;
}

export async function fetchStickerSet(name: string): Promise<{ ok: true; data: StickerSetInfo } | { ok: false; error: 'not-found' | 'network' | 'server' }> {
  try {
    const res = await fetch(`${BOT_API_URL}/api/stickerset?name=${encodeURIComponent(name)}`);
    const body = (await res.json().catch(() => ({}))) as Partial<StickerSetInfo> & { error?: string };
    if (res.ok && body.items) return { ok: true, data: body as StickerSetInfo };
    return { ok: false, error: res.status === 404 || body.error === 'pack-not-found' ? 'not-found' : 'server' };
  } catch {
    return { ok: false, error: 'network' };
  }
}

export async function fetchSticker(id: string): Promise<Uint8Array> {
  const res = await fetch(`${BOT_API_URL}/api/sticker?id=${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`sticker ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

/** Template packs the bot's admin added for everyone. */
export async function fetchBotPacks(): Promise<Array<{ name: string; title: string }>> {
  try {
    const res = await fetch(`${BOT_API_URL}/api/templates`);
    const body = (await res.json().catch(() => ({}))) as { packs?: Array<{ name: string; title: string }> };
    return Array.isArray(body.packs) ? body.packs : [];
  } catch {
    return [];
  }
}

/**
 * Several packs of up to 50 emoji ("Title 1", "Title 2", …): each is created in one call, so there is
 * nothing to wait for. `onPack` gets every finished pack.
 */
export async function createPacksSplit<T extends OutgoingFile & { emoji: string }>(
  opts: { title: string; items: readonly T[]; signal?: AbortSignal },
  onProgress: (p: JobProgress) => void,
  onPack: (items: T[], pack: PackResult) => void,
): Promise<JobResult<PackResult[]>> {
  const packs: PackResult[] = [];
  const chunks: T[][] = [];
  for (let i = 0; i < opts.items.length; i += CREATE_BATCH) chunks.push(opts.items.slice(i, i + CREATE_BATCH));
  const base = Array.from(opts.title).slice(0, 58).join('').trim() || 'Emoji Studio';
  let done = 0;
  for (const [i, chunk] of chunks.entries()) {
    const title = chunks.length > 1 ? `${base} ${i + 1}` : base;
    let packDone = 0;
    const res = await createPackAll(
      { title, items: chunk, signal: opts.signal },
      (p) => onProgress({ ...p, done: done + p.done, total: opts.items.length }),
      (items, pack) => {
        packDone += items.length;
        if (packDone === chunk.length) onPack(chunk, pack);
      },
    );
    if (!res.ok) return { ...res, data: packs };
    packs.push(res.data);
    done += chunk.length;
  }
  return { ok: true, data: packs };
}
