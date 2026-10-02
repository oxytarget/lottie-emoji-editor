import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { DEFAULT_FONT_ID } from '../content/fonts';
import { detectLang } from '../i18n';
import { pageTheme, type Theme } from '../lib/theme';
import type { Paint } from '../lottie/paint';
import { extractPalette } from '../lottie/imported';
import { applyLayout, applyLayoutOp, checkOp, CONTENT_SLOT, remapEdits, remapId, removalTarget, type Drop, type LayoutOp } from '../lottie/layout';
import type { CompatIssue } from '../lottie/imported';
import type { ItemPaint } from '../lottie/itemPaints';
import { flattenParts, listParts, type PartXf } from '../lottie/parts';
import type { LottieAnimation } from '../lottie/types';
import type { ColorRole, EmojiColors, Lang } from '../templates/types';
import { applyImportOp, applyImportOpTo, type ImportOp } from './importOps';
import { logoArt, svgKey } from './logoArt';
import { PRESETS, randomEmojiColors, randomTextColors, type ColorPreset } from './presets';

export interface ImportedTemplate {
  id: string;
  name: string;
  /** The animation as edited in the layer list (`base` with the `layout` operations applied). */
  data: LottieAnimation;
  /** The animation as imported. */
  base: LottieAnimation;
  /** Layer-list edits: inserted logos, moved parts. */
  layout: LayoutOp[];
  palette: string[];
  colorMap: Record<string, string>;
  overlay: boolean;
  /** Part ids (see lottie/parts.ts) hidden by the user. */
  hidden: string[];
  /** Part replaced by the user's text/logo (keeps that part's animation). */
  replace: string | null;
  /** Parts moved/resized/rotated on the canvas. */
  transforms: Record<string, PartXf>;
  /** Colours of single fills/strokes/gradients, by item id (see lottie/itemPaints.ts). */
  paints?: Record<string, ItemPaint>;
  /** What happened to an imported file: expressions baked into keyframes, features Telegram does not show. */
  notes?: { baked: number; issues: CompatIssue[] };
  /** Sticker from a Telegram pack (reloaded through the bot on every start). */
  source?: { pack: string; uid: string; emoji: string };
  /** What the pack analysis picked (incl. a slot put in place of the logo) — "reset" goes back to it. */
  defaults?: Pick<ImportedTemplate, 'hidden' | 'replace' | 'overlay'> & { layout?: LayoutOp[] };
}

/** The design fields a draft keeps (text/logo, colours, placement, chosen templates). */
export const DRAFT_KEYS = [
  'mode', 'text', 'fontId', 'textFill', 'textOutline', 'textOutlineWidth', 'letterSpacing', 'lineHeight', 'uppercase', 'logo', 'logoColors',
  'logoOutline', 'colors', 'presetId', 'outlineWidth', 'scale', 'offsetY', 'offsetX', 'rotation', 'stretch', 'selected', 'active',
] as const;
export type DraftDesign = Pick<EditorData, (typeof DRAFT_KEYS)[number]>;

/** A saved state of the work, to come back to later. */
export interface Draft {
  id: string;
  name: string;
  savedAt: number;
  /** Small picture of the emoji shown when it was saved (PNG data URL). */
  thumb?: string;
  design: DraftDesign;
}

/** Sticker pack used as templates. */
export interface PackRef {
  name: string;
  title: string;
}

/** Logo kept in Favourites (an uploaded SVG or a part of an imported animation). */
export interface FavLogo {
  id: string;
  name: string;
  svg: string;
}

/** Colour preset made by the user, optionally with the text or logo — a ready-made look in one tap. */
export interface UserPreset extends ColorPreset {
  textOutlineWidth: number;
  outlineWidth: number;
  content?:
    | { mode: 'logo'; logo: { name: string; svg: string }; logoColors: 'original' | 'paint'; logoOutline: boolean }
    | { mode: 'text'; text: string; fontId: string };
}

/** User edits of a pack sticker, kept across sessions (the animation itself is not stored). */
export type PackEdit = Pick<ImportedTemplate, 'colorMap' | 'overlay' | 'hidden' | 'replace' | 'transforms' | 'paints'> & { layout?: LayoutOp[] };

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
  /** Light or dark studio theme; null follows the system (or Telegram) until the user picks one. */
  theme: Theme | null;
  /** New packs come in the colours of the user's logo/text (when it has colourful ones). */
  autoBrand: boolean;
  /** Saved states of the work, newest first. */
  drafts: Draft[];
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
  /** Height of the text/logo relative to its width (free stretching on the canvas). */
  stretch: number;
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
  favColors: string[];
  favLogos: FavLogo[];
  userPresets: UserPreset[];
  /** A big pack being filled in several steps: which emoji are already in it (so it can be finished later). */
  packJob: { pack: string; ids: string[]; created: boolean } | null;
  /** SVGs of logos inserted in layer lists, by key (layer operations refer to them). */
  layoutSvgs: Record<string, string>;
}

export interface EditorActions {
  set<K extends keyof EditorData>(key: K, value: EditorData[K]): void;
  setColor(role: ColorRole, paint: Paint): void;
  /** Position/size/rotation of the text/logo (edited on the canvas). */
  setTransform(xf: { scale: number; offsetX: number; offsetY: number; rotation: number; stretch?: number }): void;
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
  /** Changes the layer structure of an imported animation; returns the new id of the inserted/moved part. */
  layoutImport(id: string, op: LayoutOp): string | null;
  /**
   * Puts the user's text/logo into the layer list of an imported animation at `at` (a new slot named `name`);
   * a slot it was in before goes away. Returns the slot's id.
   */
  placeContent(id: string, at: Drop, name: string): string | null;
  /** Stores a logo for layer operations and returns its key. */
  putLayoutSvg(svg: string): string;
  removeImport(id: string): void;
  /** Adds (or refreshes) the stickers of a pack; `personal` also remembers the pack in "My packs". */
  addPackTemplates(pack: PackRef, templates: ImportedTemplate[], personal: boolean): void;
  removePack(name: string): void;
  /** Puts a pack on top of "My packs" (title filled in once it loads). */
  rememberPack(pack: PackRef): void;
  savePack(pack: SavedPack): void;
  toggleFavColor(hex: string): void;
  addFavColors(hexes: readonly string[]): number;
  /** Returns the saved logo, or null when it is too big to keep. */
  addFavLogo(logo: { name: string; svg: string }): FavLogo | null;
  removeFavLogo(id: string): void;
  removeFavColors(hexes: readonly string[]): void;
  removeFavLogos(ids: readonly string[]): void;
  /** Makes a logo the current content (logo mode). */
  useLogo(logo: { name: string; svg: string }): void;
  /** Saves the current colours (and, with `withContent`, the current text or logo) as a preset. */
  saveUserPreset(name: string, withContent: boolean): UserPreset | null;
  removeUserPreset(id: string): void;
  applyUserPreset(preset: UserPreset): void;
  reset(): void;
  /** Saves the current work as a draft (or over draft `id`); returns its id. */
  saveDraft(thumb?: string, id?: string): string;
  /** Puts a draft's design back into the editor. */
  openDraft(id: string): void;
  deleteDraft(id: string): void;
  renameDraft(id: string, name: string): void;
}

const defaultPreset = PRESETS[1];

export const initialData = (): EditorData => ({
  lang: detectLang(),
  theme: null,
  autoBrand: true,
  drafts: [],
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
  stretch: 1,
  selected: ['classic'],
  active: 'classic',
  // The canvas in the page's theme to begin with.
  previewBg: pageTheme(),
  imports: [],
  packs: [],
  myPacks: [],
  packEdits: {},
  syncImports: false,
  favColors: [],
  favLogos: [],
  userPresets: [],
  packJob: null,
  layoutSvgs: {},
});

/** Edits of a pack sticker as remembered across sessions. */
export const packEditOf = (t: ImportedTemplate): PackEdit => {
  const { colorMap, overlay, hidden, replace, transforms, layout, paints } = t;
  return { colorMap, overlay, hidden, replace, transforms, layout, ...(paints && Object.keys(paints).length ? { paints } : {}) };
};

/** Limits keep Favourites within the ~5 MB localStorage quota. */
const MAX_FAV_COLORS = 30;
const MAX_FAV_LOGOS = 30;
const MAX_USER_PRESETS = 20;
export const MAX_FAV_LOGO_CHARS = 300_000;

const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const isSessionOnly = (id: string) => id.startsWith('import-') || id.startsWith('pack:');

const MAX_DRAFTS = 24;

/** "«HELLO» · 3", or the logo's name. */
function draftName(d: DraftDesign): string {
  const what = d.mode === 'logo' && d.logo ? d.logo.name.replace(/\.svg$/i, '') : `«${d.text.split('\n')[0].trim().slice(0, 24) || '…'}»`;
  return `${what} · ${d.selected.length}`;
}

/** Logos bigger than this are not written to localStorage (quota is ~5 MB). */
const MAX_PERSISTED_LOGO = 400_000;

export const useEditor = create<EditorData & EditorActions>()(
  persist(
    (set, get) => ({
      ...initialData(),
      set: (key, value) => set({ [key]: value } as Partial<EditorData>),
      setTransform: ({ scale, offsetX, offsetY, rotation, stretch = 1 }) => set({ scale, offsetX, offsetY, rotation, stretch }),
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
        set({ imports, packEdits: { ...get().packEdits, [updated.source.uid]: packEditOf(updated) } });
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
          if (updated.source) edits[updated.source.uid] = packEditOf(updated);
          return updated;
        });
        set({ imports: next, packEdits: edits });
        return { applied, total };
      },
      putLayoutSvg: (svg) => {
        const key = svgKey(svg);
        if (get().layoutSvgs[key] !== svg) set({ layoutSvgs: { ...get().layoutSvgs, [key]: svg } });
        return key;
      },
      layoutImport: (id, op) => {
        const { imports, layoutSvgs, packEdits } = get();
        const t = imports.find((i) => i.id === id);
        if (!t || checkOp(t.data, op)) return null;
        const data = structuredClone(t.data);
        const newId = applyLayoutOp(data, op, (key) => logoArt(layoutSvgs[key]));
        if (newId === null && op.kind !== 'remove') return null;
        const { hidden, replace, transforms, paints } = remapEdits({ hidden: t.hidden, replace: t.replace, transforms: t.transforms, paints: t.paints ?? {} }, op, t.data);
        const updated: ImportedTemplate = {
          ...t,
          data,
          layout: [...t.layout, op],
          hidden,
          replace,
          // Removing the layer the text/logo was in puts it back on top.
          overlay: t.replace && !replace ? true : t.overlay,
          transforms: transforms as Record<string, PartXf>,
          paints: paints as Record<string, ItemPaint>,
          palette: extractPalette(data),
        };
        set({
          imports: imports.map((i) => (i.id === id ? updated : i)),
          ...(updated.source ? { packEdits: { ...packEdits, [updated.source.uid]: packEditOf(updated) } } : {}),
        });
        return newId;
      },
      placeContent: (id, at, name) => {
        const before = get().imports.find((i) => i.id === id);
        if (!before) return null;
        const oldSlot = before.replace && flattenParts(listParts(before.data)).some((p) => p.id === before.replace && p.slot) ? before.replace : null;
        const insert: LayoutOp = { kind: 'insert', svg: CONTENT_SLOT, name, at };
        const slot = get().layoutImport(id, insert);
        if (!slot) return null;
        // Straight to this sticker (a new slot has no counterpart in the others, so no "apply to all").
        get().updateImport(id, applyImportOp(get().imports.find((i) => i.id === id)!, { kind: 'replace', part: slot }));
        const stale = oldSlot ? remapId(oldSlot, insert, before.data) : null;
        if (stale) get().layoutImport(id, { kind: 'remove', part: removalTarget(get().imports.find((i) => i.id === id)!.data, stale) });
        return get().imports.find((i) => i.id === id)?.replace ?? null;
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
      toggleFavColor: (hex) => {
        const c = hex.toLowerCase();
        const favs = get().favColors;
        set({ favColors: favs.includes(c) ? favs.filter((f) => f !== c) : [c, ...favs].slice(0, MAX_FAV_COLORS) });
      },
      addFavColors: (hexes) => {
        const favs = get().favColors;
        const fresh = [...new Set(hexes.map((h) => h.toLowerCase()))].filter((h) => !favs.includes(h));
        set({ favColors: [...fresh, ...favs].slice(0, MAX_FAV_COLORS) });
        return fresh.length;
      },
      addFavLogo: ({ name, svg }) => {
        if (svg.length > MAX_FAV_LOGO_CHARS) return null;
        const favs = get().favLogos;
        const known = favs.find((f) => f.svg === svg);
        if (known) return known;
        const logo = { id: newId('logo'), name: name.slice(0, 60) || 'Logo', svg };
        set({ favLogos: [logo, ...favs].slice(0, MAX_FAV_LOGOS) });
        return logo;
      },
      removeFavLogo: (id) => set({ favLogos: get().favLogos.filter((f) => f.id !== id) }),
      removeFavColors: (hexes) => {
        const gone = new Set(hexes.map((h) => h.toLowerCase()));
        set({ favColors: get().favColors.filter((c) => !gone.has(c)) });
      },
      removeFavLogos: (ids) => {
        const gone = new Set(ids);
        set({ favLogos: get().favLogos.filter((f) => !gone.has(f.id)) });
      },
      useLogo: ({ name, svg }) => set({ logo: { name, svg }, mode: 'logo' }),
      saveUserPreset: (name, withContent) => {
        const s = get();
        const content: UserPreset['content'] = !withContent
          ? undefined
          : s.mode === 'logo' && s.logo && s.logo.svg.length <= MAX_FAV_LOGO_CHARS
            ? { mode: 'logo', logo: s.logo, logoColors: s.logoColors, logoOutline: s.logoOutline }
            : s.mode === 'text' && s.text.trim()
              ? { mode: 'text', text: s.text, fontId: s.fontId }
              : undefined;
        const preset: UserPreset = {
          id: newId('user'),
          name: name.trim().slice(0, 32) || `★ ${s.userPresets.length + 1}`,
          colors: s.colors,
          textFill: s.textFill,
          textOutline: s.textOutline,
          textOutlineWidth: s.textOutlineWidth,
          outlineWidth: s.outlineWidth,
          content,
        };
        if (s.userPresets.length >= MAX_USER_PRESETS) return null;
        set({ userPresets: [...s.userPresets, preset], presetId: preset.id });
        return preset;
      },
      removeUserPreset: (id) => {
        const { userPresets, presetId } = get();
        set({ userPresets: userPresets.filter((p) => p.id !== id), presetId: presetId === id ? null : presetId });
      },
      applyUserPreset: (p) => {
        const content = p.content;
        set({
          colors: p.colors,
          textFill: p.textFill,
          textOutline: p.textOutline,
          textOutlineWidth: p.textOutlineWidth,
          outlineWidth: p.outlineWidth,
          presetId: p.id,
          ...(content?.mode === 'logo' ? { mode: 'logo' as const, logo: content.logo, logoColors: content.logoColors, logoOutline: content.logoOutline } : {}),
          ...(content?.mode === 'text' ? { mode: 'text' as const, text: content.text, fontId: content.fontId } : {}),
        });
      },
      // Packs live in Telegram and Favourites are the user's library, so a reset keeps them
      // (pack stickers stay loaded, with their edits reset).
      saveDraft: (thumb, id) => {
        const s = get();
        const design = Object.fromEntries(DRAFT_KEYS.map((k) => [k, structuredClone(s[k])])) as DraftDesign;
        // A huge logo would not fit in the browser's storage next to the others.
        if (design.logo && design.logo.svg.length > MAX_PERSISTED_LOGO) design.logo = null;
        design.selected = design.selected.filter((x) => !x.startsWith('import-'));
        const old = id ? s.drafts.find((d) => d.id === id) : undefined;
        const draft: Draft = {
          id: old?.id ?? newId('draft'),
          name: old?.name ?? draftName(design),
          savedAt: Date.now(),
          ...(thumb ? { thumb } : old?.thumb ? { thumb: old.thumb } : {}),
          design,
        };
        set({ drafts: [draft, ...s.drafts.filter((d) => d.id !== draft.id)].slice(0, MAX_DRAFTS) });
        return draft.id;
      },
      openDraft: (id) => {
        const draft = get().drafts.find((d) => d.id === id);
        if (!draft) return;
        const { imports, myPacks } = get();
        const design = structuredClone(draft.design);
        // Pack stickers come back when their pack is loaded; animations imported in an old session do not.
        const known = (x: string) => !x.startsWith('import-') && (!x.startsWith('pack:') || imports.some((i) => i.id === x) || myPacks.some((p) => x.startsWith(`pack:${p.name}:`)));
        design.selected = design.selected.filter(known);
        if (!known(design.active)) design.active = design.selected[0] ?? 'classic';
        set(design);
      },
      deleteDraft: (id) => set({ drafts: get().drafts.filter((d) => d.id !== id) }),
      renameDraft: (id, name) => set({ drafts: get().drafts.map((d) => (d.id === id ? { ...d, name: name.trim() || d.name } : d)) }),
      reset: () => {
        const { lang, theme, autoBrand, drafts, packs, myPacks, imports, favColors, favLogos, userPresets, packJob, layoutSvgs } = get();
        const stickers = imports
          .filter((t) => t.source)
          .map((t) => {
            const { layout = [], ...picked } = t.defaults ?? { hidden: [], replace: null, overlay: false };
            const data = layout.length ? applyLayout(t.base, layout, () => null) : t.base;
            return { ...t, data, layout, palette: extractPalette(data), colorMap: {}, paints: {}, transforms: {}, ...picked };
          });
        set({ ...initialData(), lang, theme, autoBrand, drafts, packs, myPacks, imports: stickers, favColors, favLogos, userPresets, packJob, layoutSvgs });
      },
    }),
    {
      name: 'emoji-studio',
      version: 3,
      storage: createJSONStorage(() => localStorage),
      // v3: light and dark studio themes — a plain canvas takes the page's theme once (it can be switched back).
      migrate: (persisted, version) => {
        const data = (persisted ?? {}) as Partial<EditorData>;
        if (version < 3 && (data.previewBg === 'light' || data.previewBg === 'dark')) data.previewBg = pageTheme();
        return data as EditorData & EditorActions;
      },
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
