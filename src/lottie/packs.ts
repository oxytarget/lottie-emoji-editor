import { hexToRgba } from './color';
import { flattenParts, listParts, partBounds, partFrame, partGeometry, sameGeometry, type Part, type PartGeometry } from './parts';
import type { BBox, LottieAnimation } from './types';

/**
 * Finds the logo/text in the stickers of a pack. Stickers made by emoji generators carry the same logo
 * (or text) in every animation while the characters differ, so parts whose outlines — normalised for position
 * and size — repeat across most of the pack are the logo. Falls back to per-sticker guesses (names, text layers).
 */

export interface PackPick {
  /** Part to replace with the user's text/logo. */
  replace: string | null;
  /** Copies of the logo (outline, shadow…) hidden so only the user's content is left. */
  hidden: string[];
  /** Found by comparing the stickers (true) or guessed from a single sticker (false). */
  shared: boolean;
}

interface Candidate extends PartGeometry {
  part: Part;
  /** Cluster of equal outlines across the pack. */
  sig: number;
}

const isAncestor = (a: string, b: string) => b.startsWith(`${a}/`) || b.startsWith(`${a}>`);
const area = (b: BBox) => Math.max(0, b.w) * Math.max(0, b.h);

function overlap(a: BBox, b: BBox): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (w <= 0 || h <= 0) return 0;
  // Share of the smaller box covered by the other one.
  return (w * h) / Math.max(1e-6, Math.min(area(a), area(b)));
}

/** The parts of one sticker that may be the logo (the slow part of the analysis — see `analyzePack`). */
export function packCandidates(anim: LottieAnimation): Candidate[] {
  return flattenParts(listParts(anim)).flatMap((part) => {
    if (!part.replaceable || part.kind === 'solid') return [];
    const geo = partGeometry(anim, part.id);
    return geo ? [{ part, ...geo, sig: -1 }] : [];
  });
}

export type { Candidate as PackCandidate };

/** `all` may be computed beforehand (sticker by sticker, so a big pack does not freeze the page). */
export function analyzePack(anims: readonly LottieAnimation[], all: Candidate[][] = anims.map(packCandidates)): PackPick[] {
  // Cluster equal outlines (same structure, points within tolerance) and count the stickers of each cluster.
  const clusters = new Map<string, Array<{ rep: Candidate; id: number }>>();
  const seen = new Map<number, Set<number>>();
  let nextId = 0;
  all.forEach((list, i) => {
    for (const c of list) {
      const bucket = clusters.get(c.key) ?? [];
      clusters.set(c.key, bucket);
      let cluster = bucket.find((b) => sameGeometry(b.rep, c));
      if (!cluster) {
        cluster = { rep: c, id: nextId++ };
        bucket.push(cluster);
      }
      c.sig = cluster.id;
      if (!seen.has(cluster.id)) seen.set(cluster.id, new Set());
      seen.get(cluster.id)!.add(i);
    }
  });
  const n = anims.length;
  const threshold = n >= 2 ? Math.max(2, Math.ceil(n * 0.5)) : Infinity;

  return anims.map((anim, i) => {
    const canvas = anim.w * anim.h;
    const boxOf = (id: string) => partBounds(anim, id, partFrame(anim, id) + anim.ip);
    // Repeated, not trivial (a plain circle or eye), not covering the whole sticker.
    const shared = all[i]
      .filter((c) => (seen.get(c.sig)?.size ?? 0) >= threshold && (c.contours >= 2 || c.segments >= 10))
      .map((c) => ({ ...c, box: boxOf(c.part.id) }))
      .filter((c): c is typeof c & { box: BBox } => !!c.box && area(c.box) > canvas * 0.0005 && area(c.box) < canvas * 0.6);
    const top = shared.filter((c) => !shared.some((o) => o !== c && isAncestor(o.part.id, c.part.id)));

    if (top.length) {
      const score = (c: (typeof top)[number]) =>
        ((seen.get(c.sig)?.size ?? 0) / n) * (c.part.detected ? 2 : 1) * Math.log(2 + c.segments) * Math.sqrt(area(c.box) / canvas);
      const best = top.reduce((a, b) => (score(b) > score(a) ? b : a));
      const hidden = top.filter((c) => c !== best && overlap(c.box, best.box) > 0.6).map((c) => c.part.id);
      return { replace: best.part.id, hidden, shared: true };
    }

    const guess = flattenParts(listParts(anim)).find((p) => p.detected && p.replaceable);
    return { replace: guess?.id ?? null, hidden: [], shared: false };
  });
}

// ---------------------------------------------------------------------------
// Matching parts and colours between stickers (for editing many stickers at once)
// ---------------------------------------------------------------------------

const partsCache = new WeakMap<LottieAnimation, Part[]>();
const geometryCache = new WeakMap<LottieAnimation, Map<string, PartGeometry | null>>();

function partsOf(anim: LottieAnimation): Part[] {
  let parts = partsCache.get(anim);
  if (!parts) {
    parts = flattenParts(listParts(anim));
    partsCache.set(anim, parts);
  }
  return parts;
}

function geometryOf(anim: LottieAnimation, id: string): PartGeometry | null {
  let byId = geometryCache.get(anim);
  if (!byId) {
    byId = new Map();
    geometryCache.set(anim, byId);
  }
  if (!byId.has(id)) byId.set(id, partGeometry(anim, id));
  return byId.get(id) ?? null;
}

/**
 * The part of `to` that corresponds to `id` in `from`: the same outlines (at any position and size), or —
 * for identically built files — the same place with the same name. Null when there is no such part.
 */
export function matchPart(from: LottieAnimation, id: string, to: LottieAnimation): string | null {
  const source = partsOf(from).find((p) => p.id === id);
  if (!source) return null;
  const candidates = partsOf(to);
  const geo = geometryOf(from, id);
  if (geo) {
    let hits = candidates.filter((p) => {
      const g = geometryOf(to, p.id);
      return !!g && sameGeometry(geo, g);
    });
    // A plain circle or square is everywhere: for simple outlines also require about the same place and size.
    if (geo.contours < 2 && geo.segments < 10) {
      const a = boundsOf(from, id);
      hits = hits.filter((p) => {
        const b = boundsOf(to, p.id);
        return !!a && !!b && closeBoxes(a, b, from.w, to.w);
      });
    }
    if (hits.length) return (hits.find((p) => p.id === id) ?? hits[0]).id;
  }
  const same = candidates.find((p) => p.id === id);
  if (same && same.kind === source.kind && same.name === source.name) return same.id;
  // A meaningful name used once ("body", "eyes"), wherever it sits.
  if (GENERIC_NAME.test(source.name)) return null;
  const named = candidates.filter((p) => p.name === source.name && p.kind === source.kind);
  return named.length === 1 ? named[0].id : null;
}

/** Names editors generate on their own — they say nothing about what a part is. */
const GENERIC_NAME = /^(?:(?:shape |text |null |solid |pre-?comp |image )?layer|group|shape|слой|шар|група|группа|фигура|фігура|null|comp|precomp)[\s_-]*\d*$/i;

const boundsOf = (anim: LottieAnimation, id: string) => partBounds(anim, id, partFrame(anim, id) + anim.ip);

function closeBoxes(a: BBox, b: BBox, wa: number, wb: number): boolean {
  const n = (box: BBox, w: number) => ({ x: (box.x + box.w / 2) / w, y: (box.y + box.h / 2) / w, s: Math.max(box.w, box.h) / w });
  const p = n(a, wa);
  const q = n(b, wb);
  return Math.hypot(p.x - q.x, p.y - q.y) < 0.12 && Math.abs(p.s - q.s) < Math.max(p.s, q.s) * 0.3;
}

/** Colours of `palette` that are (nearly) `color` — exports round colours slightly differently. */
export function matchColors(palette: readonly string[], color: string, tolerance = 6 / 255): string[] {
  const [r, g, b] = hexToRgba(color);
  return palette.filter((c) => {
    const [r2, g2, b2] = hexToRgba(c);
    return Math.max(Math.abs(r - r2), Math.abs(g - g2), Math.abs(b - b2)) <= tolerance;
  });
}
