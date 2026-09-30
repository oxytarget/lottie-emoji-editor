import { extractPalette } from '../lottie/imported';
import { matchColors, matchPart } from '../lottie/packs';
import { isIdentityXf, type PartXf } from '../lottie/parts';
import type { ImportedTemplate } from './store';

/**
 * Edits of an imported animation, described by intent so they can be repeated on other stickers
 * ("apply to all selected"): parts are found again in each sticker by their shape, colours by value.
 */
export type ImportOp =
  | { kind: 'color'; from: string; to: string }
  | { kind: 'colorsReset' }
  | { kind: 'overlay'; value: boolean }
  | { kind: 'hide'; part: string; hidden: boolean }
  | { kind: 'replace'; part: string | null }
  | { kind: 'transform'; part: string; xf: PartXf | null }
  | { kind: 'partsReset' };

type Patch = Partial<Pick<ImportedTemplate, 'colorMap' | 'overlay' | 'hidden' | 'replace' | 'transforms' | 'data' | 'layout' | 'palette'>>;

const isAncestor = (a: string, b: string) => b.startsWith(`${a}/`) || b.startsWith(`${a}>`);

/** Applies an op whose parts/colours already refer to `t` itself. */
export function applyImportOp(t: ImportedTemplate, op: ImportOp): Patch {
  switch (op.kind) {
    case 'color':
      return { colorMap: { ...t.colorMap, [op.from]: op.to } };
    case 'colorsReset':
      return { colorMap: {} };
    case 'overlay':
      // The content appears once: on top instead of inside a replaced part.
      return op.value ? { overlay: true, replace: null } : { overlay: false };
    case 'hide': {
      const hidden = op.hidden ? [...new Set([...t.hidden, op.part])] : t.hidden.filter((h) => h !== op.part);
      return { hidden, replace: op.hidden && t.replace === op.part ? null : t.replace };
    }
    case 'replace':
      if (!op.part) return { replace: null };
      // The replaced part and everything around it must stay visible; the copy on top goes away.
      return { replace: op.part, overlay: false, hidden: t.hidden.filter((h) => h !== op.part && !isAncestor(h, op.part!)) };
    case 'transform': {
      const { [op.part]: _old, ...rest } = t.transforms;
      return { transforms: op.xf && !isIdentityXf(op.xf) ? { ...rest, [op.part]: op.xf } : rest };
    }
    case 'partsReset': {
      // Back to the imported structure too (inserted logos and moved layers go away).
      const structure = t.layout.length ? { data: t.base, layout: [], palette: extractPalette(t.base) } : {};
      return { ...structure, hidden: t.defaults?.hidden ?? [], replace: t.defaults?.replace ?? null, overlay: t.defaults?.overlay ?? false, transforms: {} };
    }
  }
}

/** The part of `target` an op on `source` means: its own logo for the logo, otherwise the same-shaped part. */
function mapPart(source: ImportedTemplate, target: ImportedTemplate, part: string): string | null {
  if (part === source.replace && target.replace) return target.replace;
  return matchPart(source.data, part, target.data);
}

/**
 * The same edit for another sticker, or null when it has nothing to change (no such part or colour).
 * `op` is the edit as made on `source`.
 */
export function importOpFor(source: ImportedTemplate, target: ImportedTemplate, op: ImportOp): ImportOp | null {
  switch (op.kind) {
    case 'colorsReset':
    case 'overlay':
    case 'partsReset':
      return op;
    case 'replace': {
      if (!op.part) return op;
      const part = matchPart(source.data, op.part, target.data);
      return part ? { ...op, part } : null;
    }
    case 'hide':
    case 'transform': {
      const part = mapPart(source, target, op.part);
      return part ? { ...op, part } : null;
    }
    case 'color':
      return matchColors(target.palette, op.from).length ? op : null;
  }
}

/** Patch for another sticker (colours: every nearly equal colour of its palette). */
export function applyImportOpTo(source: ImportedTemplate, target: ImportedTemplate, op: ImportOp): Patch | null {
  const mapped = importOpFor(source, target, op);
  if (!mapped) return null;
  if (mapped.kind === 'color') {
    const colorMap = { ...target.colorMap };
    for (const c of matchColors(target.palette, mapped.from)) colorMap[c] = mapped.to;
    return { colorMap };
  }
  return applyImportOp(target, mapped);
}
