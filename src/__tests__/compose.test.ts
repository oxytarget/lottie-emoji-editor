import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'opentype.js/dist/opentype.mjs';
import { describe, expect, it } from 'vitest';
import { svgToArt } from '../content/svg';
import { textToArt } from '../content/text';
import { compose, type ComposeInput } from '../lottie/compose';
import { checkTgs, readLottieFile, toJson, toTgs } from '../lottie/export';
import { extractPalette, recolor, withOverlay } from '../lottie/imported';
import { solid } from '../lottie/paint';
import type { Layer, LottieAnimation } from '../lottie/types';
import { BUILTIN_TEMPLATES } from '../templates/builtin';

const face = (name: string) => {
  const buf = readFileSync(resolve(__dirname, '../../node_modules/@fontsource/nunito/files', name));
  return parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
};
const font = { id: 'nunito', faces: [face('nunito-latin-900-normal.woff'), face('nunito-cyrillic-900-normal.woff')] };
const art = textToArt(font, { text: 'Привіт', letterSpacing: 0, lineHeight: 1, uppercase: false }).art!;

const base = (template = BUILTIN_TEMPLATES[0]): ComposeInput => ({
  template,
  art,
  artStyle: { mode: 'paint', fill: solid('#ffffff'), outline: solid('#111111'), outlineWidth: 8 },
  colors: { body: solid('#7c3aed'), outline: solid('#1e1b4b'), accent: { type: 'linear', colors: ['#f97316', '#facc15'], angle: 90 } },
  outlineWidth: 12,
  scale: 1,
  offsetY: 0,
});

function allNumbers(node: unknown, out: number[] = []): number[] {
  if (typeof node === 'number') out.push(node);
  else if (Array.isArray(node)) node.forEach((n) => allNumbers(n, out));
  else if (node && typeof node === 'object') Object.values(node).forEach((n) => allNumbers(n, out));
  return out;
}

describe('templates', () => {
  it.each(BUILTIN_TEMPLATES.map((t) => [t.id, t] as const))('%s composes into a valid TGS', (_id, template) => {
    const anim = compose(base(template));
    expect(anim.w).toBe(512);
    expect(anim.fr).toBe(60);
    expect(anim.op).toBeLessThanOrEqual(180);
    expect(allNumbers(anim).every(Number.isFinite)).toBe(true);

    const inds = new Set(anim.layers.map((l) => l.ind));
    expect(inds.size).toBe(anim.layers.length);
    for (const l of anim.layers) if (l.parent) expect(inds.has(l.parent)).toBe(true);
    expect(anim.layers.some((l) => l.nm === 'content')).toBe(true);

    const bytes = toTgs(anim).length;
    expect(checkTgs(anim, bytes).ok).toBe(true);
    expect(bytes).toBeLessThan(40 * 1024);

    // Round-trips through the TGS reader.
    expect(readLottieFile(toTgs(anim)).layers).toHaveLength(anim.layers.length);
  });

  it('keyframes are sorted and inside the timeline', () => {
    for (const template of BUILTIN_TEMPLATES) {
      const anim = compose(base(template));
      const check = (node: unknown) => {
        if (Array.isArray(node)) return node.forEach(check);
        if (!node || typeof node !== 'object') return;
        const o = node as Record<string, unknown>;
        if (o.a === 1 && Array.isArray(o.k)) {
          const times = (o.k as { t: number }[]).map((k) => k.t);
          for (let i = 1; i < times.length; i++) expect(times[i], `${template.id}`).toBeGreaterThan(times[i - 1]);
          expect(times[0]).toBeGreaterThanOrEqual(0);
          expect(times[times.length - 1]).toBeLessThanOrEqual(anim.op);
        }
        Object.values(o).forEach(check);
      };
      check(anim.layers);
    }
  });

  it('omits the content layer when there is nothing to show', () => {
    const anim = compose({ ...base(), art: null });
    expect(anim.layers.some((l: Layer) => l.nm === 'content')).toBe(false);
  });

  it('applies the height offset to the content layer', () => {
    const a = compose(base());
    const b = compose({ ...base(), offsetY: -30 });
    const pos = (x: LottieAnimation) => (x.layers.find((l) => l.nm === 'content')!.ks.p as { k: number[] }).k[1];
    expect(pos(b) - pos(a)).toBe(-30);
  });

  it('keeps logos with original colours', () => {
    const logo = svgToArt('<svg viewBox="0 0 10 10"><rect width="10" height="10" fill="#ff0000"/><circle cx="5" cy="5" r="3" fill="#00ff00"/></svg>').art!;
    const anim = compose({ ...base(), art: logo, artStyle: { mode: 'original', fill: solid('#fff'), outline: null, outlineWidth: 0 } });
    const content = anim.layers.find((l) => l.nm === 'content')!;
    const json = JSON.stringify(content.shapes);
    expect(json).toContain('[1,0,0,1]');
    expect(json).toContain('[0,1,0,1]');
  });
});

describe('imported lottie', () => {
  it('extracts and replaces colours, then adds an overlay', () => {
    const anim = compose(base());
    const palette = extractPalette(anim);
    expect(palette).toContain('#7c3aed');
    const recolored = recolor(anim, { '#7c3aed': '#00ff00' });
    expect(extractPalette(recolored)).toContain('#00ff00');
    expect(extractPalette(recolored)).not.toContain('#7c3aed');
    // Original untouched.
    expect(extractPalette(anim)).toContain('#7c3aed');

    const withText = withOverlay(recolored, { art, artStyle: base().artStyle, scale: 1, offsetY: 0 });
    expect(withText.layers).toHaveLength(anim.layers.length + 1);
    expect(withText.layers[0].ind).toBeGreaterThan(Math.max(...anim.layers.map((l) => l.ind)));
    expect(toJson(withText)).not.toContain('"tgs"');
  });
});

describe('compileAll', () => {
  it('builds every template and imported animation with sizes', async () => {
    const { compileAll } = await import('../state/compile');
    const { tgsFromJson } = await import('../lottie/export');
    const b = base();
    const imported = compose(base(BUILTIN_TEMPLATES[1]));
    const out = compileAll({
      art: b.art,
      artStyle: b.artStyle,
      colors: b.colors,
      outlineWidth: 12,
      scale: 1,
      offsetY: 0,
      imports: [{ id: 'import-x', data: imported, colorMap: { '#7c3aed': '#ff0000' }, overlay: true }],
    });
    expect(out.map((o) => o.id)).toEqual([...BUILTIN_TEMPLATES.map((t) => t.id), 'import-x']);
    for (const o of out) {
      expect(o.check.ok).toBe(true);
      expect(o.check.bytes).toBe(tgsFromJson(o.json).length);
      const parsed = readLottieFile(tgsFromJson(o.json));
      expect(parsed.tgs).toBe(1);
    }
    const imp = JSON.parse(out[out.length - 1].json) as LottieAnimation;
    expect(imp.layers[0].nm).toBe('content');
    expect(extractPalette(imp)).toContain('#ff0000');
  });
});
