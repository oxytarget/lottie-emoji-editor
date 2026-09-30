import { gunzipSync, gzipSync, strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
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
  problems: Array<'size' | 'canvas' | 'fps' | 'duration' | 'unsupported'>;
}

/** Text (ty 5) and image (ty 2) layers do not render in Telegram's TGS player. */
function hasUnsupportedLayers(anim: LottieAnimation): boolean {
  const lists = [anim.layers, ...((anim.assets ?? []) as Array<{ layers?: LottieAnimation['layers'] }>).map((a) => a?.layers ?? [])];
  return lists.some((layers) => layers.some((l) => l.ty === 5 || l.ty === 2));
}

export function checkTgs(anim: LottieAnimation, bytes: number): TgsCheck {
  const problems: TgsCheck['problems'] = [];
  if (bytes > TGS_LIMITS.maxBytes) problems.push('size');
  if (anim.w !== TGS_LIMITS.size || anim.h !== TGS_LIMITS.size) problems.push('canvas');
  if (anim.fr !== TGS_LIMITS.fps) problems.push('fps');
  if (anim.op - anim.ip > TGS_LIMITS.maxFrames) problems.push('duration');
  if (hasUnsupportedLayers(anim)) problems.push('unsupported');
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

const IMAGE_TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml' };

function base64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/**
 * The first animation of a dotLottie (`.lottie`, a zip: manifest + animations + images) as plain Lottie JSON,
 * with its images put inline (both the v1 `animations/`+`images/` and the v2 `a/`+`i/` layouts).
 */
function readDotLottie(bytes: Uint8Array): string {
  const files = unzipSync(bytes);
  const manifest = files['manifest.json'] ? (JSON.parse(strFromU8(files['manifest.json'])) as { animations?: Array<{ id?: string }> }) : {};
  const id = manifest.animations?.[0]?.id;
  const path =
    (id && [`animations/${id}.json`, `a/${id}.json`].find((p) => files[p])) ??
    Object.keys(files).find((p) => /^(animations|a)\/[^/]+\.json$/.test(p));
  if (!path) throw new Error('No animation in the .lottie file');
  const data = JSON.parse(strFromU8(files[path])) as { assets?: Array<Record<string, unknown>> };
  for (const asset of data.assets ?? []) {
    if (typeof asset.p !== 'string' || asset.e === 1 || asset.p.startsWith('data:')) continue;
    const name = asset.p.split('/').pop()!;
    const file = files[`images/${name}`] ?? files[`i/${name}`];
    if (!file) continue;
    const type = IMAGE_TYPES[name.split('.').pop()!.toLowerCase()] ?? 'image/png';
    asset.p = `data:${type};base64,${base64(file)}`;
    asset.u = '';
    asset.e = 1;
  }
  return JSON.stringify(data);
}

/** Reads a `.tgs` (gzip), `.json` or `.lottie` (dotLottie zip) animation. */
export function readLottieFile(bytes: Uint8Array): LottieAnimation {
  const isGzip = bytes[0] === 0x1f && bytes[1] === 0x8b;
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
  const text = isGzip ? strFromU8(gunzipSync(bytes)) : isZip ? readDotLottie(bytes) : strFromU8(bytes);
  const data = JSON.parse(text) as LottieAnimation;
  if (!data || typeof data !== 'object' || !Array.isArray(data.layers) || typeof data.w !== 'number' || typeof data.h !== 'number') {
    throw new Error('Not a Lottie animation');
  }
  return data;
}
