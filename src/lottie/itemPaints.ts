import { hexToOklch, oklchToHex } from './brand';
import { hexToRgba, toHex } from './color';
import { parentOf, parseId } from './layout';
import { assetsOf, itemsBBox, resolvePart, type AnyLayer } from './parts';
import type { LottieAnimation, ShapeItem } from './types';

/**
 * Colours of single layers of an imported animation: every fill, stroke and gradient item can be listed and
 * edited on its own (the palette recolours a colour everywhere; this changes it in one place).
 *
 * Items are addressed like parts: "l3/g4" is item #4 of layer #3's shapes, "l3/g0/g2" item #2 of its first
 * group — so layer-list operations move these ids like any other (see `remapId`).
 */

/**
 * An edit of one item. Gradient points are in the item's own coordinates. A flat fill/stroke given two or more
 * `stops` becomes a gradient (with `from`/`to`/`type`).
 */
export interface ItemPaint {
  /** Flat fill/stroke colour. */
  color?: string;
  /** Gradient colour stops, in order (missing ones keep their colour). */
  stops?: string[];
  from?: [number, number];
  to?: [number, number];
  /** 1 = linear, 2 = radial. */
  type?: 1 | 2;
}

export interface PaintItem {
  id: string;
  kind: 'fill' | 'stroke';
  gradient: boolean;
  /** One colour for flat paints, the stops of a gradient. */
  colors: string[];
  type?: 1 | 2;
  from?: [number, number];
  to?: [number, number];
  /** Keyframed colour or gradient (an edit holds it still). */
  animated: boolean;
}

type Json = Record<string, unknown>;
const STYLE = new Set(['fl', 'st', 'gf', 'gs']);

const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const animatedProp = (p: unknown) => isObj(p) && p.a === 1;

/** The static value of a property, or its first keyframe. */
function first(p: unknown): number[] | undefined {
  if (!isObj(p)) return undefined;
  if (p.a === 1 && Array.isArray(p.k)) {
    const kf = p.k[0];
    return isObj(kf) && Array.isArray(kf.s) ? (kf.s as number[]) : undefined;
  }
  return Array.isArray(p.k) ? (p.k as number[]) : typeof p.k === 'number' ? [p.k] : undefined;
}

const hexAt = (arr: readonly number[], i: number) => toHex([arr[i] ?? 0, arr[i + 1] ?? 0, arr[i + 2] ?? 0, 1]);
const point = (v: number[] | undefined): [number, number] | undefined => (v && v.length >= 2 ? [v[0], v[1]] : undefined);

function describe(id: string, it: ShapeItem): PaintItem | null {
  const kind = it.ty === 'fl' || it.ty === 'gf' ? 'fill' : 'stroke';
  if (it.ty === 'fl' || it.ty === 'st') {
    const c = first(it.c);
    return c ? { id, kind, gradient: false, colors: [hexAt(c, 0)], animated: animatedProp(it.c) } : null;
  }
  const g = isObj(it.g) ? it.g : null;
  const stops = g && typeof g.p === 'number' ? g.p : 0;
  const values = g ? first(g.k) : undefined;
  if (!values || !stops) return null;
  const colors = Array.from({ length: stops }, (_, i) => hexAt(values, i * 4 + 1));
  return {
    id,
    kind,
    gradient: true,
    colors,
    type: it.t === 2 ? 2 : 1,
    from: point(first(it.s)),
    to: point(first(it.e)),
    animated: animatedProp(g?.k) || animatedProp(it.s) || animatedProp(it.e),
  };
}

function walkItems(items: readonly ShapeItem[], prefix: string, out: PaintItem[]): void {
  items.forEach((it, i) => {
    const id = `${prefix}/g${i}`;
    if (it.ty === 'gr') walkItems((it.it as ShapeItem[]) ?? [], id, out);
    else if (STYLE.has(it.ty)) {
      const d = describe(id, it);
      if (d) out.push(d);
    }
  });
}

function walkLayers(layers: readonly AnyLayer[], anim: LottieAnimation, prefix: string, seen: Set<string>, out: PaintItem[]): void {
  layers.forEach((layer, i) => walkLayer(layer, anim, `${prefix}l${i}`, seen, out));
}

function walkLayer(layer: AnyLayer, anim: LottieAnimation, id: string, seen: Set<string>, out: PaintItem[]): void {
  if (layer.ty === 4) walkItems((layer.shapes ?? []) as ShapeItem[], id, out);
  else if (layer.ty === 0 && layer.refId && !seen.has(layer.refId)) {
    const asset = assetsOf(anim).get(layer.refId);
    if (asset?.layers) walkLayers(asset.layers, anim, `${id}>`, new Set([...seen, layer.refId]), out);
  }
}

/** Fills, strokes and gradients of the whole animation, or of one part (in render order). */
export function listPaintItems(anim: LottieAnimation, part?: string): PaintItem[] {
  const out: PaintItem[] = [];
  if (!part) {
    walkLayers(anim.layers as AnyLayer[], anim, '', new Set(), out);
    return out;
  }
  const target = resolvePart(anim, part);
  if (!target) return out;
  if (target.type === 'group') walkItems((target.group.it as ShapeItem[]) ?? [], part, out);
  else walkLayer(target.layer, anim, part, new Set(), out);
  return out;
}

/** The mutable style item for an item id, or null. */
export function resolveItem(anim: LottieAnimation, id: string): ShapeItem | null {
  const tokens = parseId(id);
  const last = tokens[tokens.length - 1];
  if (!last || last.type !== 'g') return null;
  const container = resolvePart(anim, parentOf(id).parent);
  if (!container) return null;
  const items = (container.type === 'group' ? container.group.it : container.layer.shapes) as ShapeItem[] | undefined;
  const it = items?.[last.i];
  return it && STYLE.has(it.ty) ? it : null;
}

/** Channels 0–1, three decimals (TGS files have a size limit). */
const rgb = (hex: string) => hexToRgba(hex).slice(0, 3).map((v) => Math.round(v * 1000) / 1000);

const round = (v: number) => Math.round(v * 1000) / 1000;

/** Turns a flat fill/stroke into a gradient one, in place (opacity, fill rule, stroke width and joins stay). */
function toGradient(it: ShapeItem, edit: ItemPaint): void {
  const stops = edit.stops ?? [];
  const k = stops.flatMap((hex, i) => [round(i / (stops.length - 1)), ...rgb(hex)]);
  delete it.c;
  it.ty = it.ty === 'fl' ? 'gf' : 'gs';
  it.g = { p: stops.length, k: { a: 0, k } };
  it.s = { a: 0, k: edit.from ?? [0, 0] };
  it.e = { a: 0, k: edit.to ?? [0, 100] };
  it.t = edit.type ?? 1;
  // Radial highlight (players expect them on every gradient).
  it.h = { a: 0, k: 0 };
  it.a = { a: 0, k: 0 };
}

/** The second colour of a new gradient: the same hue, clearly lighter or darker. */
export function gradientPartner(hex: string): string {
  const c = hexToOklch(hex);
  return oklchToHex({ ...c, L: c.L > 0.55 ? c.L - 0.28 : Math.min(0.97, c.L + 0.3), h: (c.h + 18) % 360 });
}

/**
 * Where a new gradient of an item runs: across what its group (or layer) draws, top to bottom — from the middle
 * outwards for a radial one. In the item's own coordinates.
 */
export function gradientSpan(anim: LottieAnimation, id: string, type: 1 | 2 = 1): { from: [number, number]; to: [number, number] } {
  const container = resolvePart(anim, parentOf(id).parent);
  const items = ((container?.type === 'group' ? container.group.it : container?.layer.shapes) ?? []) as ShapeItem[];
  const box = itemsBBox(items).box ?? { x: 0, y: 0, w: 100, h: 100 };
  const cx = round(box.x + box.w / 2);
  const cy = round(box.y + box.h / 2);
  if (type === 2) return { from: [cx, cy], to: [cx, round(cy + Math.max(box.w, box.h) / 2)] };
  return { from: [cx, round(box.y)], to: [cx, round(box.y + box.h)] };
}

/** The edit that turns a flat item into a gradient of its colour and a partner colour. */
export function flatToGradient(anim: LottieAnimation, item: PaintItem): ItemPaint {
  const color = item.colors[0];
  return { stops: [color, gradientPartner(color)], type: 1, ...gradientSpan(anim, item.id, 1) };
}

/** Applies item edits to `anim` in place (pass a private copy). */
export function applyItemPaints(anim: LottieAnimation, paints: Readonly<Record<string, ItemPaint>>): LottieAnimation {
  for (const [id, edit] of Object.entries(paints)) {
    const it = resolveItem(anim, id);
    if (!it) continue;
    if ((it.ty === 'fl' || it.ty === 'st') && (edit.stops?.length ?? 0) >= 2) {
      toGradient(it, edit);
      continue;
    }
    if ((it.ty === 'fl' || it.ty === 'st') && edit.color) {
      it.c = { a: 0, k: [...rgb(edit.color), 1] };
      continue;
    }
    if (it.ty !== 'gf' && it.ty !== 'gs') continue;
    const g = isObj(it.g) ? it.g : null;
    const values = g ? first(g.k) : undefined;
    if (g && values && edit.stops?.length) {
      const next = [...values];
      const n = typeof g.p === 'number' ? g.p : 0;
      edit.stops.slice(0, n).forEach((hex, i) => {
        if (hex) next.splice(i * 4 + 1, 3, ...rgb(hex));
      });
      g.k = { a: 0, k: next };
    }
    if (edit.from) it.s = { a: 0, k: edit.from };
    if (edit.to) it.e = { a: 0, k: edit.to };
    if (edit.type) it.t = edit.type;
  }
  return anim;
}

/** Preview classes for the gradient handles: `pg-i<N>` (N = index among all items) spanning a unit box. */
export const itemGradientClass = (index: number) => `i${index}`;

/** Tags every gradient item for the canvas handles (`anim` is changed in place; exports strip the tags). */
export function tagItemGradients(anim: LottieAnimation): void {
  // A precomp used twice lists its items twice: one object, both names.
  const names = new Map<ShapeItem, string[]>();
  listPaintItems(anim).forEach((item, index) => {
    const it = item.gradient ? resolveItem(anim, item.id) : null;
    if (it) names.set(it, [...(names.get(it) ?? []), `pg-${itemGradientClass(index)}`]);
  });
  for (const [it, classes] of names) {
    delete it.cl;
    // Points are the item's own coordinates, so the "painted area" is a unit box. Last key (see stripping).
    it.cl = `${classes.join(' ')} pgb_0_0_1_1`;
  }
}
