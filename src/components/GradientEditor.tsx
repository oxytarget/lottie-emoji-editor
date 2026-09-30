import { useEffect, useId, useRef } from 'react';
import type { I18nKey } from '../i18n';
import { haptic } from '../lib/telegram';
import {
  gradientBoxOf,
  gradientPoints,
  GRADIENT_CLASS,
  resetGradientShape,
  rotateGradient,
  snapPoints,
  toggleRadial,
  withPoints,
  type GradientPaint,
  type Pt,
} from '../lottie/paint';
import type { BBox } from '../lottie/types';
import type { GradTarget } from '../state/gradients';
import { useT } from '../state/useT';
import { ColorSwatch } from './ColorSwatch';
import { MotionButton, Segmented } from './controls';
import { useSwatchTarget } from './FavColors';
import { CheckIcon, GradHandlesIcon, LinearIcon, RadialIcon, ResetIcon, RotateIcon, SwapIcon } from './icons';

/**
 * Gradient handles over the preview: the two points of the rendered gradient (start/end, or centre/edge of a
 * radial one). Drag a dot to stretch or turn the gradient, the line between them to move it, tap a dot to
 * change its colour (a favourite colour can also be dropped on it). Positions come from the rendered SVG, so
 * the handles follow the animation, and are stored relative to the painted area, so one gradient fits every
 * shape it is used on.
 */

interface Props {
  stage: React.RefObject<HTMLDivElement | null>;
  target: GradTarget;
  paint: GradientPaint;
  onLive(p: GradientPaint): void;
  onCommit(p: GradientPaint): void;
  /** A drag started/ended. */
  onActive(active: boolean): void;
  onTapStop(stop: 0 | 1): void;
  onStopColor(stop: 0 | 1, hex: string): void;
  /** Whether the gradient is on the current emoji. */
  onFound(found: boolean): void;
}

interface Found {
  box: BBox;
  /** Painted-area space → screen. */
  m: DOMMatrix;
  /** Stage position on screen. */
  left: number;
  top: number;
}

type Which = 'from' | 'to' | 'both';

interface Drag {
  which: Which;
  pointer: number;
  x0: number;
  y0: number;
  moved: boolean;
  start: { from: Pt; to: Pt };
  p0: Pt;
  toRel(x: number, y: number): Pt;
  aspect: number;
  last: GradientPaint;
}

const MIN_LENGTH = 0.03;

/** The largest rendered element painted with the gradient (all of them share its shape). */
function locate(root: HTMLElement, target: GradTarget): Found | null {
  let best: { el: SVGGraphicsElement; area: number } | null = null;
  for (const el of root.querySelectorAll<SVGGraphicsElement>(`.preview-swap svg .${GRADIENT_CLASS}${target}`)) {
    const r = el.getBoundingClientRect();
    const area = r.width * r.height;
    if (area > 0 && (!best || area > best.area)) best = { el, area };
  }
  if (!best) return null;
  const box = gradientBoxOf(best.el.getAttribute('class'));
  const m = best.el.getScreenCTM();
  if (!box || !m) return null;
  const s = root.getBoundingClientRect();
  return { box, m: DOMMatrix.fromMatrix(m), left: s.left, top: s.top };
}

const screenOf = (f: Found, q: Pt) => new DOMPoint(f.box.x + q[0] * f.box.w, f.box.y + q[1] * f.box.h).matrixTransform(f.m);

export function GradientEditor(props: Props) {
  const t = useT();
  const { stage, target, paint } = props;
  const latest = useRef(props);
  latest.current = props;
  const found = useRef<Found | null>(null);
  const drag = useRef<Drag | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const lineRef = useRef<SVGLineElement>(null);
  const hitRef = useRef<SVGLineElement>(null);
  const ringRef = useRef<SVGCircleElement>(null);
  const handles = [useRef<HTMLButtonElement>(null), useRef<HTMLButtonElement>(null)];
  const ids = [useId(), useId()];
  // Favourite colours dropped on a dot (or painted onto it) recolour that end of the gradient.
  useSwatchTarget(ids[0], (hex) => latest.current.onStopColor(0, hex));
  useSwatchTarget(ids[1], (hex) => latest.current.onStopColor(1, hex));

  // Follow the rendered gradient every frame.
  useEffect(() => {
    let raf = 0;
    let shown: boolean | null = null;
    const tick = () => {
      const root = stage.current;
      const f = root ? locate(root, target) : null;
      found.current = f;
      if (f) {
        const pts = gradientPoints(latest.current.paint, f.box);
        const a = screenOf(f, pts.from);
        const b = screenOf(f, pts.to);
        const ax = a.x - f.left;
        const ay = a.y - f.top;
        const bx = b.x - f.left;
        const by = b.y - f.top;
        handles[0].current?.style.setProperty('transform', `translate(${ax}px, ${ay}px)`);
        handles[1].current?.style.setProperty('transform', `translate(${bx}px, ${by}px)`);
        for (const line of [lineRef.current, hitRef.current]) {
          line?.setAttribute('x1', String(ax));
          line?.setAttribute('y1', String(ay));
          line?.setAttribute('x2', String(bx));
          line?.setAttribute('y2', String(by));
        }
        const ring = ringRef.current;
        if (ring) {
          ring.setAttribute('cx', String(ax));
          ring.setAttribute('cy', String(ay));
          ring.setAttribute('r', String(Math.hypot(bx - ax, by - ay)));
        }
      }
      if (!!f !== shown) {
        shown = !!f;
        if (rootRef.current) rootRef.current.style.display = shown ? '' : 'none';
        latest.current.onFound(shown);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [stage, target]);

  const begin = (which: Which) => (e: React.PointerEvent) => {
    const f = found.current;
    if (!f || e.button > 0) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    const inv = f.m.inverse();
    const toRel = (x: number, y: number): Pt => {
      const q = new DOMPoint(x, y).matrixTransform(inv);
      return [(q.x - f.box.x) / (f.box.w || 1), (q.y - f.box.y) / (f.box.h || 1)];
    };
    const p = latest.current.paint;
    drag.current = {
      which,
      pointer: e.pointerId,
      x0: e.clientX,
      y0: e.clientY,
      moved: false,
      start: gradientPoints(p, f.box),
      p0: toRel(e.clientX, e.clientY),
      toRel,
      aspect: (f.box.w || 1) / (f.box.h || 1),
      last: p,
    };
  };

  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointer) return;
    if (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 5) return;
    if (!d.moved) {
      d.moved = true;
      latest.current.onActive(true);
      haptic();
    }
    const q = d.toRel(e.clientX, e.clientY);
    const dx = q[0] - d.p0[0];
    const dy = q[1] - d.p0[1];
    const shift = (v: Pt): Pt => [v[0] + dx, v[1] + dy];
    let from = d.which === 'to' ? d.start.from : shift(d.start.from);
    let to = d.which === 'from' ? d.start.to : shift(d.start.to);
    if (d.which !== 'both' && d.last.type === 'linear') ({ from, to } = snapPoints(from, to, d.which, d.aspect));
    if (Math.hypot(to[0] - from[0], to[1] - from[1]) < MIN_LENGTH) return;
    d.last = withPoints(latest.current.paint, from, to);
    latest.current.onLive(d.last);
  };

  const end = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointer) return;
    drag.current = null;
    if (d.moved) {
      latest.current.onActive(false);
      if (e.type === 'pointerup') latest.current.onCommit(d.last);
      else latest.current.onLive(latest.current.paint);
      return;
    }
    if (e.type === 'pointerup' && d.which !== 'both') latest.current.onTapStop(d.which === 'from' ? 0 : 1);
  };

  const nudge = (stop: 0 | 1) => (e: React.KeyboardEvent) => {
    const f = found.current;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      latest.current.onTapStop(stop);
      return;
    }
    const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!dir || !f) return;
    e.preventDefault();
    const step = e.shiftKey ? 0.1 : 0.02;
    const pts = gradientPoints(paint, f.box);
    const q = stop === 0 ? pts.from : pts.to;
    const moved: Pt = [q[0] + dir[0] * step, q[1] + dir[1] * step];
    const next = stop === 0 ? withPoints(paint, moved, pts.to) : withPoints(paint, pts.from, moved);
    latest.current.onCommit(next);
  };

  const radial = paint.type === 'radial';
  const labels = radial ? [t('gradCenter'), t('gradEdge')] : [t('gradStart'), t('gradEnd')];
  const pointer = { onPointerMove: move, onPointerUp: end, onPointerCancel: end };

  return (
    <div className="grad-editor" ref={rootRef} style={{ display: 'none' }}>
      <svg className="grad-lines" aria-hidden>
        {radial && <circle ref={ringRef} className="grad-ring" />}
        <line ref={lineRef} className="grad-line" />
        <line ref={hitRef} className="grad-line-hit" onPointerDown={begin('both')} {...pointer}>
          <title>{t('gradLine')}</title>
        </line>
      </svg>
      {([0, 1] as const).map((i) => (
        <button
          key={i}
          ref={handles[i]}
          type="button"
          className={`grad-handle${i === 0 ? ' is-start' : ' is-end'}`}
          data-swatch={ids[i]}
          aria-label={`${labels[i]}: ${paint.colors[i]}`}
          title={labels[i]}
          onPointerDown={begin(i === 0 ? 'from' : 'to')}
          onKeyDown={nudge(i)}
          {...pointer}
        >
          <span style={{ background: paint.colors[i] }} />
        </button>
      ))}
    </div>
  );
}

export const GRAD_TITLES: Record<GradTarget, I18nKey> = {
  textFill: 'gradTextFill',
  textOutline: 'gradTextOutline',
  body: 'gradBody',
  outline: 'gradOutline',
  accent: 'gradAccent',
};

/** Under the canvas while its gradient handles are shown: colours, type, turn, strength, reset, done. */
export function GradientBar(props: {
  target: GradTarget;
  paint: GradientPaint;
  found: boolean;
  onChange(p: GradientPaint): void;
  onDone(): void;
  barRef: React.RefObject<HTMLDivElement | null>;
}) {
  const t = useT();
  const { paint, onChange } = props;
  const radial = paint.type === 'radial';
  const labels = radial ? [t('gradCenter'), t('gradEdge')] : [t('gradStart'), t('gradEnd')];
  const strength = Math.round((paint.strength ?? 1) * 100);
  const shaped = !!paint.from || paint.strength !== undefined;
  const title = t(GRAD_TITLES[props.target]);
  return (
    <div className="grad-bar" ref={props.barRef} role="group" aria-label={`${t('gradOnCanvas')}: ${title}`}>
      <div className="grad-bar-head">
        <span className="label">
          <GradHandlesIcon width={16} height={16} /> <span className="grad-bar-title">{title}</span>
        </span>
        <button type="button" className="pill-btn is-compact is-accent" onClick={props.onDone}>
          <CheckIcon width={16} height={16} strokeWidth={3} /> {t('gradDone')}
        </button>
      </div>
      <div className="grad-bar-row">
        <span className="grad-stops">
          <span data-stop="0">
            <ColorSwatch color={paint.colors[0]} label={labels[0]} size="sm" onChange={(c) => onChange({ ...paint, colors: [c, paint.colors[1]] })} />
          </span>
          <MotionButton
            motion="flip"
            className="icon-btn is-small"
            icon={<SwapIcon width={16} height={16} />}
            label={t('swapColors')}
            onClick={() => onChange({ ...paint, colors: [paint.colors[1], paint.colors[0]] })}
          />
          <span data-stop="1">
            <ColorSwatch color={paint.colors[1]} label={labels[1]} size="sm" onChange={(c) => onChange({ ...paint, colors: [paint.colors[0], c] })} />
          </span>
        </span>
        <Segmented
          label={title}
          value={paint.type}
          options={[
            { value: 'linear', label: <><LinearIcon width={18} height={18} /><span className="seg-text">{t('gradLinear')}</span></> },
            { value: 'radial', label: <><RadialIcon width={18} height={18} /><span className="seg-text">{t('radialGradient')}</span></> },
          ]}
          onChange={(v) => v !== paint.type && onChange(toggleRadial(paint))}
        />
        <span className="grad-bar-tools">
          <MotionButton motion="spin" className="icon-btn is-small" icon={<RotateIcon width={16} height={16} />} label={t('rotateGradient')} onClick={() => onChange(rotateGradient(paint, 45))} />
          <MotionButton
            motion="spin-back"
            className="icon-btn is-small"
            icon={<ResetIcon width={16} height={16} />}
            label={t('gradReset')}
            onClick={() => shaped && onChange(resetGradientShape(paint))}
          />
        </span>
      </div>
      {/* The track shows the gradient itself: the thumb is how far towards the second colour it goes. */}
      <label className="slider grad-strength" style={{ '--grad-track': `linear-gradient(90deg, ${paint.colors[0]}, ${paint.colors[1]})` } as React.CSSProperties}>
        <span className="label">{t('gradStrength')}</span>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={strength}
          aria-label={t('gradStrength')}
          onChange={(e) => onChange({ ...paint, strength: Number(e.target.value) / 100 })}
          onDoubleClick={() => onChange({ ...paint, strength: 1 })}
        />
        <span className="slider-value">{strength}%</span>
      </label>
      <p className={`hint${props.found ? '' : ' is-warn'}`}>{props.found ? t('gradHint') : t('gradMissing')}</p>
    </div>
  );
}
