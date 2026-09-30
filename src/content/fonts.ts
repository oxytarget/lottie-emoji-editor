import { parse, type Font } from 'opentype.js/dist/opentype.mjs';
import { BUNDLED_FONTS } from './fontCatalog';

export interface FontOption {
  id: string;
  label: string;
  /** CSS family used to preview the font name in the picker. */
  cssFamily: string;
  custom?: boolean;
}

/** A loaded font = one or more opentype faces (e.g. latin + cyrillic subsets) tried in order. */
export interface LoadedFont {
  id: string;
  faces: Font[];
}

export const DEFAULT_FONT_ID = BUNDLED_FONTS[0].id;

const cache = new Map<string, Promise<LoadedFont>>();
const customFonts = new Map<string, { label: string; font: Font; buffer: ArrayBuffer }>();
const cssRegistered = new Set<string>();

export function fontOptions(): FontOption[] {
  return [
    ...BUNDLED_FONTS.map((f) => ({ id: f.id, label: f.label, cssFamily: `emoji-${f.id}` })),
    ...[...customFonts.entries()].map(([id, f]) => ({ id, label: f.label, cssFamily: `emoji-${id}`, custom: true })),
  ];
}

export function hasFont(id: string): boolean {
  return BUNDLED_FONTS.some((f) => f.id === id) || customFonts.has(id);
}

async function fetchBuffer(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Font download failed (${res.status})`);
  return res.arrayBuffer();
}

export function loadFont(id: string): Promise<LoadedFont> {
  const cached = cache.get(id);
  if (cached) return cached;
  const custom = customFonts.get(id);
  let promise: Promise<LoadedFont>;
  if (custom) {
    promise = Promise.resolve({ id, faces: [custom.font] });
  } else {
    const def = BUNDLED_FONTS.find((f) => f.id === id) ?? BUNDLED_FONTS[0];
    promise = Promise.all(def.files.map(fetchBuffer)).then((buffers) => ({ id: def.id, faces: buffers.map((b) => parse(b)) }));
  }
  promise.catch(() => cache.delete(id));
  cache.set(id, promise);
  return promise;
}

/**
 * Registers a user supplied TTF/OTF/WOFF font. WOFF2 is not supported by the parser.
 * Returns the new font id.
 */
export async function addCustomFont(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const sig = new Uint8Array(buffer.slice(0, 4));
  const tag = String.fromCharCode(...sig);
  if (tag === 'wOF2') throw new Error('WOFF2');
  const font = parse(buffer);
  const id = `custom-${Date.now().toString(36)}`;
  const family = font.names.fontFamily?.en ?? Object.values(font.names.fontFamily ?? {})[0];
  const label = family || file.name.replace(/\.[^.]+$/, '');
  customFonts.set(id, { label, font, buffer });
  return id;
}

/** Makes font names in the picker render in their own typeface (best effort, browser only). */
export function registerCssFont(id: string): void {
  if (cssRegistered.has(id) || typeof document === 'undefined' || typeof FontFace === 'undefined') return;
  cssRegistered.add(id);
  const custom = customFonts.get(id);
  const def = BUNDLED_FONTS.find((f) => f.id === id);
  const sources = custom ? [custom.buffer] : def ? def.files.map((u) => `url(${u})`) : [];
  for (const src of sources) {
    const face = new FontFace(`emoji-${id}`, src);
    face
      .load()
      .then((f) => document.fonts.add(f))
      .catch(() => undefined);
  }
}
