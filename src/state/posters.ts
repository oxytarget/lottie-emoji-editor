import lottie from 'lottie-web/build/player/lottie_light';
import { useEffect, useState } from 'react';

/**
 * Still pictures of animations for grids and lists. A live player per tile keeps the phone busy (a pack of 75
 * stickers drew ~100 animated SVGs at once); a poster is drawn once — one frame, rasterised to a small PNG —
 * then it is just an image. Posters are made one at a time in idle moments, newest request first, only for
 * what is on screen, and cached by content.
 */

/** Which frame: a share of the length (stickers often start empty) or an exact frame. */
export type PosterAt = { frac: number } | { frame: number };

interface Job {
  key: string;
  json: string;
  at: PosterAt;
  size: number;
}

const MAX_CACHED = 600;
const cache = new Map<string, string>();
const listeners = new Map<string, Set<(url: string) => void>>();
const queue: Job[] = [];
let running = false;

/** FNV-1a over the JSON text (cheap, and the length is part of the key too). */
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

const keyOf = (json: string, at: PosterAt, size: number) =>
  `${hash(json)}.${json.length}.${'frac' in at ? `f${at.frac}` : `n${at.frame}`}.${size}`;

function remember(key: string, url: string): void {
  cache.delete(key);
  cache.set(key, url);
  while (cache.size > MAX_CACHED) {
    const [oldest, old] = cache.entries().next().value as [string, string];
    cache.delete(oldest);
    URL.revokeObjectURL(old);
  }
}

const idle = (fn: () => void) =>
  typeof requestIdleCallback === 'function' ? requestIdleCallback(fn, { timeout: 250 }) : setTimeout(fn, 16);

async function render(job: Job): Promise<string> {
  const { size } = job;
  const holder = document.createElement('div');
  holder.style.cssText = `position:fixed;left:-10000px;top:0;width:${size}px;height:${size}px;pointer-events:none;visibility:hidden`;
  document.body.appendChild(holder);
  let svg: string;
  try {
    const data = JSON.parse(job.json);
    const anim = lottie.loadAnimation({
      container: holder,
      renderer: 'svg',
      loop: false,
      autoplay: false,
      animationData: data,
      rendererSettings: { preserveAspectRatio: 'xMidYMid meet', progressiveLoad: false },
    });
    const total = Math.max(1, anim.totalFrames);
    anim.goToAndStop('frac' in job.at ? Math.floor((total - 1) * job.at.frac) : job.at.frame, true);
    const el = holder.querySelector('svg')!;
    el.setAttribute('width', String(size));
    el.setAttribute('height', String(size));
    svg = new XMLSerializer().serializeToString(el);
    anim.destroy();
  } finally {
    holder.remove();
  }
  // A bitmap is cheaper to keep and to draw than an SVG image with hundreds of paths.
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  canvas.getContext('2d')!.drawImage(img, 0, 0, size, size);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('No poster');
  return URL.createObjectURL(blob);
}

function pump(): void {
  if (running || !queue.length) return;
  running = true;
  idle(async () => {
    // Newest first: what was just scrolled into view. (The queue may have emptied meanwhile: tiles scrolled away.)
    const job = queue.pop();
    if (!job) {
      running = false;
      return;
    }
    try {
      const url = await render(job);
      remember(job.key, url);
      listeners.get(job.key)?.forEach((cb) => cb(url));
    } catch {
      // A file the player cannot draw keeps its placeholder.
    } finally {
      listeners.delete(job.key);
      running = false;
      pump();
    }
  });
}

/** The poster if it is ready. */
export function peekPoster(json: string, at: PosterAt, size: number): string | null {
  return cache.get(keyOf(json, at, size)) ?? null;
}

/** Asks for a poster; `cb` gets it when drawn. Returns a cancel function (drops the job if nobody else waits). */
export function requestPoster(json: string, at: PosterAt, size: number, cb: (url: string) => void): () => void {
  const key = keyOf(json, at, size);
  const hit = cache.get(key);
  if (hit) {
    cb(hit);
    return () => {};
  }
  let set = listeners.get(key);
  if (!set) listeners.set(key, (set = new Set()));
  set.add(cb);
  const queued = queue.findIndex((j) => j.key === key);
  if (queued >= 0) queue.push(...queue.splice(queued, 1));
  else queue.push({ key, json, at, size });
  pump();
  return () => {
    const waiting = listeners.get(key);
    waiting?.delete(cb);
    if (waiting && !waiting.size) {
      listeners.delete(key);
      const i = queue.findIndex((j) => j.key === key);
      if (i >= 0) queue.splice(i, 1);
    }
  };
}

/**
 * Poster of `json` while `enabled` (e.g. on screen). The previous picture stays until the new one is drawn,
 * so edits do not flash empty tiles.
 */
export function usePoster(json: string | null | undefined, at: PosterAt, size: number, enabled = true): string | null {
  const [url, setUrl] = useState<string | null>(() => (json ? peekPoster(json, at, size) : null));
  const atKey = 'frac' in at ? `f${at.frac}` : `n${at.frame}`;
  useEffect(() => {
    if (!json) return setUrl(null);
    const hit = peekPoster(json, at, size);
    if (hit) return setUrl(hit);
    if (!enabled) return;
    return requestPoster(json, at, size, setUrl);
  }, [json, atKey, size, enabled]);
  return url;
}
