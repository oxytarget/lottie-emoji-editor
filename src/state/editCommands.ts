import { translate } from '../i18n';
import { haptic } from '../lib/telegram';
import { parseFragment, partFragment } from '../lottie/fragment';
import { recolor } from '../lottie/imported';
import { applyItemPaints } from '../lottie/itemPaints';
import { INSERTED, parentOf, rootOf, type Drop } from '../lottie/layout';
import { flattenParts, listParts } from '../lottie/parts';
import { useEditor, type ImportedTemplate } from './store';
import { editImport, useUi } from './ui';

const say = (key: Parameters<typeof translate>[1]) => useUi.getState().showToast(translate(useEditor.getState().lang, key));

/**
 * Deletes what is selected in the editor: a grabbed part of an imported animation is hidden; the user's
 * text/logo leaves this animation (no copy on top, and the part it replaced stays hidden too) — on a built-in
 * template the text/logo itself is cleared. All of it comes back with Ctrl+Z. False when nothing is selected.
 */
export function deleteSelection(content = useUi.getState().canvasSelected): boolean {
  const ui = useUi.getState();
  const s = useEditor.getState();
  const imp = s.imports.find((i) => i.id === s.active);
  if (ui.grab && imp && ui.grab.id === imp.id) {
    editImport(imp.id, { kind: 'hide', part: ui.grab.part, hidden: true });
    ui.setGrab(null);
  } else if (content && imp) {
    if (imp.replace) editImport(imp.id, { kind: 'hide', part: imp.replace, hidden: true });
    else if (imp.overlay) editImport(imp.id, { kind: 'overlay', value: false });
    else return false;
  } else if (content && !imp) {
    if (s.mode === 'logo' && s.logo) s.set('logo', null);
    else if (s.text) s.set('text', '');
    else return false;
  } else {
    return false;
  }
  ui.setCanvasSelected(false);
  haptic();
  say('deleted');
  return true;
}

// ---------------------------------------------------------------------------
// Copy / paste of layers (also between editor windows: the system clipboard, and this browser's storage)
// ---------------------------------------------------------------------------

const CLIP_KEY = 'emoji-studio-clip';
/** Bigger than this does not fit in the browser storage next to everything else. */
const MAX_CLIP = 1_500_000;

/** The grabbed part of the open imported animation as clipboard text (its colours as edited); null if none. */
export function copySelection(): string | null {
  const ui = useUi.getState();
  const s = useEditor.getState();
  const imp = s.imports.find((i) => i.id === s.active);
  if (!ui.grab || !imp || ui.grab.id !== imp.id) return null;
  const part = flattenParts(listParts(imp.data)).find((p) => p.id === ui.grab!.part);
  if (!part) return null;
  const anim = recolor(imp.data, imp.colorMap);
  if (imp.paints) applyItemPaints(anim, imp.paints);
  const fragment = partFragment(anim, part.id, part.name.startsWith(INSERTED) ? part.name.slice(INSERTED.length) : part.name);
  if (!fragment) return null;
  const json = JSON.stringify(fragment);
  if (json.length > MAX_CLIP) {
    say('clipTooBig');
    return null;
  }
  try {
    localStorage.setItem(CLIP_KEY, json);
  } catch {
    /* full or blocked: the system clipboard still has it */
  }
  return json;
}

/** Copy from a button (no keyboard): the system clipboard where allowed, and this browser's storage. */
export async function copyToClipboard(): Promise<boolean> {
  const json = copySelection();
  if (!json) return false;
  try {
    await navigator.clipboard?.writeText(json);
  } catch {
    /* Telegram's webview may not allow it: the other windows of this browser still get it */
  }
  haptic();
  say('clipCopied');
  return true;
}

const nonce = () => Math.random().toString(36).slice(2, 8);

/** Where a pasted layer goes: next to the grabbed layer, or on top. */
function pasteTarget(imp: ImportedTemplate): Drop {
  const grab = useUi.getState().grab;
  if (grab && grab.id === imp.id && !grab.part.includes('/')) return parentOf(grab.part);
  return { parent: rootOf(imp.data), index: 0 };
}

/**
 * Pastes clipboard text into the open animation: a layer copied in this or another editor window, or SVG
 * markup (a logo). On a built-in template an SVG becomes the user's logo. True when something was pasted.
 */
export function pasteText(text: string | null | undefined): boolean {
  const s = useEditor.getState();
  const imp = s.imports.find((i) => i.id === s.active);
  const fragment = parseFragment(text);
  const svg = !fragment && text && /^\s*(<\?xml[^>]*>\s*)?<svg[\s>]/i.test(text) ? text.trim() : null;
  if (!fragment && !svg) return false;
  if (svg && !imp) {
    s.set('mode', 'logo');
    s.set('logo', { name: 'clipboard.svg', svg });
    say('logoPasted');
    return true;
  }
  if (!imp) {
    say('clipNoTarget');
    return true;
  }
  const key = s.putLayoutSvg(fragment ? JSON.stringify(fragment) : svg!);
  const name = `${INSERTED}${fragment ? fragment.name : 'logo'}`;
  const op = fragment ? { kind: 'insert' as const, svg: key, name, at: pasteTarget(imp), fragment: nonce() } : { kind: 'insert' as const, svg: key, name, at: pasteTarget(imp) };
  const id = s.layoutImport(imp.id, op);
  if (!id) return false;
  useUi.getState().setGrab({ id: imp.id, part: id });
  useUi.getState().setTab('parts');
  haptic();
  say(fragment ? 'clipPasted' : 'logoPasted');
  return true;
}

/** Paste from a button: the system clipboard if readable, else the last layer copied in this browser. */
export async function pasteFromClipboard(): Promise<boolean> {
  let text: string | null = null;
  try {
    text = (await navigator.clipboard?.readText()) ?? null;
  } catch {
    text = null;
  }
  if (pasteText(text)) return true;
  if (pasteText(storedClip())) return true;
  say('clipEmpty');
  return false;
}

/** The last layer copied in this browser (any window). */
export function storedClip(): string | null {
  try {
    return localStorage.getItem(CLIP_KEY);
  } catch {
    return null;
  }
}
