import { hexToRgba, toHex, type RGBA } from './color';
import { gradientFill, gradientStroke, solidFill, solidStroke, type GradientGeometry, type GradientStop, type StrokeOptions } from './shapes';
import type { BBox, ShapeItem } from './types';

/** Point relative to the painted area: [0, 0] is its top-left corner, [1, 1] the bottom-right one. */
export type Pt = [number, number];

/**
 * Set by dragging the gradient on the canvas. Without `from`/`to` a linear gradient spans the area along
 * `angle` and a radial one fills it from the centre. For radial gradients `from` is the centre and `to` a
 * point on the edge.
 */
interface GradientShape {
  from?: Pt;
  to?: Pt;
  /** How strong the gradient is, 0–1: at 0 it is flat (only the first colour), at 1 (default) it goes all the way to the second. */
  strength?: number;
}

export type LinearPaint = { type: 'linear'; colors: [string, string]; angle: number } & GradientShape;
export type RadialPaint = { type: 'radial'; colors: [string, string] } & GradientShape;
export type GradientPaint = LinearPaint | RadialPaint;

/** A user-editable paint: a flat colour or a two-colour gradient. */
export type Paint = { type: 'solid'; color: string } | GradientPaint;

export const solid = (color: string): Paint => ({ type: 'solid', color });

export function primaryColor(p: Paint): string {
  return p.type === 'solid' ? p.color : p.colors[0];
}

export function paintColors(p: Paint): string[] {
  return p.type === 'solid' ? [p.color] : [...p.colors];
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export function mixHex(a: string, b: string, k: number): string {
  const ca = hexToRgba(a);
  const cb = hexToRgba(b);
  return toHex([0, 1, 2].map((i) => ca[i] + (cb[i] - ca[i]) * k).concat(1));
}

/** The two colours actually drawn (the second one is pulled towards the first by `strength`). */
export function gradientStops(p: GradientPaint): [string, string] {
  const s = clamp01(p.strength ?? 1);
  return [p.colors[0], s === 1 ? p.colors[1] : mixHex(p.colors[0], p.colors[1], s)];
}

/** CSS background preview of a paint (used by UI swatches). */
export function paintCss(p: Paint): string {
  if (p.type === 'solid') return p.color;
  const [a, b] = gradientStops(p);
  if (p.type === 'linear') {
    const deg = p.from && p.to ? (Math.atan2(p.to[1] - p.from[1], p.to[0] - p.from[0]) * 180) / Math.PI : p.angle;
    return `linear-gradient(${Math.round(deg + 90)}deg, ${a}, ${b})`;
  }
  const at = p.from ? ` at ${Math.round(p.from[0] * 100)}% ${Math.round(p.from[1] * 100)}%` : '';
  return `radial-gradient(circle${at}, ${a}, ${b})`;
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

const side = (v: number) => (Math.abs(v) < 1e-6 ? 1 : v);

/** Start/end of a gradient relative to `box` (its handles on the canvas). */
export function gradientPoints(p: GradientPaint, box: BBox): { from: Pt; to: Pt } {
  if (p.from && p.to) return { from: p.from, to: p.to };
  const g = p.type === 'linear' ? linearGeometry(box, p.angle) : radialGeometry(box);
  const rel = (q: number[]): Pt => [(q[0] - box.x) / side(box.w), (q[1] - box.y) / side(box.h)];
  return { from: rel(g.start), to: rel(g.end) };
}

function geometryOf(p: GradientPaint, box: BBox): GradientGeometry {
  if (!p.from || !p.to) return p.type === 'linear' ? linearGeometry(box, p.angle) : radialGeometry(box);
  const abs = (q: Pt): [number, number] => [box.x + q[0] * box.w, box.y + q[1] * box.h];
  const start = abs(p.from);
  const end = abs(p.to);
  // A zero-length gradient draws nothing in some players.
  if (Math.hypot(end[0] - start[0], end[1] - start[1]) < 0.5) end[0] = start[0] + 0.5;
  return { type: p.type, start, end };
}

function stopsOf(p: GradientPaint): GradientStop[] {
  return gradientStops(p).map((c, i) => ({ offset: i, color: hexToRgba(c) as RGBA }));
}

/**
 * Preview-only classes on gradient fills/strokes of the user's paints: which paint it is (`pg-<target>`) and
 * the area it spans (`pgb_x_y_w_h`), so the canvas can put handles on the rendered gradient. Exports strip
 * them (`stripGradientClasses`).
 */
export const GRADIENT_CLASS = 'pg-';
const GRADIENT_BOX = 'pgb_';

function tagged(item: ShapeItem, tag: string | undefined, box: BBox): ShapeItem {
  if (!tag) return item;
  const nums = [box.x, box.y, box.w, box.h].map((n) => String(Math.round(n * 100) / 100));
  // Last key, so exports can strip it with a simple pattern.
  return { ...item, cl: `${GRADIENT_CLASS}${tag} ${GRADIENT_BOX}${nums.join('_')}` };
}

/** The area a tagged gradient spans, read back from its classes. */
export function gradientBoxOf(className: string | null): BBox | null {
  const m = className?.match(/(?:^|\s)pgb_(-?[\d.]+)_(-?[\d.]+)_(-?[\d.]+)_(-?[\d.]+)/);
  return m ? { x: Number(m[1]), y: Number(m[2]), w: Number(m[3]), h: Number(m[4]) } : null;
}

export function stripGradientClasses(json: string): string {
  return json.replace(/,"cl":"pg-[^"]*"/g, '');
}

/**
 * Lottie fill item for a paint. `box` is the area the gradient should span (in the same space as the paths).
 * `tag` names the paint for the canvas gradient editor.
 */
export function paintFill(p: Paint, box: BBox, opacity = 100, evenOdd = false, tag?: string): ShapeItem {
  if (p.type === 'solid') return solidFill(p.color, opacity, evenOdd);
  return tagged(gradientFill(stopsOf(p), geometryOf(p, box), opacity, evenOdd), tag, box);
}

export function paintStroke(p: Paint, box: BBox, opts: StrokeOptions, tag?: string): ShapeItem {
  if (p.type === 'solid') return solidStroke(p.color, opts);
  return tagged(gradientStroke(stopsOf(p), geometryOf(p, box), opts), tag, box);
}

/** The gradient with new handle positions (a linear one also keeps a matching `angle` for previews). */
export function withPoints(p: GradientPaint, from: Pt, to: Pt): GradientPaint {
  const r = (v: number) => Math.round(v * 1000) / 1000;
  const f: Pt = [r(from[0]), r(from[1])];
  const t: Pt = [r(to[0]), r(to[1])];
  if (p.type === 'radial') return { ...p, from: f, to: t };
  const angle = Math.round((Math.atan2(t[1] - f[1], t[0] - f[0]) * 180) / Math.PI);
  return { ...p, from: f, to: t, angle: (angle + 360) % 360 };
}

/** Turns the gradient by `deg` around the middle of its handles (or just its angle while it has none). */
export function rotateGradient(p: GradientPaint, deg: number): GradientPaint {
  if (!p.from || !p.to) return p.type === 'linear' ? { ...p, angle: (p.angle + deg + 360) % 360 } : p;
  const a = (deg * Math.PI) / 180;
  const [cx, cy] = p.type === 'radial' ? p.from : [(p.from[0] + p.to[0]) / 2, (p.from[1] + p.to[1]) / 2];
  const turn = (q: Pt): Pt => [cx + (q[0] - cx) * Math.cos(a) - (q[1] - cy) * Math.sin(a), cy + (q[0] - cx) * Math.sin(a) + (q[1] - cy) * Math.cos(a)];
  return withPoints(p, turn(p.from), turn(p.to));
}

/** Linear ↔ radial, keeping the colours, handles and strength. */
export function toggleRadial(p: GradientPaint): GradientPaint {
  const { from, to, strength, colors } = p;
  const shape = { ...(from && to ? { from, to } : {}), ...(strength !== undefined ? { strength } : {}) };
  return p.type === 'radial' ? { type: 'linear', colors, angle: 90, ...shape } : { type: 'radial', colors, ...shape };
}

/** Back to the default spread (handles and strength forgotten). */
export function resetGradientShape(p: GradientPaint): GradientPaint {
  const { from: _f, to: _t, strength: _s, ...rest } = p;
  return rest as GradientPaint;
}

/** Straightens a nearly horizontal/vertical handle (dragging `moved`) so level gradients are easy to make. */
export function snapPoints(from: Pt, to: Pt, moved: 'from' | 'to', aspect = 1): { from: Pt; to: Pt } {
  const dx = (to[0] - from[0]) * aspect;
  const dy = to[1] - from[1];
  const deg = Math.abs((Math.atan2(dy, dx) * 180) / Math.PI) % 90;
  if (deg > 4 && deg < 86) return { from, to };
  const level = Math.abs(dx) > Math.abs(dy);
  const fixed = moved === 'to' ? from : to;
  const snap = (q: Pt): Pt => (level ? [q[0], fixed[1]] : [fixed[0], q[1]]);
  return moved === 'to' ? { from, to: snap(to) } : { from: snap(from), to };
}
