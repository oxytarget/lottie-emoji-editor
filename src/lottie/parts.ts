import { artToShapes, fitArt, type ArtStyle, type VectorArt } from '../content/art';
import { applyMatrix, contoursBBox, IDENTITY, multiply, rotateMatrix, type Contour } from './bezier';
import { group } from './shapes';
import type { BBox, Bezier, Layer, LottieAnimation, Matrix, ShapeItem } from './types';

/**
 * Splits imported Lottie/TGS animations into editable parts (layers, layers inside precomps, shape groups),
 * guesses which part is text or a logo, and applies edits: hide a part or replace it with the user's
 * text/logo while keeping the part's own animation (its layer/group transform).
 *
 * Part ids are paths: "l3" = root layer #3, "l3>l1" = layer #1 of the precomp used by root layer #3,
 * "l3/g0" = first group of layer #3's shapes, "l3/g0/g2" = a nested group.
 */

export type PartKind = 'shape' | 'precomp' | 'null' | 'image' | 'text' | 'solid' | 'group' | 'other';

export interface Part {
  id: string;
  name: string;
  kind: PartKind;
  /** Looks like text or a logo (by name, text layer, or many glyph-like contours). */
  detected: boolean;
  /** Can be replaced with the user's text/logo. */
  replaceable: boolean;
  children: Part[];
}

type Json = Record<string, unknown>;
type AnyLayer = Layer & { refId?: string; t?: unknown; w?: number; h?: number; sw?: number; sh?: number; tt?: number; td?: number };
interface Asset {
  id: string;
  layers?: AnyLayer[];
  w?: number;
  h?: number;
}

const NAME_HINT = /(text|txt|logo|emoji|title|name|word|label|brand|caption|content|надпис|текст|лого|назва|слово|имя|ім'я)/i;
const MAX_GROUP_DEPTH = 3;

const KIND_BY_TYPE: Record<number, PartKind> = { 0: 'precomp', 1: 'solid', 2: 'image', 3: 'null', 4: 'shape', 5: 'text' };

// ---------------------------------------------------------------------------
// Geometry helpers (static, first-keyframe values)
// ---------------------------------------------------------------------------

function firstValue<T = unknown>(prop: unknown): T | undefined {
  if (!prop || typeof prop !== 'object') return undefined;
  const p = prop as { a?: number; k?: unknown };
  if (p.a === 1 && Array.isArray(p.k)) {
    const kf = p.k[0] as { s?: unknown } | undefined;
    return kf?.s as T;
  }
  return p.k as T;
}

/** Property value at frame `t` (linear between keyframes — good enough for bounds and thumbnails). */
function valueAt<T = unknown>(prop: unknown, t: number | undefined): T | undefined {
  if (t === undefined) return firstValue<T>(prop);
  if (!prop || typeof prop !== 'object') return undefined;
  const p = prop as { a?: number; k?: unknown };
  if (p.a !== 1 || !Array.isArray(p.k) || !p.k.length) return p.k as T;
  const keys = p.k as Array<{ t: number; s?: unknown; e?: unknown; h?: number }>;
  if (t <= keys[0].t) return keys[0].s as T;
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i];
    const b = keys[i + 1];
    if (t >= b.t) continue;
    const from = a.s;
    const to = b.s ?? a.e ?? from;
    if (a.h || !Array.isArray(from) || !Array.isArray(to) || typeof from[0] !== 'number') return from as T;
    const f = (t - a.t) / Math.max(b.t - a.t, 1e-6);
    return (from as number[]).map((v, j) => v + ((((to as number[])[j] ?? v) as number) - v) * f) as T;
  }
  const last = keys[keys.length - 1];
  return (last.s ?? keys[keys.length - 2]?.e) as T;
}

const num = (v: unknown, fallback: number): number => (typeof v === 'number' ? v : Array.isArray(v) && typeof v[0] === 'number' ? v[0] : fallback);
const vec = (v: unknown, fallback: number[]): number[] => (Array.isArray(v) && typeof v[0] === 'number' ? (v as number[]) : fallback);

/** Matrix of a group `tr` item (or layer `ks`) at frame `t` (first keyframe when omitted). */
function transformMatrix(tr: Json | undefined, t?: number): Matrix {
  if (!tr) return IDENTITY;
  const p = vec(valueAt(tr.p, t), [0, 0]);
  const a = vec(valueAt(tr.a, t), [0, 0]);
  const s = vec(valueAt(tr.s, t), [100, 100]);
  const r = num(valueAt(tr.r, t), 0);
  // p · r · s · (-a)
  return multiply([1, 0, 0, 1, p[0], p[1]], multiply(rotateMatrix(r), multiply([s[0] / 100, 0, 0, s[1] / 100, 0, 0], [1, 0, 0, 1, -a[0], -a[1]])));
}

function bezierContour(b: Bezier, m: Matrix): Contour | null {
  if (!b?.v?.length) return null;
  const n = b.v.length;
  const segs: Contour['segs'] = [];
  const count = b.c ? n : n - 1;
  for (let i = 0; i < count; i++) {
    const from = b.v[i];
    const j = (i + 1) % n;
    const to = b.v[j];
    const c1 = applyMatrix(m, from[0] + b.o[i][0], from[1] + b.o[i][1]);
    const c2 = applyMatrix(m, to[0] + b.i[j][0], to[1] + b.i[j][1]);
    const e = applyMatrix(m, to[0], to[1]);
    segs.push([c1[0], c1[1], c2[0], c2[1], e[0], e[1]]);
  }
  return { closed: b.c, start: applyMatrix(m, b.v[0][0], b.v[0][1]), segs };
}

function boxContour(cx: number, cy: number, w: number, h: number, m: Matrix): Contour {
  const pts = [
    [cx - w / 2, cy - h / 2],
    [cx + w / 2, cy - h / 2],
    [cx + w / 2, cy + h / 2],
    [cx - w / 2, cy + h / 2],
  ].map(([x, y]) => applyMatrix(m, x, y));
  return {
    closed: true,
    start: pts[0],
    segs: [1, 2, 3, 0].map((k, idx) => {
      const prev = pts[idx];
      const next = pts[k];
      return [prev[0], prev[1], next[0], next[1], next[0], next[1]] as Contour['segs'][number];
    }),
  };
}

/** Collects the outlines of shape items (recursing into groups and applying their transforms). */
function collectContours(items: readonly ShapeItem[], m: Matrix, out: Contour[], t?: number): void {
  const tr = items.find((it) => it.ty === 'tr') as Json | undefined;
  const local = multiply(m, transformMatrix(tr, t));
  for (const it of items) {
    if (it.ty === 'gr') collectContours((it.it as ShapeItem[]) ?? [], local, out, t);
    else if (it.ty === 'sh') {
      const b = firstValue<Bezier | Bezier[]>(it.ks);
      const bez = Array.isArray(b) ? b[0] : b;
      const c = bez && bezierContour(bez, local);
      if (c) out.push(c);
    } else if (it.ty === 'el' || it.ty === 'rc') {
      const p = vec(valueAt(it.p, t), [0, 0]);
      const s = vec(valueAt(it.s, t), [0, 0]);
      if (s[0] > 0 && s[1] > 0) out.push(boxContour(p[0], p[1], s[0], s[1], local));
    } else if (it.ty === 'sr') {
      const p = vec(valueAt(it.p, t), [0, 0]);
      const r = num(valueAt(it.or, t), 0);
      if (r > 0) out.push(boxContour(p[0], p[1], r * 2, r * 2, local));
    }
  }
}

function itemsBBox(items: readonly ShapeItem[]): { box: BBox | null; contours: number } {
  const contours: Contour[] = [];
  // A group's own `tr` applies to its content; here the list is a layer's shapes or a group's items.
  collectContours(items.filter((it) => it.ty !== 'tr'), IDENTITY, contours);
  return { box: contoursBBox(contours), contours: contours.length };
}

// ---------------------------------------------------------------------------
// Listing parts
// ---------------------------------------------------------------------------

function assetsById(anim: LottieAnimation): Map<string, Asset> {
  return new Map(((anim.assets ?? []) as Asset[]).filter((a) => a && typeof a.id === 'string').map((a) => [a.id, a]));
}

function looksLikeText(name: string, contours: number, box: BBox | null): boolean {
  if (NAME_HINT.test(name)) return true;
  // Several glyph-like outlines laid out wider than tall.
  return !!box && contours >= 5 && box.w > box.h * 1.4;
}

/** Collapses single wrapper groups (common in After Effects exports) so the meaningful groups are listed. */
function unwrap(groups: Part[]): Part[] {
  let list = groups;
  while (list.length === 1 && list[0].children.length > 1) list = list[0].children;
  return list.length > 1 ? list : [];
}

function groupParts(items: readonly ShapeItem[], prefix: string, groupDepth: number): Part[] {
  if (groupDepth > MAX_GROUP_DEPTH) return [];
  return items
    .map((it, idx) => ({ it, idx }))
    .filter(({ it }) => it.ty === 'gr')
    .map(({ it, idx }) => {
      const id = `${prefix}/g${idx}`;
      const children = (it.it as ShapeItem[]) ?? [];
      const { box, contours } = itemsBBox(children);
      const name = typeof it.nm === 'string' && it.nm ? it.nm : `Group ${idx + 1}`;
      return {
        id,
        name,
        kind: 'group' as const,
        detected: looksLikeText(name, contours, box),
        replaceable: !!box,
        children: unwrap(groupParts(children, id, groupDepth + 1)),
      };
    });
}

function layerParts(layers: readonly AnyLayer[], assets: Map<string, Asset>, prefix: string, seen: Set<string>): Part[] {
  return layers.map((layer, idx) => {
    const id = `${prefix}l${idx}`;
    const kind = KIND_BY_TYPE[layer.ty as number] ?? 'other';
    const name = typeof layer.nm === 'string' && layer.nm ? layer.nm : `Layer ${idx + 1}`;
    let children: Part[] = [];
    let detected = kind === 'text' || NAME_HINT.test(name);
    if (kind === 'shape') {
      const shapes = (layer.shapes ?? []) as ShapeItem[];
      const { box, contours } = itemsBBox(shapes);
      detected = detected || looksLikeText(name, contours, box);
      children = unwrap(groupParts(shapes, id, 1));
    } else if (kind === 'precomp' && layer.refId && !seen.has(layer.refId)) {
      const asset = assets.get(layer.refId);
      if (asset?.layers) children = layerParts(asset.layers, assets, `${id}>`, new Set([...seen, layer.refId]));
    }
    return { id, name, kind, detected, replaceable: kind !== 'null' && kind !== 'other', children };
  });
}

/** Tree of editable parts, in render order (first = top-most). */
export function listParts(anim: LottieAnimation): Part[] {
  return layerParts(anim.layers as AnyLayer[], assetsById(anim), '', new Set());
}

export function flattenParts(parts: readonly Part[]): Part[] {
  return parts.flatMap((p) => [p, ...flattenParts(p.children)]);
}

// ---------------------------------------------------------------------------
// Resolving and editing
// ---------------------------------------------------------------------------

type Target =
  | { type: 'layer'; list: AnyLayer[]; index: number; layer: AnyLayer }
  | { type: 'group'; list: ShapeItem[]; index: number; group: ShapeItem };

/** Finds the mutable object for a part id inside `anim` (which must be a private copy). */
function resolve(anim: LottieAnimation, id: string): Target | null {
  const assets = assetsById(anim);
  const [layerPath, ...groupPath] = id.split('/');
  let list = anim.layers as AnyLayer[];
  let layer: AnyLayer | undefined;
  let index = -1;
  const layerSegs = layerPath.split('>');
  for (let s = 0; s < layerSegs.length; s++) {
    index = Number(layerSegs[s].slice(1));
    layer = list[index];
    if (!layer) return null;
    if (s < layerSegs.length - 1) {
      const asset = layer.refId ? assets.get(layer.refId) : undefined;
      if (!asset?.layers) return null;
      list = asset.layers;
    }
  }
  if (!layer) return null;
  if (!groupPath.length) return { type: 'layer', list, index, layer };
  let items = (layer.shapes ?? []) as ShapeItem[];
  let groupItem: ShapeItem | undefined;
  let gIndex = -1;
  for (let g = 0; g < groupPath.length; g++) {
    gIndex = Number(groupPath[g].slice(1));
    groupItem = items[gIndex];
    if (!groupItem || groupItem.ty !== 'gr') return null;
    if (g < groupPath.length - 1) items = (groupItem.it as ShapeItem[]) ?? [];
  }
  return groupItem ? { type: 'group', list: items, index: gIndex, group: groupItem } : null;
}

const LAYER_CONTENT_KEYS = ['shapes', 'refId', 't', 'w', 'h', 'sw', 'sh', 'sc', 'tm', 'tt', 'td', 'hasMask', 'masksProperties', 'ef'];

/** Turns a layer into an invisible null layer — children parented to it keep their motion. */
function toNull(list: AnyLayer[], index: number): void {
  const layer = list[index];
  // A hidden track matte must not hide the layer it was masking.
  if (layer.td && list[index + 1]?.tt) delete (list[index + 1] as Json).tt;
  for (const k of LAYER_CONTENT_KEYS) delete (layer as Json)[k];
  (layer as Json).ty = 3;
}

export interface PartEdits {
  hidden: readonly string[];
  replace?: string | null;
}

export interface ReplaceContent {
  art: VectorArt | null;
  artStyle: ArtStyle;
  /** Size slider multiplier. */
  scale: number;
  /** Height slider (−100…100), applied relative to the replaced part's size. */
  offsetY: number;
}

function contentShapes(box: BBox, content: ReplaceContent): ShapeItem[] {
  if (!content.art) return [];
  const w = box.w * 0.92;
  const h = box.h * 0.92;
  const fitted = fitArt(content.art, w, h, content.scale);
  // Keep the outline proportional to the part's size (a 100 px logo shouldn't get a 16 px outline).
  const k = Math.min(1, Math.max(box.w, box.h) / 300);
  const shapes = artToShapes(fitted.items, fitted.bbox, { ...content.artStyle, outlineWidth: content.artStyle.outlineWidth * k });
  const dy = (content.offsetY / 200) * box.h;
  return shapes.length ? [group(shapes, { p: [box.x + box.w / 2, box.y + box.h / 2 + dy] }, 'replaced-content')] : [];
}

/** Box a non-shape layer occupies in its own coordinates. */
function layerBox(layer: AnyLayer, assets: Map<string, Asset>): BBox | null {
  switch (layer.ty as number) {
    case 0: {
      const asset = layer.refId ? assets.get(layer.refId) : undefined;
      const w = layer.w ?? asset?.w ?? 512;
      const h = layer.h ?? asset?.h ?? 512;
      return { x: w * 0.1, y: h * 0.1, w: w * 0.8, h: h * 0.8 };
    }
    case 1:
      return { x: 0, y: 0, w: layer.sw ?? 100, h: layer.sh ?? 100 };
    case 2: {
      const asset = layer.refId ? assets.get(layer.refId) : undefined;
      return { x: 0, y: 0, w: asset?.w ?? 100, h: asset?.h ?? 100 };
    }
    case 5: {
      // Text layer: estimate from the first text document (font size, text length, justification, box).
      const doc = firstValue<{ s?: number; t?: string; j?: number; sz?: number[]; ps?: number[] }>((layer.t as Json | undefined)?.d) ?? {};
      if (doc.sz && doc.ps) return { x: doc.ps[0], y: doc.ps[1], w: doc.sz[0], h: doc.sz[1] };
      const size = doc.s ?? 40;
      const lines = String(doc.t ?? 'Text').split(/\r|\n/);
      const w = Math.max(...lines.map((l) => l.length), 1) * size * 0.6;
      const h = lines.length * size * 1.1;
      const x = doc.j === 2 ? -w / 2 : doc.j === 1 ? -w : 0;
      return { x, y: -size * 0.85, w, h };
    }
    default:
      return null;
  }
}

/**
 * Returns a copy of the animation with parts hidden and (optionally) one part replaced by the user's content.
 * The replaced part keeps its transform, so the new text/logo follows the original motion.
 */
export function applyPartEdits(anim: LottieAnimation, edits: PartEdits, content?: ReplaceContent): LottieAnimation {
  if (!edits.hidden.length && !edits.replace) return anim;
  const copy = structuredClone(anim);
  const assets = assetsById(copy);

  if (edits.replace && content) {
    const target = resolve(copy, edits.replace);
    if (target?.type === 'group') {
      const items = (target.group.it as ShapeItem[]) ?? [];
      const { box } = itemsBBox(items);
      const tr = items.find((it) => it.ty === 'tr');
      if (box) target.group.it = [...contentShapes(box, content), ...(tr ? [tr] : [])];
    } else if (target?.type === 'layer') {
      const layer = target.layer;
      const box = layer.ty === 4 ? itemsBBox((layer.shapes ?? []) as ShapeItem[]).box : layerBox(layer, assets);
      if (box) {
        const shapes = contentShapes(box, content);
        for (const k of LAYER_CONTENT_KEYS) if (k !== 'tt' && k !== 'td') delete (layer as Json)[k];
        (layer as Json).ty = 4;
        layer.shapes = shapes;
      }
    }
  }

  // Layers become nulls and groups are only marked here (removed in one sweep), so part indices stay valid.
  const hidden = [...new Set(edits.hidden)].filter((id) => id !== edits.replace);
  for (const id of hidden) {
    const target = resolve(copy, id);
    if (!target) continue;
    if (target.type === 'layer') toNull(target.list, target.index);
    else (target.group as Json).__remove = true;
  }
  const sweep = (items: ShapeItem[]): ShapeItem[] =>
    items.filter((it) => !(it as Json).__remove).map((it) => (it.ty === 'gr' ? { ...it, it: sweep((it.it as ShapeItem[]) ?? []) } : it));
  const sweepLayers = (layers: AnyLayer[]) => {
    for (const l of layers) if (l.shapes) l.shapes = sweep(l.shapes as ShapeItem[]);
  };
  sweepLayers(copy.layers as AnyLayer[]);
  for (const a of assets.values()) if (a.layers) sweepLayers(a.layers);
  return copy;
}

/** Static (first-keyframe) matrix of a layer including its parent chain. */
function layerMatrix(list: readonly AnyLayer[], layer: AnyLayer, t?: number, depth = 0): Matrix {
  const own = transformMatrix(layer.ks as unknown as Json, t);
  if (layer.parent === undefined || depth > 32) return own;
  const parent = list.find((l) => l.ind === layer.parent);
  return parent ? multiply(layerMatrix(list, parent, t, depth + 1), own) : own;
}

/** Layers and groups (with their transforms) from the root to a part. */
function pathTransforms(anim: LottieAnimation, id: string): Array<{ list?: AnyLayer[]; layer?: AnyLayer; tr?: Json }> | null {
  const assets = assetsById(anim);
  const [layerPath, ...groupPath] = id.split('/');
  const out: Array<{ list?: AnyLayer[]; layer?: AnyLayer; tr?: Json }> = [];
  let list = anim.layers as AnyLayer[];
  let layer: AnyLayer | undefined;
  for (const seg of layerPath.split('>')) {
    if (layer) {
      const asset = layer.refId ? assets.get(layer.refId) : undefined;
      if (!asset?.layers) return null;
      list = asset.layers;
    }
    layer = list[Number(seg.slice(1))];
    if (!layer) return null;
    out.push({ list, layer });
  }
  let items = (layer?.shapes ?? []) as ShapeItem[];
  for (const seg of groupPath) {
    const g = items[Number(seg.slice(1))];
    if (!g || g.ty !== 'gr') return null;
    items = (g.it as ShapeItem[]) ?? [];
    out.push({ tr: items.find((it) => it.ty === 'tr') as Json | undefined });
  }
  return out;
}

/** Approximate bounds of a part on the canvas at frame `t` (first keyframe when omitted). */
export function partBounds(anim: LottieAnimation, id: string, t?: number): BBox | null {
  const assets = assetsById(anim);
  const [layerPath, ...groupPath] = id.split('/');
  let list = anim.layers as AnyLayer[];
  let m: Matrix = IDENTITY;
  let layer: AnyLayer | undefined;
  for (const seg of layerPath.split('>')) {
    if (layer) {
      const asset = layer.refId ? assets.get(layer.refId) : undefined;
      if (!asset?.layers) return null;
      list = asset.layers;
    }
    layer = list[Number(seg.slice(1))];
    if (!layer) return null;
    m = multiply(m, layerMatrix(list, layer, t));
  }
  if (!layer) return null;
  const contours: Contour[] = [];
  if (groupPath.length) {
    let items = (layer.shapes ?? []) as ShapeItem[];
    for (const seg of groupPath) {
      const g = items[Number(seg.slice(1))];
      if (!g || g.ty !== 'gr') return null;
      items = (g.it as ShapeItem[]) ?? [];
      m = multiply(m, transformMatrix(items.find((it) => it.ty === 'tr') as Json | undefined, t));
    }
    collectContours(items.filter((it) => it.ty !== 'tr'), m, contours, t);
  } else if (layer.ty === 4) {
    collectContours((layer.shapes ?? []) as ShapeItem[], m, contours, t);
  } else {
    const box = layerBox(layer, assets);
    if (box) contours.push(boxContour(box.x + box.w / 2, box.y + box.h / 2, box.w, box.h, m));
  }
  return contoursBBox(contours);
}

/**
 * Copy of the animation where only `id` (plus the transforms it depends on) is visible — for thumbnails.
 * With `crop`, the view is zoomed onto the part so small parts stay recognisable.
 */
export function isolatePart(anim: LottieAnimation, id: string, crop = false): LottieAnimation {
  const hidden: string[] = [];
  const walk = (parts: readonly Part[]) => {
    for (const p of parts) {
      if (p.id === id) continue;
      const onPath = id.startsWith(`${p.id}/`) || id.startsWith(`${p.id}>`);
      if (onPath) walk(p.children);
      else hidden.push(p.id);
    }
  };
  walk(listParts(anim));
  const isolated = applyPartEdits(anim, { hidden });
  const box = crop ? partBounds(anim, id, partFrame(anim, id) + anim.ip) : null;
  if (!box || box.w <= 0 || box.h <= 0) return isolated;

  const size = Math.max(box.w, box.h) * 1.25;
  const k = Math.min(anim.w, anim.h) / size;
  if (k <= 1.05) return isolated;
  const copy = isolated === anim ? structuredClone(anim) : isolated;
  const rootInd = copy.layers.reduce((mx, l) => Math.max(mx, typeof l.ind === 'number' ? l.ind : 0), 0) + 1;
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  for (const l of copy.layers) if (l.parent === undefined) l.parent = rootInd;
  copy.layers.push({
    ddd: 0,
    ind: rootInd,
    ty: 3,
    nm: 'thumbnail-frame',
    sr: 1,
    ks: {
      o: { a: 0, k: 100 },
      r: { a: 0, k: 0 },
      p: { a: 0, k: [copy.w / 2 - cx * k, copy.h / 2 - cy * k, 0] },
      a: { a: 0, k: [0, 0, 0] },
      s: { a: 0, k: [k * 100, k * 100, 100] },
    },
    ao: 0,
    ip: copy.ip,
    op: copy.op,
    st: 0,
    bm: 0,
  });
  return copy;
}

/**
 * A frame where the part is well visible (largest scale × opacity along its layer/group chain) —
 * relative to the start of the animation, for thumbnails.
 */
export function partFrame(anim: LottieAnimation, id: string): number {
  const chain = pathTransforms(anim, id) ?? [];
  const root = chain[0]?.layer;
  const ip = Math.max(anim.ip, root?.ip ?? anim.ip);
  const op = Math.min(anim.op, root?.op ?? anim.op);
  const middle = Math.round((ip + op) / 2);
  const props = chain.flatMap((c) => {
    const tr = c.layer ? (c.layer.ks as unknown as Json) : c.tr;
    return tr ? [tr] : [];
  });
  const times = new Set<number>([middle]);
  for (const tr of props) {
    for (const key of ['s', 'o']) {
      const prop = tr[key] as { a?: number; k?: Array<{ t: number }> } | undefined;
      if (prop?.a === 1 && Array.isArray(prop.k)) for (const kf of prop.k) if (kf.t >= ip && kf.t < op) times.add(kf.t);
    }
  }
  const score = (t: number) =>
    props.reduce((acc, tr) => {
      const sc = vec(valueAt(tr.s, t), [100, 100]);
      const o = num(valueAt(tr.o, t), 100);
      return acc * (Math.min(Math.abs(sc[0]), Math.abs(sc[1])) / 100) * (Math.max(0, o) / 100);
    }, 1);
  let best = middle;
  let bestScore = score(middle);
  for (const t of times) {
    const sc = score(t);
    if (sc > bestScore + 1e-6) {
      best = t;
      bestScore = sc;
    }
  }
  return Math.round(best) - anim.ip;
}
