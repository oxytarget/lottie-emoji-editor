import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'opentype.js/dist/opentype.mjs';
import { describe, expect, it } from 'vitest';
import { textToArt } from '../content/text';
import {
  gradientBoxOf,
  gradientPoints,
  gradientStops,
  paintCss,
  paintFill,
  paintStroke,
  resetGradientShape,
  rotateGradient,
  snapPoints,
  solid,
  stripGradientClasses,
  toggleRadial,
  withPoints,
  type GradientPaint,
} from '../lottie/paint';
import { compileAll, compileOne } from '../state/compile';
import { withPaint } from '../state/gradients';
import { BUILTIN_TEMPLATES } from '../templates/builtin';

const box = { x: 10, y: 20, w: 100, h: 50 };
const lin: GradientPaint = { type: 'linear', colors: ['#000000', '#ffffff'], angle: 90 };
const close = (a: number[], b: number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 3));

describe('gradient shape', () => {
  it('reads the default spread as handles relative to the painted area', () => {
    const d = gradientPoints(lin, box);
    close(d.from, [0.5, 0]);
    close(d.to, [0.5, 1]);
    const r = gradientPoints({ type: 'radial', colors: lin.colors }, box);
    close(r.from, [0.5, 0.5]);
    close(r.to, [1, 0.5]);
  });

  it('draws the handles where they were put, on any area', () => {
    const p = withPoints(lin, [0, 0], [1, 1]);
    const gf = paintFill(p, box) as unknown as { s: { k: number[] }; e: { k: number[] } };
    expect(gf.s.k).toEqual([10, 20]);
    expect(gf.e.k).toEqual([110, 70]);
    const other = paintFill(p, { x: 0, y: 0, w: 10, h: 10 }) as unknown as { e: { k: number[] } };
    expect(other.e.k).toEqual([10, 10]);
  });

  it('pulls the second colour towards the first when the gradient is weaker', () => {
    expect(gradientStops(lin)).toEqual(['#000000', '#ffffff']);
    expect(gradientStops({ ...lin, strength: 0.5 })).toEqual(['#000000', '#808080']);
    expect(gradientStops({ ...lin, strength: 0 })).toEqual(['#000000', '#000000']);
    const gf = paintFill({ ...lin, strength: 0.5 }, box) as unknown as { g: { k: { k: number[] } } };
    expect(gf.g.k.k.slice(4, 8).map((v) => Math.round(v * 255))).toEqual([255, 128, 128, 128]);
    expect(paintCss({ ...lin, strength: 0.5 })).toBe('linear-gradient(180deg, #000000, #808080)');
  });

  it('keeps the angle in step with the handles, turns and switches type without losing them', () => {
    const p = withPoints(lin, [0, 0.5], [1, 0.5]);
    expect(p).toMatchObject({ angle: 0, from: [0, 0.5], to: [1, 0.5] });
    const turned = rotateGradient(p, 90);
    close(turned.from!, [0.5, 0]);
    close(turned.to!, [0.5, 1]);
    expect(turned.type === 'linear' && turned.angle).toBe(90);
    expect(rotateGradient(lin, 45)).toMatchObject({ angle: 135 });

    const radial = toggleRadial({ ...p, strength: 0.4 });
    expect(radial).toEqual({ type: 'radial', colors: lin.colors, from: [0, 0.5], to: [1, 0.5], strength: 0.4 });
    expect(toggleRadial(radial)).toMatchObject({ type: 'linear', from: [0, 0.5], strength: 0.4 });
    expect(resetGradientShape(radial)).toEqual({ type: 'radial', colors: lin.colors });
  });

  it('straightens nearly level or upright handles', () => {
    expect(snapPoints([0, 0.5], [1, 0.53], 'to')).toEqual({ from: [0, 0.5], to: [1, 0.5] });
    expect(snapPoints([0.52, 0], [0.5, 1], 'from')).toEqual({ from: [0.5, 0], to: [0.5, 1] });
    expect(snapPoints([0, 0], [1, 1], 'to')).toEqual({ from: [0, 0], to: [1, 1] });
  });
});

describe('gradient handles in the preview', () => {
  it('tags gradients of user paints with the painted area, and only gradients', () => {
    const gf = paintFill(lin, box, 100, false, 'body');
    expect(gf.cl).toBe('pg-body pgb_10_20_100_50');
    expect(gradientBoxOf(String(gf.cl))).toEqual(box);
    expect(paintStroke(lin, { x: -5.5, y: 0, w: 1, h: 2 }, { width: 3 }, 'textOutline').cl).toBe('pg-textOutline pgb_-5.5_0_1_2');
    expect(paintFill(solid('#ff0000'), box, 100, false, 'body').cl).toBeUndefined();
    expect(stripGradientClasses(JSON.stringify([gf, { cl: 'emoji-content' }]))).not.toContain('pg-');
  });

  const face = (name: string) => {
    const buf = readFileSync(resolve(__dirname, '../../node_modules/@fontsource/nunito/files', name));
    return parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
  };
  const font = { id: 'nunito', faces: [face('nunito-latin-900-normal.woff')] };
  const art = textToArt(font, { text: 'Hi', letterSpacing: 0, lineHeight: 1, uppercase: false }).art!;
  const input = {
    art,
    artStyle: { mode: 'paint' as const, fill: withPoints(lin, [0, 0], [1, 1]), outline: solid('#111111'), outlineWidth: 8 },
    colors: { body: { type: 'radial' as const, colors: ['#7c3aed', '#22d3ee'] as [string, string] }, outline: solid('#1e1b4b'), accent: solid('#f97316') },
    outlineWidth: 12,
    scale: 1,
    offsetY: 0,
    offsetX: 0,
    rotation: 0,
    imports: [],
  };

  it('keeps editor classes out of the exported animation (and its size check)', () => {
    const out = compileAll(input).find((o) => o.id === BUILTIN_TEMPLATES[0].id)!;
    expect(out.json).not.toContain('pg-');
    expect(out.preview).toContain('"cl":"pg-textFill pgb_');
    expect(out.preview).toContain('"cl":"pg-body pgb_');
    expect(JSON.parse(out.preview!)).toBeTruthy();
  });

  it('previews a dragged gradient instantly on its own', () => {
    const moved = withPoints(lin, [1, 0], [0, 1]);
    const json = compileOne(withPaint(input, 'textFill', moved), BUILTIN_TEMPLATES[0].id)!;
    expect(json).toContain('pg-textFill');
    expect(withPaint(input, 'body', moved).colors.body).toBe(moved);
    expect(withPaint({ ...input, artStyle: { ...input.artStyle, outline: null } }, 'textOutline', moved).artStyle.outline).toBeNull();
  });
});
