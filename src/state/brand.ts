import { artBrandColors, brandColorMaps, familyColorMap, paintBrandColors, type ColorFamily } from '../lottie/brand';
import { logoArt } from './logoArt';
import { packEditOf, useEditor } from './store';

/** Where brand colours come from: the user's logo/text, or the emoji colours of the Colours tab. */
export type BrandSource = 'content' | 'palette';

/** Brand colours (colourful ones only, most important first); empty when there are none. */
export function brandColors(source: BrandSource): string[] {
  const s = useEditor.getState();
  if (source === 'palette') return paintBrandColors([s.colors.body, s.colors.accent, s.colors.outline]);
  if (s.mode === 'logo' && s.logo && s.logoColors === 'original') {
    const art = logoArt(s.logo.svg);
    if (art) return artBrandColors(art);
  }
  // The text's fill only: its outline is a dark stroke, not a brand colour.
  return paintBrandColors([s.textFill]);
}

/**
 * Recolours imported animations into brand colours (`null` = back to their own colours). One mapping for all
 * of them, so a pack stays consistent. Returns how many were changed (0 when there is no brand colour).
 */
export function brandImports(ids: readonly string[], source: BrandSource | null): number {
  const { imports, packEdits } = useEditor.getState();
  const targets = imports.filter((t) => ids.includes(t.id));
  if (!targets.length) return 0;
  const maps = source ? brandColorMaps(targets.map((t) => t.data), brandColors(source)) : targets.map(() => ({}));
  if (!maps) return 0;
  const byId = new Map(targets.map((t, i) => [t.id, maps[i]]));
  const edits = { ...packEdits };
  const next = imports.map((t) => {
    const colorMap = byId.get(t.id);
    if (!colorMap) return t;
    const updated = { ...t, colorMap };
    if (updated.source) edits[updated.source.uid] = packEditOf(updated);
    return updated;
  });
  useEditor.setState({ imports: next, packEdits: edits });
  return targets.length;
}

/**
 * One main colour of a pack changed in all its stickers (`to` = null: back to the file's colours). The
 * family's shades move along, so shadows and highlights stay.
 */
export function recolorFamily(ids: readonly string[], family: ColorFamily, to: string | null): void {
  const { imports, packEdits } = useEditor.getState();
  const map = to ? familyColorMap(family, to) : null;
  const edits = { ...packEdits };
  const next = imports.map((t) => {
    if (!ids.includes(t.id)) return t;
    const colorMap = { ...t.colorMap };
    for (const hex of family.colors) {
      if (map && map[hex] !== hex) colorMap[hex] = map[hex];
      else delete colorMap[hex];
    }
    const updated = { ...t, colorMap };
    if (updated.source) edits[updated.source.uid] = packEditOf(updated);
    return updated;
  });
  useEditor.setState({ imports: next, packEdits: edits });
}
