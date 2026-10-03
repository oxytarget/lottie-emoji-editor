import { describe, expect, it } from 'vitest';
import { applyPartEdits, isIdentityMove, isIdentityXf, NO_XF } from '../lottie/parts';
import type { LottieAnimation, ShapeItem } from '../lottie/types';
import { applyImportOp } from '../state/importOps';
import type { ImportedTemplate } from '../state/store';

const st = (k: unknown) => ({ a: 0, k });
const ks = (o: unknown = st(100)) => ({ o, r: st(0), p: st([256, 256, 0]), a: st([0, 0, 0]), s: st([100, 100, 100]) });
const rect = (withTr = true): ShapeItem => ({
  ty: 'gr',
  nm: 'box',
  it: [
    { ty: 'rc', p: st([0, 0]), s: st([100, 100]), r: st(0) },
    { ty: 'fl', c: st([1, 0, 0, 1]), o: st(100) },
    ...(withTr ? [{ ty: 'tr', p: st([0, 0]), a: st([0, 0]), s: st([100, 100]), r: st(0), o: st(80) }] : []),
  ],
});
const shapeLayer = (ind: number, extra: Record<string, unknown> = {}) => ({ ddd: 0, ind, ty: 4, nm: `s${ind}`, sr: 1, ks: ks(), ao: 0, shapes: [rect(), rect(false)], ip: 0, op: 60, st: 0, bm: 0, ...extra });
const anim = (layers: unknown[]): LottieAnimation => ({ v: '5.7.0', fr: 60, ip: 0, op: 60, w: 512, h: 512, nm: 't', ddd: 0, assets: [], layers }) as unknown as LottieAnimation;
type J = Record<string, any>;
const fade = (a: LottieAnimation, part: string, opacity: number) => applyPartEdits(a, { hidden: [], transforms: { [part]: { ...NO_XF, opacity } } }) as unknown as J;

describe('layer transparency', () => {
  it('counts as an edit, but not as a move', () => {
    const xf = { ...NO_XF, opacity: 0.5 };
    expect(isIdentityXf(xf)).toBe(false);
    expect(isIdentityMove(xf)).toBe(true);
    expect(isIdentityXf({ ...NO_XF, opacity: 1 })).toBe(true);
  });

  it("multiplies a layer's opacity, and adds no layers for it", () => {
    const out = fade(anim([shapeLayer(1)]), 'l0', 0.4);
    expect(out.layers).toHaveLength(1);
    expect(out.layers[0].ks.o).toEqual({ a: 0, k: 40 });
  });

  it('scales animated opacity keyframes', () => {
    const o = { a: 1, k: [{ t: 0, s: [0] }, { t: 30, s: [100] }, { t: 60, s: [50] }] };
    const out = fade(anim([shapeLayer(1, { ks: ks(o) })]), 'l0', 0.5);
    expect(out.layers[0].ks.o.k.map((k: J) => k.s[0])).toEqual([0, 50, 25]);
  });

  it("goes into a group's transform (and gives a group without one a transform)", () => {
    const a = anim([shapeLayer(1)]);
    const out = fade(a, 'l0/g0', 0.5);
    expect(out.layers[0].shapes[0].it.find((it: J) => it.ty === 'tr').o).toEqual({ a: 0, k: 40 });
    const bare = fade(a, 'l0/g1', 0.25);
    expect(bare.layers[0].shapes[1].it.find((it: J) => it.ty === 'tr').o).toEqual({ a: 0, k: 25 });
    // The rest stays as it was.
    expect(bare.layers[0].ks.o).toEqual({ a: 0, k: 100 });
  });

  it('reaches the layers parented to a null (Lottie does not pass it down itself)', () => {
    const nul = { ddd: 0, ind: 1, ty: 3, nm: 'ctrl', sr: 1, ks: ks(), ao: 0, ip: 0, op: 60, st: 0, bm: 0 };
    const out = fade(anim([nul, shapeLayer(2, { parent: 1 }), shapeLayer(3, { parent: 2 }), shapeLayer(4)]), 'l0', 0.5);
    expect(out.layers.map((l: J) => l.ks.o.k)).toEqual([100, 50, 50, 100]);
  });

  it('works with a move of the same part', () => {
    const out = applyPartEdits(anim([shapeLayer(1)]), { hidden: [], transforms: { l0: { x: 10, y: 0, scale: 1, rotation: 0, opacity: 0.3 } } }) as unknown as J;
    expect(out.layers[0].ks.o.k).toBe(30);
    expect(out.layers.some((l: J) => l.nm === 'part-transform')).toBe(true);
  });

  it('is kept as a part edit (undo, "all selected" and reset go with it)', () => {
    const imp = { transforms: {}, hidden: [], replace: null } as unknown as ImportedTemplate;
    expect(applyImportOp(imp, { kind: 'transform', part: 'l0', xf: { ...NO_XF, opacity: 0.6 } })).toEqual({ transforms: { l0: { ...NO_XF, opacity: 0.6 } } });
    expect(applyImportOp(imp, { kind: 'transform', part: 'l0', xf: { ...NO_XF, opacity: 1 } })).toEqual({ transforms: {} });
  });
});
