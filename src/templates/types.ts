import type { Paint } from '../lottie/paint';
import type { LayerStack } from '../lottie/shapes';
import type { BBox, Prop, ShapeItem } from '../lottie/types';

export type Lang = 'uk' | 'ru' | 'en';
export type Localized = Record<Lang, string>;

export type ColorRole = 'body' | 'outline' | 'accent';

export interface EmojiColors {
  body: Paint;
  outline: Paint;
  accent: Paint;
}

export interface ContentOptions {
  /** Position of the content centre (in parent space when `parent` is set). */
  p: [number, number];
  /** Box the artwork is fitted into. */
  slot: [number, number];
  parent?: number;
  s?: Prop;
  r?: Prop;
  o?: Prop;
  /** Pivot for the content's own scale/rotation animation. */
  anchor?: 'center' | 'bottom';
  nm?: string;
}

export interface BuildContext {
  /** Loop length in frames (60 fps). */
  op: number;
  layers: LayerStack;
  outlineWidth: number;
  /** Fill for a colour role; gradients span `box` (defaults to the shapes' bounds). */
  fill(role: ColorRole, box: BBox, opacity?: number): ShapeItem;
  stroke(role: ColorRole, box: BBox, width?: number, opacity?: number): ShapeItem;
  /** Shapes + outline stroke + role fill, ready to go into a group. */
  painted(shapes: ShapeItem[], role: ColorRole, opts?: { strokeWidth?: number; opacity?: number; noStroke?: boolean }): ShapeItem[];
  /** Adds the user's text/logo layer. Returns its layer index (0 when there is nothing to show). */
  content(opts: ContentOptions): number;
}

export interface Template {
  id: string;
  name: Localized;
  /** Frames at 60 fps (Telegram limit: 180). */
  duration: number;
  /** Templates without a body — best for logos. */
  logoOnly?: boolean;
  build(ctx: BuildContext): void;
}
