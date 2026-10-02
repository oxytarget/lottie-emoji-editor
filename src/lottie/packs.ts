import { hexToRgba } from './color';
import { flattenParts, listParts, partBounds, partFrame, partGeometry, runGeometry, sameGeometry, shapeRuns, type Part, type PartGeometry, type ShapeRun } from './parts';
import type { BBox, LottieAnimation } from './types';

/**
 * Finds the logo/text in the stickers of a pack. Stickers made by emoji generators carry the same logo
 * (or text) in every animation while the characters differ, so parts whose outlines — normalised for position
 * and size — repeat across most of the pack are the logo. The logo may also be a few items drawn next to the
 * body in one layer or group (its letters as sibling groups, or paths sharing the body's fill): runs of such
 * items are compared the same way. Falls back to per-sticker guesses (names, text layers).
 */

export interface PackPick {
  /** Part to replace with the user's text/logo. */
  replace: string | null;
  /** Copies of the logo (outline, shadow…) hidden so only the user's content is left. */
  hidden: string[];
  /** Found by comparing the stickers (true) or guessed from a single sticker (false). */
  shared: boolean;
  /**
   * The logo is a run of items among other shapes: a slot goes in its place (`slotForRun` in layout.ts) and
   * the run's items are in `hidden`. `replace` is then null until the slot exists.
   */
  run?: { container: string; items: number[] };
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

/** Runs of items of one sticker that may be the logo (structure only; see `shapeRuns`). */
export const packRuns = (anim: LottieAnimation): ShapeRun[] => shapeRuns(anim);

const runIds = (run: Pick<ShapeRun, 'container' | 'items'>) => run.items.map((i) => `${run.container}/g${i}`);
const isWithin = (a: string, b: string) => a === b || isAncestor(a, b);

/** A run whose outlines repeat across the pack, with its sticker's box. */
interface SharedRun extends ShapeRun, PartGeometry {
  sig: number;
}

/**
 * Runs whose structure repeats in enough stickers, then whose shapes match (only those get their geometry
 * computed — a sticker has thousands of runs). Support = number of stickers per matching cluster.
 */
function sharedRuns(anims: readonly LottieAnimation[], runs: ShapeRun[][], threshold: number): { list: SharedRun[][]; support: Map<number, number> } {
  const byKey = new Map<string, Set<number>>();
  runs.forEach((list, i) => {
    for (const r of list) {
      let set = byKey.get(r.key);
      if (!set) byKey.set(r.key, (set = new Set()));
      set.add(i);
    }
  });
  const clusters = new Map<string, Array<{ rep: PartGeometry; id: number }>>();
  const seen = new Map<number, Set<number>>();
  let nextId = 0;
  const list = runs.map((stickerRuns, i) =>
    stickerRuns.flatMap((r) => {
      if ((byKey.get(r.key)?.size ?? 0) < threshold) return [];
      const geo = runGeometry(anims[i], r);
      if (!geo) return [];
      const bucket = clusters.get(geo.key) ?? [];
      clusters.set(geo.key, bucket);
      let cluster = bucket.find((b) => sameGeometry(b.rep, geo));
      if (!cluster) {
        cluster = { rep: geo, id: nextId++ };
        bucket.push(cluster);
      }
      if (!seen.has(cluster.id)) seen.set(cluster.id, new Set());
      seen.get(cluster.id)!.add(i);
      return [{ ...r, ...geo, sig: cluster.id }];
    }),
  );
  return { list, support: new Map([...seen].map(([id, set]) => [id, set.size])) };
}

/** Every item of the run lies on every other one (copies of one shape), rather than side by side. */
function isStack(anim: LottieAnimation, run: Pick<ShapeRun, 'container' | 'items'>): boolean {
  const boxes = run.items.map((i) => partBounds(anim, `${run.container}/g${i}`, 0));
  if (boxes.some((b) => !b)) return false;
  return boxes.every((a, i) => boxes.every((b, j) => i === j || overlap(a!, b!) > 0.6));
}

/**
 * `all` and `runs` may be computed beforehand (sticker by sticker, so a big pack does not freeze the page).
 */
export function analyzePack(
  anims: readonly LottieAnimation[],
  all: Candidate[][] = anims.map(packCandidates),
  runs: ShapeRun[][] = anims.map(packRuns),
): PackPick[] {
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
  const shared = n >= 2 ? sharedRuns(anims, runs, threshold) : { list: anims.map(() => []), support: new Map<number, number>() };

  return anims.map((anim, i) => {
    const canvas = anim.w * anim.h;
    const boxOf = (id: string) => partBounds(anim, id, partFrame(anim, id) + anim.ip);
    const fits = (box: BBox | null): box is BBox => !!box && area(box) > canvas * 0.0005 && area(box) < canvas * 0.6;
    // Repeated, not trivial (a plain circle or eye), not covering the whole sticker.
    const parts = all[i]
      .filter((c) => (seen.get(c.sig)?.size ?? 0) >= threshold && (c.contours >= 2 || c.segments >= 10))
      .map((c) => ({ ...c, box: boxOf(c.part.id) }))
      .filter((c): c is typeof c & { box: BBox } => fits(c.box));
    const runsHere = shared.list[i]
      .filter((r) => (shared.support.get(r.sig) ?? 0) >= threshold)
      .map((r) => ({ ...r, box: partBounds(anim, r.container, partFrame(anim, r.container) + anim.ip, r.items) }))
      .filter((r): r is typeof r & { box: BBox } => fits(r.box))
      // A run inside a part that repeats itself is that part's business.
      .filter((r) => !parts.some((p) => isWithin(p.part.id, r.container)))
      // Copies of one logo stacked up (outline, fill, shadow) are parts with copies, not a logo made of pieces.
      .filter((r) => !isStack(anim, r));
    // Of runs that repeat, the longest: a run inside another one (part of the logo) goes.
    const longest = runsHere.filter(
      (r) => !runsHere.some((o) => o !== r && (isWithin(runIds(o).find((id) => isWithin(id, r.container)) ?? '#', r.container) || (o.container === r.container && o.items.length > r.items.length && r.items.every((x) => o.items.includes(x))))),
    );
    // A part that is one letter of a repeating run is not the logo either.
    const topParts = parts.filter(
      (c) => !parts.some((o) => o !== c && isAncestor(o.part.id, c.part.id)) && !longest.some((r) => runIds(r).some((id) => isWithin(id, c.part.id))),
    );

    type Pick = { kind: 'part'; id: string; box: BBox; score: number } | { kind: 'run'; run: (typeof longest)[number]; box: BBox; score: number };
    const support = (sig: number, map: Map<number, number>) => (map.get(sig) ?? 0) / n;
    const picks: Pick[] = [
      ...topParts.map((c) => ({
        kind: 'part' as const,
        id: c.part.id,
        box: c.box,
        score: ((seen.get(c.sig)?.size ?? 0) / n) * (c.part.detected ? 2 : 1) * Math.log(2 + c.segments) * Math.sqrt(area(c.box) / canvas),
      })),
      ...longest.map((r) => ({
        kind: 'run' as const,
        run: r,
        box: r.box,
        score: support(r.sig, shared.support) * Math.log(2 + r.segments) * Math.sqrt(area(r.box) / canvas),
      })),
    ];

    if (picks.length) {
      const best = picks.reduce((a, b) => (b.score > a.score ? b : a));
      // Copies of the logo at the same place (outline, shadow) go too.
      const copies = picks.filter((p) => p !== best && overlap(p.box, best.box) > 0.6).flatMap((p) => (p.kind === 'part' ? [p.id] : runIds(p.run)));
      if (best.kind === 'part') return { replace: best.id, hidden: copies, shared: true };
      const run = { container: best.run.container, items: best.run.items };
      return { replace: null, hidden: [...runIds(run), ...copies], shared: true, run };
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
