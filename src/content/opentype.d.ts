// Minimal typings for the parts of opentype.js 2.x used by the editor (imported via its ESM build).
declare module 'opentype.js/dist/opentype.mjs' {
  export interface PathCommand {
    type: 'M' | 'L' | 'C' | 'Q' | 'Z';
    x?: number;
    y?: number;
    x1?: number;
    y1?: number;
    x2?: number;
    y2?: number;
  }

  export interface Path {
    commands: PathCommand[];
  }

  export interface Glyph {
    index: number;
    advanceWidth?: number;
    getPath(x: number, y: number, fontSize: number, options?: Record<string, unknown>, font?: Font): Path;
  }

  export interface Font {
    unitsPerEm: number;
    ascender: number;
    descender: number;
    names: { fontFamily?: Record<string, string> };
    charToGlyphIndex(ch: string): number;
    glyphs: { get(index: number): Glyph; length: number };
    getKerningValue(left: Glyph, right: Glyph): number;
    tables: Record<string, unknown>;
  }

  export function parse(buffer: ArrayBuffer, options?: Record<string, unknown>): Font;
}
