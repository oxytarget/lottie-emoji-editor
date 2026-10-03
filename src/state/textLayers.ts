import { artBBox, type ArtItem } from '../content/art';
import { DEFAULT_FONT_ID, hasFont, loadFont } from '../content/fonts';
import { textToArt } from '../content/text';
import { hexToRgba } from '../lottie/color';
import { applyLayout, INSERT_MN, INSERTED, parentOf, rootOf, type Drop, type LayoutOp } from '../lottie/layout';
import { extractPalette } from '../lottie/imported';
import { parseFragment } from '../lottie/fragment';
import { listPaintItems, type ItemPaint } from '../lottie/itemPaints';
import { resolvePart } from '../lottie/parts';
import { layerArt, parseTextLayer, type StoredText, type TextLayerSpec } from './logoArt';
import { useEditor, type ImportedTemplate } from './store';
import { useUi } from './ui';

/**
 * Extra texts in an imported animation: each is a layer of its own (added with "+ Text" in the layer list),
 * with its own words, font and colours, and can be edited later (stored form: see `StoredText`).
 */
export type { TextLayerSpec };

const solid = (hex: string) => ({ type: 'solid' as const, color: hexToRgba(hex) });

/** Builds a text layer's stored form (null when the text has nothing the font can draw). */
async function buildText(spec: TextLayerSpec, id: string): Promise<string | null> {
  const font = await loadFont(hasFont(spec.fontId) ? spec.fontId : DEFAULT_FONT_ID);
  const { art } = textToArt(font, { text: spec.text, letterSpacing: 0, lineHeight: 1.1, uppercase: spec.uppercase });
  if (!art) return null;
  const contours = art.items.flatMap((it) => it.contours);
  const fill: ArtItem = { contours, fill: solid(spec.fill), stroke: null, evenOdd: false, opacity: 1 };
  // The outline goes under the letters, so only its outer half shows (as on the main text). It is always there
  // (0 wide for none), so the layer's items keep their places and its colour edits stay on the right ones.
  const outline: ArtItem = {
    contours,
    fill: null,
    stroke: { paint: solid(spec.outline), width: Math.max(0, spec.outlineWidth) * 2, cap: 2, join: 2, miter: 4 },
    evenOdd: false,
    opacity: 1,
  };
  const items = [outline, fill];
  const stored: StoredText = { emojiStudio: 'text', v: 1, id, ...spec, art: { ...art, items, bbox: artBBox(items) ?? art.bbox } };
  return JSON.stringify(stored);
}

/** Shown in the layer list. */
const layerName = (spec: TextLayerSpec) => `${INSERTED}${spec.text.replace(/\s+/g, ' ').trim().slice(0, 28) || '…'}`;

/** A new text's settings: the colours of the main text when they are plain colours. */
export function newTextSpec(text: string): TextLayerSpec {
  const s = useEditor.getState();
  return {
    text,
    fontId: s.fontId,
    fill: s.textFill.type === 'solid' ? s.textFill.color : '#ffffff',
    outline: s.textOutline.type === 'solid' ? s.textOutline.color : '#111111',
    outlineWidth: s.textOutlineWidth || 8,
    uppercase: s.uppercase,
  };
}

const nonce = () => Math.random().toString(36).slice(2, 8);

/** Adds a text layer next to the grabbed layer (or on top) and grabs it. Returns its part id. */
export async function addTextLayer(impId: string, spec: TextLayerSpec): Promise<string | null> {
  const raw = await buildText(spec, nonce());
  const s = useEditor.getState();
  const imp = s.imports.find((i) => i.id === impId);
  if (!raw || !imp) return null;
  const key = s.putLayoutSvg(raw);
  const grab = useUi.getState().grab;
  const at: Drop = grab && grab.id === imp.id && !grab.part.includes('/') ? parentOf(grab.part) : { parent: rootOf(imp.data), index: 0 };
  const part = s.layoutImport(imp.id, { kind: 'insert', svg: key, name: layerName(spec), at });
  if (part) {
    useUi.getState().setGrab({ id: imp.id, part });
    useUi.getState().setTab('parts');
  }
  return part;
}

/** The text layer a part is (its key and settings), or null. */
export function textLayerOf(imp: ImportedTemplate, partId: string): { key: string; spec: StoredText } | null {
  const target = resolvePart(imp.data, partId);
  const obj = (target?.type === 'layer' ? target.layer : target?.type === 'group' ? target.group : null) as { mn?: unknown } | null;
  const mn = typeof obj?.mn === 'string' ? obj.mn : '';
  if (!mn.startsWith(INSERT_MN)) return null;
  const key = mn.slice(INSERT_MN.length);
  const spec = parseTextLayer(useEditor.getState().layoutSvgs[key]);
  return spec ? { key, spec } : null;
}

const latest = new Map<string, number>();

/**
 * Rebuilds a text layer with new settings, in place: the layer list is replayed with the new text, so the layer
 * keeps its place, moves, transparency and the rest; colour edits made in "Layer colours" stay on its letters
 * and outline — except the one `reset` names (a colour just picked here). False when nothing changed (the text
 * cannot be drawn, or a newer edit came meanwhile).
 */
export async function editTextLayer(impId: string, partId: string, spec: TextLayerSpec, reset?: 'fill' | 'stroke'): Promise<boolean> {
  const imp0 = useEditor.getState().imports.find((i) => i.id === impId);
  const before = imp0 ? textLayerOf(imp0, partId) : null;
  if (!before) return false;
  const job = `${impId}|${partId}`;
  const n = (latest.get(job) ?? 0) + 1;
  latest.set(job, n);
  const raw = await buildText(spec, before.spec.id);
  if (latest.get(job) !== n) return false;
  const s = useEditor.getState();
  const imp = s.imports.find((i) => i.id === impId);
  const current = imp ? textLayerOf(imp, partId) : null;
  if (!raw || !imp || !current) return false;
  const next = s.putLayoutSvg(raw);
  const layout: LayoutOp[] = imp.layout.map((op) => (op.kind === 'insert' && op.svg === current.key ? { ...op, svg: next, name: layerName(spec) } : op));
  const svgs = useEditor.getState().layoutSvgs;
  const data = applyLayout(imp.base, layout, (k) => layerArt(svgs[k]), (k) => parseFragment(svgs[k]));
  // Colour edits of the letters/outline move to the same items of the rebuilt layer.
  const was = listPaintItems(imp.data, partId);
  const now = listPaintItems(data, partId);
  const paints: Record<string, ItemPaint> = {};
  for (const [id, edit] of Object.entries(imp.paints ?? {})) {
    const i = was.findIndex((item) => item.id === id);
    if (i < 0) paints[id] = edit;
    else if (now[i] && was[i].kind !== reset) paints[now[i].id] = edit;
  }
  s.updateImport(impId, { data, layout, paints, palette: extractPalette(data) });
  return true;
}
