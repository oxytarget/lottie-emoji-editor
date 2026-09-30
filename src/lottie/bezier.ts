import svgpath from 'svgpath';
import { round } from './anim';
import type { BBox, Bezier, Matrix } from './types';

/** Absolute cubic segment: control point 1, control point 2, end point. */
export type Cubic = [number, number, number, number, number, number];

/** A single sub-path made only of absolute cubic segments (lines are degenerate cubics). */
export interface Contour {
  closed: boolean;
  start: [number, number];
  segs: Cubic[];
}

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** m1 × m2 (apply m2 first, then m1) in SVG `matrix(a b c d e f)` convention. */
export function multiply(m1: Matrix, m2: Matrix): Matrix {
  const [a1, b1, c1, d1, e1, f1] = m1;
  const [a2, b2, c2, d2, e2, f2] = m2;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
}

export function applyMatrix(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/** Average linear scale factor of a matrix (used for stroke widths). */
export function matrixScale(m: Matrix): number {
  return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
}

const lineSeg = (x0: number, y0: number, x: number, y: number): Cubic => [x0, y0, x, y, x, y];

/**
 * Converts SVG path data into cubic contours.
 * Arcs, quadratic and shorthand commands are all normalised to cubic curves.
 */
export function parsePathData(d: string): Contour[] {
  const contours: Contour[] = [];
  let current: Contour | null = null;
  let cx = 0;
  let cy = 0;

  const ensure = () => {
    if (!current) {
      current = { closed: false, start: [cx, cy], segs: [] };
      contours.push(current);
    }
    return current;
  };

  svgpath(d)
    .abs()
    .unshort()
    .unarc()
    .iterate((seg) => {
      const cmd = seg[0];
      switch (cmd) {
        case 'M': {
          current = { closed: false, start: [seg[1], seg[2]], segs: [] };
          contours.push(current);
          cx = seg[1];
          cy = seg[2];
          break;
        }
        case 'L':
          ensure().segs.push(lineSeg(cx, cy, seg[1], seg[2]));
          cx = seg[1];
          cy = seg[2];
          break;
        case 'H':
          ensure().segs.push(lineSeg(cx, cy, seg[1], cy));
          cx = seg[1];
          break;
        case 'V':
          ensure().segs.push(lineSeg(cx, cy, cx, seg[1]));
          cy = seg[1];
          break;
        case 'C':
          ensure().segs.push([seg[1], seg[2], seg[3], seg[4], seg[5], seg[6]]);
          cx = seg[5];
          cy = seg[6];
          break;
        case 'Q': {
          const [qx, qy, x, y] = [seg[1], seg[2], seg[3], seg[4]];
          ensure().segs.push([
            cx + (2 / 3) * (qx - cx),
            cy + (2 / 3) * (qy - cy),
            x + (2 / 3) * (qx - x),
            y + (2 / 3) * (qy - y),
            x,
            y,
          ]);
          cx = x;
          cy = y;
          break;
        }
        case 'Z':
        case 'z': {
          const c = ensure();
          c.closed = true;
          cx = c.start[0];
          cy = c.start[1];
          // A new drawing command after Z starts a fresh sub-path at the same point.
          current = null;
          break;
        }
        default:
          break;
      }
    });

  return contours.filter((c) => c.segs.length > 0);
}

/** Converts opentype.js path commands (absolute M/L/C/Q/Z) to contours. */
export function commandsToContours(
  commands: ReadonlyArray<{ type: string; x?: number; y?: number; x1?: number; y1?: number; x2?: number; y2?: number }>,
): Contour[] {
  const out: Contour[] = [];
  let cur: Contour | null = null;
  let cx = 0;
  let cy = 0;
  for (const c of commands) {
    if (c.type === 'M') {
      cur = { closed: false, start: [c.x!, c.y!], segs: [] };
      out.push(cur);
      cx = c.x!;
      cy = c.y!;
    } else if (c.type === 'L') {
      if (!cur) continue;
      cur.segs.push(lineSeg(cx, cy, c.x!, c.y!));
      cx = c.x!;
      cy = c.y!;
    } else if (c.type === 'C') {
      if (!cur) continue;
      cur.segs.push([c.x1!, c.y1!, c.x2!, c.y2!, c.x!, c.y!]);
      cx = c.x!;
      cy = c.y!;
    } else if (c.type === 'Q') {
      if (!cur) continue;
      cur.segs.push([
        cx + (2 / 3) * (c.x1! - cx),
        cy + (2 / 3) * (c.y1! - cy),
        c.x! + (2 / 3) * (c.x1! - c.x!),
        c.y! + (2 / 3) * (c.y1! - c.y!),
        c.x!,
        c.y!,
      ]);
      cx = c.x!;
      cy = c.y!;
    } else if (c.type === 'Z') {
      if (!cur) continue;
      cur.closed = true;
      cx = cur.start[0];
      cy = cur.start[1];
    }
  }
  return out.filter((c) => c.segs.length > 0);
}

export function transformContours(contours: readonly Contour[], m: Matrix): Contour[] {
  return contours.map((c) => ({
    closed: c.closed,
    start: applyMatrix(m, c.start[0], c.start[1]),
    segs: c.segs.map((s) => {
      const [a, b] = applyMatrix(m, s[0], s[1]);
      const [c1, d] = applyMatrix(m, s[2], s[3]);
      const [e, f] = applyMatrix(m, s[4], s[5]);
      return [a, b, c1, d, e, f] as Cubic;
    }),
  }));
}

/** Extremes of a 1D cubic bezier on [0, 1]. */
function cubicExtrema(p0: number, p1: number, p2: number, p3: number): number[] {
  const out = [p0, p3];
  const a = -p0 + 3 * p1 - 3 * p2 + p3;
  const b = 2 * (p0 - 2 * p1 + p2);
  const c = p1 - p0;
  const at = (t: number) => {
    const mt = 1 - t;
    return mt * mt * mt * p0 + 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t * p3;
  };
  if (Math.abs(a) < 1e-12) {
    if (Math.abs(b) > 1e-12) {
      const t = -c / b;
      if (t > 0 && t < 1) out.push(at(t));
    }
    return out;
  }
  const disc = b * b - 4 * a * c;
  if (disc < 0) return out;
  const sq = Math.sqrt(disc);
  for (const t of [(-b + sq) / (2 * a), (-b - sq) / (2 * a)]) {
    if (t > 0 && t < 1) out.push(at(t));
  }
  return out;
}

/** Tight bounding box of contours (exact cubic extrema). */
export function contoursBBox(contours: readonly Contour[]): BBox | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const c of contours) {
    let x0 = c.start[0];
    let y0 = c.start[1];
    minX = Math.min(minX, x0);
    maxX = Math.max(maxX, x0);
    minY = Math.min(minY, y0);
    maxY = Math.max(maxY, y0);
    for (const s of c.segs) {
      for (const x of cubicExtrema(x0, s[0], s[2], s[4])) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
      }
      for (const y of cubicExtrema(y0, s[1], s[3], s[5])) {
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
      x0 = s[4];
      y0 = s[5];
    }
  }
  if (!Number.isFinite(minX)) return null;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function unionBBox(a: BBox | null, b: BBox | null): BBox | null {
  if (!a) return b;
  if (!b) return a;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

export function inflateBBox(b: BBox, d: number): BBox {
  return { x: b.x - d, y: b.y - d, w: b.w + 2 * d, h: b.h + 2 * d };
}

const EPS = 1e-6;
const samePoint = (x1: number, y1: number, x2: number, y2: number, tol = EPS) =>
  Math.abs(x1 - x2) < tol && Math.abs(y1 - y2) < tol;

/** Converts a contour to Lottie bezier data (vertices + relative in/out tangents). */
export function contourToBezier(contour: Contour, digits = 2): Bezier {
  const r = (n: number) => round(n, digits);
  const v: number[][] = [[contour.start[0], contour.start[1]]];
  const inT: number[][] = [[0, 0]];
  const outT: number[][] = [[0, 0]];

  for (const [c1x, c1y, c2x, c2y, x, y] of contour.segs) {
    const prev = v[v.length - 1];
    outT[outT.length - 1] = [c1x - prev[0], c1y - prev[1]];
    v.push([x, y]);
    inT.push([c2x - x, c2y - y]);
    outT.push([0, 0]);
  }

  // Degenerate zero-length segments (common in font outlines) only add noise.
  for (let k = v.length - 1; k > 0; k--) {
    const a = v[k - 1];
    const b = v[k];
    if (samePoint(a[0], a[1], b[0], b[1], 1e-4) && Math.abs(outT[k - 1][0]) + Math.abs(outT[k - 1][1]) < 1e-9 && Math.abs(inT[k][0]) + Math.abs(inT[k][1]) < 1e-9) {
      outT[k - 1] = outT[k];
      v.splice(k, 1);
      inT.splice(k, 1);
      outT.splice(k, 1);
    }
  }

  if (contour.closed && v.length > 1) {
    const first = v[0];
    const last = v[v.length - 1];
    if (samePoint(first[0], first[1], last[0], last[1], 1e-3)) {
      // Closing segment already present: merge the duplicated end vertex into the first one.
      inT[0] = inT[inT.length - 1];
      v.pop();
      inT.pop();
      outT.pop();
    }
  }

  return {
    c: contour.closed,
    v: v.map(([x, y]) => [r(x), r(y)]),
    i: inT.map(([x, y]) => [r(x), r(y)]),
    o: outT.map(([x, y]) => [r(x), r(y)]),
  };
}

/** Parses path data and converts it straight to Lottie beziers (used for hand-drawn template parts). */
export function pathToBeziers(d: string, m: Matrix = IDENTITY, digits = 2): Bezier[] {
  return transformContours(parsePathData(d), m).map((c) => contourToBezier(c, digits));
}

export function translateMatrix(x: number, y: number): Matrix {
  return [1, 0, 0, 1, x, y];
}

export function scaleMatrix(sx: number, sy = sx): Matrix {
  return [sx, 0, 0, sy, 0, 0];
}

export function rotateMatrix(deg: number, cx = 0, cy = 0): Matrix {
  const a = (deg * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return multiply(translateMatrix(cx, cy), multiply([cos, sin, -sin, cos, 0, 0], translateMatrix(-cx, -cy)));
}
