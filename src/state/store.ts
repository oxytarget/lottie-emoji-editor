import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { DEFAULT_FONT_ID } from '../content/fonts';
import { detectLang } from '../i18n';
import type { Paint } from '../lottie/paint';
import type { LottieAnimation } from '../lottie/types';
import type { ColorRole, EmojiColors, Lang } from '../templates/types';
import { PRESETS, randomEmojiColors, randomTextColors, type ColorPreset } from './presets';

export interface ImportedTemplate {
  id: string;
  name: string;
  data: LottieAnimation;
  palette: string[];
  colorMap: Record<string, string>;
  overlay: boolean;
}

export type PreviewBg = 'light' | 'dark' | 'chess';

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
  selected: string[];
  active: string;
  previewBg: PreviewBg;
  imports: ImportedTemplate[];
}

export interface EditorActions {
  set<K extends keyof EditorData>(key: K, value: EditorData[K]): void;
  setColor(role: ColorRole, paint: Paint): void;
  applyPreset(preset: ColorPreset): void;
  randomizeEmoji(): void;
  randomizeText(): void;
  toggleTemplate(id: string): void;
  addImport(t: ImportedTemplate): void;
  updateImport(id: string, patch: Partial<ImportedTemplate>): void;
  removeImport(id: string): void;
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
  selected: ['classic'],
  active: 'classic',
  previewBg: 'light',
  imports: [],
});

/** Logos bigger than this are not written to localStorage (quota is ~5 MB). */
const MAX_PERSISTED_LOGO = 400_000;

export const useEditor = create<EditorData & EditorActions>()(
  persist(
    (set, get) => ({
      ...initialData(),
      set: (key, value) => set({ [key]: value } as Partial<EditorData>),
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
      updateImport: (id, patch) => set({ imports: get().imports.map((t) => (t.id === id ? { ...t, ...patch } : t)) }),
      removeImport: (id) => {
        const { imports, selected, active } = get();
        set({
          imports: imports.filter((t) => t.id !== id),
          selected: selected.filter((s) => s !== id),
          active: active === id ? 'classic' : active,
        });
      },
      reset: () => set({ ...initialData(), lang: get().lang }),
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
        // Imported animations are session-only: drop them from the selection.
        keep.selected = (keep.selected ?? []).filter((id) => !id.startsWith('import-'));
        if (keep.active?.startsWith('import-')) keep.active = 'classic';
        return keep;
      },
    },
  ),
);
