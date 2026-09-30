import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'opentype.js/dist/opentype.mjs';
import { describe, expect, it } from 'vitest';
import { textToArt } from '../content/text';
import { compose } from '../lottie/compose';
import { solid } from '../lottie/paint';
import { checkTgs } from '../lottie/export';
import { applyPartEdits, flattenParts, isolatePart, listParts, partBounds, partFrame } from '../lottie/parts';
import type { Layer, LottieAnimation, ShapeItem } from '../lottie/types';
import { BUILTIN_TEMPLATES } from '../templates/builtin';

const face = (n: string) => {
  const b = readFileSync(resolve(__dirname, '../../node_modules/@fontsource/nunito/files', n));
  return parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
};
const font = { id: 'n', faces: [face('nunito-latin-900-normal.woff'), face('nunito-cyrillic-900-normal.woff')] };
const art = (text: string) => textToArt(font, { text, letterSpacing: 0, lineHeight: 1, uppercase: false }).art!;
const artStyle = { mode: 'paint' as const, fill: solid('#ffffff'), outline: solid('#000000'), outlineWidth: 6 };

/** An emoji made by this app — the imported file then contains a "content" layer with glyph outlines. */
const ownEmoji = () =>
  compose({
    template: BUILTIN_TEMPLATES[0],
    art: art('EMOJI'),
    artStyle,
    colors: { body: solid('#7c3aed'), outline: solid('#111111'), accent: solid('#f59e0b') },
    outlineWidth: 12,
    scale: 1,
    offsetY: 0,
  });

const st = (k: unknown) => ({ a: 0, k });
const ks = (p = [256, 256, 0]) => ({ o: st(100), r: st(0), p: st(p), a: st([0, 0, 0]), s: st([100, 100, 100]) });
const rectGroup = (nm: string, x: number, y: number, w: number, h: number): ShapeItem => ({
  ty: 'gr',
  nm,
  it: [
    { ty: 'rc', p: st([x, y]), s: st([w, h]), r: st(0) },
    { ty: 'fl', c: st([1, 0, 0, 1]), o: st(100) },
    { ty: 'tr', p: st([0, 0]), a: st([0, 0]), s: st([100, 100]), r: st(0), o: st(100) },
  ],
});
const layer = (ind: number, nm: string, extra: Partial<Layer> & Record<string, unknown>): Layer =>
  ({ ddd: 0, ind, ty: 4, nm, sr: 1, ks: ks(), ao: 0, ip: 0, op: 120, st: 0, bm: 0, ...extra }) as Layer;

/** Hand-made file with a precomp, a text layer, a matte and a layer wrapped in a single group. */
function fixture(): LottieAnimation {
  return {
    v: '5.7.4',
    fr: 60,
    ip: 0,
    op: 120,
    w: 512,
    h: 512,
    nm: 'fixture',
    ddd: 0,
    assets: [{ id: 'comp_0', w: 200, h: 200, layers: [layer(1, 'Logo', { shapes: [rectGroup('L', 10, 10, 20, 20)] }), layer(2, 'Circle', { shapes: [rectGroup('C', 0, 0, 50, 50)] })] }],
    layers: [
      layer(1, 'Badge comp', { ty: 0, refId: 'comp_0', w: 200, h: 200 }),
      layer(2, 'Title', { ty: 5, t: { d: { k: [{ s: { s: 40, t: 'HELLO', j: 2 }, t: 0 }] } } }),
      layer(3, 'Body', { shapes: [{ ty: 'gr', nm: 'Wrapper', it: [rectGroup('Hand', 0, 0, 40, 40), rectGroup('Face', 100, 0, 80, 80), { ty: 'tr', p: st([0, 0]), a: st([0, 0]), s: st([100, 100]), r: st(0), o: st(100) }] }] }),
      layer(4, 'Matte', { td: 1, shapes: [rectGroup('M', 0, 0, 300, 300)] }),
      layer(5, 'Masked', { tt: 1, shapes: [rectGroup('X', 0, 0, 100, 100)] }),
      layer(6, 'Rig', { ty: 3 }),
    ],
  };
}

describe('listParts', () => {
  it('finds the text layer of an emoji made by this app', () => {
    const parts = listParts(ownEmoji());
    const content = parts.find((p) => p.name === 'content')!;
    expect(content.kind).toBe('shape');
    expect(content.detected).toBe(true);
    expect(parts.find((p) => p.name === 'body')!.detected).toBe(false);
    expect(parts.find((p) => p.name === 'rig')!.replaceable).toBe(false);
  });

  it('builds a tree of precomp layers, text layers and groups', () => {
    const parts = listParts(fixture());
    expect(parts.map((p) => [p.id, p.kind])).toEqual([
      ['l0', 'precomp'],
      ['l1', 'text'],
      ['l2', 'shape'],
      ['l3', 'shape'],
      ['l4', 'shape'],
      ['l5', 'null'],
    ]);
    expect(parts[0].children.map((c) => [c.id, c.name, c.detected])).toEqual([
      ['l0>l0', 'Logo', true],
      ['l0>l1', 'Circle', false],
    ]);
    expect(parts[1].detected).toBe(true);
    // The single "Wrapper" group is skipped so the meaningful groups are listed.
    expect(parts[2].children.map((c) => [c.id, c.name])).toEqual([
      ['l2/g0/g0', 'Hand'],
      ['l2/g0/g1', 'Face'],
    ]);
    expect(flattenParts(parts)).toHaveLength(10);
  });
});

describe('applyPartEdits', () => {
  it('replaces the text of an imported emoji and keeps its animation rig', () => {
    const anim = ownEmoji();
    const id = listParts(anim).find((p) => p.name === 'content')!.id;
    const before = anim.layers.find((l) => l.nm === 'content')!;
    const edited = applyPartEdits(anim, { hidden: [], replace: id }, { art: art('LOL'), artStyle, scale: 1, offsetY: 0 });
    const after = edited.layers.find((l) => l.nm === 'content')!;
    expect(after.parent).toBe(before.parent);
    expect(after.ks).toEqual(before.ks);
    expect(JSON.stringify(after.shapes)).not.toEqual(JSON.stringify(before.shapes));
    expect((after.shapes![0] as ShapeItem).nm).toBe('replaced-content');
    // The original is untouched.
    expect(anim.layers.find((l) => l.nm === 'content')!.shapes).toEqual(before.shapes);
  });

  it('turns text, image and precomp layers into shape layers when replaced', () => {
    const content = { art: art('OK'), artStyle, scale: 1, offsetY: 0 };
    const text = applyPartEdits(fixture(), { hidden: [], replace: 'l1' }, content).layers[1];
    expect(text.ty).toBe(4);
    expect(text.t).toBeUndefined();
    expect(text.shapes!.length).toBe(1);
    const comp = applyPartEdits(fixture(), { hidden: [], replace: 'l0' }, content).layers[0];
    expect(comp.ty).toBe(4);
    expect(comp.refId).toBeUndefined();
  });

  it('replaces a group inside a layer but keeps the group transform', () => {
    const edited = applyPartEdits(fixture(), { hidden: [], replace: 'l2/g0/g1' }, { art: art('A'), artStyle, scale: 1, offsetY: 0 });
    const wrapper = edited.layers[2].shapes![0] as ShapeItem;
    const face = (wrapper.it as ShapeItem[])[1];
    const items = face.it as ShapeItem[];
    expect(items[items.length - 1].ty).toBe('tr');
    expect(items[0].nm).toBe('replaced-content');
  });

  it('hides layers as nulls (children keep moving), removes groups and unmasks matte targets', () => {
    const edited = applyPartEdits(fixture(), { hidden: ['l0>l0', 'l2/g0/g0', 'l3', 'l1'] });
    const comp = (edited.assets[0] as { layers: Layer[] }).layers;
    expect(comp[0].ty).toBe(3);
    expect(comp[0].shapes).toBeUndefined();
    expect(edited.layers[1].ty).toBe(3);
    const wrapper = edited.layers[2].shapes![0] as ShapeItem;
    expect((wrapper.it as ShapeItem[]).map((i) => i.nm ?? i.ty)).toEqual(['Face', 'tr']);
    expect(edited.layers[3].ty).toBe(3);
    expect(edited.layers[4].tt).toBeUndefined();
    // Unknown ids are ignored.
    expect(() => applyPartEdits(fixture(), { hidden: ['l9', 'l2/g5'] })).not.toThrow();
  });
});

describe('isolatePart', () => {
  it('keeps only the requested part visible', () => {
    const iso = isolatePart(fixture(), 'l0>l0');
    expect(iso.layers.map((l) => l.ty)).toEqual([0, 3, 3, 3, 3, 3]);
    const comp = (iso.assets[0] as { layers: Layer[] }).layers;
    expect(comp.map((l) => l.ty)).toEqual([4, 3]);

    const group = isolatePart(fixture(), 'l2/g0/g1');
    const wrapper = group.layers[2].shapes![0] as ShapeItem;
    expect((wrapper.it as ShapeItem[]).map((i) => i.nm ?? i.ty)).toEqual(['Face', 'tr']);
    expect(partFrame(fixture(), 'l2/g0/g1')).toBe(60);
  });

  it('computes part bounds through layer, parent and group transforms and zooms thumbnails onto them', () => {
    // Group "Face": rect 80×80 centred at (100, 0) inside layer at p (256, 256).
    expect(partBounds(fixture(), 'l2/g0/g1')).toEqual({ x: 316, y: 216, w: 80, h: 80 });
    // Precomp child "Logo": rect 20×20 centred at (10, 10) in a layer at (256, 256) inside a comp placed at (256, 256).
    expect(partBounds(fixture(), 'l0>l0')).toEqual({ x: 512, y: 512, w: 20, h: 20 });
    const cropped = isolatePart(fixture(), 'l2/g0/g1', true);
    const frame = cropped.layers[cropped.layers.length - 1];
    expect(frame.nm).toBe('thumbnail-frame');
    expect(cropped.layers.slice(0, -1).every((l) => l.parent !== undefined)).toBe(true);
    const s = (frame.ks.s as { k: number[] }).k[0];
    expect(s).toBeCloseTo((512 / 100) * 100, 3);
    // Big parts are barely zoomed.
    const body = isolatePart(ownEmoji(), 'l2', true);
    const bodyFrame = body.layers.find((l) => l.nm === 'thumbnail-frame');
    expect(bodyFrame ? (bodyFrame.ks.s as { k: number[] }).k[0] : 100).toBeLessThan(115);
  });

  it('shows thumbnails at a frame where the part is visible', () => {
    const star = compose({
      template: BUILTIN_TEMPLATES.find((t) => t.id === 'star')!,
      art: null,
      artStyle,
      colors: { body: solid('#7c3aed'), outline: solid('#111111'), accent: solid('#f59e0b') },
      outlineWidth: 12,
      scale: 1,
      offsetY: 0,
    });
    const idx = star.layers.findIndex((l) => l.nm === 'sparkle');
    const frame = partFrame(star, `l${idx}`);
    const scale = star.layers[idx].ks.s as { a: number; k: Array<{ t: number; s: number[] }> };
    // The chosen frame is one of the keyframes where the sparkle is fully grown.
    expect(scale.k.some((k) => Math.abs(k.t - frame) < 1 && k.s[0] === 100)).toBe(true);
    expect(partBounds(star, `l${idx}`, frame)!.w).toBeGreaterThan(20);
  });

  it('flags text layers for Telegram until they are hidden or replaced', () => {
    expect(checkTgs(fixture(), 1000).problems).toContain('unsupported');
    expect(checkTgs(applyPartEdits(fixture(), { hidden: ['l1'] }), 1000).problems).not.toContain('unsupported');
    const replaced = applyPartEdits(fixture(), { hidden: [], replace: 'l1' }, { art: art('OK'), artStyle, scale: 1, offsetY: 0 });
    expect(checkTgs(replaced, 1000).ok).toBe(true);
  });
});
