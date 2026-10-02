import { describe, expect, it } from 'vitest';
import { applyLayoutOp, removalTarget, slotForRun } from '../lottie/layout';
import { analyzePack } from '../lottie/packs';
import { applyPartEdits, flattenParts, listParts, partBounds } from '../lottie/parts';
import type { Layer, LottieAnimation, ShapeItem } from '../lottie/types';

const st = (k: unknown) => ({ a: 0, k });
const tr = (p = [0, 0], s = [100, 100]) => ({ ty: 'tr', p: st(p), a: st([0, 0]), s: st(s), r: st(0), o: st(100) });
const layer = (ind: number, nm: string, shapes: ShapeItem[], p = [256, 256, 0]): Layer =>
  ({ ddd: 0, ind, ty: 4, nm, sr: 1, ks: { o: st(100), r: st(0), p: st(p), a: st([0, 0, 0]), s: st([100, 100, 100]) }, ao: 0, ip: 0, op: 120, st: 0, bm: 0, shapes }) as Layer;
const anim = (layers: Layer[]): LottieAnimation => ({ v: '5.7.4', fr: 60, ip: 0, op: 120, w: 512, h: 512, nm: 't', ddd: 0, assets: [], layers });

/** Letters of a made-up logo: different outlines, placed side by side (scaled by `k`, moved by x, y). */
const LETTERS = [
  [[0, 0], [10, 0], [10, 30], [0, 30]],
  [[0, 0], [20, 0], [20, 10], [8, 10], [8, 30], [0, 30]],
  [[0, 30], [10, 0], [20, 30], [14, 30], [10, 16], [6, 30]],
  [[0, 0], [20, 0], [20, 30], [0, 30], [0, 22], [12, 22], [12, 8], [0, 8]],
];
const letter = (n: number, k: number, x: number, y: number): ShapeItem => {
  const pts = LETTERS[n].map(([a, b]) => [x + (a + n * 26) * k, y + b * k]);
  return { ty: 'sh', ks: st({ c: true, v: pts, i: pts.map(() => [0, 0]), o: pts.map(() => [0, 0]) }) };
};
const fill = (rgb: number[]): ShapeItem => ({ ty: 'fl', c: st([...rgb, 1]), o: st(100) });
const letterGroup = (n: number, k: number, x: number, y: number): ShapeItem => ({ ty: 'gr', nm: `Group ${n + 5}`, it: [letter(n, k, x, y), fill([1, 1, 1]), tr()] });
const body = (w: number, h: number, extra: ShapeItem[] = []): ShapeItem => ({ ty: 'gr', nm: 'Group 1', it: [{ ty: 'el', p: st([0, 0]), s: st([w, h]) }, ...extra, fill([0.9, 0.2, 0.3]), tr()] });

describe('logo drawn next to the body in one layer', () => {
  // Every sticker: a different body, the same 4-letter logo at another size and place, all in one layer.
  const pack = () =>
    [1, 1.4, 0.8, 1.2].map((k, i) =>
      anim([
        layer(1, 'Art', [body(160 + i * 40, 140 - i * 10), ...[0, 1, 2, 3].map((n) => letterGroup(n, k, -50 + i * 6, 20 - i * 5))]),
        layer(2, 'Back', [body(400 - i * 30, 300 + i * 12)]),
      ]),
    );

  it('finds the letters as one logo, not one letter', () => {
    const picks = analyzePack(pack());
    for (const pick of picks) {
      expect(pick.shared).toBe(true);
      expect(pick.run).toEqual({ container: 'l0', items: [1, 2, 3, 4] });
      expect(pick.hidden).toEqual(['l0/g1', 'l0/g2', 'l0/g3', 'l0/g4']);
    }
  });

  it('puts a slot exactly where the letters were', () => {
    const src = pack()[1];
    const run = analyzePack(pack())[1].run!;
    const op = slotForRun(src, run, '★ Ваш текст')!;
    // The layer's list has no fills of its own: the slot goes right above the letters.
    expect(op).toMatchObject({ kind: 'insert', at: { parent: 'l0', index: 1 } });
    const data = structuredClone(src);
    const slot = applyLayoutOp(data, op, () => null)!;
    expect(slot).toBe('l0/g1');
    const before = partBounds(src, 'l0', 0, run.items)!;
    const after = partBounds(data, slot, 0)!;
    for (const k of ['x', 'y', 'w', 'h'] as const) expect(after[k]).toBeCloseTo(before[k], 0);
    expect(flattenParts(listParts(data)).find((p) => p.id === slot)?.slot).toBe(true);
  });
});

describe('logo paths sharing the body fill', () => {
  // The letters are paths in the body's own group (one fill paints both); the group bounces.
  const bounce = { a: 1, k: [{ t: 0, s: [0, 0], o: { x: [0.4], y: [0] }, i: { x: [0.6], y: [1] } }, { t: 60, s: [0, -40] }, { t: 120, s: [0, 0] }] };
  const sticker = (k: number, w: number) => {
    const g = body(w, 160, [0, 1, 2, 3].map((n) => letter(n, k, -40, -10)));
    (g.it as ShapeItem[])[(g.it as ShapeItem[]).length - 1] = { ...tr(), p: bounce } as ShapeItem;
    return anim([layer(1, 'Art', [g])]);
  };
  const pack = () => [sticker(1, 200), sticker(1.3, 260), sticker(0.9, 180)];

  it('finds the paths, and the slot follows the bouncing group without taking its fill', () => {
    const src = pack()[0];
    const pick = analyzePack(pack())[0];
    expect(pick.run).toEqual({ container: 'l0/g0', items: [1, 2, 3, 4] });
    const op = slotForRun(src, pick.run!, '★ Ваш текст')!;
    // The group has a fill: the slot goes next to it, in a wrapper repeating its (animated) transform.
    expect(op).toMatchObject({ at: { parent: 'l0', index: 0 } });
    const data = structuredClone(src);
    const slot = applyLayoutOp(data, op, () => null)!;
    expect(slot).toBe('l0/g0/g0');
    for (const t of [0, 30, 60, 90]) {
      const before = partBounds(src, 'l0/g0', t, pick.run!.items)!;
      const after = partBounds(data, slot, t)!;
      expect(after.y).toBeCloseTo(before.y, 0);
      expect(after.w).toBeCloseTo(before.w, 0);
    }
    // The layer list shows the slot, not its wrapper; removing it takes the wrapper along.
    const ids = flattenParts(listParts(data)).map((p) => p.id);
    expect(ids).toContain(slot);
    expect(ids).not.toContain('l0/g0');
    expect(removalTarget(data, slot)).toBe('l0/g0');
    // Hiding the letters keeps the body.
    const hidden = applyPartEdits(data, { hidden: pick.hidden.map((id) => id.replace(/^l0\/g0/, 'l0/g1')) });
    const items = ((hidden.layers[0].shapes![1] as unknown as { it: ShapeItem[] }).it).map((it) => it.ty);
    expect(items).toEqual(['el', 'fl', 'tr']);
  });
});

describe('brand colours', async () => {
  const { brandColorMaps, hexToOklch, paintBrandColors } = await import('../lottie/brand');
  const hex = (c: number[]) => `#${c.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('')}`;
  const shape = (w: number, rgb: number[]): ShapeItem => ({ ty: 'gr', it: [{ ty: 'el', p: st([0, 0]), s: st([w, w]) }, fill(rgb), tr()] });
  const RED = [0.9, 0.22, 0.31];
  const SHADOW = [0.72, 0.16, 0.24];
  const LIGHT = [1, 0.48, 0.54];
  const sticker = () =>
    anim([
      layer(1, 'Art', [shape(30, [1, 1, 1]), shape(40, LIGHT), shape(60, SHADOW), shape(200, RED), { ty: 'gr', it: [{ ty: 'el', p: st([0, 0]), s: st([210, 210]) }, { ty: 'st', c: st([0.07, 0.07, 0.07, 1]), o: st(100), w: st(6) }, tr()] }]),
    ]);

  it('turns the body colour family into the brand colour, shades kept, greys untouched', () => {
    const [map] = brandColorMaps([sticker()], ['#1e88ff'])!;
    expect(Object.keys(map).sort()).toEqual([hex(LIGHT), hex(RED), hex(SHADOW)].sort());
    const main = hexToOklch(map[hex(RED)]);
    const brand = hexToOklch('#1e88ff');
    expect(Math.abs(main.h - brand.h)).toBeLessThan(6);
    expect(main.L).toBeCloseTo(brand.L, 1);
    // The shadow stays darker and the highlight lighter than the new body colour.
    expect(hexToOklch(map[hex(SHADOW)]).L).toBeLessThan(main.L);
    expect(hexToOklch(map[hex(LIGHT)]).L).toBeGreaterThan(main.L);
  });

  it('needs a colourful brand colour', () => {
    expect(brandColorMaps([sticker()], ['#ffffff', '#111111'])).toBeNull();
    expect(paintBrandColors([{ type: 'solid', color: '#ffffff' }, { type: 'solid', color: '#0057b7' }, { type: 'solid', color: '#ffd700' }])).toEqual(['#0057b7', '#ffd700']);
  });
});

describe('main colours of a pack', async () => {
  const { colorFamilies, familyColorMap, hexToOklch } = await import('../lottie/brand');
  const shape = (w: number, rgb: number[]): ShapeItem => ({ ty: 'gr', it: [{ ty: 'el', p: st([0, 0]), s: st([w, w]) }, fill(rgb), tr()] });
  const sticker = (k: number) => anim([layer(1, 'A', [shape(30, [1, 1, 1]), shape(50 * k, [0.72, 0.16, 0.24]), shape(200 * k, [0.9, 0.22, 0.31]), shape(60, [0.1, 0.5, 0.95]), shape(220 * k, [0.05, 0.05, 0.05])])]);

  it('lists hue families with their shades, and blacks / whites apart', () => {
    const families = colorFamilies([sticker(1), sticker(1.2)]);
    const red = families.find((f) => f.colors.length === 2)!;
    expect(red.colors.sort()).toEqual(['#b8293d', '#e6384f'].sort());
    expect(red.hex).toBe('#e6384f');
    expect(families.map((f) => f.hex)).toEqual(expect.arrayContaining(['#0d0d0d', '#ffffff', '#1a80f2']));
    expect(families[0].share).toBeGreaterThan(families[families.length - 1].share);
  });

  it('turns a family into the picked colour, the shade keeping its step', () => {
    const red = colorFamilies([sticker(1)]).find((f) => f.hex === '#e6384f')!;
    const map = familyColorMap(red, '#22aa55');
    expect(map['#e6384f']).toBe('#22aa55');
    expect(hexToOklch(map['#b8293d']).L).toBeLessThan(hexToOklch('#22aa55').L);
  });
});
