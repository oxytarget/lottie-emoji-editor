import { initData, requestWriteAccess } from './telegram';

/**
 * Bot backend base URL, baked in at build time: an absolute URL (GitHub Pages → Vercel/Cloudflare)
 * or "/" when the API is served from the same origin (Vercel). Empty disables "send to chat".
 */
const RAW_API_URL = (import.meta.env.VITE_BOT_API_URL ?? '').trim();
export const BOT_API_URL = RAW_API_URL.replace(/\/+$/, '');

export interface OutgoingFile {
  name: string;
  data: Uint8Array | string;
  type: string;
}

export type SendError = 'denied' | 'unauthorized' | 'network' | 'server';
export type SendResult = { ok: true; sent: number } | { ok: false; error: SendError };

/** True inside the Telegram Mini App when a bot backend is configured. */
export function canSendToChat(): boolean {
  return !!RAW_API_URL && !!initData();
}

async function post(files: OutgoingFile[]): Promise<Response> {
  const form = new FormData();
  form.set('initData', initData());
  for (const f of files) {
    const blob = new Blob([typeof f.data === 'string' ? f.data : new Uint8Array(f.data)], { type: f.type });
    form.append('files', blob, f.name);
  }
  return fetch(`${BOT_API_URL}/api/send`, { method: 'POST', body: form });
}

/** Asks the bot to send the files to the current user's chat. */
export async function sendToChat(files: OutgoingFile[]): Promise<SendResult> {
  try {
    let res = await post(files);
    if (res.status === 403) {
      // The bot may not write first: ask the user for permission, then retry once.
      if (!(await requestWriteAccess())) return { ok: false, error: 'denied' };
      res = await post(files);
    }
    if (res.ok) return { ok: true, sent: files.length };
    if (res.status === 401) return { ok: false, error: 'unauthorized' };
    if (res.status === 403) return { ok: false, error: 'denied' };
    return { ok: false, error: 'server' };
  } catch {
    return { ok: false, error: 'network' };
  }
}
