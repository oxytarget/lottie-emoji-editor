import { svgToArt } from '../content/svg';
import type { VectorArt } from '../content/art';

/**
 * A text layer added to an imported animation is stored like an inserted logo — under a key in `layoutSvgs` —
 * as JSON holding its settings and the outlines made from them (kept, so replaying the layer list never waits
 * for a font to load).
 */
export interface TextLayerSpec {
  text: string;
  fontId: string;
  fill: string;
  outline: string;
  /** Outline width, in units of a 100 px font (0 = none). */
  outlineWidth: number;
  uppercase: boolean;
}

export interface StoredText extends TextLayerSpec {
  emojiStudio: 'text';
  v: 1;
  /** Makes every text layer's key its own (two equal texts are still two layers to edit). */
  id: string;
  art: VectorArt;
}

const MARK = '"emojiStudio":"text"';

export function parseTextLayer(raw: string | undefined): StoredText | null {
  if (!raw || !raw.includes(MARK)) return null;
  try {
    const t = JSON.parse(raw) as StoredText;
    return t.emojiStudio === 'text' && t.art && Array.isArray(t.art.items) ? t : null;
  } catch {
    return null;
  }
}

const textCache = new Map<string, VectorArt | null>();

/** The artwork an inserted layer's key stands for: a text layer's outlines, or a logo's SVG. */
export function layerArt(raw: string | undefined): VectorArt | null {
  if (!raw?.includes(MARK)) return logoArt(raw);
  if (!textCache.has(raw)) textCache.set(raw, parseTextLayer(raw)?.art ?? null);
  return textCache.get(raw) ?? null;
}

/** Parsed logos inserted in layer lists (parsing an SVG needs the DOM, so it happens once per logo). */
const cache = new Map<string, VectorArt | null>();

export function logoArt(svg: string | undefined): VectorArt | null {
  if (!svg) return null;
  if (!cache.has(svg)) cache.set(svg, svgToArt(svg).art);
  return cache.get(svg) ?? null;
}

/** Short stable key of an SVG (logos are stored once and referenced from layer operations). */
export function svgKey(svg: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < svg.length; i++) {
    const ch = svg.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `s${(4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)}`;
}
