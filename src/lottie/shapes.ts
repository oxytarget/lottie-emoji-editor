import { round, stat } from './anim';
import { contourToBezier, contoursBBox, pathToBeziers, type Contour } from './bezier';
import { hexToRgba, type RGBA } from './color';
import type { BBox, Bezier, Layer, LayerTransform, Matrix, Prop, ShapeItem } from './types';

type PropInput = Prop | number | readonly number[];
const toProp = (v: PropInput): Prop => (typeof v === 'number' || Array.isArray(v) ? stat(v as number | number[]) : (v as Prop));

export interface TransformInput {
  p?: PropInput;
  a?: PropInput;
  s?: PropInput;
  r?: PropInput;
  o?: PropInput;
}

export function shapeTransform(t: TransformInput = {}): ShapeItem {
  return {
    ty: 'tr',
    p: toProp(t.p ?? [0, 0]),
    a: toProp(t.a ?? [0, 0]),
    s: toProp(t.s ?? [100, 100]),
    r: toProp(t.r ?? 0),
    o: toProp(t.o ?? 100),
    sk: stat(0),
    sa: stat(0),
  };
}

export function group(items: ShapeItem[], t: TransformInput = {}, nm?: string): ShapeItem {
  const g: ShapeItem = { ty: 'gr', it: [...items, shapeTransform(t)] };
  if (nm) g.nm = nm;
  return g;
}

export function bezierShape(b: Bezier): ShapeItem {
  return { ty: 'sh', ks: { a: 0, k: b } };
}

export function pathShapes(d: string, m?: Matrix): ShapeItem[] {
  return pathToBeziers(d, m).map(bezierShape);
}

export function contourShapes(contours: readonly Contour[], digits = 2): ShapeItem[] {
  return contours.map((c) => bezierShape(contourToBezier(c, digits)));
}

export function ellipse(cx: number, cy: number, w: number, h = w): ShapeItem {
  return { ty: 'el', d: 1, p: stat([cx, cy]), s: stat([w, h]) };
}

export function animatedEllipse(p: PropInput, s: PropInput): ShapeItem {
  return { ty: 'el', d: 1, p: toProp(p), s: toProp(s) };
}

export function rect(cx: number, cy: number, w: number, h: number, r = 0): ShapeItem {
  return { ty: 'rc', d: 1, p: stat([cx, cy]), s: stat([w, h]), r: stat(r) };
}

export function solidFill(color: RGBA | string, opacity: PropInput = 100, evenOdd = false): ShapeItem {
  const c = typeof color === 'string' ? hexToRgba(color) : color;
  return { ty: 'fl', c: stat([c[0], c[1], c[2], 1]), o: toProp(opacity), r: evenOdd ? 2 : 1 };
}

export interface StrokeOptions {
  width: PropInput;
  opacity?: PropInput;
  /** 1 butt, 2 round, 3 square */
  cap?: 1 | 2 | 3;
  /** 1 miter, 2 round, 3 bevel */
  join?: 1 | 2 | 3;
  miter?: number;
  dash?: { dash: number; gap: number; offset?: PropInput };
}

function strokeCommon(o: StrokeOptions): Record<string, unknown> {
  const out: Record<string, unknown> = {
    o: toProp(o.opacity ?? 100),
    w: toProp(o.width),
    lc: o.cap ?? 2,
    lj: o.join ?? 2,
  };
  if ((o.join ?? 2) === 1) out.ml = o.miter ?? 4;
  if (o.dash) {
    out.d = [
      { n: 'd', nm: 'dash', v: stat(o.dash.dash) },
      { n: 'g', nm: 'gap', v: stat(o.dash.gap) },
      { n: 'o', nm: 'offset', v: toProp(o.dash.offset ?? 0) },
    ];
  }
  return out;
}

export function solidStroke(color: RGBA | string, opts: StrokeOptions): ShapeItem {
  const c = typeof color === 'string' ? hexToRgba(color) : color;
  return { ty: 'st', c: stat([c[0], c[1], c[2], 1]), ...strokeCommon(opts) };
}

/** Gradient stop: offset 0..1 + colour. */
export interface GradientStop {
  offset: number;
  color: RGBA;
}

export interface GradientGeometry {
  type: 'linear' | 'radial';
  start: [number, number];
  end: [number, number];
}

function gradientData(stops: readonly GradientStop[]): { p: number; k: Prop } {
  const sorted = [...stops].sort((a, b) => a.offset - b.offset);
  const colors: number[] = [];
  const alphas: number[] = [];
  let hasAlpha = false;
  for (const s of sorted) {
    colors.push(round(s.offset, 3), round(s.color[0], 3), round(s.color[1], 3), round(s.color[2], 3));
    alphas.push(round(s.offset, 3), round(s.color[3], 3));
    if (s.color[3] < 0.999) hasAlpha = true;
  }
  return { p: sorted.length, k: stat(hasAlpha ? [...colors, ...alphas] : colors) };
}

export function gradientFill(stops: readonly GradientStop[], geo: GradientGeometry, opacity: PropInput = 100, evenOdd = false): ShapeItem {
  return {
    ty: 'gf',
    o: toProp(opacity),
    r: evenOdd ? 2 : 1,
    g: gradientData(stops),
    s: stat(geo.start),
    e: stat(geo.end),
    t: geo.type === 'linear' ? 1 : 2,
    h: stat(0),
    a: stat(0),
  };
}

export function gradientStroke(stops: readonly GradientStop[], geo: GradientGeometry, opts: StrokeOptions): ShapeItem {
  return {
    ty: 'gs',
    g: gradientData(stops),
    s: stat(geo.start),
    e: stat(geo.end),
    t: geo.type === 'linear' ? 1 : 2,
    h: stat(0),
    a: stat(0),
    ...strokeCommon(opts),
  };
}

/** Bounding box of every bezier path in a list of shape items (recurses into groups, ignores transforms). */
export function shapesBBox(items: readonly ShapeItem[]): BBox | null {
  let box: BBox | null = null;
  const add = (b: BBox) => {
    if (!box) {
      box = { ...b };
      return;
    }
    const x = Math.min(box.x, b.x);
    const y = Math.min(box.y, b.y);
    box = { x, y, w: Math.max(box.x + box.w, b.x + b.w) - x, h: Math.max(box.y + box.h, b.y + b.h) - y };
  };
  for (const it of items) {
    if (it.ty === 'gr') {
      const inner = shapesBBox(it.it as ShapeItem[]);
      if (inner) add(inner);
    } else if (it.ty === 'sh') {
      const k = (it.ks as { k: Bezier }).k;
      const b = k.v;
      if (!b?.length) continue;
      const contour: Contour = {
        closed: k.c,
        start: [b[0][0], b[0][1]],
        segs: b.map((_, idx) => {
          const from = b[idx];
          const toIdx = (idx + 1) % b.length;
          const to = b[toIdx];
          return [from[0] + k.o[idx][0], from[1] + k.o[idx][1], to[0] + k.i[toIdx][0], to[1] + k.i[toIdx][1], to[0], to[1]];
        }).slice(0, k.c ? b.length : b.length - 1) as Contour['segs'],
      };
      const bb = contoursBBox([contour]);
      if (bb) add(bb);
    } else if (it.ty === 'el' || it.ty === 'rc') {
      const p = (it.p as { k: number[] }).k;
      const s = (it.s as { k: number[] }).k;
      if (Array.isArray(p) && typeof p[0] === 'number' && Array.isArray(s) && typeof s[0] === 'number') {
        add({ x: p[0] - s[0] / 2, y: p[1] - s[1] / 2, w: s[0], h: s[1] });
      }
    }
  }
  return box;
}

// ---------------------------------------------------------------------------
// Layers
// ---------------------------------------------------------------------------

export interface LayerInput {
  nm: string;
  p?: PropInput;
  a?: PropInput;
  s?: PropInput;
  r?: PropInput;
  o?: PropInput;
  parent?: number;
}

function layerTransform(l: LayerInput): LayerTransform {
  return {
    o: toProp(l.o ?? 100),
    r: toProp(l.r ?? 0),
    p: toProp(l.p ?? [256, 256, 0]),
    a: toProp(l.a ?? [0, 0, 0]),
    s: toProp(l.s ?? [100, 100, 100]),
  };
}

/** Collects layers top-to-bottom and hands out layer indices for parenting. */
export class LayerStack {
  private layers: Layer[] = [];
  private nextInd = 1;

  constructor(private readonly op: number) {}

  /** Adds a shape layer. Layers added first are rendered on top. */
  shape(l: LayerInput & { shapes: ShapeItem[] }): number {
    const ind = this.nextInd++;
    const layer: Layer = {
      ddd: 0,
      ind,
      ty: 4,
      nm: l.nm,
      sr: 1,
      ks: layerTransform(l),
      ao: 0,
      shapes: l.shapes,
      ip: 0,
      op: this.op,
      st: 0,
      bm: 0,
    };
    if (l.parent) layer.parent = l.parent;
    this.layers.push(layer);
    return ind;
  }

  /** Adds an invisible null layer used as an animation rig for parenting. */
  null(l: LayerInput): number {
    const ind = this.nextInd++;
    const layer: Layer = {
      ddd: 0,
      ind,
      ty: 3,
      nm: l.nm,
      sr: 1,
      ks: layerTransform(l),
      ao: 0,
      ip: 0,
      op: this.op,
      st: 0,
      bm: 0,
    };
    if (l.parent) layer.parent = l.parent;
    this.layers.push(layer);
    return ind;
  }

  toArray(): Layer[] {
    return this.layers;
  }
}
