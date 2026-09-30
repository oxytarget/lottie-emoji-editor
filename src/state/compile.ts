import type { ArtStyle, VectorArt } from '../content/art';
import { compose } from '../lottie/compose';
import { checkTgs, tgsFromJson, toJson, type TgsCheck } from '../lottie/export';
import { recolor, withOverlay } from '../lottie/imported';
import { applyPartEdits, stripPartClasses, type PartXf } from '../lottie/parts';
import type { LottieAnimation } from '../lottie/types';
import { BUILTIN_TEMPLATES } from '../templates/builtin';
import type { EmojiColors } from '../templates/types';

export interface ImportInput {
  id: string;
  /** Omitted when the worker already has this animation (see `createCompiler`). */
  data?: LottieAnimation;
  colorMap: Record<string, string>;
  overlay: boolean;
  hidden: string[];
  replace: string | null;
  transforms: Record<string, PartXf>;
}

/** Everything needed to build the animations — plain data so it can be sent to a Web Worker. */
export interface CompileInput {
  art: VectorArt | null;
  artStyle: ArtStyle;
  colors: EmojiColors;
  outlineWidth: number;
  scale: number;
  offsetY: number;
  offsetX: number;
  rotation: number;
  imports: ImportInput[];
  /** Imported animation whose preview gets `pt-N` part classes (for tapping parts on the canvas). */
  annotate?: string | null;
}

export interface CompileOutput {
  id: string;
  /** Lottie JSON without the TGS marker. */
  json: string;
  check: TgsCheck;
  /** Same animation with part classes, for the editor preview (only for `annotate`). */
  preview?: string;
}

function buildImported(input: CompileInput, imp: ImportInput & { data: LottieAnimation }, annotate: boolean): LottieAnimation {
  const { art, artStyle, scale, offsetY, offsetX, rotation } = input;
  let anim = recolor(imp.data, imp.colorMap);
  anim = applyPartEdits(anim, { hidden: imp.hidden, replace: imp.replace, transforms: imp.transforms, annotate }, { art, artStyle, scale, offsetY, offsetX, rotation });
  if (imp.overlay && art) anim = withOverlay(anim, { art, artStyle, scale, offsetY, offsetX, rotation });
  return anim;
}

function buildTemplate(input: CompileInput, template: (typeof BUILTIN_TEMPLATES)[number]): LottieAnimation {
  const { art, artStyle, colors, outlineWidth, scale, offsetY, offsetX, rotation } = input;
  return compose({ template, art, artStyle, colors, outlineWidth, scale, offsetY, offsetX, rotation });
}

function finish(id: string, anim: LottieAnimation, annotated = false): CompileOutput {
  const raw = toJson(anim);
  const json = annotated ? stripPartClasses(raw) : raw;
  return { id, json, check: checkTgs(anim, tgsFromJson(json).length), ...(annotated ? { preview: raw } : {}) };
}

const withData = (imp: ImportInput): imp is ImportInput & { data: LottieAnimation } => !!imp.data;

/** Builds every built-in template plus the imported animations. Pure and synchronous. */
export function compileAll(input: CompileInput): CompileOutput[] {
  const out = BUILTIN_TEMPLATES.map((template) => finish(template.id, buildTemplate(input, template)));
  for (const imp of input.imports.filter(withData)) {
    const annotate = input.annotate === imp.id;
    out.push(finish(imp.id, buildImported(input, imp, annotate), annotate));
  }
  return out;
}

/** Builds a single animation without size checks — fast enough to run on every frame of a canvas drag. */
export function compileOne(input: CompileInput, id: string): string | null {
  const template = BUILTIN_TEMPLATES.find((t) => t.id === id);
  if (template) return toJson(buildTemplate(input, template));
  const imp = input.imports.find((i) => i.id === id);
  return imp && withData(imp) ? toJson(buildImported(input, imp, input.annotate === id)) : null;
}

/**
 * Compiler with memory, for the Web Worker: animations are sent once (later inputs may omit `data`), and
 * results are reused while the settings that affect them stay the same — changing a colour does not rebuild
 * every imported sticker, and scrolling through a big pack does not rebuild the built-in templates.
 */
export function createCompiler() {
  const datas = new Map<string, LottieAnimation>();
  const cache = new Map<string, { key: string; out: CompileOutput }>();

  const cached = (id: string, key: string, build: () => CompileOutput): CompileOutput => {
    const hit = cache.get(id);
    if (hit && hit.key === key) return hit.out;
    const out = build();
    cache.set(id, { key, out });
    return out;
  };

  return {
    compile(input: CompileInput, keep?: readonly string[]): CompileOutput[] {
      for (const imp of input.imports) if (imp.data) datas.set(imp.id, imp.data);
      if (keep) {
        const alive = new Set(keep);
        for (const id of datas.keys()) if (!alive.has(id)) datas.delete(id);
        for (const id of cache.keys()) if (!alive.has(id) && !BUILTIN_TEMPLATES.some((t) => t.id === id)) cache.delete(id);
      }
      const { art, artStyle, colors, outlineWidth, scale, offsetY, offsetX, rotation } = input;
      const content = JSON.stringify({ art, artStyle, scale, offsetY, offsetX, rotation });
      const templateKey = `${content}|${JSON.stringify({ colors, outlineWidth })}`;
      const out = BUILTIN_TEMPLATES.map((t) => cached(t.id, templateKey, () => finish(t.id, buildTemplate(input, t))));
      for (const imp of input.imports) {
        const data = imp.data ?? datas.get(imp.id);
        if (!data) continue;
        const annotate = input.annotate === imp.id;
        const { colorMap, overlay, hidden, replace, transforms } = imp;
        const key = `${content}|${JSON.stringify({ colorMap, overlay, hidden, replace, transforms, annotate })}`;
        out.push(cached(imp.id, key, () => finish(imp.id, buildImported(input, { ...imp, data }, annotate), annotate)));
      }
      return out;
    },
  };
}
