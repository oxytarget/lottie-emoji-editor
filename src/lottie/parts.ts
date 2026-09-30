import { artToShapes, fitArt, type ArtStyle, type VectorArt } from '../content/art';
import { applyMatrix, contoursBBox, IDENTITY, invert, matrixScale, multiply, rotateMatrix, type Contour } from './bezier';
import { toHex } from './color';
import { contentGroup } from './compose';
import { shapeTransform } from './shapes';
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
  /** A place for the user's text/logo made in the layer list (see `CONTENT_SLOT` in layout.ts). */
  slot?: boolean;
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

/** Name prefix of logos inserted from Favourites in the layer list (see layout.ts). */
export const INSERTED = '★ ';
const isInserted = (p: Part) => p.name.startsWith(INSERTED);
/** Match name (`mn`) of a slot for the user's text/logo — a standard Lottie field players ignore. */
export const SLOT_MN = 'emoji-studio:content';

/**
 * Collapses single wrapper groups (common in After Effects exports) so the meaningful groups are listed.
 * Logos inserted by the user are always listed.
 */
function unwrap(groups: Part[]): Part[] {
  let list = groups;
  while (list.length === 1 && list[0].children.length > 1 && !isInserted(list[0])) list = list[0].children;
  return list.length > 1 || (list.length === 1 && isInserted(list[0])) ? list : [];
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
        ...(it.mn === SLOT_MN ? { slot: true } : {}),
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
    // Null layers draw nothing, whatever their name says.
    let detected = kind === 'text' || (kind !== 'null' && NAME_HINT.test(name));
    if (kind === 'shape') {
      const shapes = (layer.shapes ?? []) as ShapeItem[];
      const { box, contours } = itemsBBox(shapes);
      detected = detected || looksLikeText(name, contours, box);
      children = unwrap(groupParts(shapes, id, 1));
    } else if (kind === 'precomp' && layer.refId && !seen.has(layer.refId)) {
      const asset = assets.get(layer.refId);
      if (asset?.layers) children = layerParts(asset.layers, assets, `${id}>`, new Set([...seen, layer.refId]));
    }
    return { id, name, kind, detected, replaceable: kind !== 'null' && kind !== 'other', ...(layer.mn === SLOT_MN ? { slot: true } : {}), children };
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

/** Extra transform of a part, in canvas terms (edited by grabbing the part on the preview). */
export interface PartXf {
  /** Move, in canvas pixels. */
  x: number;
  y: number;
  /** Size multiplier around the part's centre. */
  scale: number;
  /** Degrees, clockwise. */
  rotation: number;
  /** Height relative to width (free stretching; 1 or missing = proportional). */
  stretch?: number;
}

export const NO_XF: PartXf = { x: 0, y: 0, scale: 1, rotation: 0 };

export const isIdentityXf = (xf: PartXf | undefined): boolean =>
  !xf ||
  (Math.abs(xf.x) < 0.01 && Math.abs(xf.y) < 0.01 && Math.abs(xf.scale - 1) < 1e-3 && Math.abs(xf.rotation) < 0.01 && Math.abs((xf.stretch ?? 1) - 1) < 1e-3);

/** SVG class prefix of annotated parts: `pt-N`, N = index in `flattenParts(listParts(anim))`. */
export const PART_CLASS = 'pt-';

export interface PartEdits {
  hidden: readonly string[];
  replace?: string | null;
  transforms?: Readonly<Record<string, PartXf>>;
  /** Tag every part with a `pt-N` class so the preview can tell which part was tapped. */
  annotate?: boolean;
}

export interface ReplaceContent {
  art: VectorArt | null;
  artStyle: ArtStyle;
  /** Size slider multiplier. */
  scale: number;
  /** Height slider (−100…100), applied relative to the replaced part's size. */
  offsetY: number;
  /** Horizontal offset, relative to the replaced part's size like `offsetY`. */
  offsetX?: number;
  rotation?: number;
  stretch?: number;
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
  const dx = ((content.offsetX ?? 0) / 200) * box.w;
  if (!shapes.length) return [];
  return [{ ...contentGroup(shapes, content.rotation ?? 0, [box.x + box.w / 2 + dx, box.y + box.h / 2 + dy], content.stretch ?? 1), nm: 'replaced-content' }];
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

interface MovePlan {
  anchor: [number, number];
  pos: [number, number];
  scale: number;
  stretch: number;
  rotation: number;
}

/** Turns a canvas-space move/scale/rotate of a part into a transform in the part's parent space. */
function movePlan(anim: LottieAnimation, id: string, xf: PartXf): MovePlan | null {
  const t = partFrame(anim, id) + anim.ip;
  const box = partBounds(anim, id, t);
  const parent = parentMatrix(anim, id, t);
  if (!box || !parent) return null;
  const inv = invert(parent);
  const [cx, cy] = applyMatrix(inv, box.x + box.w / 2, box.y + box.h / 2);
  const dx = inv[0] * xf.x + inv[2] * xf.y;
  const dy = inv[1] * xf.x + inv[3] * xf.y;
  const flipped = parent[0] * parent[3] - parent[1] * parent[2] < 0;
  return { anchor: [cx, cy], pos: [cx + dx, cy + dy], scale: xf.scale, stretch: xf.stretch ?? 1, rotation: flipped ? -xf.rotation : xf.rotation };
}

/**
 * Applies a move plan: groups get wrapped in a group carrying the extra transform; layers get parented
 * to a new null layer (appended, so part indices and track-matte order stay intact).
 */
function applyMove(target: Target, plan: MovePlan): void {
  const r = (v: number) => Math.round(v * 1000) / 1000;
  if (target.type === 'group') {
    target.list[target.index] = {
      ty: 'gr',
      nm: 'part-transform',
      it: [target.group, shapeTransform({ a: plan.anchor.map(r), p: plan.pos.map(r), s: [r(plan.scale * 100), r(plan.scale * plan.stretch * 100)], r: r(plan.rotation) })],
    };
    return;
  }
  const { list, layer } = target;
  const ind = list.reduce((mx, l) => Math.max(mx, typeof l.ind === 'number' ? l.ind : 0), 0) + 1;
  const holder: AnyLayer = {
    ddd: 0,
    ind,
    ty: 3,
    nm: 'part-transform',
    sr: 1,
    ks: {
      o: { a: 0, k: 100 },
      r: { a: 0, k: r(plan.rotation) },
      p: { a: 0, k: [r(plan.pos[0]), r(plan.pos[1]), 0] },
      a: { a: 0, k: [r(plan.anchor[0]), r(plan.anchor[1]), 0] },
      s: { a: 0, k: [r(plan.scale * 100), r(plan.scale * plan.stretch * 100), 100] },
    },
    ao: 0,
    ip: layer.ip,
    op: layer.op,
    st: 0,
    bm: 0,
  };
  if (layer.parent !== undefined) holder.parent = layer.parent;
  layer.parent = ind;
  list.push(holder);
}

/**
 * Returns a copy of the animation with parts hidden, moved, and (optionally) one part replaced by the user's
 * content. The replaced part keeps its transform, so the new text/logo follows the original motion.
 */
export function applyPartEdits(anim: LottieAnimation, edits: PartEdits, content?: ReplaceContent): LottieAnimation {
  const moves = Object.entries(edits.transforms ?? {}).filter(([, xf]) => !isIdentityXf(xf));
  if (!edits.hidden.length && !edits.replace && !moves.length && !edits.annotate) return anim;
  // Moves are measured on the untouched source.
  const plans = moves.flatMap(([id, xf]) => {
    const plan = movePlan(anim, id, xf);
    return plan ? [{ id, plan }] : [];
  });
  const copy = structuredClone(anim);
  const assets = assetsById(copy);

  if (edits.annotate) {
    flattenParts(listParts(copy)).forEach((part, i) => {
      const target = resolve(copy, part.id);
      const obj = (target?.type === 'layer' ? target.layer : target?.group) as Json | undefined;
      if (!obj) return;
      // Last key, so exports can strip it with a simple pattern (see `stripPartClasses`).
      delete obj.cl;
      obj.cl = `${PART_CLASS}${i}`;
    });
  }

  // Resolve everything first: wrapping a group for a move changes the paths below it.
  const hidden = [...new Set(edits.hidden)].filter((id) => id !== edits.replace);
  const hiddenTargets = hidden.map((id) => resolve(copy, id));
  const moveTargets = plans.map(({ id, plan }) => ({ target: resolve(copy, id), plan }));
  const replaceTarget = edits.replace && content ? resolve(copy, edits.replace) : null;

  if (replaceTarget && content) {
    if (replaceTarget.type === 'group') {
      const items = (replaceTarget.group.it as ShapeItem[]) ?? [];
      const { box } = itemsBBox(items);
      const tr = items.find((it) => it.ty === 'tr');
      if (box) replaceTarget.group.it = [...contentShapes(box, content), ...(tr ? [tr] : [])];
    } else {
      const layer = replaceTarget.layer;
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
  for (const target of hiddenTargets) {
    if (!target) continue;
    if (target.type === 'layer') toNull(target.list, target.index);
    else (target.group as Json).__remove = true;
  }
  for (const { target, plan } of moveTargets) if (target) applyMove(target, plan);

  const sweep = (items: ShapeItem[]): ShapeItem[] =>
    items.filter((it) => !(it as Json).__remove).map((it) => (it.ty === 'gr' ? { ...it, it: sweep((it.it as ShapeItem[]) ?? []) } : it));
  const sweepLayers = (layers: AnyLayer[]) => {
    for (const l of layers) if (l.shapes) l.shapes = sweep(l.shapes as ShapeItem[]);
  };
  sweepLayers(copy.layers as AnyLayer[]);
  for (const a of assets.values()) if (a.layers) sweepLayers(a.layers);
  return copy;
}

/** Removes the `pt-N` classes added by `annotate` from serialized JSON (they only matter for the preview). */
export function stripPartClasses(json: string): string {
  return json.replace(/,"cl":"pt-\d+"/g, '');
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

/** Canvas matrix of the space a part lives in (everything above it, without the part's own transform). */
export function parentMatrix(anim: LottieAnimation, id: string, t?: number): Matrix | null {
  const assets = assetsById(anim);
  const [layerPath, ...groupPath] = id.split('/');
  const segs = layerPath.split('>');
  let list = anim.layers as AnyLayer[];
  let m: Matrix = IDENTITY;
  let layer: AnyLayer | undefined;
  for (let s = 0; s < segs.length; s++) {
    if (layer) {
      const asset = layer.refId ? assets.get(layer.refId) : undefined;
      if (!asset?.layers) return null;
      list = asset.layers;
    }
    layer = list[Number(segs[s].slice(1))];
    if (!layer) return null;
    if (s === segs.length - 1 && !groupPath.length) {
      const own = layer;
      const parent = own.parent !== undefined ? list.find((l) => l.ind === own.parent) : undefined;
      return parent ? multiply(m, layerMatrix(list, parent, t)) : m;
    }
    m = multiply(m, layerMatrix(list, layer, t));
  }
  let items = (layer?.shapes ?? []) as ShapeItem[];
  for (let g = 0; g < groupPath.length; g++) {
    const grp = items[Number(groupPath[g].slice(1))];
    if (!grp || grp.ty !== 'gr') return null;
    items = (grp.it as ShapeItem[]) ?? [];
    if (g < groupPath.length - 1) m = multiply(m, transformMatrix(items.find((it) => it.ty === 'tr') as Json | undefined, t));
  }
  return m;
}

// ---------------------------------------------------------------------------
// Geometry signatures (to find the same logo across the stickers of a pack)
// ---------------------------------------------------------------------------

export interface PartGeometry {
  /** Structure: number of outlines and segments (+ text/image ids) — equal for the same logo at any size. */
  key: string;
  /** Outline end points normalised to the part's bounding box (0…1), for a tolerant comparison. */
  points: number[];
  contours: number;
  segments: number;
}

/** 53-bit string hash (cyrb53). */
function hash(str: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

function layerGeometry(layer: AnyLayer, assets: Map<string, Asset>, m: Matrix, contours: Contour[], extra: string[], depth: number): void {
  switch (layer.ty as number) {
    case 4:
      collectContours(((layer.shapes ?? []) as ShapeItem[]).filter((it) => it.ty !== 'tr'), m, contours);
      break;
    case 0: {
      const asset = layer.refId ? assets.get(layer.refId) : undefined;
      if (!asset?.layers || depth > 4) break;
      for (const child of asset.layers) {
        if (child.ty !== 3) layerGeometry(child, assets, multiply(m, layerMatrix(asset.layers, child)), contours, extra, depth + 1);
      }
      break;
    }
    case 5: {
      const doc = firstValue<{ t?: string; f?: string }>((layer.t as Json | undefined)?.d) ?? {};
      extra.push(`T:${doc.t ?? ''}:${doc.f ?? ''}`);
      break;
    }
    case 2: {
      const asset = layer.refId ? (assets.get(layer.refId) as (Asset & { p?: string; u?: string }) | undefined) : undefined;
      extra.push(`I:${hash(`${asset?.u ?? ''}${asset?.p ?? ''}`)}`);
      break;
    }
    case 1:
      extra.push(`S:${layer.sw}x${layer.sh}`);
      break;
  }
}

const MAX_POINTS = 480;

/** Shape of a part regardless of where it is and how big it is — matches the same logo in different stickers. */
export function partGeometry(anim: LottieAnimation, id: string): PartGeometry | null {
  const target = resolve(anim, id);
  if (!target) return null;
  const contours: Contour[] = [];
  const extra: string[] = [];
  if (target.type === 'group') collectContours(((target.group.it as ShapeItem[]) ?? []).filter((it) => it.ty !== 'tr'), IDENTITY, contours);
  else layerGeometry(target.layer, assetsById(anim), IDENTITY, contours, extra, 0);
  const box = contoursBBox(contours);
  const size = box ? Math.max(box.w, box.h) : 0;
  if (!extra.length && (!box || size <= 0)) return null;
  const points: number[] = [];
  let segments = 0;
  if (box && size > 0) {
    const all: number[] = [];
    for (const c of contours) {
      all.push(c.start[0], c.start[1]);
      for (const sg of c.segs) all.push(sg[4], sg[5]);
      segments += c.segs.length;
    }
    // Evenly sampled end points keep the comparison cheap for detailed logos.
    const pairs = all.length / 2;
    const step = Math.max(1, pairs / (MAX_POINTS / 2));
    for (let i = 0; i < pairs; i += step) {
      const j = Math.floor(i) * 2;
      points.push((all[j] - box.x) / size, (all[j + 1] - box.y) / size);
    }
    if (box.w > 0 && box.h > 0) points.push(box.w / size, box.h / size);
  }
  const key = `${extra.join('|')}#${contours.map((c) => `${c.closed ? 'c' : 'o'}${c.segs.length}`).join(',')}`;
  return { key: hash(key), points, contours: contours.length, segments };
}

/** Same normalised outlines, within `tolerance` of the part size. */
export function sameGeometry(a: PartGeometry, b: PartGeometry, tolerance = 0.025): boolean {
  if (a.key !== b.key || a.points.length !== b.points.length) return false;
  for (let i = 0; i < a.points.length; i++) if (Math.abs(a.points[i] - b.points[i]) > tolerance) return false;
  return true;
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

// ---------------------------------------------------------------------------
// A part as an SVG logo (to keep it in Favourites and use it in other emoji)
// ---------------------------------------------------------------------------

type Paint = { kind: 'solid'; color: string } | { kind: 'gradient'; id: string };
interface SvgCtx {
  t: number;
  defs: string[];
  out: string[];
  box: { x0: number; y0: number; x1: number; y1: number };
}

const fmt = (n: number) => String(Math.round(n * 100) / 100);
const K = 0.5522847498;

function grow(ctx: SvgCtx, x: number, y: number, pad = 0): void {
  ctx.box.x0 = Math.min(ctx.box.x0, x - pad);
  ctx.box.y0 = Math.min(ctx.box.y0, y - pad);
  ctx.box.x1 = Math.max(ctx.box.x1, x + pad);
  ctx.box.y1 = Math.max(ctx.box.y1, y + pad);
}

/** Closed contour through cubic segments given in local coordinates. */
function localContour(start: [number, number], segs: number[][], m: Matrix): Contour {
  const pt = (x: number, y: number) => applyMatrix(m, x, y);
  return {
    closed: true,
    start: pt(start[0], start[1]),
    segs: segs.map(([a, b, c, d, e, f]) => {
      const p1 = pt(a, b);
      const p2 = pt(c, d);
      const p3 = pt(e, f);
      return [p1[0], p1[1], p2[0], p2[1], p3[0], p3[1]] as Contour['segs'][number];
    }),
  };
}

function ellipseContour(cx: number, cy: number, rx: number, ry: number, m: Matrix): Contour {
  const kx = rx * K;
  const ky = ry * K;
  return localContour(
    [cx, cy - ry],
    [
      [cx + kx, cy - ry, cx + rx, cy - ky, cx + rx, cy],
      [cx + rx, cy + ky, cx + kx, cy + ry, cx, cy + ry],
      [cx - kx, cy + ry, cx - rx, cy + ky, cx - rx, cy],
      [cx - rx, cy - ky, cx - kx, cy - ry, cx, cy - ry],
    ],
    m,
  );
}

function rectContour(cx: number, cy: number, w: number, h: number, radius: number, m: Matrix): Contour {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  const [x0, y0, x1, y1] = [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2];
  const line = (x: number, y: number, x2: number, y2: number) => [x, y, x2, y2, x2, y2];
  const k = r * K;
  const pts = [
    line(x0 + r, y0, x1 - r, y0),
    [x1 - r + k, y0, x1, y0 + r - k, x1, y0 + r],
    line(x1, y0 + r, x1, y1 - r),
    [x1, y1 - r + k, x1 - r + k, y1, x1 - r, y1],
    line(x1 - r, y1, x0 + r, y1),
    [x0 + r - k, y1, x0, y1 - r + k, x0, y1 - r],
    line(x0, y1 - r, x0, y0 + r),
    [x0, y0 + r - k, x0 + r - k, y0, x0 + r, y0],
  ];
  return localContour([x0 + r, y0], r > 0 ? pts : pts.filter((_, i) => i % 2 === 0), m);
}

function starContour(it: ShapeItem, t: number, m: Matrix): Contour | null {
  const n = Math.max(3, Math.round(num(valueAt(it.pt, t), 5)));
  const [cx, cy] = vec(valueAt(it.p, t), [0, 0]);
  const outer = num(valueAt(it.or, t), 0);
  const inner = num(valueAt(it.ir, t), outer / 2);
  const rot = num(valueAt(it.r, t), 0);
  if (outer <= 0) return null;
  const star = it.sy !== 2;
  const count = star ? n * 2 : n;
  const pts = Array.from({ length: count }, (_, i) => {
    const a = ((rot - 90 + (i * 360) / count) * Math.PI) / 180;
    const r = star && i % 2 ? inner : outer;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  });
  return localContour(
    pts[0] as [number, number],
    pts.map((_, i) => {
      const [x, y] = pts[(i + 1) % pts.length];
      return [x, y, x, y, x, y];
    }),
    m,
  );
}

function shapeContour(it: ShapeItem, t: number, m: Matrix): Contour | null {
  if (it.ty === 'sh') {
    const b = valueAt<Bezier | Bezier[]>(it.ks, t);
    const bez = Array.isArray(b) ? b[0] : b;
    return bez ? bezierContour(bez, m) : null;
  }
  if (it.ty === 'el') {
    const [cx, cy] = vec(valueAt(it.p, t), [0, 0]);
    const [w, h] = vec(valueAt(it.s, t), [0, 0]);
    return w > 0 && h > 0 ? ellipseContour(cx, cy, w / 2, h / 2, m) : null;
  }
  if (it.ty === 'rc') {
    const [cx, cy] = vec(valueAt(it.p, t), [0, 0]);
    const [w, h] = vec(valueAt(it.s, t), [0, 0]);
    return w > 0 && h > 0 ? rectContour(cx, cy, w, h, num(valueAt(it.r, t), 0), m) : null;
  }
  if (it.ty === 'sr') return starContour(it, t, m);
  return null;
}

function pathData(contours: readonly Contour[], ctx: SvgCtx, pad: number): string {
  return contours
    .map((c) => {
      grow(ctx, c.start[0], c.start[1], pad);
      let d = `M${fmt(c.start[0])} ${fmt(c.start[1])}`;
      for (const s of c.segs) {
        grow(ctx, s[0], s[1], pad);
        grow(ctx, s[2], s[3], pad);
        grow(ctx, s[4], s[5], pad);
        d += `C${fmt(s[0])} ${fmt(s[1])} ${fmt(s[2])} ${fmt(s[3])} ${fmt(s[4])} ${fmt(s[5])}`;
      }
      return c.closed ? `${d}Z` : d;
    })
    .join('');
}

function gradientPaint(style: ShapeItem, m: Matrix, ctx: SvgCtx): Paint | null {
  const g = style.g as { p?: number; k?: unknown } | undefined;
  const stops = g?.p ?? 0;
  const values = vec(valueAt(g?.k, ctx.t), []);
  if (!stops || values.length < stops * 4) return null;
  const id = `g${ctx.defs.length}`;
  const [sx, sy] = applyMatrix(m, ...(vec(valueAt(style.s, ctx.t), [0, 0]).slice(0, 2) as [number, number]));
  const [ex, ey] = applyMatrix(m, ...(vec(valueAt(style.e, ctx.t), [100, 0]).slice(0, 2) as [number, number]));
  const stopTags = Array.from({ length: stops }, (_, i) => {
    const [o, r, gg, b] = values.slice(i * 4, i * 4 + 4);
    return `<stop offset="${fmt(o)}" stop-color="${toHex([r, gg, b])}"/>`;
  }).join('');
  ctx.defs.push(
    style.t === 2
      ? `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${fmt(sx)}" cy="${fmt(sy)}" r="${fmt(Math.hypot(ex - sx, ey - sy))}">${stopTags}</radialGradient>`
      : `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${fmt(sx)}" y1="${fmt(sy)}" x2="${fmt(ex)}" y2="${fmt(ey)}">${stopTags}</linearGradient>`,
  );
  return { kind: 'gradient', id };
}

/** Shapes a style applies to: the items above it in its group, including nested groups (Lottie rules). */
function collectShapes(items: readonly ShapeItem[], m: Matrix, t: number, out: Contour[]): void {
  for (const it of items) {
    if (it.ty === 'gr') {
      const children = (it.it as ShapeItem[]) ?? [];
      collectShapes(children, multiply(m, transformMatrix(children.find((c) => c.ty === 'tr') as Json | undefined, t)), t, out);
    } else {
      const c = shapeContour(it, t, m);
      if (c) out.push(c);
    }
  }
}

/** Emits one SVG path per fill/stroke, bottom-most first (Lottie lists the top-most item first). */
function renderItems(items: readonly ShapeItem[], m: Matrix, opacity: number, ctx: SvgCtx): void {
  const tr = items.find((it) => it.ty === 'tr') as Json | undefined;
  const local = multiply(m, transformMatrix(tr, ctx.t));
  const alpha = opacity * (num(valueAt(tr?.o, ctx.t), 100) / 100);
  if (alpha <= 0.001) return;
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.ty === 'gr') {
      renderItems((it.it as ShapeItem[]) ?? [], local, alpha, ctx);
      continue;
    }
    if (!['fl', 'st', 'gf', 'gs'].includes(it.ty)) continue;
    const contours: Contour[] = [];
    collectShapes(items.slice(0, i), local, ctx.t, contours);
    if (!contours.length) continue;
    const o = alpha * (num(valueAt(it.o, ctx.t), 100) / 100);
    const color = () => toHex(vec(valueAt(it.c, ctx.t), [0, 0, 0]));
    const paint: Paint | null = it.ty === 'gf' || it.ty === 'gs' ? gradientPaint(it, local, ctx) : { kind: 'solid', color: color() };
    if (!paint) continue;
    const value = paint.kind === 'solid' ? paint.color : `url(#${paint.id})`;
    if (it.ty === 'fl' || it.ty === 'gf') {
      const rule = it.r === 2 ? ' fill-rule="evenodd"' : '';
      ctx.out.push(`<path d="${pathData(contours, ctx, 0)}" fill="${value}"${o < 1 ? ` fill-opacity="${fmt(o)}"` : ''}${rule}/>`);
    } else {
      const width = num(valueAt(it.w, ctx.t), 1) * matrixScale(local);
      if (width <= 0) continue;
      ctx.out.push(
        `<path d="${pathData(contours, ctx, width / 2)}" fill="none" stroke="${value}" stroke-width="${fmt(width)}" stroke-linejoin="round" stroke-linecap="round"${o < 1 ? ` stroke-opacity="${fmt(o)}"` : ''}/>`,
      );
    }
  }
}

function renderLayer(layer: AnyLayer, assets: Map<string, Asset>, m: Matrix, ctx: SvgCtx, depth: number): void {
  if (layer.td || layer.hd) return;
  if (layer.ty === 4) renderItems((layer.shapes ?? []) as ShapeItem[], m, 1, ctx);
  else if (layer.ty === 0 && depth < 5) {
    const asset = layer.refId ? assets.get(layer.refId) : undefined;
    const children = asset?.layers ?? [];
    for (let i = children.length - 1; i >= 0; i--) renderLayer(children[i], assets, multiply(m, layerMatrix(children, children[i], ctx.t)), ctx, depth + 1);
  }
}

/**
 * The part drawn as a standalone SVG (its shapes, fills, strokes and gradients at the frame where it is best
 * visible, without its own motion). Null when there is nothing drawable (text and image layers are skipped).
 */
export function partSvg(anim: LottieAnimation, id: string): string | null {
  const target = resolve(anim, id);
  if (!target) return null;
  const ctx: SvgCtx = { t: partFrame(anim, id) + anim.ip, defs: [], out: [], box: { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity } };
  if (target.type === 'group') renderItems((target.group.it as ShapeItem[]) ?? [], IDENTITY, 1, ctx);
  else renderLayer({ ...target.layer, td: undefined }, assetsById(anim), IDENTITY, ctx, 0);
  const { x0, y0, x1, y1 } = ctx.box;
  if (!ctx.out.length || !(x1 > x0) || !(y1 > y0)) return null;
  const pad = Math.max(x1 - x0, y1 - y0) * 0.02;
  const view = [x0 - pad, y0 - pad, x1 - x0 + pad * 2, y1 - y0 + pad * 2].map(fmt).join(' ');
  const defs = ctx.defs.length ? `<defs>${ctx.defs.join('')}</defs>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${view}">${defs}${ctx.out.join('')}</svg>`;
}

// Internals shared with the layer-structure editor (layout.ts).
export type { AnyLayer, Target as PartTarget };
export { assetsById as assetsOf, itemsBBox as itemsBounds, resolve as resolvePart };
