import type { Font, Glyph } from 'opentype.js/dist/opentype.mjs';
import { commandsToContours, type Contour } from '../lottie/bezier';
import { artBBox, type VectorArt } from './art';
import type { LoadedFont } from './fonts';

export interface TextOptions {
  text: string;
  /** Extra space between letters, in em. */
  letterSpacing: number;
  /** Distance between baselines, in em. */
  lineHeight: number;
  uppercase: boolean;
}

export interface TextResult {
  art: VectorArt | null;
  /** Characters no face of the font could render (e.g. emoji). */
  missing: string[];
}

const FONT_SIZE = 100;

interface PlacedGlyph {
  face: Font;
  glyph: Glyph;
}

/** Maps characters to glyphs, falling back through the faces (e.g. latin → cyrillic subset). */
function glyphsFor(line: string, faces: readonly Font[]): PlacedGlyph[] {
  const out: PlacedGlyph[] = [];
  for (const ch of Array.from(line)) {
    for (const face of faces) {
      const idx = face.charToGlyphIndex(ch);
      if (idx > 0) {
        out.push({ face, glyph: face.glyphs.get(idx) });
        break;
      }
    }
  }
  return out;
}

function kerning(a: PlacedGlyph, b: PlacedGlyph): number {
  if (a.face !== b.face) return 0;
  try {
    return a.face.getKerningValue(a.glyph, b.glyph) || 0;
  } catch {
    // Some GPOS lookup formats are not supported by opentype.js — kerning is optional.
    return 0;
  }
}

/** Lays out (multi-line, centred) text and converts every glyph into bezier contours. */
export function textToArt(font: LoadedFont, opts: TextOptions): TextResult {
  const source = opts.uppercase ? opts.text.toLocaleUpperCase() : opts.text;
  const lines = source
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l, i, all) => l.length > 0 || (i > 0 && i < all.length - 1));

  const missing = new Set<string>();
  for (const ch of Array.from(source)) {
    if (/\s/.test(ch)) continue;
    if (!font.faces.some((f) => f.charToGlyphIndex(ch) > 0)) missing.add(ch);
  }

  const glyphOpts = { drawSVG: false, drawLayers: false, hinting: false };
  const spacing = opts.letterSpacing * FONT_SIZE;
  const contours: Contour[] = [];
  lines.forEach((line, lineIdx) => {
    const glyphs = glyphsFor(line, font.faces);
    if (!glyphs.length) return;
    // Pen positions (manual layout: opentype.js shaping throws on some GSUB formats).
    const xs: number[] = [];
    let x = 0;
    glyphs.forEach((g, i) => {
      xs.push(x);
      x += ((g.glyph.advanceWidth ?? 0) * FONT_SIZE) / g.face.unitsPerEm;
      if (i < glyphs.length - 1) x += (kerning(g, glyphs[i + 1]) * FONT_SIZE) / g.face.unitsPerEm + spacing;
    });
    const offset = -x / 2;
    const y = lineIdx * opts.lineHeight * FONT_SIZE;
    glyphs.forEach((g, i) => {
      const path = g.glyph.getPath(xs[i] + offset, y, FONT_SIZE, glyphOpts, g.face);
      contours.push(...commandsToContours(path.commands));
    });
  });

  if (!contours.length) return { art: null, missing: [...missing] };

  const items = [{ contours, fill: { type: 'solid' as const, color: [0, 0, 0, 1] as [number, number, number, number] }, stroke: null, evenOdd: false, opacity: 1 }];
  const bbox = artBBox(items);
  if (!bbox) return { art: null, missing: [...missing] };
  const primary = font.faces[0];
  // Roughly the cap height: prevents a lone "-" or "." from being scaled to fill the whole slot.
  const capHeight = ((primary.ascender * 0.7) / primary.unitsPerEm) * FONT_SIZE;
  return { art: { kind: 'text', items, bbox, minFitHeight: capHeight }, missing: [...missing] };
}
