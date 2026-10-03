import { useRef } from 'react';
import { haptic } from '../lib/telegram';

/**
 * Press and hold (a finger or the mouse, ~0.45 s without moving) does `onHold`; the click that follows the release
 * is swallowed, so a held button does not also do its tap action.
 */
export function useHold(onHold: () => void, ms = 450) {
  const timer = useRef(0);
  const held = useRef(false);
  const start = useRef<{ x: number; y: number } | null>(null);
  const latest = useRef(onHold);
  latest.current = onHold;
  const cancel = () => {
    window.clearTimeout(timer.current);
    start.current = null;
  };
  return {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button > 0) return;
      held.current = false;
      start.current = { x: e.clientX, y: e.clientY };
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        held.current = true;
        start.current = null;
        haptic();
        latest.current();
      }, ms);
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (start.current && Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 8) cancel();
    },
    onPointerUp: cancel,
    onPointerLeave: cancel,
    onPointerCancel: cancel,
    // Phones open a menu on a long press.
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
    onClickCapture: (e: React.MouseEvent) => {
      if (!held.current) return;
      held.current = false;
      e.preventDefault();
      e.stopPropagation();
    },
  };
}
