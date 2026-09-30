import { IDENTITY, contoursBBox, matrixScale, multiply, parsePathData, transformContours, type Contour } from '../lottie/bezier';
import { parseColor, type RGBA } from '../lottie/color';
import type { GradientStop } from '../lottie/shapes';
import type { BBox, Matrix } from '../lottie/types';
import { artBBox, type ArtItem, type ArtPaint, type VectorArt } from './art';

export type SvgWarning = 'text' | 'image' | 'clip' | 'mask' | 'filter' | 'pattern' | 'complex';

export interface SvgImportResult {
  art: VectorArt | null;
  warnings: SvgWarning[];
  error?: 'parse' | 'empty' | 'too-large';
  stats: { items: number; points: number };
}

export const MAX_SVG_BYTES = 3 * 1024 * 1024;
const COMPLEX_POINTS = 6000;

// ---------------------------------------------------------------------------
// Style cascade
// ---------------------------------------------------------------------------

const INHERITED = [
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'color',
  'visibility',
] as const;
const NON_INHERITED = ['opacity', 'display', 'stop-color', 'stop-opacity', 'clip-path', 'mask', 'filter'] as const;
const STYLE_PROPS: readonly string[] = [...INHERITED, ...NON_INHERITED];

type Style = Record<string, string>;

const ROOT_STYLE: Style = {
  fill: 'black',
  'fill-opacity': '1',
  'fill-rule': 'nonzero',
  stroke: 'none',
  'stroke-width': '1',
  'stroke-opacity': '1',
  'stroke-linecap': 'butt',
  'stroke-linejoin': 'miter',
  'stroke-miterlimit': '4',
  color: 'black',
  visibility: 'visible',
};

interface CssRule {
  selector: string;
  decls: Style;
  important: Style;
  specificity: number;
  order: number;
}

function parseDeclarations(text: string): { decls: Style; important: Style } {
  const decls: Style = {};
  const important: Style = {};
  for (const part of text.split(';')) {
    const idx = part.indexOf(':');
    if (idx < 0) continue;
    const prop = part.slice(0, idx).trim().toLowerCase();
    let value = part.slice(idx + 1).trim();
    if (!prop || !value) continue;
    const isImportant = /!important\s*$/i.test(value);
    value = value.replace(/!important\s*$/i, '').trim();
    (isImportant ? important : decls)[prop] = value;
  }
  return { decls, important };
}

function specificity(selector: string): number {
  const ids = (selector.match(/#[\w-]+/g) ?? []).length;
  const classes = (selector.match(/(\.[\w-]+|\[[^\]]*\]|:(?!:)[\w-]+)/g) ?? []).length;
  const tags = (selector.replace(/#[\w-]+|\.[\w-]+|\[[^\]]*\]|::?[\w-]+(\([^)]*\))?/g, ' ').match(/[a-zA-Z][\w-]*/g) ?? []).length;
  return ids * 10000 + classes * 100 + tags;
}

/** Tiny CSS parser: plain rule sets only, at-rules are skipped. */
export function parseCss(css: string): CssRule[] {
  const rules: CssRule[] = [];
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!\[CDATA\[|\]\]>/g, '');
  let i = 0;
  let order = 0;
  while (i < src.length) {
    const open = src.indexOf('{', i);
    if (open < 0) break;
    const prelude = src.slice(i, open).trim();
    // Find the matching closing brace (handles nested blocks of at-rules).
    let depth = 1;
    let j = open + 1;
    while (j < src.length && depth > 0) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}') depth--;
      j++;
    }
    const body = src.slice(open + 1, j - 1);
    i = j;
    if (!prelude || prelude.startsWith('@')) continue;
    const { decls, important } = parseDeclarations(body);
    for (const sel of prelude.split(',')) {
      const selector = sel.trim();
      if (selector) rules.push({ selector, decls, important, specificity: specificity(selector), order: order++ });
    }
  }
  return rules.sort((a, b) => a.specificity - b.specificity || a.order - b.order);
}

function safeMatches(el: Element, selector: string): boolean {
  try {
    return el.matches(selector);
  } catch {
    return false;
  }
}

function computeStyle(el: Element, parent: Style, rules: readonly CssRule[]): Style {
  const style: Style = {};
  for (const p of INHERITED) style[p] = parent[p];
  style.opacity = '1';
  style.display = 'inline';

  const apply = (decls: Style) => {
    for (const [prop, value] of Object.entries(decls)) {
      if (!STYLE_PROPS.includes(prop)) continue;
      if (value === 'inherit') style[prop] = parent[prop] ?? style[prop];
      else if (value !== 'initial' && value !== 'unset') style[prop] = value;
    }
  };

  const attrs: Style = {};
  for (const p of STYLE_PROPS) {
    const v = el.getAttribute(p);
    if (v !== null) attrs[p] = v.trim();
  }
  apply(attrs);
  const matched = rules.filter((r) => safeMatches(el, r.selector));
  for (const r of matched) apply(r.decls);
  const inline = el.getAttribute('style');
  const inlineParsed = inline ? parseDeclarations(inline) : null;
  if (inlineParsed) apply(inlineParsed.decls);
  for (const r of matched) apply(r.important);
  if (inlineParsed) apply(inlineParsed.important);
  return style;
}

// ---------------------------------------------------------------------------
// Numbers, lengths, transforms
// ---------------------------------------------------------------------------

const UNIT: Record<string, number> = { px: 1, pt: 4 / 3, pc: 16, mm: 3.7795275591, cm: 37.795275591, in: 96, em: 16, rem: 16, ex: 8 };

function parseLength(value: string | null | undefined, ref: number, fallback = 0): number {
  if (value === null || value === undefined || value.trim() === '') return fallback;
  const m = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*(%|[a-z]+)?\s*$/i.exec(value);
  if (!m) return fallback;
  const n = parseFloat(m[1]);
  const unit = m[2]?.toLowerCase();
  if (!unit) return n;
  if (unit === '%') return (n / 100) * ref;
  return n * (UNIT[unit] ?? 1);
}

function parseNumbers(s: string): number[] {
  return (s.match(/[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/gi) ?? []).map(Number);
}

export function parseTransform(value: string | null): Matrix {
  if (!value) return IDENTITY;
  let m: Matrix = IDENTITY;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(value))) {
    const fn = match[1].toLowerCase();
    const a = parseNumbers(match[2]);
    let t: Matrix = IDENTITY;
    if (fn === 'matrix' && a.length >= 6) t = [a[0], a[1], a[2], a[3], a[4], a[5]];
    else if (fn === 'translate') t = [1, 0, 0, 1, a[0] ?? 0, a[1] ?? 0];
    else if (fn === 'scale') t = [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0];
    else if (fn === 'rotate') {
      const rad = ((a[0] ?? 0) * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const cx = a[1] ?? 0;
      const cy = a[2] ?? 0;
      t = multiply(multiply([1, 0, 0, 1, cx, cy], [cos, sin, -sin, cos, 0, 0]), [1, 0, 0, 1, -cx, -cy]);
    } else if (fn === 'skewx') t = [1, 0, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 1, 0, 0];
    else if (fn === 'skewy') t = [1, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0];
    m = multiply(m, t);
  }
  return m;
}

function viewBoxOf(el: Element): [number, number, number, number] | null {
  const vb = el.getAttribute('viewBox');
  if (!vb) return null;
  const n = parseNumbers(vb);
  return n.length === 4 && n[2] > 0 && n[3] > 0 ? [n[0], n[1], n[2], n[3]] : null;
}

/** Transform established by a viewBox inside a viewport of `w × h`. */
function viewBoxTransform(vb: [number, number, number, number], w: number, h: number, par: string | null): Matrix {
  const [vx, vy, vw, vh] = vb;
  const sx = w / vw;
  const sy = h / vh;
  const p = (par ?? 'xMidYMid meet').trim();
  if (p.startsWith('none')) return [sx, 0, 0, sy, -vx * sx, -vy * sy];
  const s = p.includes('slice') ? Math.max(sx, sy) : Math.min(sx, sy);
  const align = p.split(/\s+/)[0];
  const ax = align.includes('xMin') ? 0 : align.includes('xMax') ? 1 : 0.5;
  const ay = align.includes('YMin') ? 0 : align.includes('YMax') ? 1 : 0.5;
  return [s, 0, 0, s, -vx * s + (w - vw * s) * ax, -vy * s + (h - vh * s) * ay];
}

// ---------------------------------------------------------------------------
// Geometry of basic shapes
// ---------------------------------------------------------------------------

interface Viewport {
  w: number;
  h: number;
}

function num(el: Element, name: string, ref: number, fallback = 0): number {
  return parseLength(el.getAttribute(name), ref, fallback);
}

function shapeContours(el: Element, vp: Viewport): Contour[] {
  const diag = Math.sqrt((vp.w * vp.w + vp.h * vp.h) / 2);
  switch (el.localName) {
    case 'path':
      return parsePathData(el.getAttribute('d') ?? '');
    case 'rect': {
      const x = num(el, 'x', vp.w);
      const y = num(el, 'y', vp.h);
      const w = num(el, 'width', vp.w);
      const h = num(el, 'height', vp.h);
      if (w <= 0 || h <= 0) return [];
      const rxAttr = el.getAttribute('rx');
      const ryAttr = el.getAttribute('ry');
      let rx = rxAttr !== null && rxAttr !== 'auto' ? parseLength(rxAttr, vp.w) : NaN;
      let ry = ryAttr !== null && ryAttr !== 'auto' ? parseLength(ryAttr, vp.h) : NaN;
      if (Number.isNaN(rx)) rx = Number.isNaN(ry) ? 0 : ry;
      if (Number.isNaN(ry)) ry = rx;
      rx = Math.min(Math.max(rx, 0), w / 2);
      ry = Math.min(Math.max(ry, 0), h / 2);
      if (rx === 0 || ry === 0) return parsePathData(`M${x} ${y}H${x + w}V${y + h}H${x}Z`);
      return parsePathData(
        `M${x + rx} ${y}H${x + w - rx}A${rx} ${ry} 0 0 1 ${x + w} ${y + ry}V${y + h - ry}A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h}` +
          `H${x + rx}A${rx} ${ry} 0 0 1 ${x} ${y + h - ry}V${y + ry}A${rx} ${ry} 0 0 1 ${x + rx} ${y}Z`,
      );
    }
    case 'circle':
    case 'ellipse': {
      const cx = num(el, 'cx', vp.w);
      const cy = num(el, 'cy', vp.h);
      const rx = el.localName === 'circle' ? num(el, 'r', diag) : num(el, 'rx', vp.w);
      const ry = el.localName === 'circle' ? rx : num(el, 'ry', vp.h, rx);
      if (rx <= 0 || ry <= 0) return [];
      return parsePathData(`M${cx - rx} ${cy}A${rx} ${ry} 0 1 0 ${cx + rx} ${cy}A${rx} ${ry} 0 1 0 ${cx - rx} ${cy}Z`);
    }
    case 'line':
      return parsePathData(`M${num(el, 'x1', vp.w)} ${num(el, 'y1', vp.h)}L${num(el, 'x2', vp.w)} ${num(el, 'y2', vp.h)}`);
    case 'polyline':
    case 'polygon': {
      const n = parseNumbers(el.getAttribute('points') ?? '');
      if (n.length < 4) return [];
      let d = `M${n[0]} ${n[1]}`;
      for (let i = 2; i + 1 < n.length; i += 2) d += `L${n[i]} ${n[i + 1]}`;
      if (el.localName === 'polygon') d += 'Z';
      return parsePathData(d);
    }
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// Paint servers
// ---------------------------------------------------------------------------

const GRADIENT_ATTRS = ['x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'fx', 'fy', 'gradientUnits', 'gradientTransform'];

function hrefOf(el: Element): string | null {
  const h = el.getAttribute('href') ?? el.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ?? el.getAttribute('xlink:href');
  return h && h.startsWith('#') ? h.slice(1) : null;
}

function clamp01(n: number) {
  return Math.min(1, Math.max(0, n));
}

/** Parses opacity-like values (`0.5`, `50%`), returning `fallback` when invalid. */
function parseAlpha(value: string | undefined, fallback = 1): number {
  if (value === undefined) return fallback;
  const n = parseFloat(value);
  if (Number.isNaN(n)) return fallback;
  return clamp01(value.trim().endsWith('%') ? n / 100 : n);
}

interface Ctx {
  rules: CssRule[];
  byId: Map<string, Element>;
  warnings: Set<SvgWarning>;
  items: ArtItem[];
}

function gradientStops(el: Element, ctx: Ctx, opacity: number): GradientStop[] {
  const seen = new Set<Element>();
  let cur: Element | null = el;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const stops = Array.from(cur.children).filter((c) => c.localName === 'stop');
    if (stops.length) {
      let last = 0;
      return stops.map((s) => {
        const st = computeStyle(s, ROOT_STYLE, ctx.rules);
        const offRaw = s.getAttribute('offset') ?? '0';
        const off = clamp01(offRaw.trim().endsWith('%') ? parseFloat(offRaw) / 100 : parseFloat(offRaw) || 0);
        last = Math.max(last, off);
        const colorStr = st['stop-color'] === 'currentColor' ? st.color : st['stop-color'] ?? 'black';
        const c = parseColor(colorStr) ?? [0, 0, 0, 1];
        const alpha = c[3] * parseAlpha(st['stop-opacity']) * opacity;
        return { offset: last, color: [c[0], c[1], c[2], alpha] as RGBA };
      });
    }
    const next = hrefOf(cur);
    cur = next ? ctx.byId.get(next) ?? null : null;
  }
  return [];
}

function gradientAttrs(el: Element, ctx: Ctx): Record<string, string> {
  const out: Record<string, string> = {};
  const seen = new Set<Element>();
  let cur: Element | null = el;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    for (const a of GRADIENT_ATTRS) {
      const v = cur.getAttribute(a);
      if (v !== null && out[a] === undefined) out[a] = v;
    }
    const next = hrefOf(cur);
    cur = next ? ctx.byId.get(next) ?? null : null;
  }
  return out;
}

function resolvePaint(value: string, opacity: number, style: Style, localBox: BBox | null, ctm: Matrix, vp: Viewport, ctx: Ctx): ArtPaint | null {
  const v = value.trim();
  if (!v || v === 'none') return null;
  const url = /^url\(\s*['"]?#([^'")]+)['"]?\s*\)\s*(.*)$/.exec(v);
  if (url) {
    const target = ctx.byId.get(url[1]);
    const fallback = url[2]?.trim();
    const fallbackPaint = () => (fallback ? resolvePaint(fallback, opacity, style, localBox, ctm, vp, ctx) : null);
    if (!target) return fallbackPaint();
    if (target.localName === 'pattern') {
      ctx.warnings.add('pattern');
      return fallbackPaint();
    }
    if (target.localName !== 'linearGradient' && target.localName !== 'radialGradient') return fallbackPaint();
    const stops = gradientStops(target, ctx, opacity);
    if (!stops.length) return null;
    if (stops.length === 1) return { type: 'solid', color: stops[0].color };
    const a = gradientAttrs(target, ctx);
    const obb = (a.gradientUnits ?? 'objectBoundingBox') !== 'userSpaceOnUse';
    if (obb && (!localBox || localBox.w === 0 || localBox.h === 0)) return { type: 'solid', color: stops[stops.length - 1].color };
    const unitMatrix: Matrix = obb && localBox ? [localBox.w, 0, 0, localBox.h, localBox.x, localBox.y] : IDENTITY;
    const m = multiply(ctm, multiply(unitMatrix, parseTransform(a.gradientTransform ?? null)));
    const len = (val: string | undefined, def: string, ref: number) => {
      const raw = val ?? def;
      if (obb) return raw.trim().endsWith('%') ? parseFloat(raw) / 100 : parseFloat(raw);
      return parseLength(raw, ref);
    };
    const pt = (x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
    if (target.localName === 'linearGradient') {
      return {
        type: 'linear',
        stops,
        start: pt(len(a.x1, '0%', vp.w), len(a.y1, '0%', vp.h)),
        end: pt(len(a.x2, '100%', vp.w), len(a.y2, '0%', vp.h)),
      };
    }
    const cx = len(a.cx, '50%', vp.w);
    const cy = len(a.cy, '50%', vp.h);
    const r = len(a.r, '50%', Math.sqrt((vp.w * vp.w + vp.h * vp.h) / 2));
    return { type: 'radial', stops, start: pt(cx, cy), end: pt(cx + r, cy) };
  }
  const colorStr = v === 'currentColor' || v === 'currentcolor' ? style.color : v;
  const c = parseColor(colorStr);
  if (!c) return null;
  return { type: 'solid', color: [c[0], c[1], c[2], c[3] * opacity] };
}

// ---------------------------------------------------------------------------
// Tree walk
// ---------------------------------------------------------------------------

const SKIP = new Set([
  'defs',
  'clipPath',
  'clippath',
  'mask',
  'symbol',
  'pattern',
  'marker',
  'metadata',
  'title',
  'desc',
  'style',
  'script',
  'foreignObject',
  'foreignobject',
  'filter',
  'linearGradient',
  'lineargradient',
  'radialGradient',
  'radialgradient',
]);
const SHAPES = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon']);
const LINECAP: Record<string, 1 | 2 | 3> = { butt: 1, round: 2, square: 3 };
const LINEJOIN: Record<string, 1 | 2 | 3> = { miter: 1, 'miter-clip': 1, arcs: 1, round: 2, bevel: 3 };

function walk(el: Element, parentStyle: Style, ctm: Matrix, opacity: number, vp: Viewport, ctx: Ctx, depth: number, viaUse = false): void {
  if (depth > 64) return;
  const tag = el.localName;
  if (SKIP.has(tag) && !(viaUse && tag === 'symbol')) return;

  const style = computeStyle(el, parentStyle, ctx.rules);
  if (style.display === 'none') return;
  if (style['clip-path'] && style['clip-path'] !== 'none') ctx.warnings.add('clip');
  if (style.mask && style.mask !== 'none') ctx.warnings.add('mask');
  if (style.filter && style.filter !== 'none') ctx.warnings.add('filter');

  const acc = opacity * parseAlpha(style.opacity);
  if (acc <= 0.001) return;

  let m = multiply(ctm, parseTransform(el.getAttribute('transform')));

  if (tag === 'text' || tag === 'tspan' || tag === 'textPath') {
    ctx.warnings.add('text');
    return;
  }
  if (tag === 'image') {
    ctx.warnings.add('image');
    return;
  }

  if (tag === 'use') {
    const id = hrefOf(el);
    const ref = id ? ctx.byId.get(id) : undefined;
    if (!ref) return;
    m = multiply(m, [1, 0, 0, 1, num(el, 'x', vp.w), num(el, 'y', vp.h)]);
    if (ref.localName === 'symbol' || ref.localName === 'svg') {
      const vb = viewBoxOf(ref);
      const w = el.getAttribute('width') ?? ref.getAttribute('width');
      const h = el.getAttribute('height') ?? ref.getAttribute('height');
      if (vb && w && h) m = multiply(m, viewBoxTransform(vb, parseLength(w, vp.w), parseLength(h, vp.h), ref.getAttribute('preserveAspectRatio')));
    }
    walk(ref, style, m, acc, vp, ctx, depth + 1, true);
    return;
  }

  if (tag === 'svg' && depth > 0) {
    const vb = viewBoxOf(el);
    m = multiply(m, [1, 0, 0, 1, num(el, 'x', vp.w), num(el, 'y', vp.h)]);
    const w = parseLength(el.getAttribute('width'), vp.w, vp.w);
    const h = parseLength(el.getAttribute('height'), vp.h, vp.h);
    if (vb) m = multiply(m, viewBoxTransform(vb, w, h, el.getAttribute('preserveAspectRatio')));
    const inner = vb ? { w: vb[2], h: vb[3] } : { w, h };
    for (const child of Array.from(el.children)) walk(child, style, m, acc, inner, ctx, depth + 1);
    return;
  }

  if (SHAPES.has(tag)) {
    if (style.visibility === 'hidden' || style.visibility === 'collapse') return;
    const local = shapeContours(el, vp);
    if (!local.length) return;
    const localBox = contoursBBox(local);
    const isLine = tag === 'line';
    const fill = isLine ? null : resolvePaint(style.fill, parseAlpha(style['fill-opacity']), style, localBox, m, vp, ctx);
    const strokePaint = resolvePaint(style.stroke, parseAlpha(style['stroke-opacity']), style, localBox, m, vp, ctx);
    const strokeWidth = parseLength(style['stroke-width'], Math.sqrt((vp.w * vp.w + vp.h * vp.h) / 2), 1) * matrixScale(m);
    const stroke =
      strokePaint && strokeWidth > 0
        ? {
            paint: strokePaint,
            width: strokeWidth,
            cap: LINECAP[style['stroke-linecap']] ?? 1,
            join: LINEJOIN[style['stroke-linejoin']] ?? 1,
            miter: parseFloat(style['stroke-miterlimit']) || 4,
          }
        : null;
    if (!fill && !stroke) return;
    ctx.items.push({
      contours: transformContours(local, m),
      fill,
      stroke,
      evenOdd: style['fill-rule'] === 'evenodd',
      opacity: acc,
    });
    return;
  }

  // Containers: svg (root), g, a, switch, symbol (via <use>) and unknown elements.
  for (const child of Array.from(el.children)) walk(child, style, m, acc, vp, ctx, depth + 1);
}

function parseDocument(source: string): Element | null {
  if (typeof DOMParser === 'undefined') return null;
  const xml = new DOMParser().parseFromString(source, 'image/svg+xml');
  const root = xml.documentElement;
  if (root && root.localName === 'svg' && !xml.getElementsByTagName('parsererror').length) return root;
  // Lenient fallback for slightly broken files (unescaped entities etc.).
  const html = new DOMParser().parseFromString(source, 'text/html');
  return html.querySelector('svg');
}

/** Converts an SVG document into editor artwork. Nothing from the file is ever inserted into the page DOM. */
export function svgToArt(source: string): SvgImportResult {
  const empty = (error: SvgImportResult['error']): SvgImportResult => ({ art: null, warnings: [], error, stats: { items: 0, points: 0 } });
  if (source.length > MAX_SVG_BYTES) return empty('too-large');
  const root = parseDocument(source);
  if (!root) return empty('parse');

  const byId = new Map<string, Element>();
  for (const el of Array.from(root.querySelectorAll('[id]'))) byId.set(el.getAttribute('id')!, el);
  const css = Array.from(root.querySelectorAll('style'))
    .map((s) => s.textContent ?? '')
    .join('\n');

  const ctx: Ctx = { rules: parseCss(css), byId, warnings: new Set(), items: [] };
  const vb = viewBoxOf(root);
  const vp: Viewport = vb
    ? { w: vb[2], h: vb[3] }
    : { w: parseLength(root.getAttribute('width'), 100, 100), h: parseLength(root.getAttribute('height'), 100, 100) };

  walk(root, ROOT_STYLE, IDENTITY, 1, vp, ctx, 0);

  const bbox = artBBox(ctx.items);
  const points = ctx.items.reduce((sum, it) => sum + it.contours.reduce((s, c) => s + c.segs.length, 0), 0);
  if (points > COMPLEX_POINTS) ctx.warnings.add('complex');
  const stats = { items: ctx.items.length, points };
  if (!bbox || bbox.w <= 0 || bbox.h <= 0) return { art: null, warnings: [...ctx.warnings], error: 'empty', stats };
  return { art: { kind: 'logo', items: ctx.items, bbox }, warnings: [...ctx.warnings], stats };
}
