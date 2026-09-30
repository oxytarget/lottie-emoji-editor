import { round } from '../lottie/anim';
import { pathShapes } from '../lottie/shapes';
import type { ShapeItem } from '../lottie/types';

/** Hand-drawn vector parts shared by templates. All paths are centred on (0, 0) unless stated otherwise. */

const f = (n: number) => round(n, 2);

/** Heart that fits a `w`-wide box, centred on its bounding box. */
export function heart(w: number): ShapeItem[] {
  const s = w / 92;
  // Base heart drawn in a 100×100 box: bounds x 4..96, y 6..88 → centre (50, 47).
  return pathShapes(
    'M50 88C20 66 4 50 4 31C4 16 16 6 29 6C39 6 46 12 50 20C54 12 61 6 71 6C84 6 96 16 96 31C96 50 80 66 50 88Z',
    [s, 0, 0, s, -50 * s, -47 * s],
  );
}

export function starPath(points: number, outer: number, inner: number, rotationDeg = -90): string {
  let d = '';
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = ((rotationDeg + (i * 180) / points) * Math.PI) / 180;
    d += `${i === 0 ? 'M' : 'L'}${f(Math.cos(a) * r)} ${f(Math.sin(a) * r)}`;
  }
  return `${d}Z`;
}

export function star(points: number, outer: number, inner: number, rotationDeg = -90): ShapeItem[] {
  return pathShapes(starPath(points, outer, inner, rotationDeg));
}

/** Four-point "twinkle" sparkle with concave sides. */
export function sparkle(r: number): ShapeItem[] {
  const k = r * 0.18;
  return pathShapes(`M0 ${-r}Q${k} ${-k} ${r} 0Q${k} ${k} 0 ${r}Q${-k} ${k} ${-r} 0Q${-k} ${-k} 0 ${-r}Z`);
}

/** Teardrop flame; base at (0, 0), tip pointing up at (0, -h). */
export function flame(w: number, h: number): ShapeItem[] {
  const hw = w / 2;
  return pathShapes(
    `M0 ${-h}C${f(hw * 0.35)} ${f(-h * 0.62)} ${hw} ${f(-h * 0.5)} ${hw} ${f(-h * 0.24)}` +
      `C${hw} ${f(-h * 0.06)} ${f(hw * 0.52)} 0 0 0C${f(-hw * 0.52)} 0 ${-hw} ${f(-h * 0.06)} ${-hw} ${f(-h * 0.24)}` +
      `C${-hw} ${f(-h * 0.5)} ${f(-hw * 0.35)} ${f(-h * 0.62)} 0 ${-h}Z`,
  );
}

/** Crown with three spikes; base centre at (0, 0), growing upwards. */
export function crown(w: number, h: number): ShapeItem[] {
  const hw = w / 2;
  return pathShapes(
    `M${-hw} 0L${-hw} ${f(-h * 0.72)}L${f(-hw * 0.48)} ${f(-h * 0.36)}L0 ${-h}L${f(hw * 0.48)} ${f(-h * 0.36)}L${hw} ${f(-h * 0.72)}L${hw} 0Z`,
  );
}

/** Lightning bolt that fits roughly a `size` tall box. */
export function bolt(size: number): ShapeItem[] {
  const s = size / 100;
  return pathShapes('M12 -50L-28 8L-2 8L-12 50L28 -8L2 -8Z', [s, 0, 0, s, 0, 0]);
}

/** Rounded speech bubble with a tail at the bottom-left. Box centred at (0, 0). */
export function bubble(w: number, h: number, r: number, tail: number): ShapeItem[] {
  const x = -w / 2;
  const y = -h / 2;
  return pathShapes(
    `M${x + r} ${y}H${x + w - r}Q${x + w} ${y} ${x + w} ${y + r}V${y + h - r}Q${x + w} ${y + h} ${x + w - r} ${y + h}` +
      `H${f(x + w * 0.42)}L${f(x + w * 0.16)} ${y + h + tail}L${f(x + w * 0.24)} ${y + h}H${x + r}Q${x} ${y + h} ${x} ${y + h - r}V${y + r}Q${x} ${y} ${x + r} ${y}Z`,
  );
}

/** Ribbon tail (behind a banner) with a V notch at its outer end. `dir` = -1 for left, 1 for right. */
export function ribbonTail(dir: -1 | 1, inner: number, outer: number, top: number, bottom: number): ShapeItem[] {
  const notch = outer - dir * 30;
  const mid = (top + bottom) / 2;
  return pathShapes(`M${dir * inner} ${top}L${dir * outer} ${top}L${dir * notch} ${mid}L${dir * outer} ${bottom}L${dir * inner} ${bottom}Z`);
}

/** `count` rounded rays between radii r1 and r2 (as one compound path). */
export function rays(count: number, r1: number, r2: number, width: number): ShapeItem[] {
  let d = '';
  for (let i = 0; i < count; i++) {
    const a = (i * 2 * Math.PI) / count - Math.PI / 2;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    const px = -sin * (width / 2);
    const py = cos * (width / 2);
    const bx = cos * r1;
    const by = sin * r1;
    const tx = cos * r2;
    const ty = sin * r2;
    d += `M${f(bx + px)} ${f(by + py)}L${f(tx + px * 0.35)} ${f(ty + py * 0.35)}Q${f(tx + cos * width * 0.3)} ${f(ty + sin * width * 0.3)} ${f(tx - px * 0.35)} ${f(ty - py * 0.35)}L${f(bx - px)} ${f(by - py)}Z`;
  }
  return pathShapes(d);
}

/** Open arc (stroke only), angles in degrees, y-down. */
export function arc(r: number, fromDeg: number, toDeg: number): ShapeItem[] {
  const a0 = (fromDeg * Math.PI) / 180;
  const a1 = (toDeg * Math.PI) / 180;
  const large = Math.abs(toDeg - fromDeg) > 180 ? 1 : 0;
  const sweep = toDeg > fromDeg ? 1 : 0;
  return pathShapes(`M${f(Math.cos(a0) * r)} ${f(Math.sin(a0) * r)}A${r} ${r} 0 ${large} ${sweep} ${f(Math.cos(a1) * r)} ${f(Math.sin(a1) * r)}`);
}

/** Deterministic pseudo random numbers so exports are reproducible. */
export function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
