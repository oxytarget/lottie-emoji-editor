import { artToShapes, fitArt, type ArtStyle, type VectorArt } from '../content/art';
import { hexToRgba, toHex } from './color';
import { contentGroup } from './compose';
import type { Layer, LottieAnimation } from './types';

/**
 * Helpers for user-imported Lottie/TGS files: palette extraction, recolouring and
 * placing the user's text/logo on top of the animation.
 */

type Json = Record<string, unknown>;

const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

function visit(node: unknown, fn: (obj: Json) => void): void {
  if (Array.isArray(node)) {
    for (const n of node) visit(n, fn);
  } else if (isObj(node)) {
    fn(node);
    for (const v of Object.values(node)) if (typeof v === 'object' && v !== null) visit(v, fn);
  }
}

/** Calls `fn` for every RGB triple (as a mutable array + offset) inside colour and gradient properties. */
function forEachColor(anim: unknown, fn: (arr: number[], offset: number) => void): void {
  const colorValue = (k: unknown) => {
    if (Array.isArray(k) && typeof k[0] === 'number' && k.length >= 3) fn(k as number[], 0);
  };
  const gradientValue = (k: unknown, stops: number) => {
    if (!Array.isArray(k) || typeof k[0] !== 'number') return;
    for (let i = 0; i < stops && i * 4 + 3 < k.length; i++) fn(k as number[], i * 4 + 1);
  };
  const eachKeyframeValue = (prop: unknown, cb: (k: unknown) => void) => {
    if (!isObj(prop)) return;
    if (prop.a === 1 && Array.isArray(prop.k)) {
      for (const kf of prop.k) {
        if (isObj(kf)) {
          cb(kf.s);
          cb(kf.e);
        }
      }
    } else {
      cb(prop.k);
    }
  };

  visit(anim, (obj) => {
    if ((obj.ty === 'fl' || obj.ty === 'st') && isObj(obj.c)) eachKeyframeValue(obj.c, colorValue);
    if ((obj.ty === 'gf' || obj.ty === 'gs') && isObj(obj.g)) {
      const g = obj.g as Json;
      const stops = typeof g.p === 'number' ? g.p : 0;
      eachKeyframeValue(g.k, (k) => gradientValue(k, stops));
    }
  });
}

/** Unique colours used by the animation, most frequent first. */
export function extractPalette(anim: LottieAnimation, limit = 12): string[] {
  const counts = new Map<string, number>();
  forEachColor(anim, (arr, i) => {
    const hex = toHex([arr[i], arr[i + 1], arr[i + 2], 1]);
    counts.set(hex, (counts.get(hex) ?? 0) + 1);
  });
  visit(anim.layers, (obj) => {
    if (obj.ty === 1 && typeof obj.sc === 'string') {
      const hex = obj.sc.toLowerCase();
      counts.set(hex, (counts.get(hex) ?? 0) + 1);
    }
  });
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([hex]) => hex);
}

/** Deep-copies the animation replacing colours according to `map` (hex → hex). */
export function recolor(anim: LottieAnimation, map: Record<string, string>): LottieAnimation {
  const copy = structuredClone(anim);
  const entries = Object.entries(map).filter(([from, to]) => from !== to);
  if (!entries.length) return copy;
  const lookup = new Map(entries.map(([from, to]) => [from.toLowerCase(), hexToRgba(to)]));
  forEachColor(copy, (arr, i) => {
    const target = lookup.get(toHex([arr[i], arr[i + 1], arr[i + 2], 1]));
    if (!target) return;
    arr[i] = target[0];
    arr[i + 1] = target[1];
    arr[i + 2] = target[2];
  });
  visit(copy.layers, (obj) => {
    if (obj.ty === 1 && typeof obj.sc === 'string') {
      const t = lookup.get(obj.sc.toLowerCase());
      if (t) obj.sc = toHex(t);
    }
  });
  return copy;
}

export interface OverlayInput {
  art: VectorArt;
  artStyle: ArtStyle;
  scale: number;
  offsetY: number;
  offsetX?: number;
  rotation?: number;
}

/** Adds the user's content as the top-most layer, centred on the canvas. */
export function withOverlay(anim: LottieAnimation, overlay: OverlayInput): LottieAnimation {
  const slotW = anim.w * 0.62;
  const slotH = anim.h * 0.42;
  const fitted = fitArt(overlay.art, slotW, slotH, overlay.scale);
  const k = anim.w / 512;
  const shapes = artToShapes(fitted.items, fitted.bbox, { ...overlay.artStyle, outlineWidth: overlay.artStyle.outlineWidth * k });
  const maxInd = anim.layers.reduce((m, l) => Math.max(m, typeof l.ind === 'number' ? l.ind : 0), 0);
  const layer: Layer = {
    ddd: 0,
    ind: maxInd + 1,
    ty: 4,
    nm: 'content',
    sr: 1,
    ks: {
      o: { a: 0, k: 100 },
      r: { a: 0, k: 0 },
      p: { a: 0, k: [anim.w / 2 + (overlay.offsetX ?? 0) * k, anim.h / 2 + overlay.offsetY * k, 0] },
      a: { a: 0, k: [0, 0, 0] },
      s: { a: 0, k: [100, 100, 100] },
    },
    ao: 0,
    shapes: [contentGroup(shapes, overlay.rotation ?? 0)],
    ip: anim.ip,
    op: anim.op,
    st: 0,
    bm: 0,
  };
  return { ...anim, layers: [layer, ...anim.layers] };
}

/**
 * Brings a foreign animation to Telegram's sticker format: 60 fps (all times rescaled) and a 512×512 canvas
 * (custom emoji packs use 100×100 — the scene is scaled by a parent null layer, geometry stays untouched).
 */
export function normalizeForTgs(anim: LottieAnimation, size = 512): LottieAnimation {
  return fitCanvas(to60fps(anim), size);
}

export function to60fps(anim: LottieAnimation): LottieAnimation {
  const fr = anim.fr;
  if (!(fr > 0) || Math.abs(fr - 60) < 0.01) return anim;
  const f = 60 / fr;
  const copy = structuredClone(anim);
  const times = (l: Json) => {
    for (const key of ['ip', 'op', 'st']) if (typeof l[key] === 'number') l[key] = (l[key] as number) * f;
  };
  times(copy);
  for (const l of copy.layers) times(l);
  for (const a of copy.assets ?? []) if (isObj(a) && Array.isArray(a.layers)) for (const l of a.layers) if (isObj(l)) times(l);
  // Keyframes: any `k` array of objects with a numeric `t` (properties, shapes, text documents…).
  visit(copy, (obj) => {
    const k = obj.k;
    if (Array.isArray(k) && k.length && isObj(k[0]) && typeof k[0].t === 'number') {
      for (const kf of k) if (isObj(kf) && typeof kf.t === 'number') kf.t *= f;
    }
  });
  if (Array.isArray(copy.markers)) {
    for (const m of copy.markers) {
      if (isObj(m) && typeof m.tm === 'number') m.tm *= f;
      if (isObj(m) && typeof m.dr === 'number') m.dr *= f;
    }
  }
  copy.fr = 60;
  return copy;
}

export function fitCanvas(anim: LottieAnimation, size = 512): LottieAnimation {
  if (anim.w === size && anim.h === size) return anim;
  const k = size / Math.max(anim.w, anim.h);
  const rootInd = anim.layers.reduce((m, l) => Math.max(m, typeof l.ind === 'number' ? l.ind : 0), 0) + 1;
  const root: Layer = {
    ddd: 0,
    ind: rootInd,
    ty: 3,
    nm: 'canvas',
    sr: 1,
    ks: {
      o: { a: 0, k: 100 },
      r: { a: 0, k: 0 },
      p: { a: 0, k: [(size - anim.w * k) / 2, (size - anim.h * k) / 2, 0] },
      a: { a: 0, k: [0, 0, 0] },
      s: { a: 0, k: [k * 100, k * 100, 100] },
    },
    ao: 0,
    ip: anim.ip,
    op: anim.op,
    st: 0,
    bm: 0,
  };
  const layers = anim.layers.map((l) => (l.parent === undefined ? { ...l, parent: rootInd } : l));
  return { ...anim, w: size, h: size, layers: [...layers, root] };
}
