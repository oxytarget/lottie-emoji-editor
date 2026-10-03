import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'opentype.js/dist/opentype.mjs';
import { beforeEach, describe, expect, it } from 'vitest';
import { textToArt } from '../content/text';
import { stretched } from '../components/CanvasEditor';
import { compose } from '../lottie/compose';
import { extractPalette, recolor } from '../lottie/imported';
import { hexToOklch } from '../lottie/brand';
import { applyItemPaints, flatToGradient, gradientPartner, gradientSpan, listPaintItems, resolveItem, tagItemGradients } from '../lottie/itemPaints';
import { applyLayoutOp, CONTENT_SLOT, INSERTED, remapEdits } from '../lottie/layout';
import { solid, stripGradientClasses } from '../lottie/paint';
import { applyPartEdits, flattenParts, listParts, partBounds } from '../lottie/parts';
import type { Layer, LottieAnimation, ShapeItem } from '../lottie/types';
import { compileAll } from '../state/compile';
import { initialData, useEditor, type ImportedTemplate } from '../state/store';
import { BUILTIN_TEMPLATES } from '../templates/builtin';

const st = (k: unknown) => ({ a: 0, k });
const tr = (p = [0, 0]) => ({ ty: 'tr', p: st(p), a: st([0, 0]), s: st([100, 100]), r: st(0), o: st(100) });
const layer = (ind: number, nm: string, shapes: ShapeItem[]): Layer =>
  ({ ddd: 0, ind, ty: 4, nm, sr: 1, ks: { o: st(100), r: st(0), p: st([256, 256, 0]), a: st([0, 0, 0]), s: st([100, 100, 100]) }, ao: 0, ip: 0, op: 120, st: 0, bm: 0, shapes }) as Layer;

/** A badge: a circle with a gradient ring and a 3-stop gradient fill, a flat-coloured dot, and a radial halo. */
const badge = (): LottieAnimation => ({
  v: '5.7.4',
  fr: 60,
  ip: 0,
  op: 120,
  w: 512,
  h: 512,
  nm: 'badge',
  ddd: 0,
  assets: [],
  layers: [
    layer(1, 'Badge', [
      {
        ty: 'gr',
        nm: 'Circle',
        it: [
          { ty: 'el', p: st([0, 0]), s: st([360, 360]) },
          { ty: 'gs', o: st(100), w: st(18), g: { p: 2, k: st([0, 1, 1, 1, 1, 0.2, 0.2, 0.2]) }, s: st([0, -180]), e: st([0, 180]), t: 1 },
          { ty: 'gf', o: st(100), r: 1, g: { p: 3, k: st([0, 1, 0, 0, 0.5, 0, 1, 0, 1, 0, 0, 1]) }, s: st([-180, 0]), e: st([180, 0]), t: 1 },
          tr(),
        ],
      },
      { ty: 'gr', nm: 'Dot', it: [{ ty: 'rc', p: st([0, 0]), s: st([120, 120]), r: st(30) }, { ty: 'fl', o: st(100), c: { a: 1, k: [{ t: 0, s: [0, 0, 1, 1] }, { t: 60, s: [0, 1, 1, 1] }] } }, tr([0, 40])] },
    ]),
    layer(2, 'Back', [
      { ty: 'el', p: st([0, 0]), s: st([480, 480]) },
      { ty: 'gf', o: st(100), r: 1, g: { p: 2, k: st([0, 1, 1, 0, 1, 1, 0.5, 0]) }, s: st([0, 0]), e: st([240, 0]), t: 2 },
    ]),
  ],
});

describe('layer colours', () => {
  it('lists the fills, strokes and gradients of the animation or of one layer', () => {
    const items = listPaintItems(badge());
    expect(items.map((i) => `${i.id}:${i.kind}${i.gradient ? ':grad' : ''}`)).toEqual([
      'l0/g0/g1:stroke:grad',
      'l0/g0/g2:fill:grad',
      'l0/g1/g1:fill',
      'l1/g1:fill:grad',
    ]);
    expect(items[1]).toMatchObject({ colors: ['#ff0000', '#00ff00', '#0000ff'], type: 1, from: [-180, 0], to: [180, 0], animated: false });
    expect(items[2]).toMatchObject({ colors: ['#0000ff'], animated: true });
    expect(items[3]).toMatchObject({ type: 2, colors: ['#ffff00', '#ff8000'] });
    expect(listPaintItems(badge(), 'l0/g1').map((i) => i.id)).toEqual(['l0/g1/g1']);
    expect(listPaintItems(badge(), 'l1').map((i) => i.id)).toEqual(['l1/g1']);
  });

  it('changes one layer only: flat colour, gradient stops, points and type', () => {
    const anim = applyItemPaints(badge(), {
      'l0/g1/g1': { color: '#123456' },
      'l0/g0/g2': { stops: ['#000000', '', '#ffffff'], from: [0, -100], to: [0, 100] },
      'l1/g1': { type: 1 },
    });
    const items = listPaintItems(anim);
    expect(items[2]).toMatchObject({ colors: ['#123456'], animated: false });
    expect(items[1]).toMatchObject({ colors: ['#000000', '#00ff00', '#ffffff'], from: [0, -100], to: [0, 100] });
    expect(items[3].type).toBe(1);
    // The ring keeps its colours: a per-layer edit is not a palette change.
    expect(items[0].colors).toEqual(['#ffffff', '#333333']);
    expect(resolveItem(anim, 'l0/g1/g0')).toBeNull();
  });

  it('turns a flat colour of one layer into a gradient across its shape (and back with the edit gone)', () => {
    const src = badge();
    const dot = listPaintItems(src).find((i) => i.id === 'l0/g1/g1')!;
    const edit = flatToGradient(src, dot);
    // Its colour and a clearly different shade of it, top to bottom over the 120×120 rect.
    expect(edit.stops![0]).toBe('#0000ff');
    expect(edit.stops![1]).not.toBe('#0000ff');
    expect(edit).toMatchObject({ type: 1, from: [0, -60], to: [0, 60] });
    expect(gradientSpan(src, 'l0/g1/g1', 2)).toEqual({ from: [0, 0], to: [0, 60] });

    const anim = applyItemPaints(badge(), { 'l0/g1/g1': { color: '#ff0000', ...edit } });
    const item = resolveItem(anim, 'l0/g1/g1')!;
    expect(item.ty).toBe('gf');
    expect(item.c).toBeUndefined();
    expect(item.o).toEqual(st(100));
    expect((item.g as { p: number }).p).toBe(2);
    expect(listPaintItems(anim).find((i) => i.id === 'l0/g1/g1')).toMatchObject({ gradient: true, kind: 'fill', colors: edit.stops, from: [0, -60], to: [0, 60], type: 1 });
    // Its stops and type are then edited like any gradient.
    const again = applyItemPaints(badge(), { 'l0/g1/g1': { ...edit, stops: ['#00ff00', '#000000'], type: 2 } });
    expect(listPaintItems(again).find((i) => i.id === 'l0/g1/g1')).toMatchObject({ colors: ['#00ff00', '#000000'], type: 2 });
  });

  it('makes stroke gradients from flat strokes, keeping the width', () => {
    const anim = badge();
    ((anim.layers[1] as Layer).shapes as ShapeItem[]).push({ ty: 'st', o: st(100), w: st(12), lc: 2, lj: 2, c: st([1, 0, 0, 1]) });
    const out = applyItemPaints(anim, { 'l1/g2': { stops: ['#ff0000', '#220000'], from: [0, -240], to: [0, 240], type: 1 } });
    const stroke = resolveItem(out, 'l1/g2')!;
    expect(stroke).toMatchObject({ ty: 'gs', w: st(12), lc: 2, lj: 2, t: 1 });
    expect(listPaintItems(out).find((i) => i.id === 'l1/g2')).toMatchObject({ kind: 'stroke', gradient: true, colors: ['#ff0000', '#220000'] });
  });

  it('picks a partner colour that stands apart: darker for light colours, lighter for dark ones', () => {
    const light = hexToOklch(gradientPartner('#ffdd55'));
    const dark = hexToOklch(gradientPartner('#1a1a40'));
    expect(light.L).toBeLessThan(hexToOklch('#ffdd55').L - 0.2);
    expect(dark.L).toBeGreaterThan(hexToOklch('#1a1a40').L + 0.2);
  });

  it('tags gradients for the canvas handles in the preview only', () => {
    const anim = badge();
    tagItemGradients(anim);
    expect(resolveItem(anim, 'l0/g0/g2')!.cl).toBe('pg-i1 pgb_0_0_1_1');
    expect(resolveItem(anim, 'l0/g1/g1')!.cl).toBeUndefined();
    expect(stripGradientClasses(JSON.stringify(anim))).not.toContain('pg-');

    const out = compileAll({
      art: null,
      artStyle: { mode: 'paint', fill: solid('#fff'), outline: null, outlineWidth: 0 },
      colors: { body: solid('#000'), outline: solid('#000'), accent: solid('#000') },
      outlineWidth: 0,
      scale: 1,
      offsetY: 0,
      offsetX: 0,
      rotation: 0,
      imports: [{ id: 'x', data: badge(), colorMap: {}, overlay: false, hidden: [], replace: null, transforms: {}, paints: { 'l0/g1/g1': { color: '#123456' } } }],
      annotate: 'x',
    }).find((o) => o.id === 'x')!;
    expect(out.json).not.toContain('pg-');
    expect(out.preview).toContain('pg-i3 pgb_0_0_1_1');
    expect(out.json).toContain('"c":{"a":0,"k":[0.071,0.204,0.337,1]}');
  });
});

describe('the text/logo in the layer list', () => {
  it('makes an invisible slot the text/logo is fitted into, marked through moves', () => {
    const anim = badge();
    const id = applyLayoutOp(anim, { kind: 'insert', svg: CONTENT_SLOT, name: `${INSERTED}Text`, at: { parent: 'l0/g0', index: 0 } }, () => null)!;
    expect(id).toBe('l0/g0/g0');
    const part = flattenParts(listParts(anim)).find((p) => p.id === id)!;
    expect(part).toMatchObject({ name: '★ Text', slot: true, replaceable: true });
    // Nothing is drawn until the text/logo goes in.
    expect(listPaintItems(anim, id)).toEqual([]);
    const box = partBounds(anim, id)!;
    expect(box.w).toBeGreaterThan(100);

    // Out of the group to the top level: still a slot.
    const moved = applyLayoutOp(anim, { kind: 'move', part: id, at: { parent: '', index: 0 } }, () => null)!;
    expect(moved).toBe('l0');
    expect(flattenParts(listParts(anim)).find((p) => p.id === moved)?.slot).toBe(true);
    const withSlot = badge();
    applyLayoutOp(withSlot, { kind: 'insert', svg: CONTENT_SLOT, name: `${INSERTED}Text`, at: { parent: 'l0/g0', index: 0 } }, () => null);
    // The text/logo and the layer colours go along.
    expect(remapEdits({ hidden: [], replace: 'l0/g0/g0', transforms: {}, paints: { 'l0/g0/g3': { color: '#fff' } } }, { kind: 'move', part: 'l0/g0/g0', at: { parent: '', index: 0 } }, withSlot)).toMatchObject({
      replace: 'l0',
      paints: { 'l1/g0/g2': { color: '#fff' } },
    });
  });

  it('puts the text/logo into a slot and removes the slot it was in before', () => {
    useEditor.setState({ ...initialData() });
    const data = badge();
    const imp: ImportedTemplate = { id: 'b', name: 'b', data, base: data, layout: [], palette: extractPalette(data), colorMap: {}, overlay: true, hidden: [], replace: null, transforms: {} };
    useEditor.setState({ imports: [imp], selected: ['b'], active: 'b' });
    const s = useEditor.getState();
    const first = s.placeContent('b', { parent: 'l0/g0', index: 0 }, `${INSERTED}Text`);
    let t = useEditor.getState().imports[0];
    expect(first).toBe('l0/g0/g0');
    expect(t).toMatchObject({ replace: 'l0/g0/g0', overlay: false });

    const second = s.placeContent('b', { parent: '', index: 2 }, `${INSERTED}Text`);
    t = useEditor.getState().imports[0];
    expect(second).toBe('l2');
    expect(flattenParts(listParts(t.data)).filter((p) => p.slot).map((p) => p.id)).toEqual(['l2']);
    expect(t.layout.map((o) => o.kind)).toEqual(['insert', 'insert', 'remove']);

    // Deleting the slot puts the text/logo back on top.
    s.layoutImport('b', { kind: 'remove', part: 'l2' });
    expect(useEditor.getState().imports[0]).toMatchObject({ replace: null, overlay: true });
  });

  it('keeps per-layer colours on their items when layers move', () => {
    const edits = remapEdits({ hidden: [], replace: null, transforms: {}, paints: { 'l0/g1/g1': { color: '#123456' } } }, { kind: 'move', part: 'l0/g1', at: { parent: '', index: 0 } }, badge());
    expect(edits.paints).toEqual({ 'l0/g1': { color: '#123456' } });
  });
});

describe('free stretching', () => {
  beforeEach(() => useEditor.setState({ ...initialData() }));

  const face = (n: string) => {
    const b = readFileSync(resolve(__dirname, '../../node_modules/@fontsource/nunito/files', n));
    return parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
  };
  const art = textToArt({ id: 'n', faces: [face('nunito-latin-900-normal.woff')] }, { text: 'HI', letterSpacing: 0, lineHeight: 1, uppercase: false }).art!;
  const artStyle = { mode: 'paint' as const, fill: solid('#ffffff'), outline: null, outlineWidth: 0 };
  const colors = { body: solid('#7c3aed'), outline: solid('#111111'), accent: solid('#f59e0b') };

  it('stretches the text/logo on its own axes', () => {
    const base = { template: BUILTIN_TEMPLATES[0], art, artStyle, colors, outlineWidth: 12, scale: 1, offsetY: 0 };
    const scaleOf = (a: LottieAnimation): unknown => {
      let found: unknown;
      const visit = (n: unknown) => {
        if (Array.isArray(n)) n.forEach(visit);
        else if (n && typeof n === 'object') {
          const o = n as Record<string, unknown>;
          if (o.cl === 'emoji-content') found = ((o.it as ShapeItem[]).find((i) => i.ty === 'tr') as unknown as { s: { k: number[] } }).s.k;
          Object.values(o).forEach(visit);
        }
      };
      visit(a);
      return found;
    };
    expect(scaleOf(compose(base))).toEqual([100, 100]);
    expect(scaleOf(compose({ ...base, stretch: 1.5 }))).toEqual([100, 150]);
  });

  it('stretches a grabbed part', () => {
    const edited = applyPartEdits(badge(), { hidden: [], transforms: { 'l0/g1': { x: 0, y: 0, scale: 2, rotation: 0, stretch: 0.5 } } });
    const wrap = (edited.layers[0].shapes as ShapeItem[])[1];
    expect(wrap.nm).toBe('part-transform');
    const t = (wrap.it as ShapeItem[])[1] as unknown as { s: { k: number[] } };
    expect(t.s.k).toEqual([200, 100]);
  });

  it('turns handle drags into width and height changes in the content’s own axes', () => {
    const s = { scale: 1, offsetX: 0, offsetY: 0, rotation: 0, stretch: 1 };
    const c = { x: 0, y: 0 };
    // Right edge twice as far: twice as wide, same height.
    expect(stretched(s, 'x', c, { x: 50, y: 0 }, { x: 100, y: 0 })).toMatchObject({ scale: 2, stretch: 0.5 });
    // Top edge: only the height.
    expect(stretched(s, 'y', c, { x: 0, y: -20 }, { x: 0, y: -60 })).toMatchObject({ scale: 1, stretch: 3 });
    // Rotated 90°: a vertical drag changes the (turned) width.
    const turned = stretched({ ...s, rotation: 90 }, 'x', c, { x: 0, y: 50 }, { x: 0, y: 100 });
    expect(turned.scale).toBeCloseTo(2);
  });
});

it('keeps recolouring and layer colours apart', () => {
  const anim = applyItemPaints(recolor(badge(), { '#ff0000': '#00ffff' }), { 'l0/g1/g1': { color: '#123456' } });
  const items = listPaintItems(anim);
  expect(items[1].colors[0]).toBe('#00ffff');
  expect(items[2].colors).toEqual(['#123456']);
});

it('repeats a layer colour on the same layer of the other selected stickers', () => {
  const make = (id: string): ImportedTemplate => {
    const data = badge();
    return { id, name: id, data, base: data, layout: [], palette: extractPalette(data), colorMap: {}, overlay: false, hidden: [], replace: null, transforms: {} };
  };
  useEditor.setState({ ...initialData(), imports: [make('a'), make('b')], selected: ['a', 'b'], active: 'a', syncImports: true });
  const r = useEditor.getState().editImport('a', { kind: 'paint', item: 'l0/g1/g1', paint: { color: '#123456' } });
  expect(r).toEqual({ applied: 1, total: 1 });
  expect(useEditor.getState().imports.map((t) => t.paints)).toEqual([{ 'l0/g1/g1': { color: '#123456' } }, { 'l0/g1/g1': { color: '#123456' } }]);
  // "Reset colours" also forgets layer colours.
  useEditor.getState().editImport('a', { kind: 'colorsReset' });
  expect(useEditor.getState().imports.map((t) => t.paints)).toEqual([{}, {}]);
});
