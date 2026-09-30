import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { DEFAULT_FONT_ID } from '../content/fonts';
import { detectLang } from '../i18n';
import type { Paint } from '../lottie/paint';
import type { PartXf } from '../lottie/parts';
import type { LottieAnimation } from '../lottie/types';
import type { ColorRole, EmojiColors, Lang } from '../templates/types';
import { applyImportOp, applyImportOpTo, type ImportOp } from './importOps';
import { PRESETS, randomEmojiColors, randomTextColors, type ColorPreset } from './presets';

export interface ImportedTemplate {
  id: string;
  name: string;
  data: LottieAnimation;
  palette: string[];
  colorMap: Record<string, string>;
  overlay: boolean;
  /** Part ids (see lottie/parts.ts) hidden by the user. */
  hidden: string[];
  /** Part replaced by the user's text/logo (keeps that part's animation). */
  replace: string | null;
  /** Parts moved/resized/rotated on the canvas. */
  transforms: Record<string, PartXf>;
  /** Sticker from a Telegram pack (reloaded through the bot on every start). */
  source?: { pack: string; uid: string; emoji: string };
  /** What the pack analysis picked — "reset" goes back to it. */
  defaults?: Pick<ImportedTemplate, 'hidden' | 'replace' | 'overlay'>;
}

/** Sticker pack used as templates. */
export interface PackRef {
  name: string;
  title: string;
}

/** User edits of a pack sticker, kept across sessions (the animation itself is not stored). */
export type PackEdit = Pick<ImportedTemplate, 'colorMap' | 'overlay' | 'hidden' | 'replace' | 'transforms'>;

export type PreviewBg = 'light' | 'dark' | 'chess';

/** Emoji pack the bot created for this user (remembered locally to add more emoji later). */
export interface SavedPack {
  name: string;
  title: string;
  url: string;
  count: number;
}

export interface EditorData {
  lang: Lang;
  mode: 'text' | 'logo';
  text: string;
  fontId: string;
  textFill: Paint;
  textOutline: Paint;
  textOutlineWidth: number;
  letterSpacing: number;
  lineHeight: number;
  uppercase: boolean;
  logo: { name: string; svg: string } | null;
  logoColors: 'original' | 'paint';
  logoOutline: boolean;
  colors: EmojiColors;
  presetId: string | null;
  outlineWidth: number;
  scale: number;
  offsetY: number;
  offsetX: number;
  rotation: number;
  selected: string[];
  active: string;
  previewBg: PreviewBg;
  imports: ImportedTemplate[];
  packs: SavedPack[];
  /** Sticker packs the user added as templates. */
  myPacks: PackRef[];
  packEdits: Record<string, PackEdit>;
  /** Edits of an imported animation are repeated on every other selected one. */
  syncImports: boolean;
}

export interface EditorActions {
  set<K extends keyof EditorData>(key: K, value: EditorData[K]): void;
  setColor(role: ColorRole, paint: Paint): void;
  /** Position/size/rotation of the text/logo (edited on the canvas). */
  setTransform(xf: { scale: number; offsetX: number; offsetY: number; rotation: number }): void;
  applyPreset(preset: ColorPreset): void;
  randomizeEmoji(): void;
  randomizeText(): void;
  toggleTemplate(id: string): void;
  addImport(t: ImportedTemplate): void;
  updateImport(id: string, patch: Partial<ImportedTemplate>): void;
  /**
   * Edits an imported animation — and, with `syncImports`, every other selected one (parts are matched by shape).
   * Returns how many of the other selected animations were changed.
   */
  editImport(id: string, op: ImportOp): { applied: number; total: number };
  removeImport(id: string): void;
  /** Adds (or refreshes) the stickers of a pack; `personal` also remembers the pack in "My packs". */
  addPackTemplates(pack: PackRef, templates: ImportedTemplate[], personal: boolean): void;
  removePack(name: string): void;
  /** Puts a pack on top of "My packs" (title filled in once it loads). */
  rememberPack(pack: PackRef): void;
  savePack(pack: SavedPack): void;
  reset(): void;
}

const defaultPreset = PRESETS[1];

export const initialData = (): EditorData => ({
  lang: detectLang(),
  mode: 'text',
  text: 'EMOJI',
  fontId: DEFAULT_FONT_ID,
  textFill: defaultPreset.textFill,
  textOutline: defaultPreset.textOutline,
  textOutlineWidth: 8,
  letterSpacing: 0,
  lineHeight: 1.05,
  uppercase: false,
  logo: null,
  logoColors: 'original',
  logoOutline: true,
  colors: defaultPreset.colors,
  presetId: defaultPreset.id,
  outlineWidth: 12,
  scale: 1,
  offsetY: 0,
  offsetX: 0,
  rotation: 0,
  selected: ['classic'],
  active: 'classic',
  previewBg: 'light',
  imports: [],
  packs: [],
  myPacks: [],
  packEdits: {},
  syncImports: false,
});

const isSessionOnly = (id: string) => id.startsWith('import-') || id.startsWith('pack:');

/** Logos bigger than this are not written to localStorage (quota is ~5 MB). */
const MAX_PERSISTED_LOGO = 400_000;

export const useEditor = create<EditorData & EditorActions>()(
  persist(
    (set, get) => ({
      ...initialData(),
      set: (key, value) => set({ [key]: value } as Partial<EditorData>),
      setTransform: ({ scale, offsetX, offsetY, rotation }) => set({ scale, offsetX, offsetY, rotation }),
      setColor: (role, paint) => set({ colors: { ...get().colors, [role]: paint }, presetId: null }),
      applyPreset: (preset) =>
        set({ colors: preset.colors, textFill: preset.textFill, textOutline: preset.textOutline, presetId: preset.id }),
      randomizeEmoji: () => set({ colors: randomEmojiColors(), presetId: null }),
      randomizeText: () => {
        const { fill, outline } = randomTextColors(get().colors.body);
        set({ textFill: fill, textOutline: outline });
      },
      toggleTemplate: (id) => {
        const { selected, active } = get();
        const isSelected = selected.includes(id);
        if (!isSelected) set({ selected: [...selected, id], active: id });
        else if (active !== id) set({ active: id });
        else set({ selected: selected.filter((s) => s !== id), active: id });
      },
      addImport: (t) => set({ imports: [...get().imports, t], selected: [...get().selected, t.id], active: t.id }),
      updateImport: (id, patch) => {
        const imports = get().imports.map((t) => (t.id === id ? { ...t, ...patch } : t));
        const updated = imports.find((t) => t.id === id);
        if (!updated?.source) return set({ imports });
        const { colorMap, overlay, hidden, replace, transforms } = updated;
        set({ imports, packEdits: { ...get().packEdits, [updated.source.uid]: { colorMap, overlay, hidden, replace, transforms } } });
      },
      editImport: (id, op) => {
        const { imports, selected, syncImports, packEdits } = get();
        const source = imports.find((t) => t.id === id);
        if (!source) return { applied: 0, total: 0 };
        const targets = new Set(syncImports ? selected.filter((s) => s !== id) : []);
        let applied = 0;
        let total = 0;
        const edits = { ...packEdits };
        const next = imports.map((t) => {
          let patch;
          if (t.id === id) patch = applyImportOp(t, op);
          else if (targets.has(t.id)) {
            total++;
            patch = applyImportOpTo(source, t, op);
            if (patch) applied++;
          }
          if (!patch) return t;
          const updated = { ...t, ...patch };
          if (updated.source) {
            const { colorMap, overlay, hidden, replace, transforms } = updated;
            edits[updated.source.uid] = { colorMap, overlay, hidden, replace, transforms };
          }
          return updated;
        });
        set({ imports: next, packEdits: edits });
        return { applied, total };
      },
      addPackTemplates: (pack, templates, personal) => {
        const { imports, myPacks } = get();
        const others = imports.filter((t) => t.source?.pack !== pack.name);
        const known = myPacks.some((p) => p.name === pack.name);
        set({
          imports: [...others, ...templates],
          myPacks: personal ? [pack, ...myPacks.filter((p) => p.name !== pack.name)] : known ? myPacks.map((p) => (p.name === pack.name ? pack : p)) : myPacks,
        });
      },
      rememberPack: (pack) => {
        const { myPacks } = get();
        const known = myPacks.find((p) => p.name === pack.name);
        set({ myPacks: [known ?? pack, ...myPacks.filter((p) => p.name !== pack.name)] });
      },
      removePack: (name) => {
        const { imports, selected, active, myPacks } = get();
        const gone = new Set(imports.filter((t) => t.source?.pack === name).map((t) => t.id));
        set({
          imports: imports.filter((t) => !gone.has(t.id)),
          myPacks: myPacks.filter((p) => p.name !== name),
          selected: selected.filter((s) => !gone.has(s)),
          active: gone.has(active) ? 'classic' : active,
        });
      },
      removeImport: (id) => {
        const { imports, selected, active } = get();
        set({
          imports: imports.filter((t) => t.id !== id),
          selected: selected.filter((s) => s !== id),
          active: active === id ? 'classic' : active,
        });
      },
      savePack: (pack) => {
        const others = get().packs.filter((p) => p.name !== pack.name);
        set({ packs: [pack, ...others].slice(0, 20) });
      },
      // Packs live in Telegram, so a reset keeps the lists (pack stickers stay loaded, with their edits reset).
      reset: () => {
        const { lang, packs, myPacks, imports } = get();
        const stickers = imports
          .filter((t) => t.source)
          .map((t) => ({ ...t, colorMap: {}, transforms: {}, ...(t.defaults ?? { hidden: [], replace: null, overlay: false }) }));
        set({ ...initialData(), lang, packs, myPacks, imports: stickers });
      },
    }),
    {
      name: 'emoji-studio',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => {
        const { imports: _imports, ...data } = s;
        const keep: Partial<EditorData> = {};
        for (const [k, v] of Object.entries(data)) if (typeof v !== 'function') (keep as Record<string, unknown>)[k] = v;
        if (keep.logo && keep.logo.svg.length > MAX_PERSISTED_LOGO) keep.logo = null;
        // Imported animations and pack stickers are session-only: drop them from the selection.
        keep.selected = (keep.selected ?? []).filter((id) => !isSessionOnly(id));
        if (keep.active && isSessionOnly(keep.active)) keep.active = 'classic';
        return keep;
      },
    },
  ),
);
