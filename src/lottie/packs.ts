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

function candidates(anim: LottieAnimation): Candidate[] {
  return flattenParts(listParts(anim)).flatMap((part) => {
    if (!part.replaceable || part.kind === 'solid') return [];
    const geo = partGeometry(anim, part.id);
    return geo ? [{ part, ...geo, sig: -1 }] : [];
  });
}

export function analyzePack(anims: readonly LottieAnimation[]): PackPick[] {
  const all = anims.map(candidates);
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
