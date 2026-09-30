import { artToShapes, fitArt, type VectorArt } from '../content/art';
import { solid } from './paint';
import { assetsOf, INSERTED, itemsBounds, resolvePart, SLOT_MN, type AnyLayer } from './parts';
import { stat } from './anim';
import { group } from './shapes';
import type { LottieAnimation, ShapeItem } from './types';

/**
 * Structure edits of an imported animation, made in the layer list: insert a logo (from Favourites) as a new
 * layer or group, move a part up/down or into another group/precomp, remove an inserted logo.
 *
 * Edits are kept as a list of operations replayed on the original file, so they survive reloading a pack
 * sticker. Part ids are positions ("l3/g0/g2"), so every operation also says how existing ids move
 * (`remapIds`) — hidden/replaced/moved parts keep pointing at the same things.
 *
 * A drop position is `{ parent, index }`: `parent` is the part whose child list receives the item ('' = the
 * top-level layers), `index` the place in that list (0 = top-most).
 */

export interface Drop {
  parent: string;
  index: number;
}

export type LayoutOp =
  | { kind: 'insert'; svg: string; name: string; at: Drop }
  | { kind: 'move'; part: string; at: Drop }
  | { kind: 'remove'; part: string };

export { INSERTED, SLOT_MN };

/**
 * `svg` key of an insert that makes a place for the user's text/logo: an invisible frame the text/logo then
 * replaces (see the part edits), so it sits at that depth and moves with the group it was dropped into.
 */
export const CONTENT_SLOT = '@content';

type Json = Record<string, unknown>;
type ListKind = 'layers' | 'items';

interface ListRef {
  kind: ListKind;
  list: unknown[];
  /** Canvas of a layer list. */
  size?: { w: number; h: number };
  /** Bounds of a shape list in its own coordinates. */
  box?: { x: number; y: number; w: number; h: number } | null;
  ip?: number;
  op?: number;
}

// ---------------------------------------------------------------------------
// Ids as tokens
// ---------------------------------------------------------------------------

interface Token {
  sep: '' | '>' | '/';
  type: 'l' | 'g';
  i: number;
}

export function parseId(id: string): Token[] {
  if (!id) return [];
  const out: Token[] = [];
  const re = /(^|>|\/)([lg])(\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(id))) out.push({ sep: m[1] as Token['sep'], type: m[2] as Token['type'], i: Number(m[3]) });
  return out;
}

export const formatId = (tokens: readonly Token[]): string => tokens.map((t) => `${t.sep}${t.type}${t.i}`).join('');

/** The part whose list contains `id` ('' for top-level layers) and the index in that list. */
export function parentOf(id: string): { parent: string; index: number } {
  const tokens = parseId(id);
  const last = tokens[tokens.length - 1];
  return { parent: formatId(tokens.slice(0, -1)), index: last?.i ?? 0 };
}

const startsWith = (id: Token[], prefix: Token[]) =>
  id.length >= prefix.length && prefix.every((t, k) => t.sep === id[k].sep && t.type === id[k].type && t.i === id[k].i);

// ---------------------------------------------------------------------------
// Resolving lists
// ---------------------------------------------------------------------------

/** The child list of `parent` ('' = top-level layers), or null when that part cannot contain anything. */
export function childList(anim: LottieAnimation, parent: string): ListRef | null {
  if (!parent) return { kind: 'layers', list: anim.layers, size: { w: anim.w, h: anim.h }, ip: anim.ip, op: anim.op };
  const target = resolvePart(anim, parent);
  if (!target) return null;
  if (target.type === 'group') {
    const items = (target.group.it as ShapeItem[]) ?? [];
    target.group.it = items;
    return { kind: 'items', list: items, box: itemsBounds(items).box };
  }
  const layer = target.layer;
  if (layer.ty === 0) {
    const asset = layer.refId ? assetsOf(anim).get(layer.refId) : undefined;
    if (!asset?.layers) return null;
    return { kind: 'layers', list: asset.layers, size: { w: asset.w ?? layer.w ?? anim.w, h: asset.h ?? layer.h ?? anim.h }, ip: layer.ip, op: layer.op };
  }
  if (layer.ty === 4) {
    const shapes = (layer.shapes ?? []) as ShapeItem[];
    layer.shapes = shapes;
    return { kind: 'items', list: shapes, box: itemsBounds(shapes).box };
  }
  return null;
}

const childToken = (kind: ListKind, parent: string, i: number): Token =>
  kind === 'layers' ? { sep: parent ? '>' : '', type: 'l', i } : { sep: '/', type: 'g', i };

/** Items lists keep their transform last. */
function insertIndex(ref: ListRef, index: number): number {
  const n = ref.list.length;
  const hasTr = ref.kind === 'items' && (ref.list[n - 1] as ShapeItem | undefined)?.ty === 'tr';
  return Math.max(0, Math.min(index, hasTr ? n - 1 : n));
}

// ---------------------------------------------------------------------------
// Conversions between layers and groups
// ---------------------------------------------------------------------------

const strip3d = (v: unknown): unknown => (Array.isArray(v) && v.length === 3 && typeof v[0] === 'number' ? v.slice(0, 2) : v);
const add3d = (v: unknown): unknown => (Array.isArray(v) && v.length === 2 && typeof v[0] === 'number' ? [...v, 0] : v);

function mapProp(prop: unknown, fn: (v: unknown) => unknown): unknown {
  if (!prop || typeof prop !== 'object') return prop;
  const p = prop as { a?: number; k?: unknown };
  if (p.a === 1 && Array.isArray(p.k)) {
    return { ...p, k: p.k.map((kf) => (kf && typeof kf === 'object' ? { ...(kf as Json), s: fn((kf as Json).s), e: fn((kf as Json).e), to: undefined, ti: undefined } : kf)) };
  }
  return { ...p, k: fn(p.k) };
}

function layerToGroup(layer: AnyLayer): ShapeItem {
  const ks = layer.ks as unknown as Json;
  const tr: ShapeItem = {
    ty: 'tr',
    p: mapProp(ks.p ?? { a: 0, k: [0, 0] }, strip3d),
    a: mapProp(ks.a ?? { a: 0, k: [0, 0] }, strip3d),
    s: mapProp(ks.s ?? { a: 0, k: [100, 100] }, strip3d),
    r: ks.r ?? { a: 0, k: 0 },
    o: ks.o ?? { a: 0, k: 100 },
    sk: { a: 0, k: 0 },
    sa: { a: 0, k: 0 },
  };
  const g: ShapeItem = { ty: 'gr', nm: layer.nm, it: [...(((layer.shapes ?? []) as ShapeItem[]).filter((it) => it.ty !== 'tr')), tr] };
  if (layer.mn) g.mn = layer.mn;
  if (layer.cl) g.cl = layer.cl;
  return g;
}

function groupToLayer(g: ShapeItem, ind: number, ip: number, op: number): AnyLayer {
  const items = (g.it as ShapeItem[]) ?? [];
  const tr = (items.find((it) => it.ty === 'tr') ?? {}) as Json;
  return {
    ...(g.mn ? { mn: g.mn } : {}),
    ddd: 0,
    ind,
    ty: 4,
    nm: typeof g.nm === 'string' ? g.nm : 'Group',
    sr: 1,
    ks: {
      o: (tr.o as never) ?? { a: 0, k: 100 },
      r: (tr.r as never) ?? { a: 0, k: 0 },
      p: mapProp(tr.p ?? { a: 0, k: [0, 0] }, add3d) as never,
      a: mapProp(tr.a ?? { a: 0, k: [0, 0] }, add3d) as never,
      s: mapProp(tr.s ?? { a: 0, k: [100, 100] }, add3d) as never,
    },
    ao: 0,
    shapes: items.filter((it) => it.ty !== 'tr'),
    ip,
    op,
    st: 0,
    bm: 0,
  };
}

const nextInd = (layers: readonly AnyLayer[]) => layers.reduce((m, l) => Math.max(m, typeof l.ind === 'number' ? l.ind : 0), 0) + 1;

/** Whether a layer can leave its list: nothing may refer to it, it may not refer to others, no mattes. */
function isFreeLayer(layer: AnyLayer, list: readonly AnyLayer[]): boolean {
  return layer.parent === undefined && !layer.tt && !layer.td && !list.some((l) => l.parent === layer.ind);
}

// ---------------------------------------------------------------------------
// Logo → shapes
// ---------------------------------------------------------------------------

/** The logo's own shapes (original colours), centred on 0,0 and fitted into w×h. */
function logoShapes(art: VectorArt, w: number, h: number): ShapeItem[] {
  const fitted = fitArt(art, w, h);
  return artToShapes(fitted.items, fitted.bbox, { mode: 'original', fill: solid('#000000'), outline: null, outlineWidth: 0 });
}

// ---------------------------------------------------------------------------
// Applying operations
// ---------------------------------------------------------------------------

/** An empty frame (a rectangle without paint) — the size the user's text/logo is fitted into. */
const slotFrame = (w: number, h: number): ShapeItem => ({ ty: 'rc', nm: 'frame', d: 1, p: stat([0, 0]), s: stat([Math.round(w), Math.round(h)]), r: stat(0) });

/** Why an operation cannot be applied (the UI does not offer such drops). */
export function checkOp(anim: LottieAnimation, op: LayoutOp): string | null {
  if (op.kind === 'insert') return childList(anim, op.at.parent) ? null : 'no-container';
  const source = resolvePart(anim, op.part);
  if (!source) return 'no-part';
  if (op.kind === 'remove') return null;
  const from = parentOf(op.part);
  if (op.at.parent === op.part || startsWith(parseId(op.at.parent), parseId(op.part))) return 'into-itself';
  const target = childList(anim, op.at.parent);
  if (!target) return 'no-container';
  if (source.type === 'layer') {
    const sameList = from.parent === op.at.parent;
    if (sameList) return null;
    if (!isFreeLayer(source.layer, source.list)) return 'linked-layer';
    if (target.kind === 'items' && source.layer.ty !== 4) return 'not-shapes';
    return null;
  }
  return null;
}

/**
 * Applies one operation to `anim` (mutated — pass a copy). `svgArt` turns an inserted logo's SVG into
 * vector art. Returns the new id of the inserted/moved part, or null when nothing was done.
 */
export function applyLayoutOp(anim: LottieAnimation, op: LayoutOp, svgArt: (svg: string) => VectorArt | null): string | null {
  if (checkOp(anim, op)) return null;
  if (op.kind === 'insert') {
    const slot = op.svg === CONTENT_SLOT;
    const art = slot ? null : svgArt(op.svg);
    const ref = childList(anim, op.at.parent)!;
    if (!art && !slot) return null;
    const at = insertIndex(ref, op.at.index);
    if (ref.kind === 'layers') {
      const layers = ref.list as AnyLayer[];
      const { w, h } = ref.size!;
      const layer: AnyLayer = {
        ddd: 0,
        ind: nextInd(layers),
        ty: 4,
        nm: op.name,
        sr: 1,
        ks: { o: { a: 0, k: 100 }, r: { a: 0, k: 0 }, p: { a: 0, k: [w / 2, h / 2, 0] }, a: { a: 0, k: [0, 0, 0] }, s: { a: 0, k: [100, 100, 100] } },
        ao: 0,
        // The inner wrapper is not "inserted" itself, so the list shows only the layer.
        shapes: [group(art ? logoShapes(art, w * 0.4, h * 0.4) : [slotFrame(w * 0.62, h * 0.42)], {}, op.name.slice(INSERTED.length) || 'logo')],
        ip: ref.ip ?? anim.ip,
        op: ref.op ?? anim.op,
        st: 0,
        bm: 0,
      };
      if (slot) layer.mn = SLOT_MN;
      layers.splice(at, 0, layer);
    } else {
      const box = ref.box ?? { x: -50, y: -50, w: 100, h: 100 };
      const size = Math.max(box.w, box.h, 20) * 0.6;
      const g = group(art ? logoShapes(art, size, size) : [slotFrame(size, size * 0.6)], { p: [box.x + box.w / 2, box.y + box.h / 2] }, op.name);
      if (slot) g.mn = SLOT_MN;
      (ref.list as ShapeItem[]).splice(at, 0, g);
    }
    return formatId([...parseId(op.at.parent), childToken(ref.kind, op.at.parent, at)]);
  }

  const source = resolvePart(anim, op.part)!;
  const sourceList = source.list as unknown[];
  const obj = source.type === 'layer' ? source.layer : source.group;
  if (op.kind === 'remove') {
    sourceList.splice(source.index, 1);
    return null;
  }

  // Resolve the target before removing (removal may shift it), then insert into the same list object.
  const target = childList(anim, op.at.parent)!;
  const sameList = target.list === sourceList;
  sourceList.splice(source.index, 1);
  let index = op.at.index;
  if (sameList && source.index < index) index--;
  const at = insertIndex(target, index);
  let item: unknown = obj;
  if (source.type === 'layer' && target.kind === 'items') item = layerToGroup(source.layer);
  else if (source.type === 'group' && target.kind === 'layers') item = groupToLayer(source.group, nextInd(target.list as AnyLayer[]), target.ip ?? anim.ip, target.op ?? anim.op);
  else if (source.type === 'layer' && !sameList) (item as AnyLayer).ind = nextInd(target.list as AnyLayer[]);
  target.list.splice(at, 0, item);
  const newParent = remapId(op.at.parent, { kind: 'remove', part: op.part }) ?? op.at.parent;
  return formatId([...parseId(newParent), childToken(target.kind, op.at.parent, at)]);
}

/** Replays operations on a copy of the original animation. */
export function applyLayout(base: LottieAnimation, ops: readonly LayoutOp[], svgArt: (svg: string) => VectorArt | null): LottieAnimation {
  if (!ops.length) return base;
  const copy = structuredClone(base);
  for (const op of ops) applyLayoutOp(copy, op, svgArt);
  return copy;
}

// ---------------------------------------------------------------------------
// Remapping ids
// ---------------------------------------------------------------------------

function shiftList(tokens: Token[], parent: Token[], from: number, delta: number): Token[] {
  if (!startsWith(tokens, parent) || tokens.length <= parent.length) return tokens;
  const t = tokens[parent.length];
  if (t.i < from) return tokens;
  const copy = tokens.map((x) => ({ ...x }));
  copy[parent.length].i += delta;
  return copy;
}

/**
 * Where a part id ends up after an operation (`anim` = the structure before it; needed for moves to know the
 * kind of the target list). Null when the part is removed.
 */
export function remapId(id: string, op: LayoutOp, anim?: LottieAnimation): string | null {
  const tokens = parseId(id);
  if (op.kind === 'insert') {
    const parent = parseId(op.at.parent);
    const ref = anim ? childList(anim, op.at.parent) : null;
    const at = ref ? insertIndex(ref, op.at.index) : op.at.index;
    return formatId(shiftList(tokens, parent, at, 1));
  }
  const src = parseId(op.part);
  const from = parentOf(op.part);
  const fromParent = parseId(from.parent);
  if (op.kind === 'remove') {
    if (startsWith(tokens, src)) return null;
    return formatId(shiftList(tokens, fromParent, from.index + 1, -1));
  }
  // Move: removal, then insertion; the moved subtree gets its new prefix.
  const targetBefore = parseId(op.at.parent);
  const targetAfter = parseId(remapId(op.at.parent, { kind: 'remove', part: op.part }) ?? '');
  let index = op.at.index;
  const sameList = from.parent === op.at.parent;
  if (sameList && from.index < index) index--;
  let kind: ListKind = 'layers';
  let at = index;
  if (anim) {
    const ref = childList(anim, op.at.parent);
    if (ref) {
      kind = ref.kind;
      // Without the moved item when it came from the same list.
      const n = ref.list.length - (sameList ? 1 : 0);
      const hasTr = ref.kind === 'items' && (ref.list[ref.list.length - 1] as ShapeItem | undefined)?.ty === 'tr';
      at = Math.max(0, Math.min(index, hasTr ? n - 1 : n));
    }
  } else {
    kind = targetBefore.length && targetBefore[targetBefore.length - 1].type === 'g' ? 'items' : 'layers';
  }
  const moved = [...targetAfter, childToken(kind, op.at.parent, at)];
  if (startsWith(tokens, src)) return formatId([...moved, ...tokens.slice(src.length)]);
  const afterRemoval = shiftList(tokens, fromParent, from.index + 1, -1);
  return formatId(shiftList(afterRemoval, targetAfter, at, 1));
}

export interface IdEdits {
  hidden: string[];
  replace: string | null;
  transforms: Record<string, unknown>;
  /** Per-item colours (item ids move like part ids). */
  paints?: Record<string, unknown>;
}

function remapKeys(record: Record<string, unknown>, map: (id: string) => string | null): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [id, value] of Object.entries(record)) {
    const to = map(id);
    if (to) out[to] = value;
  }
  return out;
}

/** Moves hidden/replaced/moved part ids (and edited items) along with an operation (`anim` = structure before it). */
export function remapEdits<T extends IdEdits>(edits: T, op: LayoutOp, anim: LottieAnimation): T {
  const map = (id: string) => remapId(id, op, anim);
  const hidden = edits.hidden.map(map).filter((id): id is string => !!id);
  const replace = edits.replace ? map(edits.replace) : null;
  const transforms = remapKeys(edits.transforms, map);
  return { ...edits, hidden, replace, transforms, ...(edits.paints ? { paints: remapKeys(edits.paints, map) } : {}) };
}
