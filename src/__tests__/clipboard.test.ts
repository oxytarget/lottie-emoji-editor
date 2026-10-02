import { describe, expect, it } from 'vitest';
import { parseFragment, partFragment } from '../lottie/fragment';
import { applyLayoutOp } from '../lottie/layout';
import { partBounds } from '../lottie/parts';
import type { Layer, LottieAnimation, ShapeItem } from '../lottie/types';

const st = (k: unknown) => ({ a: 0, k });
const tr = (p = [0, 0], s = [100, 100]) => ({ ty: 'tr', p: st(p), a: st([0, 0]), s: st(s), r: st(0), o: st(100) });
const layer = (ind: number, nm: string, shapes: ShapeItem[], extra: Partial<Layer> = {}): Layer =>
  ({ ddd: 0, ind, ty: 4, nm, sr: 1, ks: { o: st(100), r: st(0), p: st([256, 256, 0]), a: st([0, 0, 0]), s: st([100, 100, 100]) }, ao: 0, ip: 0, op: 120, st: 0, bm: 0, shapes, ...extra }) as Layer;
const anim = (layers: Layer[]): LottieAnimation => ({ v: '5.7.4', fr: 60, ip: 0, op: 120, w: 512, h: 512, nm: 't', ddd: 0, assets: [], layers });

describe('copying layers between animations', () => {
  // A star drawn in a group whose fill sits one level up, in a layer parented to a moving null.
  const source = () =>
    anim([
      layer(1, 'Body', [
        { ty: 'gr', nm: 'Outer', it: [{ ty: 'gr', nm: 'Star', it: [{ ty: 'sr', p: st([0, 0]), or: st(40), ir: st(20), pt: st(5), sy: 1 }, tr([30, 0])] }, { ty: 'fl', c: st([1, 0.8, 0, 1]), o: st(100) }, tr([10, 10], [150, 150])] },
      ], { parent: 2 }),
      { ...layer(2, 'Mover', []), ty: 3, ks: { o: st(100), r: st(0), p: st([20, -40, 0]), a: st([0, 0, 0]), s: st([100, 100, 100]) } } as Layer,
    ]);

  it('copies a group with the fill above it, its transforms and its parent', () => {
    const src = source();
    const f = partFragment(src, 'l0/g0/g0', 'Star')!;
    expect(parseFragment(JSON.stringify(f))?.name).toBe('Star');
    expect(f.layers.map((l) => l.ty)).toEqual([4, 3]);
    const target = anim([layer(1, 'Other', [{ ty: 'gr', it: [{ ty: 'el', p: st([0, 0]), s: st([50, 50]) }, tr()] }])]);
    const before = partBounds(src, 'l0/g0/g0', 0)!;
    const op = { kind: 'insert' as const, svg: 'k', name: '★ Star', at: { parent: '', index: 0 }, fragment: 'ab12' };
    const id = applyLayoutOp(target, op, () => null, () => f);
    expect(id).toBe('l0');
    // Same place and size on the canvas, and painted (the fill came along).
    const after = partBounds(target, 'l0>l0', 0)!;
    for (const k of ['x', 'y', 'w', 'h'] as const) expect(after[k]).toBeCloseTo(before[k], 3);
    expect(JSON.stringify(target.assets)).toContain('"ty":"fl"');
    // Pasting again cannot clash with the first copy.
    applyLayoutOp(target, { ...op, fragment: 'cd34' }, () => null, () => f);
    const ids = (target.assets ?? []).map((a) => (a as { id: string }).id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(target.layers).toHaveLength(3);
  });

  it('refuses to paste a layer inside a group', () => {
    const f = partFragment(source(), 'l0', 'Body')!;
    const target = anim([layer(1, 'Other', [{ ty: 'gr', it: [{ ty: 'el', p: st([0, 0]), s: st([50, 50]) }, tr()] }])]);
    expect(applyLayoutOp(target, { kind: 'insert', svg: 'k', name: 'x', at: { parent: 'l0', index: 0 }, fragment: 'z' }, () => null, () => f)).toBeNull();
  });
});
