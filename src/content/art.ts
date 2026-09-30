import { contoursBBox, inflateBBox, transformContours, unionBBox, type Contour } from '../lottie/bezier';
import type { RGBA } from '../lottie/color';
import { paintFill, paintStroke, type Paint } from '../lottie/paint';
import {
  contourShapes,
  gradientFill,
  gradientStroke,
  group,
  solidFill,
  solidStroke,
  type GradientStop,
  type StrokeOptions,
} from '../lottie/shapes';
import type { BBox, Matrix, ShapeItem } from '../lottie/types';

/** Paint as it appears in the source artwork (absolute gradient coordinates). */
export type ArtPaint =
  | { type: 'solid'; color: RGBA }
  | { type: 'linear' | 'radial'; stops: GradientStop[]; start: [number, number]; end: [number, number] };

export interface ArtStroke {
  paint: ArtPaint;
  width: number;
  cap: 1 | 2 | 3;
  join: 1 | 2 | 3;
  miter: number;
}

export interface ArtItem {
  contours: Contour[];
  fill: ArtPaint | null;
  stroke: ArtStroke | null;
  evenOdd: boolean;
  /** 0..1 */
  opacity: number;
}

/** Resolution-independent vector artwork (converted text or an imported SVG logo). */
export interface VectorArt {
  kind: 'text' | 'logo';
  items: ArtItem[];
  /** Visual bounds including native strokes. */
  bbox: BBox;
  /** Minimum height used when fitting (keeps short glyphs like "-" from being blown up). */
  minFitHeight?: number;
}

export function artBBox(items: readonly ArtItem[]): BBox | null {
  let box: BBox | null = null;
  for (const it of items) {
    const b = contoursBBox(it.contours);
    if (!b) continue;
    box = unionBBox(box, it.stroke ? inflateBBox(b, it.stroke.width / 2) : b);
  }
  return box;
}

function transformPaint(p: ArtPaint, m: Matrix): ArtPaint {
  if (p.type === 'solid') return p;
  const tp = (pt: [number, number]): [number, number] => [m[0] * pt[0] + m[2] * pt[1] + m[4], m[1] * pt[0] + m[3] * pt[1] + m[5]];
  return { ...p, start: tp(p.start), end: tp(p.end) };
}

/**
 * Scales and centres artwork so it fits a `w × h` box centred at (0, 0).
 * `userScale` multiplies the fitted size (the "Size" slider).
 */
export function fitArt(art: VectorArt, w: number, h: number, userScale = 1): { items: ArtItem[]; scale: number; bbox: BBox } {
  const b = art.bbox;
  const fitH = Math.max(b.h, art.minFitHeight ?? 0);
  const s = Math.min(w / Math.max(b.w, 1e-6), h / Math.max(fitH, 1e-6)) * userScale;
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const m: Matrix = [s, 0, 0, s, -cx * s, -cy * s];
  const items = art.items.map((it) => ({
    ...it,
    contours: transformContours(it.contours, m),
    fill: it.fill && transformPaint(it.fill, m),
    stroke: it.stroke && { ...it.stroke, width: it.stroke.width * s, paint: transformPaint(it.stroke.paint, m) },
  }));
  return { items, scale: s, bbox: { x: -b.w * s / 2, y: -b.h * s / 2, w: b.w * s, h: b.h * s } };
}

export interface ArtStyle {
  /** `original` keeps the artwork colours, `paint` recolours everything with `fill`. */
  mode: 'original' | 'paint';
  fill: Paint;
  outline: Paint | null;
  /** Visible outline thickness in canvas px. */
  outlineWidth: number;
  digits?: number;
}

function artPaintFill(p: ArtPaint, opacity: number, evenOdd: boolean): ShapeItem {
  if (p.type === 'solid') return solidFill(p.color, opacity * p.color[3], evenOdd);
  return gradientFill(p.stops, { type: p.type, start: p.start, end: p.end }, opacity, evenOdd);
}

function artPaintStroke(p: ArtPaint, opts: StrokeOptions, opacity: number): ShapeItem {
  if (p.type === 'solid') return solidStroke(p.color, { ...opts, opacity: opacity * p.color[3] });
  return gradientStroke(p.stops, { type: p.type, start: p.start, end: p.end }, { ...opts, opacity });
}

/**
 * Converts fitted artwork into Lottie shape items.
 * The outline ("sticker border") is a stroke drawn *behind* the artwork, so only its outer half is visible.
 */
export function artToShapes(items: readonly ArtItem[], bbox: BBox, style: ArtStyle): ShapeItem[] {
  const digits = style.digits ?? 1;
  const groups: ShapeItem[] = [];

  for (const it of items) {
    const paths = contourShapes(it.contours, digits);
    if (!paths.length) continue;
    const styleItems: ShapeItem[] = [];
    const op = Math.round(it.opacity * 100);
    if (style.mode === 'paint') {
      if (it.fill) styleItems.push(paintFill(style.fill, bbox, op, it.evenOdd, 'textFill'));
      if (it.stroke) {
        styleItems.push(paintStroke(style.fill, bbox, { width: it.stroke.width, cap: it.stroke.cap, join: it.stroke.join, miter: it.stroke.miter, opacity: op }, 'textFill'));
      }
    } else {
      // Lottie draws earlier style items on top: SVG paints fill first, then stroke over it.
      if (it.stroke) {
        styleItems.push(artPaintStroke(it.stroke.paint, { width: it.stroke.width, cap: it.stroke.cap, join: it.stroke.join, miter: it.stroke.miter }, op));
      }
      if (it.fill) styleItems.push(artPaintFill(it.fill, op, it.evenOdd));
    }
    if (!styleItems.length) continue;
    groups.push(group([...paths, ...styleItems]));
  }

  // Later SVG elements are painted on top; in Lottie the first item is on top.
  groups.reverse();

  if (style.outline && style.outlineWidth > 0) {
    const ow = style.outlineWidth * 2;
    const filled = items.filter((it) => it.fill && !it.stroke);
    const stroked = items.filter((it) => it.stroke);
    const outlineGroups: ShapeItem[] = [];
    if (filled.length) {
      outlineGroups.push(
        group([...filled.flatMap((it) => contourShapes(it.contours, digits)), paintStroke(style.outline, bbox, { width: ow, cap: 2, join: 2 }, 'textOutline')]),
      );
    }
    for (const it of stroked) {
      outlineGroups.push(
        group([...contourShapes(it.contours, digits), paintStroke(style.outline, bbox, { width: it.stroke!.width + ow, cap: 2, join: 2 }, 'textOutline')]),
      );
    }
    groups.push(...outlineGroups);
  }

  return groups;
}
