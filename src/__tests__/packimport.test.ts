import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'opentype.js/dist/opentype.mjs';
import { describe, expect, it } from 'vitest';
import { textToArt } from '../content/text';
import { compose } from '../lottie/compose';
import { checkTgs, toJson } from '../lottie/export';
import { normalizeForTgs } from '../lottie/imported';
import { analyzePack } from '../lottie/packs';
import { applyPartEdits, flattenParts, listParts, partBounds, stripPartClasses } from '../lottie/parts';
import { solid } from '../lottie/paint';
import type { Layer, LottieAnimation, ShapeItem } from '../lottie/types';
import { BUILTIN_TEMPLATES } from '../templates/builtin';

const face = (n: string) => {
  const b = readFileSync(resolve(__dirname, '../../node_modules/@fontsource/nunito/files', n));
  return parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
};
const font = { id: 'n', faces: [face('nunito-latin-900-normal.woff')] };
const art = (text: string) => textToArt(font, { text, letterSpacing: 0, lineHeight: 1, uppercase: false }).art!;
const artStyle = { mode: 'paint' as const, fill: solid('#ffffff'), outline: solid('#000000'), outlineWidth: 6 };
const colors = { body: solid('#7c3aed'), outline: solid('#111111'), accent: solid('#f59e0b') };

/** A pack made by an emoji generator: same text in every sticker, different characters and text sizes. */
const generatedPack = () =>
  [0, 2, 3, 5, 7].map((i, n) => compose({ template: BUILTIN_TEMPLATES[i], art: art('BRAND'), artStyle, colors, outlineWidth: 12, scale: 0.8 + n * 0.15, offsetY: 0 }));

const st = (k: unknown) => ({ a: 0, k });
const tr = (p = [0, 0], s = [100, 100]) => ({ ty: 'tr', p: st(p), a: st([0, 0]), s: st(s), r: st(0), o: st(100) });
const layer = (ind: number, nm: string, shapes: ShapeItem[], p = [256, 256, 0]): Layer =>
  ({ ddd: 0, ind, ty: 4, nm, sr: 1, ks: { o: st(100), r: st(0), p: st(p), a: st([0, 0, 0]), s: st([100, 100, 100]) }, ao: 0, ip: 0, op: 120, st: 0, bm: 0, shapes }) as Layer;
const anim = (layers: Layer[], extra: Partial<LottieAnimation> = {}): LottieAnimation => ({ v: '5.7.4', fr: 60, ip: 0, op: 120, w: 512, h: 512, nm: 't', ddd: 0, assets: [], layers, ...extra });

/** A zig-zag "logo" path (scaled by `k`, so the same logo can be baked at different sizes). */
const logoPath = (k: number, x = 0, y = 0): ShapeItem => {
  const pts = [[0, 0], [10, 20], [20, 0], [30, 20], [40, 0], [50, 20], [60, 0], [60, 30], [0, 30]].map(([a, b]) => [x + a * k, y + b * k]);
  return { ty: 'sh', ks: st({ c: true, v: pts, i: pts.map(() => [0, 0]), o: pts.map(() => [0, 0]) }) };
};
const logoGroup = (nm: string, k: number, x = 0, y = 0): ShapeItem => ({ ty: 'gr', nm, it: [logoPath(k, x, y), logoPath(k, x + 70 * k, y), { ty: 'fl', c: st([1, 1, 1, 1]), o: st(100) }, tr()] });
const blob = (w: number, h: number): ShapeItem => ({ ty: 'gr', nm: 'Body', it: [{ ty: 'el', p: st([0, 0]), s: st([w, h]) }, { ty: 'fl', c: st([1, 0, 0, 1]), o: st(100) }, tr()] });

describe('analyzePack', () => {
  it('finds the text shared by the stickers of a generated pack', () => {
    const pack = generatedPack();
    const picks = analyzePack(pack);
    picks.forEach((pick, i) => {
      expect(pick.shared).toBe(true);
      const part = flattenParts(listParts(pack[i])).find((p) => p.id === pick.replace)!;
      expect(part.name).toBe('content');
    });
  });

  it('finds a logo baked at different sizes and positions, and hides its outline copy', () => {
    const pack = [1, 1.5, 0.7].map((k, i) =>
      anim([
        layer(1, 'Art', [logoGroup('Outline', k, 3, 3), logoGroup('Fill', k), blob(100 + i * 60, 80 + i * 30)], [100 + i * 40, 260, 0]),
        layer(2, 'Background', [blob(400 - i * 50, 300)]),
      ]),
    );
    const picks = analyzePack(pack);
    for (const pick of picks) {
      expect(pick.shared).toBe(true);
      expect(['l0/g0', 'l0/g1']).toContain(pick.replace);
      expect(pick.hidden).toEqual([pick.replace === 'l0/g0' ? 'l0/g1' : 'l0/g0']);
    }
  });

  it('falls back to per-sticker guesses when nothing repeats', () => {
    const picks = analyzePack([anim([layer(1, 'Title', [logoGroup('A', 1)]), layer(2, 'Body', [blob(100, 100)])])]);
    expect(picks[0]).toEqual({ replace: 'l0', hidden: [], shared: false });
  });
});

describe('part transforms', () => {
  const base = () => anim([layer(1, 'Top', [logoGroup('Logo', 1), blob(120, 120)], [200, 200, 0]), layer(2, 'Child', [blob(50, 50)], [30, 0, 0])]);

  it('moves, scales and rotates a group around its centre', () => {
    const src = base();
    const before = partBounds(src, 'l0/g0')!;
    const moved = applyPartEdits(src, { hidden: [], transforms: { 'l0/g0': { x: 20, y: -10, scale: 2, rotation: 0 } } });
    const after = partBounds(moved, 'l0/g0')!;
    expect(after.w).toBeCloseTo(before.w * 2, 3);
    expect(after.x + after.w / 2).toBeCloseTo(before.x + before.w / 2 + 20, 3);
    expect(after.y + after.h / 2).toBeCloseTo(before.y + before.h / 2 - 10, 3);
    // Other parts do not move.
    expect(partBounds(moved, 'l0/g1')).toEqual(partBounds(src, 'l0/g1'));
  });

  it('moves a layer through a new null parent, keeping its own parent chain', () => {
    const src = base();
    src.layers[1].parent = 1;
    const before = partBounds(src, 'l1')!;
    const moved = applyPartEdits(src, { hidden: [], transforms: { l1: { x: -40, y: 25, scale: 0.5, rotation: 90 } } });
    expect(moved.layers).toHaveLength(3);
    expect(moved.layers[2].ty).toBe(3);
    expect(moved.layers[1].parent).toBe(moved.layers[2].ind);
    expect(moved.layers[2].parent).toBe(1);
    const after = partBounds(moved, 'l1')!;
    expect(after.w).toBeCloseTo(before.w * 0.5, 3);
    expect(after.x + after.w / 2).toBeCloseTo(before.x + before.w / 2 - 40, 3);
    expect(after.y + after.h / 2).toBeCloseTo(before.y + before.h / 2 + 25, 3);
  });

  it('tags parts with classes for the preview that exports strip again', () => {
    const src = base();
    const plain = toJson(applyPartEdits(src, { hidden: ['l1'] }));
    const tagged = toJson(applyPartEdits(src, { hidden: ['l1'], annotate: true }));
    expect(tagged).toContain('"cl":"pt-0"');
    expect(tagged).toContain('"cl":"pt-2"');
    expect(stripPartClasses(tagged)).toBe(plain);
  });
});

describe('normalizeForTgs', () => {
  it('scales a 100×100 custom emoji at 30 fps to a 512×512 sticker at 60 fps', () => {
    const src = anim(
      [
        {
          ...layer(1, 'Logo', [logoGroup('L', 0.5)], [50, 50, 0]),
          ip: 0,
          op: 60,
          ks: { o: st(100), r: { a: 1, k: [{ t: 0, s: [0] }, { t: 30, s: [90] }] }, p: st([50, 50, 0]), a: st([0, 0, 0]), s: st([100, 100, 100]) },
        } as Layer,
      ],
      { w: 100, h: 100, fr: 30, op: 60 },
    );
    const out = normalizeForTgs(src);
    expect([out.w, out.h, out.fr, out.op]).toEqual([512, 512, 60, 120]);
    expect(out.layers[0].op).toBe(120);
    expect((out.layers[0].ks.r as { k: Array<{ t: number }> }).k.map((kf) => kf.t)).toEqual([0, 60]);
    expect(partBounds(out, 'l0')!.w).toBeCloseTo(partBounds(src, 'l0')!.w * 5.12, 3);
    const check = checkTgs(out, 1000);
    expect(check.problems).toEqual([]);
  });
});
