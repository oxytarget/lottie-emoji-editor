/**
 * Minimal Lottie (Bodymovin 5.x) typings — only the subset this editor generates.
 * Everything we emit is limited to features supported by Telegram's rlottie
 * (shape layers, null layers, groups, paths, ellipses, rects, fills, strokes, gradients).
 */

export type Vec = number[];

export interface Easing {
  x: number[];
  y: number[];
}

export interface Keyframe<T = number[]> {
  t: number;
  s: T;
  h?: 1;
  o?: Easing;
  i?: Easing;
}

export type Prop =
  | { a: 0; k: number | number[] }
  | { a: 1; k: Keyframe[] };

export interface Bezier {
  c: boolean;
  v: number[][];
  i: number[][];
  o: number[][];
}

export type ShapeProp =
  | { a: 0; k: Bezier }
  | { a: 1; k: Keyframe<Bezier[]>[] };

/** A shape item inside a shape layer (`gr`, `sh`, `el`, `rc`, `fl`, `st`, `gf`, `gs`, `tr`, …). */
export interface ShapeItem {
  ty: string;
  nm?: string;
  [key: string]: unknown;
}

export interface LayerTransform {
  o: Prop;
  r: Prop;
  p: Prop;
  a: Prop;
  s: Prop;
}

export interface Layer {
  ddd: 0;
  ind: number;
  /** 0 precomp, 1 solid, 2 image, 3 null, 4 shape, 5 text — generated files only use 3 and 4. */
  ty: number;
  nm: string;
  sr: 1;
  ks: LayerTransform;
  ao: 0;
  ip: number;
  op: number;
  st: number;
  bm: 0;
  parent?: number;
  shapes?: ShapeItem[];
  [key: string]: unknown;
}

export interface LottieAnimation {
  tgs?: 1;
  v: string;
  fr: number;
  ip: number;
  op: number;
  w: number;
  h: number;
  nm: string;
  ddd: 0;
  assets: unknown[];
  layers: Layer[];
  [key: string]: unknown;
}

export type Matrix = [number, number, number, number, number, number];

export interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
}
