import type { Easing, Keyframe, Prop } from './types';

/** Cubic-bezier easing curves (same meaning as CSS `cubic-bezier(x1, y1, x2, y2)`). */
export const EASE = {
  linear: [0, 0, 1, 1],
  inOut: [0.42, 0, 0.58, 1],
  soft: [0.33, 0, 0.67, 1],
  out: [0.16, 1, 0.3, 1],
  in: [0.5, 0, 0.75, 0],
  outBack: [0.34, 1.56, 0.64, 1],
} as const;

export type EaseName = keyof typeof EASE;
export type Ease = EaseName | readonly [number, number, number, number] | 'hold';

export const round = (n: number, digits = 2): number => {
  const f = 10 ** digits;
  const r = Math.round(n * f) / f;
  return Object.is(r, -0) ? 0 : r;
};

const toArray = (v: number | readonly number[]): number[] => (typeof v === 'number' ? [v] : v.map((n) => round(n, 3)));

/** Static (non-animated) property. */
export function stat(value: number | readonly number[]): Prop {
  return { a: 0, k: typeof value === 'number' ? round(value, 3) : value.map((n) => round(n, 3)) };
}

function easing(dims: number, ease: Exclude<Ease, 'hold'>): { o: Easing; i: Easing } {
  const [x1, y1, x2, y2] = typeof ease === 'string' ? EASE[ease] : ease;
  const fill = (n: number) => Array.from({ length: dims }, () => n);
  return { o: { x: fill(x1), y: fill(y1) }, i: { x: fill(x2), y: fill(y2) } };
}

/**
 * Keyframed property. Each tuple is `[frame, value, easeToNext]`.
 * The easing of a keyframe describes the transition *to the next* keyframe.
 */
export function anim(frames: ReadonlyArray<readonly [number, number | readonly number[], Ease?]>): Prop {
  if (frames.length === 1) return stat(frames[0][1]);
  const keys: Keyframe[] = frames.map(([t, value, ease = 'soft'], idx) => {
    const s = toArray(value);
    const key: Keyframe = { t: round(t, 2), s };
    if (idx === frames.length - 1) return key;
    if (ease === 'hold') {
      key.h = 1;
      return key;
    }
    Object.assign(key, easing(s.length, ease));
    return key;
  });
  return { a: 1, k: keys };
}

/**
 * Seamless loop helper: `points` are `[fraction 0..1, value, ease]`, the first value is
 * repeated at the end so the animation loops without a jump.
 */
export function loop(
  duration: number,
  points: ReadonlyArray<readonly [number, number | readonly number[], Ease?]>,
): Prop {
  const frames = points.map(([f, v, e]) => [f * duration, v, e] as const);
  const last = frames[frames.length - 1];
  if (last[0] < duration) frames.push([duration, points[0][1], undefined]);
  return anim(frames);
}

/** Oscillation between `a` and `b` (a → b → a …) `cycles` times within `duration`. */
export function pingPong(
  duration: number,
  a: number | readonly number[],
  b: number | readonly number[],
  cycles = 1,
  ease: Ease = 'inOut',
  phase = 0,
): Prop {
  const pts: Array<readonly [number, number | readonly number[], Ease]> = [];
  const steps = cycles * 2;
  for (let i = 0; i <= steps; i++) {
    pts.push([i / steps, i % 2 === 0 ? a : b, ease]);
  }
  return phase ? shiftLoop(duration, pts, phase) : anim(pts.map(([f, v, e]) => [f * duration, v, e]));
}

/**
 * Offsets a looping keyframe list in time by `phase` (0..1) while keeping the loop seamless.
 * Useful to de-synchronise several copies of the same motion.
 * Points must lie in [0, 1); the loop always closes back to the first value at 1
 * (use a `'hold'` point just before 1 for an instant jump back).
 */
export function shiftLoop(
  duration: number,
  points: ReadonlyArray<readonly [number, number | readonly number[], Ease?]>,
  phase: number,
): Prop {
  const p = ((phase % 1) + 1) % 1;
  if (p === 0) return loop(duration, points);
  const closed = [...points.filter(([f]) => f < 1), [1, points[0][1], points[0][2]] as const];

  const valueAt = (f: number): number[] => {
    for (let i = 0; i < closed.length - 1; i++) {
      const [f0, v0] = closed[i];
      const [f1, v1] = closed[i + 1];
      if (f >= f0 && f <= f1) {
        const k = f1 === f0 ? 0 : (f - f0) / (f1 - f0);
        const a = toArray(v0);
        const b = toArray(v1);
        return a.map((n, j) => n + (b[j] - n) * k);
      }
    }
    return toArray(closed[0][1]);
  };

  const shifted: Array<[number, number | readonly number[], Ease?]> = [];
  const start = valueAt(p);
  shifted.push([0, start, 'linear']);
  // The closing point (fraction 1) coincides with the first point of the next cycle — skip it.
  for (const [f, v, e] of closed.slice(0, -1)) {
    const nf = f - p;
    if (nf > 0 && nf < 1) shifted.push([nf, v, e]);
  }
  for (const [f, v, e] of closed.slice(0, -1)) {
    const nf = f + 1 - p;
    if (nf > 0 && nf < 1) shifted.push([nf, v, e]);
  }
  shifted.sort((x, y) => x[0] - y[0]);
  shifted.push([1, start, undefined]);
  return anim(shifted.map(([f, v, e]) => [f * duration, v, e]));
}
