import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'opentype.js/dist/opentype.mjs';
import { describe, expect, it } from 'vitest';
import { artToShapes, fitArt } from '../content/art';
import { svgToArt, parseTransform, parseCss } from '../content/svg';
import { textToArt } from '../content/text';
import { contourToBezier, contoursBBox, parsePathData } from '../lottie/bezier';
import { solid } from '../lottie/paint';

const fontFile = (name: string) => {
  const buf = readFileSync(resolve(__dirname, '../../node_modules/@fontsource/nunito/files', name));
  return parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
};

describe('bezier', () => {
  it('converts a closed square to 4 vertices with zero tangents', () => {
    const [c] = parsePathData('M0 0H10V10H0Z');
    const b = contourToBezier(c);
    expect(b.c).toBe(true);
    expect(b.v).toEqual([[0, 0], [10, 0], [10, 10], [0, 10]]);
    expect(b.i.flat().every((n) => n === 0)).toBe(true);
  });

  it('computes tight bounds of arcs', () => {
    const cs = parsePathData('M0 50A50 50 0 1 0 100 50A50 50 0 1 0 0 50Z');
    const bb = contoursBBox(cs)!;
    expect(bb.x).toBeCloseTo(0, 1);
    expect(bb.y).toBeCloseTo(0, 1);
    expect(bb.w).toBeCloseTo(100, 1);
    expect(bb.h).toBeCloseTo(100, 1);
  });

  it('merges the closing vertex when the path returns to its start', () => {
    const [c] = parsePathData('M0 0C5 -5 10 -5 10 0C10 5 0 5 0 0Z');
    const b = contourToBezier(c);
    expect(b.v.length).toBe(2);
    expect(b.i[0]).toEqual([0, 5]);
  });
});

describe('text', () => {
  const font = { id: 'nunito', faces: [fontFile('nunito-latin-900-normal.woff'), fontFile('nunito-cyrillic-900-normal.woff')] };

  it('renders latin + cyrillic using fallback faces', () => {
    const { art, missing } = textToArt(font, { text: 'Hi Їжак', letterSpacing: 0, lineHeight: 1.1, uppercase: false });
    expect(missing).toEqual([]);
    expect(art).not.toBeNull();
    expect(art!.items[0].contours.length).toBeGreaterThan(6);
    expect(art!.bbox.w).toBeGreaterThan(art!.bbox.h);
  });

  it('reports characters no face can render', () => {
    const { missing } = textToArt(font, { text: 'ok😀', letterSpacing: 0, lineHeight: 1, uppercase: false });
    expect(missing).toEqual(['😀']);
  });

  it('fits into a slot centred at 0,0', () => {
    const { art } = textToArt(font, { text: 'TOP\nqqq', letterSpacing: 0.02, lineHeight: 1, uppercase: false });
    const fitted = fitArt(art!, 200, 100);
    expect(fitted.bbox.w).toBeLessThanOrEqual(200.01);
    expect(fitted.bbox.h).toBeLessThanOrEqual(100.01);
    const bb = contoursBBox(fitted.items[0].contours)!;
    expect(bb.x + bb.w / 2).toBeCloseTo(0, 3);
    expect(bb.y + bb.h / 2).toBeCloseTo(0, 3);
    const shapes = artToShapes(fitted.items, fitted.bbox, { mode: 'paint', fill: solid('#ffffff'), outline: solid('#000000'), outlineWidth: 6 });
    expect(shapes).toHaveLength(2);
    expect((shapes[1].it as { ty: string }[]).some((s) => s.ty === 'st')).toBe(true);
  });
});

describe('svg import', () => {
  it('parses transforms', () => {
    expect(parseTransform('translate(10 20) scale(2)')).toEqual([2, 0, 0, 2, 10, 20]);
  });

  it('orders css rules by specificity', () => {
    const rules = parseCss('#a{fill:red} .b{fill:blue} path{fill:green} @media print{.x{fill:pink}}');
    expect(rules.map((r) => r.selector)).toEqual(['path', '.b', '#a']);
  });

  it('handles classes, shapes, use, gradients and opacity', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 100 100">
      <defs>
        <style>.cls-1{fill:#e30613;} .cls-2{fill:url(#g);}</style>
        <linearGradient id="base"><stop offset="0" stop-color="#fff"/><stop offset="1" style="stop-color:#000"/></linearGradient>
        <linearGradient id="g" xlink:href="#base" x1="0" x2="0" y1="0" y2="1"/>
        <circle id="dot" r="5"/>
      </defs>
      <g transform="translate(10 10)" opacity="0.5">
        <rect class="cls-1" width="20" height="10" rx="2"/>
        <path class="cls-2" d="M30 0h20v20h-20z"/>
      </g>
      <use href="#dot" x="80" y="80" fill="#00ff00"/>
      <line x1="0" y1="100" x2="100" y2="100" stroke="blue" stroke-width="4"/>
      <text x="0" y="0">Hi</text>
    </svg>`;
    const res = svgToArt(svg);
    expect(res.error).toBeUndefined();
    expect(res.warnings).toContain('text');
    const items = res.art!.items;
    expect(items).toHaveLength(4);
    expect(items[0].fill).toMatchObject({ type: 'solid' });
    expect((items[0].fill as { color: number[] }).color[0]).toBeCloseTo(0xe3 / 255, 3);
    expect(items[0].opacity).toBe(0.5);
    const grad = items[1].fill as { type: string; start: number[]; end: number[]; stops: unknown[] };
    expect(grad.type).toBe('linear');
    expect(grad.stops).toHaveLength(2);
    // objectBoundingBox (0,0)→(0,1) of the square at x 40..60, y 10..30
    expect(grad.start).toEqual([40, 10]);
    expect(grad.end).toEqual([40, 30]);
    const dot = contoursBBox(items[2].contours)!;
    expect(dot.x + dot.w / 2).toBeCloseTo(80, 3);
    expect(items[3].fill).toBeNull();
    expect(items[3].stroke!.width).toBe(4);
  });

  it('reports empty documents', () => {
    expect(svgToArt('<svg xmlns="http://www.w3.org/2000/svg"></svg>').error).toBe('empty');
    expect(svgToArt('not svg at all').error).toBe('parse');
  });
});
