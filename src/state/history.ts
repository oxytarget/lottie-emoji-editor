import { DRAFT_KEYS, packEditOf, useEditor, type EditorData, type ImportedTemplate } from './store';

/**
 * Undo/redo of edits: the design (text/logo, colours, placement) and the edits of imported animations
 * (colours, hidden/replaced/moved parts, the layer list). Selection and loading packs are not edits. A burst
 * of changes to the same things (a slider being dragged, typing) is one step.
 */

const DESIGN = DRAFT_KEYS.filter((k) => k !== 'selected' && k !== 'active') as Array<keyof EditorData>;
const IMPORT_FIELDS = ['data', 'layout', 'palette', 'colorMap', 'overlay', 'hidden', 'replace', 'transforms', 'paints'] as const;
type ImportEdits = Pick<ImportedTemplate, (typeof IMPORT_FIELDS)[number]>;

interface Snapshot {
  design: Partial<EditorData>;
  imports: Record<string, ImportEdits>;
}

const LIMIT = 100;
/** Changes to the same things within this time are one step. */
const BURST_MS = 700;

let undoStack: Snapshot[] = [];
let redoStack: Snapshot[] = [];
let applying = false;
let lastAt = 0;
let lastKeys = '';

const pick = <T extends object, K extends keyof T>(obj: T, keys: readonly K[]) => Object.fromEntries(keys.map((k) => [k, obj[k]])) as Pick<T, K>;

function snapshot(s: EditorData, only?: ReadonlySet<string>): Snapshot {
  const imports: Record<string, ImportEdits> = {};
  for (const i of s.imports) if (!only || only.has(i.id)) imports[i.id] = pick(i, IMPORT_FIELDS);
  return { design: pick(s, DESIGN), imports };
}

/** What changed between two states: design keys and ids of imports whose edits differ. */
function changes(s: EditorData, prev: EditorData): { keys: string[]; imports: string[] } {
  const keys = DESIGN.filter((k) => s[k] !== prev[k]) as string[];
  const before = new Map(prev.imports.map((i) => [i.id, i]));
  const imports = s.imports.filter((i) => {
    const p = before.get(i.id);
    // New animations (a pack loading) are not edits.
    return !!p && p !== i && IMPORT_FIELDS.some((f) => i[f] !== p[f]);
  });
  return { keys, imports: imports.map((i) => i.id) };
}

let started = false;

/** Starts recording (once). */
export function startHistory(): void {
  if (started) return;
  started = true;
  useEditor.subscribe((s, prev) => {
    if (applying) return;
    const { keys, imports } = changes(s, prev);
    if (!keys.length && !imports.length) return;
    const id = [...keys, ...imports].join(',');
    const now = Date.now();
    if (id !== lastKeys || now - lastAt > BURST_MS) {
      undoStack.push(snapshot(prev, new Set(imports)));
      if (undoStack.length > LIMIT) undoStack.shift();
      redoStack = [];
    }
    lastAt = now;
    lastKeys = id;
  });
}

function apply(snap: Snapshot): void {
  applying = true;
  try {
    const s = useEditor.getState();
    const packEdits = { ...s.packEdits };
    const imports = s.imports.map((i) => {
      const edits = snap.imports[i.id];
      if (!edits) return i;
      const next = { ...i, ...edits };
      if (next.source) packEdits[next.source.uid] = packEditOf(next);
      return next;
    });
    useEditor.setState({ ...snap.design, imports, packEdits });
  } finally {
    applying = false;
    lastAt = 0;
    lastKeys = '';
  }
}

function step(from: Snapshot[], to: Snapshot[]): boolean {
  const snap = from.pop();
  if (!snap) return false;
  // The state now, for the way back (the same imports the step touches).
  to.push(snapshot(useEditor.getState(), new Set(Object.keys(snap.imports))));
  apply(snap);
  return true;
}

export const undo = (): boolean => step(undoStack, redoStack);
export const redo = (): boolean => step(redoStack, undoStack);
export const canUndo = (): boolean => undoStack.length > 0;

/** For tests. */
export function clearHistory(): void {
  undoStack = [];
  redoStack = [];
  lastAt = 0;
  lastKeys = '';
}
