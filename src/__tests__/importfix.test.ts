import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { bakeExpressions, hasExpressions, type Sampler } from '../lottie/bake';
import { readLottieFile } from '../lottie/export';
import { compatibilityIssues, fitCanvas, normalizeForTgs } from '../lottie/imported';
import { rootOf } from '../lottie/layout';
import { flattenParts, listParts, partBounds } from '../lottie/parts';
import type { Layer, LottieAnimation } from '../lottie/types';

const st = (k: unknown) => ({ a: 0, k });
const shape = (nm: string, extra: Record<string, unknown> = {}): Layer =>
  ({
    ddd: 0, ind: 1, ty: 4, nm, sr: 1, ao: 0, ip: 0, op: 60, st: 0, bm: 0,
    ks: { o: st(100), r: st(0), p: st([400, 150, 0]), a: st([0, 0, 0]), s: st([100, 100, 100]) },
    shapes: [{ ty: 'gr', nm: 'Box', it: [{ ty: 'rc', p: st([0, 0]), s: st([1200, 100]), r: st(0) }, { ty: 'fl', c: st([1, 0, 0, 1]), o: st(100) }, { ty: 'tr', p: st([0, 0]), a: st([0, 0]), s: st([100, 100]), r: st(0), o: st(100) }] }],
    ...extra,
  }) as Layer;
const wide = (): LottieAnimation => ({ v: '5.7.4', fr: 30, ip: 0, op: 60, w: 800, h: 300, nm: 'wide', ddd: 0, assets: [], layers: [shape('Bar'), { ...shape('Top'), ind: 2 }] });

describe('importing foreign animations', () => {
  it('frames a non-square scene in a clipping precomp, listed as the top level', () => {
    const anim = normalizeForTgs(wide());
    expect([anim.w, anim.h, anim.fr, anim.op]).toEqual([512, 512, 60, 120]);
    expect(anim.layers).toHaveLength(1);
    expect(anim.layers[0]).toMatchObject({ ty: 0, w: 800, h: 300, refId: 'canvas' });
    // The frame scales 800×300 into 512 wide, centred vertically.
    const ks = anim.layers[0].ks as unknown as { p: { k: number[] }; s: { k: number[] } };
    expect(ks.s.k[0]).toBeCloseTo(64);
    expect(ks.p.k[1]).toBeCloseTo((512 - 300 * 0.64) / 2);
    // The layer list shows the scene's own layers; drops at the top level go into the frame.
    expect(flattenParts(listParts(anim)).map((p) => `${p.id}:${p.name}`)).toEqual(['l0>l0:Bar', 'l0>l1:Top']);
    expect(rootOf(anim)).toBe('l0');
    const box = partBounds(anim, 'l0>l0')!;
    expect(box.w).toBeCloseTo(1200 * 0.64, 0);
  });

  it('keeps square scenes as they were (saved edits keep pointing at the same layers)', () => {
    const square = { ...wide(), w: 100, h: 100 };
    const anim = fitCanvas(square);
    expect(anim.layers.map((l) => l.nm)).toEqual(['Bar', 'Top', 'canvas']);
    expect(rootOf(anim)).toBe('');
  });

  it('opens dotLottie files, with their images inline', () => {
    const json = { ...wide(), assets: [{ id: 'img_0', w: 10, h: 10, u: '/images/', p: 'img_0.png', e: 0 }] };
    const zip = zipSync({
      'manifest.json': strToU8(JSON.stringify({ animations: [{ id: 'hello' }], version: '1.0' })),
      'animations/hello.json': strToU8(JSON.stringify(json)),
      'images/img_0.png': new Uint8Array([137, 80, 78, 71]),
    });
    const anim = readLottieFile(zip);
    expect(anim.nm).toBe('wide');
    expect(anim.assets[0]).toMatchObject({ e: 1, u: '', p: 'data:image/png;base64,iVBORw==' });
    // v2 layout (a/, i/) without a manifest id.
    const v2 = zipSync({ 'manifest.json': strToU8('{}'), 'a/x.json': strToU8(JSON.stringify(wide())) });
    expect(readLottieFile(v2).w).toBe(800);
  });

  it('finds what Telegram does not show', () => {
    const anim = wide();
    expect(compatibilityIssues(anim)).toEqual([]);
    expect(hasExpressions(anim)).toBe(false);
    (anim.layers[0].ks as unknown as { r: Record<string, unknown> }).r = { a: 0, k: 0, x: 'time * 360' };
    anim.layers[1] = { ...anim.layers[1], ef: [{ ty: 5, nm: 'Slider' }, { ty: 25, nm: 'Drop Shadow' }] } as Layer;
    anim.layers.push({ ...shape('Title'), ind: 3, ty: 5 } as Layer);
    expect(hasExpressions(anim)).toBe(true);
    expect(compatibilityIssues(anim).sort()).toEqual(['effects', 'expressions', 'text']);
    // Expression controls alone are not a visual effect.
    anim.layers[1] = { ...anim.layers[1], ef: [{ ty: 5, nm: 'Slider' }] } as Layer;
    expect(compatibilityIssues(anim)).not.toContain('effects');
  });
});

describe('baking expressions', () => {
  const withExpressions = (): LottieAnimation => {
    const anim = wide();
    const ks = anim.layers[0].ks as unknown as Record<string, Record<string, unknown>>;
    ks.r = { a: 0, k: 0, x: 'time * 90' };
    ks.p = { a: 0, k: [400, 150, 0], x: 'wiggle(2, 10)' };
    return { ...anim, op: 10 };
  };

  it('writes what the sandboxed player computed as keyframes, merging straight runs', async () => {
    let job: Parameters<Sampler>[0] | null = null;
    const sampler: Sampler = async (j) => {
      job = j;
      return [
        Array.from({ length: j.frames }, (_, f) => [f * 10]), // straight line → 2 keys
        Array.from({ length: j.frames }, (_, f) => [400, f % 2 ? 160 : 150, 0]), // zigzag → every frame
      ];
    };
    const res = await bakeExpressions(withExpressions(), sampler);
    expect(job!).toMatchObject({ count: 2, frames: 10, w: 800, h: 300 });
    expect(res).toMatchObject({ baked: 2, failed: 0 });
    expect(hasExpressions(res.anim)).toBe(false);
    const ks = res.anim.layers[0].ks as unknown as Record<string, { a: number; k: Array<{ t: number; s: number[] }> }>;
    expect(ks.r.a).toBe(1);
    expect(ks.r.k.map((k) => [k.t, k.s[0]])).toEqual([[0, 0], [9, 90]]);
    expect(ks.p.k).toHaveLength(10);
    expect(ks.p.k[0]).toMatchObject({ o: { x: 0, y: 0 }, i: { x: 1, y: 1 } });
  });

  it('keeps an expression when the sandbox sends something that is not plain numbers', async () => {
    const sampler: Sampler = async (j) => [
      Array.from({ length: j.frames }, () => ['9' as unknown as number]),
      Array.from({ length: j.frames }, (_, f) => (f === 3 ? [Number.NaN, 0, 0] : [1, 2, 0])),
    ];
    const res = await bakeExpressions(withExpressions(), sampler);
    expect(res).toMatchObject({ baked: 0, failed: 2 });
    expect(hasExpressions(res.anim)).toBe(true);
  });
});
