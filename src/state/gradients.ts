import type { Paint } from '../lottie/paint';
import type { ColorRole } from '../templates/types';
import type { CompileInput } from './compile';
import { useEditor, type EditorData } from './store';

/** A user paint that can be a gradient: the text/logo fill and outline, or a colour of the character. */
export type GradTarget = ColorRole | 'textFill' | 'textOutline';

export function paintOf(s: Pick<EditorData, 'textFill' | 'textOutline' | 'colors'>, target: GradTarget): Paint {
  if (target === 'textFill') return s.textFill;
  if (target === 'textOutline') return s.textOutline;
  return s.colors[target];
}

export function setPaintOf(target: GradTarget, p: Paint): void {
  const s = useEditor.getState();
  if (target === 'textFill' || target === 'textOutline') s.set(target, p);
  else s.setColor(target, p);
}

/** Compile input with one paint replaced (instant previews while dragging a handle). */
export function withPaint(input: CompileInput, target: GradTarget, p: Paint): CompileInput {
  if (target === 'textFill') return { ...input, artStyle: { ...input.artStyle, fill: p } };
  if (target === 'textOutline') return input.artStyle.outline ? { ...input, artStyle: { ...input.artStyle, outline: p } } : input;
  return { ...input, colors: { ...input.colors, [target]: p } };
}
