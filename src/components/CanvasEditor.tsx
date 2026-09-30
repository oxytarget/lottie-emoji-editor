import { useEffect, useRef, useState } from 'react';
import { CONTENT_CLASS } from '../lottie/compose';
import { useT } from '../state/useT';

/** Transform of the user's text/logo, edited directly on the preview. */
export interface ContentXf {
  scale: number;
  offsetX: number;
  offsetY: number;
  rotation: number;
}

interface Props {
  /** Element that contains the rendered Lottie SVG. */
  stage: React.RefObject<HTMLDivElement | null>;
  value: ContentXf;
  /** Called on every frame while a gesture is running. */
  onLive(xf: ContentXf): void;
  /** Called once when the gesture ends. */
  onCommit(xf: ContentXf): void;
  /** Gesture started/ended — the preview pauses while editing. */
  onActive?(active: boolean): void;
}

type Mode = 'move' | 'scale' | 'rotate' | 'pinch' | 'scroll';

interface Gesture {
  mode: Mode;
  start: ContentXf;
  /** Canvas units per screen pixel. */
  k: number;
  center: { x: number; y: number };
  pointers: Map<number, { x: number; y: number }>;
  origin: Map<number, { x: number; y: number }>;
  last: { x: number; y: number };
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const LIMITS = { scale: [0.2, 3], offset: [-260, 260] } as const;

function normalize(xf: ContentXf): ContentXf {
  let r = ((xf.rotation % 360) + 540) % 360 - 180;
  // Snap to straight angles when close.
  for (const a of [-180, -90, 0, 90, 180]) if (Math.abs(r - a) < 4) r = a;
  return {
    scale: Math.round(clamp(xf.scale, LIMITS.scale[0], LIMITS.scale[1]) * 100) / 100,
    offsetX: Math.round(clamp(xf.offsetX, LIMITS.offset[0], LIMITS.offset[1])),
    offsetY: Math.round(clamp(xf.offsetY, LIMITS.offset[0], LIMITS.offset[1])),
    rotation: Math.round(r === -180 ? 180 : r),
  };
}

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
const angle = (a: { x: number; y: number }, b: { x: number; y: number }) => (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
const mid = (pts: { x: number; y: number }[]) => ({ x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 });

/**
 * Selection box over the user's text/logo: drag to move, corner handles to resize, top handle to rotate,
 * two fingers to pinch/rotate, mouse wheel to resize, arrow keys to nudge.
 */
export function CanvasEditor({ stage, value, onLive, onCommit, onActive }: Props) {
  const t = useT();
  const boxRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const latest = useRef(value);
  const [selected, setSelected] = useState(false);
  const [active, setActive] = useState(false);
  const wheelTimer = useRef<number | undefined>(undefined);
  latest.current = gesture.current ? latest.current : value;

  // Follow the rendered content every frame (it moves with the animation).
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const box = boxRef.current;
      const root = stage.current;
      if (box && root) {
        const el = root.querySelector(`.${CONTENT_CLASS}`) as SVGGraphicsElement | null;
        const r = el?.getBoundingClientRect();
        if (el && r && r.width > 0 && r.height > 0) {
          const s = root.getBoundingClientRect();
          const pad = 10;
          box.style.display = '';
          box.style.transform = `translate(${r.left - s.left - pad}px, ${r.top - s.top - pad}px)`;
          box.style.width = `${r.width + pad * 2}px`;
          box.style.height = `${r.height + pad * 2}px`;
        } else {
          box.style.display = 'none';
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [stage]);

  // Deselect when tapping elsewhere.
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setSelected(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, []);

  const unitsPerPx = () => {
    const svg = stage.current?.querySelector('svg');
    const w = svg?.getBoundingClientRect().width ?? 0;
    return w > 0 ? 512 / w : 1;
  };

  const boxCenter = () => {
    const r = boxRef.current!.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };

  const emit = (xf: ContentXf) => {
    latest.current = normalize(xf);
    onLive(latest.current);
  };

  const begin = (mode: Mode, e: React.PointerEvent) => {
    const g = gesture.current;
    if (g) {
      // A second finger turns any gesture into pinch + rotate.
      g.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (g.pointers.size === 2) {
        gesture.current = { ...g, mode: 'pinch', start: latest.current, origin: new Map(g.pointers) };
      }
      return;
    }
    const p = { x: e.clientX, y: e.clientY };
    gesture.current = {
      mode,
      start: latest.current,
      k: unitsPerPx(),
      center: boxCenter(),
      pointers: new Map([[e.pointerId, p]]),
      origin: new Map([[e.pointerId, p]]),
      last: p,
    };
    setActive(true);
    onActive?.(true);
  };

  const onPointerDown = (mode: Mode) => (e: React.PointerEvent) => {
    if (e.button > 0) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    setSelected(true);
    begin(mode, e);
  };

  // Pointers anywhere on the stage: a second finger for pinch, or one finger to scroll the page.
  useEffect(() => {
    const root = stage.current;
    if (!root) return;
    const down = (e: PointerEvent) => {
      const g = gesture.current;
      if (g && g.pointers.size === 1) {
        g.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        gesture.current = { ...g, mode: 'pinch', start: latest.current, origin: new Map(g.pointers) };
        root.setPointerCapture?.(e.pointerId);
      } else if (!g && e.pointerType === 'touch' && !boxRef.current?.contains(e.target as Node)) {
        const p = { x: e.clientX, y: e.clientY };
        gesture.current = { mode: 'scroll', start: latest.current, k: 1, center: p, pointers: new Map([[e.pointerId, p]]), origin: new Map([[e.pointerId, p]]), last: p };
      }
    };
    root.addEventListener('pointerdown', down);
    return () => root.removeEventListener('pointerdown', down);
  }, [stage]);

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const g = gesture.current;
      if (!g || !g.pointers.has(e.pointerId)) return;
      const p = { x: e.clientX, y: e.clientY };
      g.pointers.set(e.pointerId, p);
      const s = g.start;
      if (g.mode === 'scroll') {
        // The stage blocks native touch scrolling so gestures work; scroll the page by hand instead.
        window.scrollBy(0, g.last.y - p.y);
        g.last = p;
        return;
      }
      if (g.mode === 'pinch' && g.pointers.size >= 2) {
        const [a0, b0] = [...g.origin.values()];
        const [a1, b1] = [...g.pointers.values()];
        const m0 = mid([a0, b0]);
        const m1 = mid([a1, b1]);
        emit({
          scale: s.scale * (dist(a1, b1) / Math.max(dist(a0, b0), 1)),
          rotation: s.rotation + angle(a1, b1) - angle(a0, b0),
          offsetX: s.offsetX + (m1.x - m0.x) * g.k,
          offsetY: s.offsetY + (m1.y - m0.y) * g.k,
        });
        return;
      }
      const o = g.origin.get(e.pointerId)!;
      if (g.mode === 'move') emit({ ...s, offsetX: s.offsetX + (p.x - o.x) * g.k, offsetY: s.offsetY + (p.y - o.y) * g.k });
      else if (g.mode === 'scale') emit({ ...s, scale: s.scale * (dist(p, g.center) / Math.max(dist(o, g.center), 1)) });
      else if (g.mode === 'rotate') emit({ ...s, rotation: s.rotation + angle(g.center, p) - angle(g.center, o) });
    };
    const up = (e: PointerEvent) => {
      const g = gesture.current;
      if (!g || !g.pointers.has(e.pointerId)) return;
      g.pointers.delete(e.pointerId);
      g.origin.delete(e.pointerId);
      if (g.mode === 'pinch' && g.pointers.size === 1) {
        // Continue as a move with the remaining finger.
        const [id, p] = [...g.pointers.entries()][0];
        gesture.current = { ...g, mode: 'move', start: latest.current, origin: new Map([[id, p]]) };
        return;
      }
      if (g.pointers.size) return;
      gesture.current = null;
      if (g.mode !== 'scroll') {
        setActive(false);
        onActive?.(false);
        onCommit(latest.current);
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  });

  // Mouse wheel / trackpad pinch over the stage resizes.
  useEffect(() => {
    const root = stage.current;
    if (!root) return;
    const wheel = (e: WheelEvent) => {
      if (!boxRef.current || boxRef.current.style.display === 'none') return;
      e.preventDefault();
      emit({ ...latest.current, scale: latest.current.scale * Math.exp(-e.deltaY / (e.ctrlKey ? 100 : 500)) });
      window.clearTimeout(wheelTimer.current);
      wheelTimer.current = window.setTimeout(() => onCommit(latest.current), 250);
    };
    root.addEventListener('wheel', wheel, { passive: false });
    return () => root.removeEventListener('wheel', wheel);
  });

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 10 : 2;
    const x = latest.current;
    const next: Record<string, ContentXf> = {
      ArrowLeft: { ...x, offsetX: x.offsetX - step },
      ArrowRight: { ...x, offsetX: x.offsetX + step },
      ArrowUp: { ...x, offsetY: x.offsetY - step },
      ArrowDown: { ...x, offsetY: x.offsetY + step },
      '+': { ...x, scale: x.scale * 1.05 },
      '=': { ...x, scale: x.scale * 1.05 },
      '-': { ...x, scale: x.scale / 1.05 },
      '[': { ...x, rotation: x.rotation - (e.shiftKey ? 15 : 5) },
      ']': { ...x, rotation: x.rotation + (e.shiftKey ? 15 : 5) },
    };
    const xf = next[e.key];
    if (!xf) return;
    e.preventDefault();
    latest.current = normalize(xf);
    onCommit(latest.current);
  };

  return (
    <div className="canvas-editor">
      <div
        ref={boxRef}
        className={`canvas-box${selected ? ' is-selected' : ''}${active ? ' is-active' : ''}`}
        role="application"
        aria-label={t('canvasHint')}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onFocus={() => setSelected(true)}
        onPointerDown={onPointerDown('move')}
        style={{ display: 'none' }}
      >
        {(['nw', 'ne', 'se', 'sw'] as const).map((c) => (
          <span key={c} className={`canvas-handle is-${c}`} onPointerDown={onPointerDown('scale')} aria-hidden />
        ))}
        <span className="canvas-rotate" onPointerDown={onPointerDown('rotate')} aria-hidden>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5" />
          </svg>
        </span>
      </div>
    </div>
  );
}
