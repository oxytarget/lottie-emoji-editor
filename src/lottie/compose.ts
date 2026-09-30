import { artToShapes, fitArt, type ArtStyle, type VectorArt } from '../content/art';
import type { BuildContext, ContentOptions, EmojiColors, Template } from '../templates/types';
import { paintFill, paintStroke } from './paint';
import { group, LayerStack, shapesBBox } from './shapes';
import type { BBox, LottieAnimation, ShapeItem } from './types';

export const CANVAS = 512;
export const FPS = 60;

export interface ComposeInput {
  template: Template;
  art: VectorArt | null;
  artStyle: ArtStyle;
  colors: EmojiColors;
  /** Stroke width of the character outline (canvas px). */
  outlineWidth: number;
  /** Size multiplier of the text/logo (the "Size" slider). */
  scale: number;
  /** Vertical offset of the text/logo in canvas px (the "Height" slider, negative = up). */
  offsetY: number;
  /** Horizontal offset of the text/logo in canvas px (dragging on the canvas). */
  offsetX?: number;
  /** Rotation of the text/logo in degrees (rotating on the canvas). */
  rotation?: number;
  name?: string;
}

const EMPTY_BOX: BBox = { x: -1, y: -1, w: 2, h: 2 };

/** Class of the user's text/logo group in the rendered SVG — the canvas editor finds it by this. */
export const CONTENT_CLASS = 'emoji-content';

/** Wraps the user's content so it can be rotated and located in the rendered SVG. */
export function contentGroup(shapes: ShapeItem[], rotation = 0, p: [number, number] = [0, 0]): ShapeItem {
  return { ...group(shapes, { p, r: rotation }, 'content'), cl: CONTENT_CLASS };
}

/** Builds a Telegram-compatible (TGS-ready) Lottie animation for a template. */
export function compose(input: ComposeInput): LottieAnimation {
  const { template, art, artStyle, colors, outlineWidth, scale, offsetY, offsetX = 0, rotation = 0 } = input;
  const op = template.duration;
  const layers = new LayerStack(op);

  const ctx: BuildContext = {
    op,
    layers,
    outlineWidth,
    fill: (role, box, opacity = 100) => paintFill(colors[role], box, opacity),
    stroke: (role, box, width = outlineWidth, opacity = 100) => paintStroke(colors[role], box, { width, opacity, cap: 2, join: 2 }),
    painted(shapes, role, opts = {}) {
      const box = shapesBBox(shapes) ?? EMPTY_BOX;
      const width = opts.strokeWidth ?? outlineWidth;
      const out: ShapeItem[] = [...shapes];
      if (!opts.noStroke && width > 0) out.push(paintStroke(colors.outline, box, { width, cap: 2, join: 2 }));
      out.push(paintFill(colors[role], box, opts.opacity ?? 100));
      return out;
    },
    content(opts: ContentOptions) {
      if (!art) return 0;
      const [w, h] = opts.slot;
      // Slots are shaped for a line of text; logos are usually squarer, so let them grow taller.
      const slotH = art.kind === 'logo' ? Math.min(w, h * 1.35) : h;
      const fitted = fitArt(art, w, slotH, scale);
      const shapes = artToShapes(fitted.items, fitted.bbox, { ...artStyle, outlineWidth: artStyle.outlineWidth * Math.min(scale, 1.6) });
      if (!shapes.length) return 0;
      const bottom = opts.anchor === 'bottom' ? fitted.bbox.y + fitted.bbox.h : 0;
      return layers.shape({
        nm: opts.nm ?? 'content',
        p: [opts.p[0] + offsetX, opts.p[1] + offsetY + bottom],
        a: [0, bottom],
        s: opts.s,
        r: opts.r,
        o: opts.o,
        parent: opts.parent,
        shapes: [contentGroup(shapes, rotation)],
      });
    },
  };

  template.build(ctx);

  return {
    v: '5.7.4',
    fr: FPS,
    ip: 0,
    op,
    w: CANVAS,
    h: CANVAS,
    nm: input.name ?? template.id,
    ddd: 0,
    assets: [],
    layers: layers.toArray(),
  };
}
