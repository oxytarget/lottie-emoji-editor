import { create } from 'zustand';
import type { GradTarget } from './gradients';
import type { ImportOp } from './importOps';
import { useEditor, type PackRef } from './store';

export type PackStatus =
  | { state: 'loading'; done: number; total: number }
  | { state: 'ready'; count: number; skipped: number }
  | { state: 'error'; error: 'not-found' | 'empty' | 'network' | 'server' };

export type Tab = 'templates' | 'content' | 'colors' | 'parts';

/** Session-only UI state shared between the grid, the preview and the parts list. */
interface UiState {
  /** Editor panel shown under the preview. */
  tab: Tab;
  setTab(tab: Tab): void;
  /** Pack sticker tiles currently on screen (only those, plus selected ones, are compiled). */
  visible: ReadonlySet<string>;
  setVisible(id: string, visible: boolean): void;
  /** Part grabbed on the canvas / in the parts list. */
  grab: { id: string; part: string } | null;
  setGrab(grab: { id: string; part: string } | null): void;
  packStatus: Record<string, PackStatus>;
  setPackStatus(name: string, status: PackStatus): void;
  /** Forget a failed load so the pack is fetched again. */
  clearPackStatus(name: string): void;
  /** Template packs the bot offers to everyone (null until loaded). */
  botPacks: PackRef[] | null;
  setBotPacks(packs: PackRef[]): void;
  openPacks: Record<string, boolean>;
  setPackOpen(name: string, open: boolean): void;
  /** Favourite colour being painted onto swatches (tap a swatch to apply it). */
  paintColor: string | null;
  setPaintColor(color: string | null): void;
  /** Canvas resizing keeps proportions (unlocked: free stretching). */
  ratioLock: boolean;
  setRatioLock(locked: boolean): void;
  /** Gradient whose handles are shown on the canvas. */
  gradEdit: GradTarget | null;
  setGradEdit(target: GradTarget | null): void;
  /** Gradient of a layer of an imported animation shown with handles on the canvas (see lottie/itemPaints.ts). */
  gradItem: { imp: string; item: string } | null;
  setGradItem(item: { imp: string; item: string } | null): void;
  /** Result of the last edit repeated on the selected animations (for a short confirmation). */
  syncReport: { applied: number; total: number; n: number } | null;
  setSyncReport(report: { applied: number; total: number }): void;
}

const pendingVisible = new Map<string, boolean>();
let visibleTimer: ReturnType<typeof setTimeout> | undefined;

export const useUi = create<UiState>()((set, get) => ({
  tab: 'templates',
  setTab: (tab) => set({ tab }),
  visible: new Set(),
  // Batched: while scrolling a big pack, tiles come and go every few pixels, and each change recompiles and
  // re-renders — one update per moment is enough.
  setVisible: (id, visible) => {
    pendingVisible.set(id, visible);
    if (visibleTimer) return;
    visibleTimer = setTimeout(() => {
      visibleTimer = undefined;
      const current = get().visible;
      const next = new Set(current);
      for (const [key, on] of pendingVisible) {
        if (on) next.add(key);
        else next.delete(key);
      }
      pendingVisible.clear();
      if (next.size !== current.size || [...next].some((key) => !current.has(key))) set({ visible: next });
    }, 120);
  },
  grab: null,
  setGrab: (grab) => set({ grab }),
  packStatus: {},
  setPackStatus: (name, status) => set({ packStatus: { ...get().packStatus, [name]: status } }),
  clearPackStatus: (name) => {
    const { [name]: _gone, ...rest } = get().packStatus;
    set({ packStatus: rest });
  },
  botPacks: null,
  setBotPacks: (botPacks) => set({ botPacks }),
  openPacks: {},
  setPackOpen: (name, open) => set({ openPacks: { ...get().openPacks, [name]: open } }),
  paintColor: null,
  setPaintColor: (paintColor) => set({ paintColor }),
  ratioLock: true,
  setRatioLock: (ratioLock) => set({ ratioLock }),
  gradEdit: null,
  // One set of gradient handles at a time.
  setGradEdit: (gradEdit) => set(gradEdit ? { gradEdit, gradItem: null } : { gradEdit }),
  gradItem: null,
  setGradItem: (gradItem) => set(gradItem ? { gradItem, gradEdit: null } : { gradItem }),
  syncReport: null,
  setSyncReport: (report) => set({ syncReport: { ...report, n: (get().syncReport?.n ?? 0) + 1 } }),
}));

/** Edits an imported animation (and the selected ones, when "apply to all selected" is on) and reports it. */
export function editImport(id: string, op: ImportOp): void {
  const result = useEditor.getState().editImport(id, op);
  if (result.total) useUi.getState().setSyncReport(result);
}
