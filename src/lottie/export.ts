import { gunzipSync, gzipSync, strFromU8, strToU8, zipSync } from 'fflate';
import type { LottieAnimation } from './types';

/** Telegram limits for animated (TGS) custom emoji and stickers. */
export const TGS_LIMITS = {
  maxBytes: 64 * 1024,
  size: 512,
  fps: 60,
  maxFrames: 180,
} as const;

export function toJson(anim: LottieAnimation): string {
  const { tgs: _tgs, ...rest } = anim;
  return JSON.stringify(rest);
}

/** TGS = gzipped Lottie JSON with a `"tgs": 1` marker. */
export function toTgs(anim: LottieAnimation): Uint8Array {
  return tgsFromJson(toJson(anim));
}

/** Same as `toTgs` for an already serialized animation (must not contain a `tgs` key). */
export function tgsFromJson(json: string): Uint8Array {
  const body = json.trim();
  const marked = body === '{}' ? '{"tgs":1}' : `{"tgs":1,${body.slice(1)}`;
  return gzipSync(strToU8(marked), { level: 9, mtime: 0 });
}

export interface TgsCheck {
  bytes: number;
  ok: boolean;
  problems: Array<'size' | 'canvas' | 'fps' | 'duration'>;
}

export function checkTgs(anim: LottieAnimation, bytes: number): TgsCheck {
  const problems: TgsCheck['problems'] = [];
  if (bytes > TGS_LIMITS.maxBytes) problems.push('size');
  if (anim.w !== TGS_LIMITS.size || anim.h !== TGS_LIMITS.size) problems.push('canvas');
  if (anim.fr !== TGS_LIMITS.fps) problems.push('fps');
  if (anim.op - anim.ip > TGS_LIMITS.maxFrames) problems.push('duration');
  return { bytes, ok: problems.length === 0, problems };
}

export function formatKb(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)}`;
}

export function zipFiles(files: Record<string, Uint8Array | string>): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const [name, data] of Object.entries(files)) entries[name] = typeof data === 'string' ? strToU8(data) : data;
  return zipSync(entries, { level: 0 });
}

export function downloadBlob(data: Uint8Array | string, filename: string, type: string): void {
  const blob = new Blob([typeof data === 'string' ? data : new Uint8Array(data)], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** File-name friendly slug (keeps latin/cyrillic letters and digits). */
export function slug(input: string, fallback = 'emoji'): string {
  const s = input
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  return s || fallback;
}

/** Reads a `.tgs` (gzip) or `.json` Lottie file. */
export function readLottieFile(bytes: Uint8Array): LottieAnimation {
  const isGzip = bytes[0] === 0x1f && bytes[1] === 0x8b;
  const text = isGzip ? strFromU8(gunzipSync(bytes)) : strFromU8(bytes);
  const data = JSON.parse(text) as LottieAnimation;
  if (!data || typeof data !== 'object' || !Array.isArray(data.layers) || typeof data.w !== 'number' || typeof data.h !== 'number') {
    throw new Error('Not a Lottie animation');
  }
  return data;
}
