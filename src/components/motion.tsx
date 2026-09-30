import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Tiny motion helpers (no animation library): mount/unmount presence with exit animations,
 * replayable icon animations and a sliding indicator for tab-like controls.
 * All motion is CSS, so `prefers-reduced-motion` switches it off globally.
 */

/** Keeps an element mounted while its exit animation plays. `state` drives `data-state` CSS. */
const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function usePresence(open: boolean, exitMs = 200): { mounted: boolean; state: 'open' | 'closed' } {
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    const t = window.setTimeout(() => setMounted(false), reducedMotion() ? 0 : exitMs);
    return () => window.clearTimeout(t);
  }, [open, exitMs]);
  return { mounted: open || mounted, state: open ? 'open' : 'closed' };
}

/** A counter that restarts CSS animations: bump it on click and key the animated element by it. */
export function useReplay(): [number, () => void] {
  const [n, setN] = useState(0);
  return [n, useCallback(() => setN((v) => v + 1), [])];
}

export type IconMotion =
  | 'roll'
  | 'spin'
  | 'spin-back'
  | 'flip'
  | 'blink'
  | 'drop'
  | 'lift'
  | 'fly'
  | 'twinkle'
  | 'pop'
  | 'pulse'
  | 'wiggle'
  | 'swap';

/** Wraps an icon; each change of `play` (> 0) replays the chosen animation. */
export function AnimIcon({ motion, play, children }: { motion: IconMotion; play: number; children: ReactNode }) {
  return (
    <span key={play} className={`anim-icon anim-${motion}`} data-play={play > 0 ? 'true' : undefined}>
      {children}
    </span>
  );
}

/**
 * Position of a sliding "pill" behind the active child of `container` (children marked with `data-slide-key`).
 * Returns inline style for the indicator element.
 */
export function useSlidingIndicator(container: React.RefObject<HTMLElement | null>, activeKey: string): React.CSSProperties {
  const [style, setStyle] = useState<React.CSSProperties>({ opacity: 0 });
  const ready = useRef(false);

  const measure = useCallback(() => {
    const root = container.current;
    const el = root?.querySelector<HTMLElement>(`[data-slide-key="${CSS.escape(activeKey)}"]`);
    if (!root || !el) return;
    setStyle({
      opacity: 1,
      width: el.offsetWidth,
      height: el.offsetHeight,
      transform: `translate(${el.offsetLeft}px, ${el.offsetTop}px)`,
      // No slide on the very first measurement.
      transition: ready.current ? undefined : 'none',
    });
    ready.current = true;
  }, [container, activeKey]);

  useLayoutEffect(measure, [measure]);
  useEffect(() => {
    const root = container.current;
    if (!root || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(root);
    return () => ro.disconnect();
  }, [container, measure]);

  return style;
}

/** Number that "bumps" (scales briefly) every time its value changes. */
export function Bump({ value, className = '' }: { value: ReactNode; className?: string }) {
  const initial = useRef(String(value));
  const changed = useRef(false);
  if (String(value) !== initial.current) changed.current = true;
  // Keyed by value: the span (and its animation) is recreated only when the value changes.
  return (
    <span key={String(value)} className={`bump${changed.current ? ' is-bumping' : ''} ${className}`}>
      {value}
    </span>
  );
}
