import { svgToArt } from '../content/svg';
import type { VectorArt } from '../content/art';

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
