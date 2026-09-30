import type { ArtStyle, VectorArt } from '../content/art';
import { compose } from '../lottie/compose';
import { checkTgs, tgsFromJson, toJson, type TgsCheck } from '../lottie/export';
import { recolor, withOverlay } from '../lottie/imported';
import { applyPartEdits } from '../lottie/parts';
import type { LottieAnimation } from '../lottie/types';
import { BUILTIN_TEMPLATES } from '../templates/builtin';
import type { EmojiColors } from '../templates/types';

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
  imports: Array<{ id: string; data: LottieAnimation; colorMap: Record<string, string>; overlay: boolean; hidden: string[]; replace: string | null }>;
}

export interface CompileOutput {
  id: string;
  /** Lottie JSON without the TGS marker. */
  json: string;
  check: TgsCheck;
}

function finish(id: string, anim: LottieAnimation): CompileOutput {
  const json = toJson(anim);
  return { id, json, check: checkTgs(anim, tgsFromJson(json).length) };
}

function buildImported(input: CompileInput, imp: CompileInput['imports'][number]): LottieAnimation {
  const { art, artStyle, scale, offsetY, offsetX, rotation } = input;
  let anim = recolor(imp.data, imp.colorMap);
  anim = applyPartEdits(anim, { hidden: imp.hidden, replace: imp.replace }, { art, artStyle, scale, offsetY, offsetX, rotation });
  if (imp.overlay && art) anim = withOverlay(anim, { art, artStyle, scale, offsetY, offsetX, rotation });
  return anim;
}

function buildTemplate(input: CompileInput, template: (typeof BUILTIN_TEMPLATES)[number]): LottieAnimation {
  const { art, artStyle, colors, outlineWidth, scale, offsetY, offsetX, rotation } = input;
  return compose({ template, art, artStyle, colors, outlineWidth, scale, offsetY, offsetX, rotation });
}

/** Builds every built-in template plus the imported animations. Pure and synchronous. */
export function compileAll(input: CompileInput): CompileOutput[] {
  const out = BUILTIN_TEMPLATES.map((template) => finish(template.id, buildTemplate(input, template)));
  for (const imp of input.imports) out.push(finish(imp.id, buildImported(input, imp)));
  return out;
}

/** Builds a single animation without size checks — fast enough to run on every frame of a canvas drag. */
export function compileOne(input: CompileInput, id: string): string | null {
  const template = BUILTIN_TEMPLATES.find((t) => t.id === id);
  if (template) return toJson(buildTemplate(input, template));
  const imp = input.imports.find((i) => i.id === id);
  return imp ? toJson(buildImported(input, imp)) : null;
}
