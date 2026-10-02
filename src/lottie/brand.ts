import { artBBox, type ArtItem, type VectorArt } from '../content/art';
import { toHex } from './color';
import { extractPalette } from './imported';
import type { Paint } from './paint';
import { itemsBounds } from './parts';
import type { LottieAnimation, ShapeItem } from './types';

/**
 * Recolouring a pack into brand colours. The pack's colours are grouped into families by hue (a body colour
 * with its shadows and highlights is one family); the biggest families take the brand colours, and every
 * colour keeps its place in its family — a shadow stays a shadow of the new colour. Greys, black and white
 * (outlines, eyes, highlights) are left alone. Colours are mixed in OKLCH, so shades look even.
 */

interface Lch {
  L: number;
  C: number;
  h: number;
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fromLinear = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

export function hexToOklch(hex: string): Lch {
  const n = parseInt(hex.slice(1, 7), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => toLinear(v / 255));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { L, C: Math.hypot(A, B), h: ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360 };
}

function oklchToRgb({ L, C, h }: Lch): [number, number, number] {
  const a = C * Math.cos((h * Math.PI) / 180);
  const b = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

/** Back to `#rrggbb`, lowering the chroma until the colour fits sRGB (keeps lightness and hue). */
export function oklchToHex(c: Lch): string {
  let C = c.C;
  for (let i = 0; i < 24; i++) {
    const rgb = oklchToRgb({ ...c, C });
    if (rgb.every((v) => v >= -0.001 && v <= 1.001)) return toHex([...rgb.map((v) => Math.min(1, Math.max(0, v))), 1]);
    C *= 0.88;
  }
  return toHex([...oklchToRgb({ ...c, C: 0 }).map((v) => Math.min(1, Math.max(0, v))), 1]);
}

/** Black, white and greys (and nearly so) are not brand colours and are not recoloured. */
export const isNeutral = (c: Lch) => c.C < 0.035 || c.L < 0.16 || c.L > 0.97;

const hueDistance = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

const FAMILY_HUE = 32;

interface Family {
  L: number;
  C: number;
  /** Weighted mean hue (as a vector, so 350° and 10° average to 0°). */
  x: number;
  y: number;
  weight: number;
}

const familyHue = (f: Family) => ((Math.atan2(f.y, f.x) * 180) / Math.PI + 360) % 360;

/** Hue families of weighted colours, biggest first. */
function families(colors: ReadonlyMap<string, number>): { list: Family[]; of: Map<string, Family> } {
  const list: Family[] = [];
  const of = new Map<string, Family>();
  for (const [hex, weight] of [...colors].sort((a, b) => b[1] - a[1])) {
    const c = hexToOklch(hex);
    if (isNeutral(c)) continue;
    let f = list.find((x) => hueDistance(familyHue(x), c.h) < FAMILY_HUE);
    if (!f) list.push((f = { L: 0, C: 0, x: 0, y: 0, weight: 0 }));
    const w = Math.max(weight, 1e-6);
    f.L = (f.L * f.weight + c.L * w) / (f.weight + w);
    f.C = (f.C * f.weight + c.C * w) / (f.weight + w);
    f.x += Math.cos((c.h * Math.PI) / 180) * w;
    f.y += Math.sin((c.h * Math.PI) / 180) * w;
    f.weight += w;
    of.set(hex, f);
  }
  list.sort((a, b) => b.weight - a.weight);
  return { list, of };
}

// ---------------------------------------------------------------------------
// How much of the picture each colour paints
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Static value or keyframe values of a property. */
function values(prop: unknown): unknown[] {
  if (!isObj(prop)) return [];
  if (prop.a === 1 && Array.isArray(prop.k)) return prop.k.flatMap((kf) => (isObj(kf) ? [kf.s, kf.e].filter((v) => v !== undefined) : []));
  return [prop.k];
}

const rgbHex = (v: unknown, at = 0): string | null =>
  Array.isArray(v) && typeof v[at] === 'number' && v.length >= at + 3 ? toHex([v[at] as number, v[at + 1] as number, v[at + 2] as number, 1]) : null;

/**
 * Colour → share of the picture it paints: a fill counts the size of the shapes it fills, a stroke a little,
 * each gradient stop a part of its gradient. Keys are spelt like `extractPalette`'s.
 */
export function paletteWeights(anim: LottieAnimation): Map<string, number> {
  const out = new Map<string, number>();
  const add = (hex: string | null, w: number) => {
    if (hex) out.set(hex, (out.get(hex) ?? 0) + w);
  };
  const visitList = (items: readonly ShapeItem[], depth: number) => {
    if (depth > 12) return;
    const box = itemsBounds(items).box;
    const area = box ? Math.max(1, box.w * box.h) : 1;
    for (const it of items) {
      if (it.ty === 'gr') visitList((it.it as ShapeItem[]) ?? [], depth + 1);
      else if (it.ty === 'fl' || it.ty === 'st') {
        const vals = values(it.c);
        for (const v of vals) add(rgbHex(v), ((it.ty === 'fl' ? 1 : 0.15) * area) / vals.length);
      } else if ((it.ty === 'gf' || it.ty === 'gs') && isObj(it.g)) {
        const stops = typeof it.g.p === 'number' ? it.g.p : 0;
        const vals = values(it.g.k);
        for (const v of vals) for (let i = 0; i < stops; i++) add(rgbHex(v, i * 4 + 1), ((it.ty === 'gf' ? 1 : 0.15) * area) / stops / vals.length);
      }
    }
  };
  const visitLayers = (layers: readonly Json[]) => {
    for (const l of layers) {
      if (l.ty === 4 && Array.isArray(l.shapes)) visitList(l.shapes as ShapeItem[], 0);
      if (l.ty === 1 && typeof l.sc === 'string') add(l.sc.toLowerCase(), Number(l.sw ?? 100) * Number(l.sh ?? 100));
    }
  };
  visitLayers(anim.layers as unknown as Json[]);
  for (const a of anim.assets ?? []) if (isObj(a) && Array.isArray(a.layers)) visitLayers(a.layers as Json[]);
  return out;
}

// ---------------------------------------------------------------------------
// Brand colours
// ---------------------------------------------------------------------------

/** Brand colours from weighted colours: one per hue family, biggest first. */
function brandOf(weighted: ReadonlyMap<string, number>, limit = 3): string[] {
  const { list } = families(weighted);
  // The family's most used colour stands for it (not an average nobody picked).
  const byFamily = new Map<Family, { hex: string; w: number }>();
  for (const [hex, w] of weighted) {
    const c = hexToOklch(hex);
    if (isNeutral(c)) continue;
    const f = list.find((x) => hueDistance(familyHue(x), c.h) < FAMILY_HUE);
    const best = f && byFamily.get(f);
    if (f && (!best || w > best.w)) byFamily.set(f, { hex, w });
  }
  return list.slice(0, limit).flatMap((f) => (byFamily.has(f) ? [byFamily.get(f)!.hex] : []));
}

const itemArea = (it: ArtItem) => {
  const b = artBBox([it]);
  return b ? Math.max(1, b.w * b.h) : 1;
};

/** Colours of a logo (its own colours), biggest areas first; greys left out. */
export function artBrandColors(art: VectorArt): string[] {
  const weighted = new Map<string, number>();
  const add = (rgba: readonly number[], w: number) => {
    const hex = toHex([rgba[0], rgba[1], rgba[2], 1]);
    weighted.set(hex, (weighted.get(hex) ?? 0) + w);
  };
  for (const it of art.items) {
    const area = itemArea(it) * it.opacity;
    for (const [paint, k] of [
      [it.fill, 1],
      [it.stroke?.paint ?? null, 0.2],
    ] as const) {
      if (!paint) continue;
      if (paint.type === 'solid') add(paint.color, area * k * paint.color[3]);
      else for (const s of paint.stops) add(s.color, (area * k) / paint.stops.length);
    }
  }
  return brandOf(weighted);
}

/** Colours of editor paints (text fill, emoji colours…), in the given order of importance; greys left out. */
export function paintBrandColors(paints: readonly (Paint | null | undefined)[]): string[] {
  const weighted = new Map<string, number>();
  paints.forEach((p, i) => {
    if (!p) return;
    const colors = p.type === 'solid' ? [p.color] : p.colors;
    for (const c of colors) weighted.set(c.toLowerCase(), (weighted.get(c.toLowerCase()) ?? 0) + (paints.length - i) / colors.length);
  });
  return brandOf(weighted);
}

// ---------------------------------------------------------------------------
// Recolouring
// ---------------------------------------------------------------------------

/** `c` (a colour of the family `f`) moved to `to`: the same lightness step from the family, its own shading. */
function shifted(c: Lch, f: { L: number; C: number; h: number }, to: Lch): string {
  const L = Math.min(0.97, Math.max(0.06, to.L + (c.L - f.L)));
  // Greys have no hue to keep: they all take the new colour's.
  if (f.C < 0.035) return oklchToHex({ L, C: to.C, h: to.h });
  const C = Math.min(0.37, (c.C * to.C) / Math.max(f.C, 0.02));
  const h = (to.h + (((c.h - f.h + 540) % 360) - 180) * 0.4 + 360) % 360;
  return oklchToHex({ L, C, h });
}

/**
 * Colour maps (old → new, for `colorMap`) that put `brand` colours on a set of animations — one mapping for
 * all of them, so the stickers of a pack stay alike. Null when there is nothing to do (no brand colour).
 */
export function brandColorMaps(anims: readonly LottieAnimation[], brand: readonly string[]): Array<Record<string, string>> | null {
  const targets = brand.map(hexToOklch).filter((c) => !isNeutral(c));
  if (!targets.length) return null;
  const weights = anims.map(paletteWeights);
  const total = new Map<string, number>();
  for (const w of weights) for (const [hex, v] of w) total.set(hex, (total.get(hex) ?? 0) + v);
  // Colours the weights missed (inside unusual properties) still belong to a family.
  for (const anim of anims) for (const hex of extractPalette(anim, Infinity)) if (!total.has(hex)) total.set(hex, 0);
  const { list, of } = families(total);

  const mapped = new Map<string, string>();
  for (const [hex] of total) {
    const f = of.get(hex);
    if (!f) continue;
    const to = targets[list.indexOf(f) % targets.length];
    mapped.set(hex, shifted(hexToOklch(hex), { L: f.L, C: f.C, h: familyHue(f) }, to));
  }
  return anims.map((anim) => {
    const map: Record<string, string> = {};
    for (const hex of extractPalette(anim, Infinity)) {
      const to = mapped.get(hex);
      if (to && to !== hex) map[hex] = to;
    }
    return map;
  });
}

// ---------------------------------------------------------------------------
// Main colours of a pack
// ---------------------------------------------------------------------------

/** A main colour of a set of animations with its shades (one hue family, or blacks / whites / greys). */
export interface ColorFamily {
  /** The family's most used colour (stands for it). */
  hex: string;
  /** All its colours, as spelt in the files. */
  colors: string[];
  /** Share of the painted picture (0…1). */
  share: number;
  /** Lightness, chroma and hue of the family as a whole. */
  L: number;
  C: number;
  h: number;
}

/** The main colours of the animations, biggest first: hue families, then blacks, greys and whites. */
export function colorFamilies(anims: readonly LottieAnimation[], limit = 8): ColorFamily[] {
  const total = new Map<string, number>();
  for (const anim of anims) {
    for (const [hex, w] of paletteWeights(anim)) total.set(hex, (total.get(hex) ?? 0) + w);
    for (const hex of extractPalette(anim, Infinity)) if (!total.has(hex)) total.set(hex, 0);
  }
  const sum = [...total.values()].reduce((a, b) => a + b, 0) || 1;
  const { list, of } = families(total);
  const groups = new Map<unknown, { colors: Array<[string, number]>; L: number; C: number; h: number }>();
  for (const f of list) groups.set(f, { colors: [], L: f.L, C: f.C, h: familyHue(f) });
  // Neutrals by lightness: outlines, greys, highlights.
  const neutral = (L: number) => (L < 0.4 ? 'dark' : L > 0.85 ? 'light' : 'grey');
  for (const [hex, w] of total) {
    const f = of.get(hex);
    if (f) {
      groups.get(f)!.colors.push([hex, w]);
      continue;
    }
    const c = hexToOklch(hex);
    const key = neutral(c.L);
    if (!groups.has(key)) groups.set(key, { colors: [], L: 0, C: 0, h: 0 });
    groups.get(key)!.colors.push([hex, w]);
  }
  const out: ColorFamily[] = [];
  for (const [key, g] of groups) {
    if (!g.colors.length) continue;
    g.colors.sort((a, b) => b[1] - a[1]);
    const weight = g.colors.reduce((a, [, w]) => a + w, 0);
    let { L, C, h } = g;
    if (typeof key === 'string') {
      // A neutral group: its average lightness, no hue.
      L = g.colors.reduce((a, [hex, w]) => a + hexToOklch(hex).L * (w || 1e-6), 0) / (weight || 1e-6 * g.colors.length);
      C = 0;
      h = 0;
    }
    out.push({ hex: g.colors[0][0], colors: g.colors.map(([hex]) => hex), share: weight / sum, L, C, h });
  }
  return out.sort((a, b) => b.share - a.share).slice(0, limit);
}

/** Colour map that turns `family` into `to`, every shade moved alike. */
export function familyColorMap(family: ColorFamily, to: string): Record<string, string> {
  const target = hexToOklch(to);
  const map: Record<string, string> = {};
  for (const hex of family.colors) {
    // The colour that stands for the family becomes exactly the one picked.
    map[hex] = hex === family.hex ? to.toLowerCase() : shifted(hexToOklch(hex), family, target);
  }
  return map;
}
