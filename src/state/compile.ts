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

/** Builds every built-in template plus the imported animations. Pure and synchronous. */
export function compileAll(input: CompileInput): CompileOutput[] {
  const { art, artStyle, colors, outlineWidth, scale, offsetY } = input;
  const out = BUILTIN_TEMPLATES.map((template) =>
    finish(template.id, compose({ template, art, artStyle, colors, outlineWidth, scale, offsetY })),
  );
  for (const imp of input.imports) {
    let anim = recolor(imp.data, imp.colorMap);
    anim = applyPartEdits(anim, { hidden: imp.hidden, replace: imp.replace }, { art, artStyle, scale, offsetY });
    if (imp.overlay && art) anim = withOverlay(anim, { art, artStyle, scale, offsetY });
    out.push(finish(imp.id, anim));
  }
  return out;
}
