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

export type BotError = 'denied' | 'unauthorized' | 'network' | 'server' | 'pack-full' | 'pack-not-found' | 'bad-emoji';

/** True inside the Telegram Mini App when a bot backend is configured. */
export function canUseBot(): boolean {
  return !!RAW_API_URL && !!initData();
}

const blobOf = (f: OutgoingFile) => new Blob([typeof f.data === 'string' ? f.data : new Uint8Array(f.data)], { type: f.type });

/** POSTs a form to the backend; when the bot may not message the user yet, asks for permission and retries once. */
async function call<T>(path: string, build: () => FormData): Promise<{ ok: true; data: T } | { ok: false; error: BotError; detail?: string }> {
  const post = () => fetch(`${BOT_API_URL}${path}`, { method: 'POST', body: build() });
  try {
    let res = await post();
    if (res.status === 403) {
      if (!(await requestWriteAccess())) return { ok: false, error: 'denied' };
      res = await post();
    }
    const body = (await res.json().catch(() => ({}))) as { error?: string; detail?: string } & T;
    if (res.ok) return { ok: true, data: body };
    const known: BotError[] = ['pack-full', 'pack-not-found', 'bad-emoji'];
    if (res.status === 401) return { ok: false, error: 'unauthorized' };
    if (res.status === 403) return { ok: false, error: 'denied' };
    if (body.error && known.includes(body.error as BotError)) return { ok: false, error: body.error as BotError, detail: body.detail };
    return { ok: false, error: 'server', detail: body.detail };
  } catch {
    return { ok: false, error: 'network' };
  }
}

/** Asks the bot to send the files to the current user's chat. */
export async function sendToChat(files: OutgoingFile[]) {
  return call<{ sent: number }>('/api/send', () => {
    const form = new FormData();
    form.set('initData', initData());
    for (const f of files) form.append('files', blobOf(f), f.name);
    return form;
  });
}

export interface PackResult {
  name: string;
  url: string;
  title: string;
  added: number;
  canvas: number;
}

/** Asks the bot to create a custom emoji pack (or add to `set`, a pack it created before). */
export async function createPack(opts: { title: string; set?: string; items: Array<OutgoingFile & { emoji: string }> }) {
  return call<PackResult>('/api/pack', () => {
    const form = new FormData();
    form.set('initData', initData());
    form.set('title', opts.title);
    if (opts.set) form.set('set', opts.set);
    for (const item of opts.items) {
      form.append('files', blobOf(item), item.name);
      form.append('emojis', item.emoji);
    }
    return form;
  });
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
