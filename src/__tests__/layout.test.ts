import { describe, expect, it } from 'vitest';
import { svgToArt } from '../content/svg';
import { applyLayout, applyLayoutOp, checkOp, INSERTED, parentOf, remapEdits, type LayoutOp } from '../lottie/layout';
import { flattenParts, listParts, partBounds } from '../lottie/parts';
import type { Layer, LottieAnimation, ShapeItem } from '../lottie/types';

const LOGO = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"><path d="M0 0H100V50H0Z" fill="#ff0000"/><circle cx="50" cy="25" r="20" fill="#00ff00"/></svg>';
const art = (svg: string) => svgToArt(svg).art;

const st = (k: unknown) => ({ a: 0, k });
const tr = (p = [0, 0]) => ({ ty: 'tr', p: st(p), a: st([0, 0]), s: st([100, 100]), r: st(0), o: st(100) });
const rect = (nm: string, x: number, w = 40): ShapeItem => ({ ty: 'gr', nm, it: [{ ty: 'rc', p: st([x, 0]), s: st([w, w]), r: st(0) }, { ty: 'fl', c: st([0, 0, 1, 1]), o: st(100) }, tr()] });
const layer = (ind: number, nm: string, shapes: ShapeItem[], extra: Partial<Layer> = {}): Layer =>
  ({ ddd: 0, ind, ty: 4, nm, sr: 1, ks: { o: st(100), r: st(0), p: st([256, 256, 0]), a: st([0, 0, 0]), s: st([100, 100, 100]) }, ao: 0, ip: 0, op: 120, st: 0, bm: 0, shapes, ...extra }) as Layer;

/** Two shape layers (the first with three groups) and a precomp with one layer inside. */
const fixture = (): LottieAnimation => ({
  v: '5.7.4',
  fr: 60,
  ip: 0,
  op: 120,
  w: 512,
  h: 512,
  nm: 'f',
  ddd: 0,
  assets: [{ id: 'c0', w: 200, h: 200, layers: [layer(1, 'Inner', [rect('I', 0)])] }],
  layers: [
    layer(1, 'Body', [rect('A', -60), rect('B', 0), rect('C', 60)]),
    layer(2, 'Hat', [rect('H', 0, 80)], { ks: { o: st(100), r: st(0), p: st([256, 100, 0]), a: st([0, 0, 0]), s: st([100, 100, 100]) } } as Partial<Layer>),
    layer(3, 'Comp', [], { ty: 0, refId: 'c0', w: 200, h: 200 } as Partial<Layer>),
  ],
});

const names = (anim: LottieAnimation) => flattenParts(listParts(anim)).map((p) => `${p.id}:${p.name}`);

/** Applies an op and remaps edits, like the editor does. */
function run(anim: LottieAnimation, op: LayoutOp, edits = { hidden: [] as string[], replace: null as string | null, transforms: {} as Record<string, unknown> }) {
  const next = structuredClone(anim);
  const id = applyLayoutOp(next, op, art);
  return { anim: next, id, edits: remapEdits(edits, op, anim) };
}

describe('layer structure edits', () => {
  it('inserts a favourite logo as a top-level layer and keeps other edits on their parts', () => {
    const before = fixture();
    const r = run(before, { kind: 'insert', svg: LOGO, name: `${INSERTED}Logo`, at: { parent: '', index: 1 } }, { hidden: ['l1'], replace: 'l0/g1', transforms: { l2: { x: 1 } } });
    expect(r.id).toBe('l1');
    expect(r.anim.layers.map((l) => l.nm)).toEqual(['Body', '★ Logo', 'Hat', 'Comp']);
    expect(r.edits).toEqual({ hidden: ['l2'], replace: 'l0/g1', transforms: { l3: { x: 1 } } });
    const box = partBounds(r.anim, 'l1')!;
    expect(box.x + box.w / 2).toBeCloseTo(256, 0);
    expect(box.w).toBeGreaterThan(150);
  });

  it('inserts a logo inside a group, where it follows that group', () => {
    const r = run(fixture(), { kind: 'insert', svg: LOGO, name: `${INSERTED}Logo`, at: { parent: 'l0/g1', index: 0 } }, { hidden: ['l0/g1/g0'], replace: null, transforms: {} });
    expect(r.id).toBe('l0/g1/g0');
    expect(r.edits.hidden).toEqual(['l0/g1/g1']);
    expect(names(r.anim)).toContain('l0/g1/g0:★ Logo');
  });

  it('moves a group up and down in its list', () => {
    const r = run(fixture(), { kind: 'move', part: 'l0/g2', at: { parent: 'l0', index: 0 } }, { hidden: ['l0/g0'], replace: 'l0/g2', transforms: {} });
    expect(r.id).toBe('l0/g0');
    expect((r.anim.layers[0].shapes as ShapeItem[]).map((g) => g.nm)).toEqual(['C', 'A', 'B']);
    expect(r.edits).toMatchObject({ hidden: ['l0/g1'], replace: 'l0/g0' });
    // Down again (after B = index 3 in the pre-move list).
    const back = run(r.anim, { kind: 'move', part: 'l0/g0', at: { parent: 'l0', index: 3 } }, r.edits);
    expect((back.anim.layers[0].shapes as ShapeItem[]).map((g) => g.nm)).toEqual(['A', 'B', 'C']);
    expect(back.edits).toMatchObject({ hidden: ['l0/g0'], replace: 'l0/g2' });
  });

  it('nests a group into another group and a shape layer into a group (and back out as a layer)', () => {
    const into = run(fixture(), { kind: 'move', part: 'l0/g0', at: { parent: 'l0/g2', index: 0 } }, { hidden: [], replace: 'l0/g0', transforms: { 'l0/g2': 1 } });
    expect(into.id).toBe('l0/g1/g0');
    expect(into.edits).toMatchObject({ replace: 'l0/g1/g0', transforms: { 'l0/g1': 1 } });

    const hatBox = partBounds(fixture(), 'l1')!;
    const layerIn = run(fixture(), { kind: 'move', part: 'l1', at: { parent: 'l0', index: 3 } });
    expect(layerIn.id).toBe('l0/g3');
    expect(layerIn.anim.layers.map((l) => l.nm)).toEqual(['Body', 'Comp']);
    const g = (layerIn.anim.layers[0].shapes as ShapeItem[])[3];
    expect([g.ty, g.nm]).toEqual(['gr', 'Hat']);
    // Its own transform travels with it (the hat sat higher than the body's origin).
    const moved = partBounds(layerIn.anim, 'l0/g3')!;
    expect(moved.y + moved.h / 2).toBeCloseTo(256 + (hatBox.y + hatBox.h / 2), 0);

    const out = run(layerIn.anim, { kind: 'move', part: 'l0/g3', at: { parent: '', index: 0 } });
    expect(out.id).toBe('l0');
    expect(out.anim.layers[0]).toMatchObject({ ty: 4, nm: 'Hat' });
    expect(out.anim.layers.map((l) => l.ind)).toEqual([4, 1, 3]);
  });

  it('refuses moves into itself and moving linked layers out of their list', () => {
    const anim = fixture();
    expect(checkOp(anim, { kind: 'move', part: 'l0', at: { parent: 'l0', index: 0 } })).toBe('into-itself');
    anim.layers[1].parent = 1;
    expect(checkOp(anim, { kind: 'move', part: 'l1', at: { parent: 'l0', index: 0 } })).toBe('linked-layer');
    expect(checkOp(anim, { kind: 'move', part: 'l1', at: { parent: '', index: 0 } })).toBeNull();
    expect(checkOp(anim, { kind: 'move', part: 'l2', at: { parent: 'l0', index: 0 } })).toBe('not-shapes');
    expect(checkOp(anim, { kind: 'insert', svg: LOGO, name: 'x', at: { parent: 'l2', index: 0 } })).toBeNull();
    expect(checkOp(anim, { kind: 'insert', svg: LOGO, name: 'x', at: { parent: 'l2>l0/g0', index: 0 } })).toBeNull();
  });

  it('removes an inserted logo and replays the same result from the original file', () => {
    const base = fixture();
    const ops: LayoutOp[] = [
      { kind: 'insert', svg: LOGO, name: `${INSERTED}A`, at: { parent: '', index: 0 } },
      { kind: 'move', part: 'l1/g2', at: { parent: 'l1', index: 0 } },
      { kind: 'insert', svg: LOGO, name: `${INSERTED}B`, at: { parent: 'l3', index: 1 } },
      { kind: 'remove', part: 'l0' },
    ];
    let step = base;
    let edits = { hidden: ['l0/g1'], replace: null as string | null, transforms: {} as Record<string, unknown> };
    for (const op of ops) {
      const r = run(step, op, edits);
      step = r.anim;
      edits = r.edits;
    }
    expect(JSON.stringify(applyLayout(base, ops, art))).toBe(JSON.stringify(step));
    expect(names(step)).toContain('l2>l1:★ B');
    expect(step.layers.map((l) => l.nm)).toEqual(['Body', 'Hat', 'Comp']);
    // "B" (hidden before) is now the third group of Body.
    expect(edits.hidden).toEqual(['l0/g2']);
    expect(parentOf('l2>l1')).toEqual({ parent: 'l2', index: 1 });
  });
});
