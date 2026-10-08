import { artBBox, fitArt, type ArtItem, type ArtPaint, type VectorArt } from '../content/art';
import { DEFAULT_FONT_ID, hasFont, loadFont } from '../content/fonts';
import { svgToArt } from '../content/svg';
import { textToArt } from '../content/text';
import type { Contour } from '../lottie/bezier';
import { hexToRgba } from '../lottie/color';

/**
 * The client editor's automatic layout: a photo, a logo and a text become one artwork that every template then
 * fits into its own place (keeping proportions, never past its bounds). Telegram's animated emoji draw only
 * vector shapes, so photos and PNG/JPG logos are traced into a few colour areas first.
 */

// ---------------------------------------------------------------------------
// Pictures from the phone → SVG
// ---------------------------------------------------------------------------

export type PictureKind = 'photo' | 'logo';

/** Longest side the tracer works on (more detail costs file size: an emoji file may be 64 KB at most). */
const TRACE_SIZE: Record<PictureKind, number> = { photo: 150, logo: 220 };

async function decode(file: Blob): Promise<CanvasImageSource & { width: number; height: number }> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file);
    } catch {
      /* the <img> route knows more formats on some browsers */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return Object.assign(img, {
      width: img.naturalWidth,
      height: img.naturalHeight,
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Makes the background of a logo transparent when its corners agree on one colour (a JPG or a white PNG). */
function dropBackground(d: Uint8ClampedArray, w: number, h: number): void {
  const at = (x: number, y: number) => (y * w + x) * 4;
  const corners = [at(0, 0), at(w - 1, 0), at(0, h - 1), at(w - 1, h - 1)];
  if (corners.some((i) => d[i + 3] < 200)) return;
  const [r, g, b] = [d[corners[0]], d[corners[0] + 1], d[corners[0] + 2]];
  const near = (i: number) => Math.abs(d[i] - r) + Math.abs(d[i + 1] - g) + Math.abs(d[i + 2] - b) < 60;
  if (!corners.every(near)) return;
  for (let i = 0; i < d.length; i += 4) if (near(i)) d[i + 3] = 0;
}

/** A photo becomes a round picture (it sits best in round and soft template shapes). */
function roundCrop(d: Uint8ClampedArray, w: number, h: number): void {
  const r = Math.min(w, h) / 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if ((x + 0.5 - w / 2) ** 2 + (y + 0.5 - h / 2) ** 2 > r * r) d[(y * w + x) * 4 + 3] = 0;
    }
  }
}

/**
 * A picture from the phone as SVG: an SVG file as it is; a photo or a PNG/JPG logo traced into colour areas.
 * Throws when the file is not a picture the browser can read.
 */
export async function pictureToSvg(file: File, kind: PictureKind): Promise<string> {
  if (file.type === 'image/svg+xml' || /\.svg$/i.test(file.name)) {
    const text = await file.text();
    if (!svgToArt(text).art) throw new Error('svg');
    return text;
  }
  const image = await decode(file);
  const side = TRACE_SIZE[kind];
  // A photo is cropped to a centred square first.
  const crop = kind === 'photo' ? Math.min(image.width, image.height) : 0;
  const sw = crop || image.width;
  const sh = crop || image.height;
  const k = Math.min(1, side / Math.max(sw, sh));
  const w = Math.max(8, Math.round(sw * k));
  const h = Math.max(8, Math.round(sh * k));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('canvas');
  ctx.drawImage(image, crop ? (image.width - crop) / 2 : 0, crop ? (image.height - crop) / 2 : 0, sw, sh, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h);
  if (kind === 'photo') roundCrop(data.data, w, h);
  else dropBackground(data.data, w, h);
  const { default: tracer } = await import('imagetracerjs');
  const svg: string = tracer.imagedataToSVG(data, {
    numberofcolors: kind === 'photo' ? 8 : 6,
    colorsampling: 2,
    colorquantcycles: 3,
    blurradius: kind === 'photo' ? 2 : 0,
    blurdelta: 30,
    ltres: kind === 'photo' ? 1.5 : 1,
    qtres: kind === 'photo' ? 1.5 : 1,
    pathomit: kind === 'photo' ? 12 : 6,
    strokewidth: 0,
    roundcoords: 1,
    viewbox: true,
  });
  // Fully transparent areas (the background, outside the circle) are not shapes.
  const cleaned = svg.replace(/<path[^>]*opacity="0"[^>]*\/>/g, '');
  if (!svgToArt(cleaned).art) throw new Error('empty');
  return cleaned;
}

// ---------------------------------------------------------------------------
// Artwork → SVG
// ---------------------------------------------------------------------------

const n = (v: number) => Math.round(v * 10) / 10;

function pathData(contours: readonly Contour[]): string {
  return contours.map((c) => `M${n(c.start[0])} ${n(c.start[1])}${c.segs.map((s) => `C${s.map(n).join(' ')}`).join('')}${c.closed ? 'Z' : ''}`).join('');
}

const rgb = (c: readonly number[]) => `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`;

function paintAttr(p: ArtPaint, attr: 'fill' | 'stroke', defs: string[]): string {
  if (p.type === 'solid') return `${attr}="${rgb(p.color)}"${p.color[3] < 1 ? ` ${attr}-opacity="${n(p.color[3])}"` : ''}`;
  const id = `g${defs.length}`;
  const stops = p.stops
    .map((s) => `<stop offset="${s.offset}" stop-color="${rgb(s.color)}"${s.color[3] < 1 ? ` stop-opacity="${s.color[3]}"` : ''}/>`)
    .join('');
  defs.push(
    p.type === 'linear'
      ? `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${n(p.start[0])}" y1="${n(p.start[1])}" x2="${n(p.end[0])}" y2="${n(p.end[1])}">${stops}</linearGradient>`
      : `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${n(p.start[0])}" cy="${n(p.start[1])}" r="${n(Math.hypot(p.end[0] - p.start[0], p.end[1] - p.start[1]))}">${stops}</radialGradient>`,
  );
  return `${attr}="url(#${id})"`;
}

/** Artwork items as an SVG document (later items on top, as in SVG). */
export function artToSvg(items: readonly ArtItem[]): string {
  const box = artBBox(items) ?? { x: 0, y: 0, w: 1, h: 1 };
  const defs: string[] = [];
  const paths = items.map((it) => {
    const fill = it.fill ? paintAttr(it.fill, 'fill', defs) : 'fill="none"';
    const stroke = it.stroke
      ? `${paintAttr(it.stroke.paint, 'stroke', defs)} stroke-width="${n(it.stroke.width)}" stroke-linejoin="round" stroke-linecap="round"`
      : '';
    return `<path d="${pathData(it.contours)}" ${fill} ${stroke}${it.evenOdd ? ' fill-rule="evenodd"' : ''}${it.opacity < 1 ? ` opacity="${n(it.opacity)}"` : ''}/>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${n(box.x)} ${n(box.y)} ${n(box.w)} ${n(box.h)}">${defs.length ? `<defs>${defs.join('')}</defs>` : ''}${paths.join('')}</svg>`;
}

/** Items of `art` fitted into a `w × h` box whose centre is (cx, cy). */
function place(art: VectorArt, w: number, h: number, cx: number, cy: number): { items: ArtItem[]; box: { x: number; y: number; w: number; h: number } } {
  const fitted = fitArt(art, w, h);
  const move = (c: Contour): Contour => ({
    ...c,
    start: [c.start[0] + cx, c.start[1] + cy],
    segs: c.segs.map((s) => [s[0] + cx, s[1] + cy, s[2] + cx, s[3] + cy, s[4] + cx, s[5] + cy]),
  });
  const movePaint = (p: ArtPaint): ArtPaint =>
    p.type === 'solid'
      ? p
      : {
          ...p,
          start: [p.start[0] + cx, p.start[1] + cy],
          end: [p.end[0] + cx, p.end[1] + cy],
        };
  const items = fitted.items.map((it) => ({
    ...it,
    contours: it.contours.map(move),
    fill: it.fill && movePaint(it.fill),
    stroke: it.stroke && { ...it.stroke, paint: movePaint(it.stroke.paint) },
  }));
  return {
    items,
    box: {
      x: fitted.bbox.x + cx,
      y: fitted.bbox.y + cy,
      w: fitted.bbox.w,
      h: fitted.bbox.h,
    },
  };
}

/** Long single-line text goes on two lines (at the space nearest the middle), so it can be bigger. */
export function balanceLines(text: string): string {
  const t = text.trim().replace(/[ \t]+/g, ' ');
  if (t.includes('\n') || t.length < 14) return t;
  const mid = t.length / 2;
  let best = -1;
  for (let i = 0; i < t.length; i++) if (t[i] === ' ' && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i;
  return best > 0 ? `${t.slice(0, best)}\n${t.slice(best + 1)}` : t;
}

export interface DesignInput {
  photo: string | null;
  logo: string | null;
  text: string;
  fontId: string;
  textColor: string;
  /** Text outline colour (keeps it readable on any picture); null for none. */
  outline: string | null;
}

/**
 * One artwork from the user's photo, logo and text: the picture on top (with the logo as a badge on the photo),
 * the text underneath, sized to the width it gets. Null when there is no picture (the text alone then goes
 * through the normal text path, with its fonts and colours).
 */
export async function buildDesign(input: DesignInput): Promise<string | null> {
  const photo = input.photo ? svgToArt(input.photo).art : null;
  const logo = input.logo ? svgToArt(input.logo).art : null;
  const picture = photo ?? logo;
  if (!picture) return null;
  const badge = photo && logo ? logo : null;
  const text = input.text.trim();
  let textArt: VectorArt | null = null;
  if (text) {
    const font = await loadFont(hasFont(input.fontId) ? input.fontId : DEFAULT_FONT_ID);
    const art = textToArt(font, {
      text: balanceLines(text),
      letterSpacing: 0,
      lineHeight: 1.05,
      uppercase: false,
    }).art;
    if (art) {
      const contours = art.items.flatMap((it) => it.contours);
      const fill: ArtItem = {
        contours,
        fill: { type: 'solid', color: hexToRgba(input.textColor) },
        stroke: null,
        evenOdd: false,
        opacity: 1,
      };
      const items: ArtItem[] = input.outline
        ? [
            {
              contours,
              fill: null,
              stroke: {
                paint: { type: 'solid', color: hexToRgba(input.outline) },
                width: 14,
                cap: 2,
                join: 2,
                miter: 4,
              },
              evenOdd: false,
              opacity: 1,
            },
            fill,
          ]
        : [fill];
      textArt = { ...art, items, bbox: artBBox(items) ?? art.bbox };
    }
  }

  const SIDE = 1000;
  const items: ArtItem[] = [];
  // Picture: the whole square without text; the top part with it.
  const pictureH = textArt ? 640 : SIDE;
  const pic = place(picture, SIDE * 0.9, pictureH, 0, textArt ? -SIDE / 2 + pictureH / 2 : 0);
  items.push(...pic.items);
  if (badge) {
    const size = Math.min(pic.box.w, pic.box.h) * 0.4;
    items.push(...place(badge, size, size, pic.box.x + pic.box.w - size * 0.45, pic.box.y + pic.box.h - size * 0.45).items);
  }
  if (textArt) {
    const top = pic.box.y + pic.box.h + 30;
    const height = Math.max(160, SIDE / 2 - top);
    items.push(...place(textArt, SIDE * 0.95, height, 0, top + height / 2).items);
  }
  return artToSvg(items);
}
