import { hexToRgba, type RGBA } from './color';
import { gradientFill, gradientStroke, solidFill, solidStroke, type GradientGeometry, type GradientStop, type StrokeOptions } from './shapes';
import type { BBox, ShapeItem } from './types';

/** A user-editable paint: a flat colour or a two-colour gradient. */
export type Paint =
  | { type: 'solid'; color: string }
  | { type: 'linear'; colors: [string, string]; angle: number }
  | { type: 'radial'; colors: [string, string] };

export const solid = (color: string): Paint => ({ type: 'solid', color });

export function primaryColor(p: Paint): string {
  return p.type === 'solid' ? p.color : p.colors[0];
}

export function paintColors(p: Paint): string[] {
  return p.type === 'solid' ? [p.color] : [...p.colors];
}

/** CSS background preview of a paint (used by UI swatches). */
export function paintCss(p: Paint): string {
  if (p.type === 'solid') return p.color;
  if (p.type === 'linear') return `linear-gradient(${p.angle + 90}deg, ${p.colors[0]}, ${p.colors[1]})`;
  return `radial-gradient(circle, ${p.colors[0]}, ${p.colors[1]})`;
}

/** Gradient start/end points that span `box` along `angle` (0° = left → right, 90° = top → bottom). */
export function linearGeometry(box: BBox, angle: number): GradientGeometry {
  const a = (angle * Math.PI) / 180;
  const dx = Math.cos(a);
  const dy = Math.sin(a);
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const half = Math.abs((box.w / 2) * dx) + Math.abs((box.h / 2) * dy) || 1;
  return { type: 'linear', start: [cx - dx * half, cy - dy * half], end: [cx + dx * half, cy + dy * half] };
}

export function radialGeometry(box: BBox): GradientGeometry {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const r = Math.max(box.w, box.h) / 2 || 1;
  return { type: 'radial', start: [cx, cy], end: [cx + r, cy] };
}

function stopsOf(colors: readonly string[]): GradientStop[] {
  return colors.map((c, i) => ({ offset: colors.length === 1 ? 0 : i / (colors.length - 1), color: hexToRgba(c) as RGBA }));
}

function geometryOf(p: Exclude<Paint, { type: 'solid' }>, box: BBox): GradientGeometry {
  return p.type === 'linear' ? linearGeometry(box, p.angle) : radialGeometry(box);
}

/** Lottie fill item for a paint. `box` is the area the gradient should span (in the same space as the paths). */
export function paintFill(p: Paint, box: BBox, opacity = 100, evenOdd = false): ShapeItem {
  if (p.type === 'solid') return solidFill(p.color, opacity, evenOdd);
  return gradientFill(stopsOf(p.colors), geometryOf(p, box), opacity, evenOdd);
}

export function paintStroke(p: Paint, box: BBox, opts: StrokeOptions): ShapeItem {
  if (p.type === 'solid') return solidStroke(p.color, opts);
  return gradientStroke(stopsOf(p.colors), geometryOf(p, box), opts);
}
