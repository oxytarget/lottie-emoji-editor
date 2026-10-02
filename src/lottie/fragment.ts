import { assetsOf, resolvePart, type AnyLayer } from './parts';
import { shapeTransform } from './shapes';
import type { LottieAnimation, ShapeItem } from './types';

/**
 * A layer (or a group of a layer) cut out of an animation so it can live in another one: copied with the
 * layers it is parented to (as nulls), the fills and transforms of the groups it sits in, and the precomps and
 * images it uses. It is plain JSON — it travels through the clipboard between editor windows.
 */
export interface LottieFragment {
  /** Marks editor clipboard contents. */
  emojiStudio: 'layer';
  v: 1;
  name: string;
  /** Size of the space the layers live in (the animation's canvas). */
  w: number;
  h: number;
  layers: AnyLayer[];
  assets: Array<Record<string, unknown>>;
}

type Json = Record<string, unknown>;
const STYLES = new Set(['fl', 'st', 'gf', 'gs']);

/** A copy of a layer that only moves (for the parents of a copied layer). */
function asNull(l: AnyLayer): AnyLayer {
  const out: AnyLayer = { ddd: 0, ind: l.ind, ty: 3, nm: l.nm, sr: l.sr ?? 1, ks: structuredClone(l.ks), ao: 0, ip: l.ip, op: l.op, st: l.st ?? 0, bm: 0 };
  if (l.parent !== undefined) out.parent = l.parent;
  return out;
}

/** The assets the layers use (precomps with their own layers, images), deep-copied. */
function usedAssets(anim: LottieAnimation, layers: readonly AnyLayer[]): Array<Record<string, unknown>> {
  const all = assetsOf(anim);
  const out = new Map<string, Record<string, unknown>>();
  const visit = (list: readonly AnyLayer[]) => {
    for (const l of list) {
      const id = l.refId;
      if (!id || out.has(id)) continue;
      const asset = all.get(id);
      if (!asset) continue;
      out.set(id, structuredClone(asset) as unknown as Record<string, unknown>);
      if (asset.layers) visit(asset.layers);
    }
  };
  visit(layers);
  return [...out.values()];
}

/** The part `id` of `anim` as a fragment (null for a part that cannot be cut out). */
export function partFragment(anim: LottieAnimation, id: string, name: string): LottieFragment | null {
  const [layerPath, ...groupPath] = id.split('/');
  const target = resolvePart(anim, layerPath);
  if (!target || target.type !== 'layer') return null;
  const { list, layer } = target;
  // Inside a precomp the space is that precomp's.
  const segs = layerPath.split('>');
  let w = anim.w;
  let h = anim.h;
  if (segs.length > 1) {
    const outer = resolvePart(anim, segs.slice(0, -1).join('>'));
    if (outer?.type === 'layer') {
      const asset = outer.layer.refId ? assetsOf(anim).get(outer.layer.refId) : undefined;
      w = asset?.w ?? outer.layer.w ?? w;
      h = asset?.h ?? outer.layer.h ?? h;
    }
  }
  const copy = structuredClone(layer) as AnyLayer & Json;
  // A matte without what it masks (or a masked layer without its matte) is just a layer here.
  delete copy.tt;
  delete copy.td;

  if (groupPath.length) {
    if (layer.ty !== 4) return null;
    // Down to the part: each list's fills (they paint the part too) and transform, outermost first.
    let items = (layer.shapes ?? []) as ShapeItem[];
    const chain: Array<{ styles: ShapeItem[]; tr: ShapeItem | undefined }> = [{ styles: items.filter((it) => STYLES.has(it.ty)), tr: undefined }];
    let item: ShapeItem | undefined;
    for (const [n, seg] of groupPath.entries()) {
      item = items[Number(seg.slice(1))];
      if (!item) return null;
      if (n < groupPath.length - 1) {
        if (item.ty !== 'gr') return null;
        items = (item.it as ShapeItem[]) ?? [];
        chain.push({ styles: items.filter((it) => STYLES.has(it.ty)), tr: items.find((it) => it.ty === 'tr') });
      }
    }
    if (!item) return null;
    let content: ShapeItem[] = [structuredClone(item)];
    for (const { styles, tr } of chain.reverse()) {
      content = [{ ty: 'gr', nm: name, it: [...content, ...structuredClone(styles), tr ? structuredClone(tr) : shapeTransform({})] }];
    }
    copy.shapes = content;
  }

  // Parents (in the same list) come along as nulls, so the part keeps its motion.
  const parents: AnyLayer[] = [];
  const seen = new Set<number>();
  for (let child: AnyLayer = copy; child.parent !== undefined; ) {
    const parent = list.find((l) => l.ind === child.parent);
    if (!parent || seen.has(child.parent)) {
      delete child.parent;
      break;
    }
    seen.add(child.parent);
    const copied = asNull(parent);
    parents.push(copied);
    child = copied;
  }
  const layers = [copy, ...parents];
  return { emojiStudio: 'layer', v: 1, name, w, h, layers, assets: usedAssets(anim, layers) };
}

/** A fragment from clipboard text (null when it is something else). */
export function parseFragment(text: string | null | undefined): LottieFragment | null {
  if (!text || !text.includes('"emojiStudio"')) return null;
  try {
    const f = JSON.parse(text) as LottieFragment;
    return f && f.emojiStudio === 'layer' && Array.isArray(f.layers) && f.layers.length > 0 && Array.isArray(f.assets) ? f : null;
  } catch {
    return null;
  }
}

/**
 * The fragment as one precomp layer for another animation, with its assets renamed by `nonce` (so pasting
 * the same thing twice, or into a file with the same asset ids, cannot clash).
 */
export function fragmentLayer(f: LottieFragment, nonce: string, ind: number, ip: number, op: number, name: string): { layer: AnyLayer; assets: Array<Record<string, unknown>> } {
  const rename = (id: string) => `${id}~${nonce}`;
  const relink = (layers: unknown) => {
    if (!Array.isArray(layers)) return;
    for (const l of layers as Json[]) if (typeof l.refId === 'string') l.refId = rename(l.refId);
  };
  const layers = structuredClone(f.layers);
  relink(layers);
  const assets: Array<Record<string, unknown>> = structuredClone(f.assets).map((a) => {
    relink(a.layers);
    return { ...a, id: rename(String(a.id)) };
  });
  const id = `clip~${nonce}`;
  assets.push({ id, w: f.w, h: f.h, layers });
  const layer: AnyLayer = {
    ddd: 0,
    ind,
    ty: 0,
    nm: name,
    refId: id,
    sr: 1,
    ks: { o: { a: 0, k: 100 }, r: { a: 0, k: 0 }, p: { a: 0, k: [0, 0, 0] }, a: { a: 0, k: [0, 0, 0] }, s: { a: 0, k: [100, 100, 100] } },
    ao: 0,
    w: f.w,
    h: f.h,
    ip,
    op,
    st: 0,
    bm: 0,
  };
  return { layer, assets };
}
