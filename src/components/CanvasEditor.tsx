import { useEffect, useRef, useState } from 'react';
import { useUi } from '../state/ui';
import { useT } from '../state/useT';
import { LockIcon, UnlockIcon } from './icons';

/** Transform of the user's text/logo, edited directly on the preview. */
export interface ContentXf {
  scale: number;
  offsetX: number;
  offsetY: number;
  rotation: number;
  /** Height relative to width (free stretching; 1 = proportional). */
  stretch: number;
}

interface Props {
  /** Element that contains the rendered Lottie SVG. */
  stage: React.RefObject<HTMLDivElement | null>;
  /** SVG class of the element being edited (the user's text/logo or a grabbed part). */
  target: string;
  value: ContentXf;
  /** Called on every frame while a gesture is running. */
  onLive(xf: ContentXf): void;
  /** Called once when the gesture ends. */
  onCommit(xf: ContentXf): void;
  /** Gesture started/ended — the preview pauses while editing. */
  onActive?(active: boolean): void;
  /** Double tap / double click on the stage (client coordinates) — used to grab the element under it. */
  onPick?(x: number, y: number): void;
  /** Proportions locked: corners resize evenly; unlocked: corners and edges stretch freely. */
  locked: boolean;
  onToggleLock(): void;
  /** The × next to the handles (and the Delete key): removes what the frame is around. */
  onDelete?(): void;
}

type Mode = 'move' | 'scale' | 'rotate' | 'pinch' | 'scroll' | 'stretch';
/** Which way a free stretch goes: both (corner), width or height (edges). */
type Axis = 'xy' | 'x' | 'y';

interface Gesture {
  mode: Mode;
  axis: Axis;
  /** Value when the gesture began (a tap that moves nothing commits nothing). */
  initial: ContentXf;
  start: ContentXf;
  /** Canvas units per screen pixel. */
  k: number;
  center: { x: number; y: number };
  pointers: Map<number, { x: number; y: number }>;
  origin: Map<number, { x: number; y: number }>;
  last: { x: number; y: number };
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const LIMITS = { scale: [0.01, 3], offset: [-260, 260], stretch: [0.2, 5] } as const;

function normalize(xf: ContentXf): ContentXf {
  let r = ((xf.rotation % 360) + 540) % 360 - 180;
  // Snap to straight angles when close.
  for (const a of [-180, -90, 0, 90, 180]) if (Math.abs(r - a) < 4) r = a;
  return {
    scale: Math.round(clamp(xf.scale, LIMITS.scale[0], LIMITS.scale[1]) * 100) / 100,
    offsetX: Math.round(clamp(xf.offsetX, LIMITS.offset[0], LIMITS.offset[1])),
    offsetY: Math.round(clamp(xf.offsetY, LIMITS.offset[0], LIMITS.offset[1])),
    rotation: Math.round(r === -180 ? 180 : r),
    stretch: Math.round(clamp(xf.stretch, LIMITS.stretch[0], LIMITS.stretch[1]) * 100) / 100,
  };
}

const sameXf = (a: ContentXf, b: ContentXf) =>
  a.scale === b.scale && a.offsetX === b.offsetX && a.offsetY === b.offsetY && a.rotation === b.rotation && a.stretch === b.stretch;

/** A screen vector in the content's own (unrotated) axes. */
function local(v: { x: number; y: number }, rotation: number) {
  const a = (-rotation * Math.PI) / 180;
  return { x: v.x * Math.cos(a) - v.y * Math.sin(a), y: v.x * Math.sin(a) + v.y * Math.cos(a) };
}

/** Free stretch: how the size changes along the content's own axes as a handle moves from `o` to `p`. */
export function stretched(s: ContentXf, axis: Axis, center: { x: number; y: number }, o: { x: number; y: number }, p: { x: number; y: number }): ContentXf {
  const v0 = local({ x: o.x - center.x, y: o.y - center.y }, s.rotation);
  const v1 = local({ x: p.x - center.x, y: p.y - center.y }, s.rotation);
  // A handle that starts (almost) on an axis cannot measure that axis.
  const fx = axis !== 'y' && Math.abs(v0.x) > 8 ? Math.max(Math.abs(v1.x), 2) / Math.abs(v0.x) : 1;
  const fy = axis !== 'x' && Math.abs(v0.y) > 8 ? Math.max(Math.abs(v1.y), 2) / Math.abs(v0.y) : 1;
  return { ...s, scale: s.scale * fx, stretch: (s.stretch * fy) / fx };
}

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
const angle = (a: { x: number; y: number }, b: { x: number; y: number }) => (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
const mid = (pts: { x: number; y: number }[]) => ({ x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 });

/**
 * Selection box over the user's text/logo: drag to move, corner handles to resize, top handle to rotate,
 * two fingers to pinch/rotate, mouse wheel to resize, arrow keys to nudge.
 */
export function CanvasEditor({ stage, target, value, onLive, onCommit, onActive, onPick, locked, onToggleLock, onDelete }: Props) {
  const t = useT();
  const boxRef = useRef<HTMLDivElement>(null);
  const lockRef = useRef<HTMLButtonElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const latest = useRef(value);
  const [selected, setSelected] = useState(false);
  // The Delete key acts on the selected frame (see editCommands).
  useEffect(() => {
    useUi.getState().setCanvasSelected(selected);
  }, [selected]);
  useEffect(() => () => useUi.getState().setCanvasSelected(false), []);
  const [active, setActive] = useState(false);
  const wheelTimer = useRef<number | undefined>(undefined);
  latest.current = gesture.current ? latest.current : value;
  const pick = useRef(onPick);
  pick.current = onPick;

  // A newly grabbed element shows its handles right away.
  const firstTarget = useRef(true);
  useEffect(() => {
    if (firstTarget.current) {
      firstTarget.current = false;
      return;
    }
    setSelected(true);
  }, [target]);

  // Follow the rendered content (it moves with the animation): every frame while selected or dragged, a few
  // times a second otherwise — measuring forces a layout, and on phones that was a big share of every frame.
  // A press on the content between updates is caught by the stage (see the hit test below).
  const live = useRef(false);
  live.current = selected || active;
  const wake = useRef<() => void>(() => {});
  useEffect(() => {
    let raf = 0;
    let timer = 0;
    let stopped = false;
    const tick = () => {
      const box = boxRef.current;
      const root = stage.current;
      if (box && root) {
        const el = root.querySelector(`svg .${target}`) as SVGGraphicsElement | null;
        const r = el?.getBoundingClientRect();
        if (el && r && r.width > 0 && r.height > 0) {
          const s = root.getBoundingClientRect();
          const pad = 10;
          box.style.display = '';
          box.style.transform = `translate(${r.left - s.left - pad}px, ${r.top - s.top - pad}px)`;
          box.style.width = `${r.width + pad * 2}px`;
          box.style.height = `${r.height + pad * 2}px`;
          if (lockRef.current) lockRef.current.style.display = '';
        } else {
          box.style.display = 'none';
          if (lockRef.current) lockRef.current.style.display = 'none';
        }
      }
      if (stopped) return;
      if (live.current) raf = requestAnimationFrame(tick);
      else timer = window.setTimeout(tick, 250);
    };
    wake.current = () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  }, [stage, target]);
  useEffect(() => {
    if (selected || active) wake.current();
  }, [selected, active]);
  const targetRef = useRef(target);
  targetRef.current = target;

  // Double tap (two quick taps close together) anywhere on the stage.
  useEffect(() => {
    const root = stage.current;
    if (!root) return;
    let down: { x: number; y: number; t: number } | null = null;
    let last: { x: number; y: number; t: number } | null = null;
    const onDown = (e: PointerEvent) => {
      // Taps on on-canvas buttons and gradient dots are not taps on the animation.
      if ((e.target as Element | null)?.closest?.('.canvas-lock, .grad-editor button, .grad-line-hit')) {
        down = null;
        last = null;
        return;
      }
      if (e.isPrimary) down = { x: e.clientX, y: e.clientY, t: performance.now() };
    };
    const onUp = (e: PointerEvent) => {
      if (!down || !e.isPrimary) return;
      const now = performance.now();
      const tap = Math.hypot(e.clientX - down.x, e.clientY - down.y) < 10 && now - down.t < 400;
      down = null;
      if (!tap) {
        last = null;
        return;
      }
      if (last && now - last.t < 450 && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 30) {
        last = null;
        pick.current?.(e.clientX, e.clientY);
      } else {
        last = { x: e.clientX, y: e.clientY, t: now };
      }
    };
    root.addEventListener('pointerdown', onDown);
    window.addEventListener('pointerup', onUp);
    return () => {
      root.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
    };
  }, [stage]);

  // Deselect when tapping elsewhere.
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node) && !lockRef.current?.contains(e.target as Node)) setSelected(false);
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

  const begin = (mode: Mode, e: React.PointerEvent, axis: Axis = 'xy') => {
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
      axis,
      initial: latest.current,
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

  const onPointerDown = (mode: Mode, axis?: Axis) => (e: React.PointerEvent) => {
    if (e.button > 0) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    setSelected(true);
    begin(mode, e, axis);
  };

  // Pointers anywhere on the stage: a press on the content, a second finger for pinch, or one finger to scroll.
  const onActiveRef = useRef(onActive);
  onActiveRef.current = onActive;
  useEffect(() => {
    const root = stage.current;
    if (!root) return;
    const onContent = (e: PointerEvent) =>
      e.button <= 0 &&
      !(e.target as Element | null)?.closest?.('.canvas-lock, .grad-editor') &&
      document.elementsFromPoint(e.clientX, e.clientY).some((el) => root.contains(el) && !!el.closest(`svg .${targetRef.current}`));
    const down = (e: PointerEvent) => {
      const g = gesture.current;
      if (g && g.pointers.size === 1) {
        g.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        gesture.current = { ...g, mode: 'pinch', start: latest.current, origin: new Map(g.pointers) };
        root.setPointerCapture?.(e.pointerId);
      } else if (!g && !boxRef.current?.contains(e.target as Node) && onContent(e)) {
        // A press on the content while the frame was not following it closely: drag it all the same.
        e.preventDefault();
        root.setPointerCapture?.(e.pointerId);
        setSelected(true);
        const el = root.querySelector(`svg .${targetRef.current}`)!.getBoundingClientRect();
        const p = { x: e.clientX, y: e.clientY };
        gesture.current = {
          mode: 'move',
          axis: 'xy',
          initial: latest.current,
          start: latest.current,
          k: unitsPerPx(),
          center: { x: el.left + el.width / 2, y: el.top + el.height / 2 },
          pointers: new Map([[e.pointerId, p]]),
          origin: new Map([[e.pointerId, p]]),
          last: p,
        };
        setActive(true);
        onActiveRef.current?.(true);
      } else if (!g && e.pointerType === 'touch' && !boxRef.current?.contains(e.target as Node)) {
        const p = { x: e.clientX, y: e.clientY };
        gesture.current = { mode: 'scroll', axis: 'xy', initial: latest.current, start: latest.current, k: 1, center: p, pointers: new Map([[e.pointerId, p]]), origin: new Map([[e.pointerId, p]]), last: p };
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
          ...s,
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
      else if (g.mode === 'stretch') emit(stretched(s, g.axis, g.center, o, p));
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
        if (!sameXf(latest.current, g.initial)) onCommit(latest.current);
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
      <button
        ref={lockRef}
        type="button"
        className={`canvas-lock${locked ? '' : ' is-free'}`}
        aria-pressed={!locked}
        aria-label={locked ? t('ratioLocked') : t('ratioFree')}
        title={locked ? t('ratioLocked') : t('ratioFree')}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => {
          onToggleLock();
          // Show the handles right away (unlocked: with the edge ones).
          setSelected(true);
        }}
        style={{ display: 'none' }}
      >
        {locked ? <LockIcon width={18} height={18} /> : <UnlockIcon width={18} height={18} />}
      </button>
      <div
        ref={boxRef}
        className={`canvas-box${selected ? ' is-selected' : ''}${active ? ' is-active' : ''}${locked ? '' : ' is-free'}`}
        role="application"
        aria-label={t('canvasHint')}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onFocus={() => setSelected(true)}
        onPointerDown={onPointerDown('move')}
        style={{ display: 'none' }}
      >
        {(['nw', 'ne', 'se', 'sw'] as const).map((c) => (
          <span key={c} className={`canvas-handle is-${c}`} onPointerDown={locked ? onPointerDown('scale') : onPointerDown('stretch', 'xy')} aria-hidden />
        ))}
        {/* Unlocked: edges change only the width or only the height. */}
        {!locked &&
          (['n', 'e', 's', 'w'] as const).map((c) => (
            <span key={c} className={`canvas-handle is-edge is-${c}`} onPointerDown={onPointerDown('stretch', c === 'n' || c === 's' ? 'y' : 'x')} aria-hidden />
          ))}
        <span className="canvas-rotate" onPointerDown={onPointerDown('rotate')} aria-hidden>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5" />
          </svg>
        </span>
        {onDelete && (
          <button
            type="button"
            className="canvas-delete"
            title={`${t('canvasDelete')} (Delete)`}
            aria-label={t('canvasDelete')}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
          >
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
