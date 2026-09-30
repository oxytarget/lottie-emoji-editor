import { create } from 'zustand';
import type { ImportOp } from './importOps';
import { useEditor, type PackRef } from './store';

export type PackStatus =
  | { state: 'loading'; done: number; total: number }
  | { state: 'ready'; count: number; skipped: number }
  | { state: 'error'; error: 'not-found' | 'empty' | 'network' | 'server' };

/** Session-only UI state shared between the grid, the preview and the parts list. */
interface UiState {
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
  /** Result of the last edit repeated on the selected animations (for a short confirmation). */
  syncReport: { applied: number; total: number; n: number } | null;
  setSyncReport(report: { applied: number; total: number }): void;
}

export const useUi = create<UiState>()((set, get) => ({
  visible: new Set(),
  setVisible: (id, visible) => {
    const current = get().visible;
    if (current.has(id) === visible) return;
    const next = new Set(current);
    if (visible) next.add(id);
    else next.delete(id);
    set({ visible: next });
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
  syncReport: null,
  setSyncReport: (report) => set({ syncReport: { ...report, n: (get().syncReport?.n ?? 0) + 1 } }),
}));

/** Edits an imported animation (and the selected ones, when "apply to all selected" is on) and reports it. */
export function editImport(id: string, op: ImportOp): void {
  const result = useEditor.getState().editImport(id, op);
  if (result.total) useUi.getState().setSyncReport(result);
}
