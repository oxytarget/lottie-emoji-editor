import { useEffect, useRef, useState } from 'react';
import { haptic } from '../lib/telegram';
import { useEditor } from '../state/store';
import { useUi } from '../state/ui';
import { useT } from '../state/useT';
import { FavEditBar, FavEditToggle, useFavSelection } from './FavEdit';
import { CheckIcon, CloseIcon, StarIcon } from './icons';

/**
 * Favourite colours at hand: a strip above the panel. Drag a colour onto any colour circle, or tap it and then
 * tap circles to paint them one after another ("Done" or Escape stops).
 */

/** Colour circles on screen that accept a colour (registered by ColorSwatch). */
const targets = new Map<string, (hex: string) => void>();

export function useSwatchTarget(id: string, onChange: (hex: string) => void): void {
  const latest = useRef(onChange);
  latest.current = onChange;
  useEffect(() => {
    targets.set(id, (hex) => latest.current(hex));
    return () => void targets.delete(id);
  }, [id]);
}

/** Applies `hex` to the colour circle under a screen point; true when there was one. */
function applyAt(x: number, y: number, hex: string): boolean {
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-swatch]');
  const apply = el ? targets.get(el.dataset.swatch!) : undefined;
  if (!apply) return false;
  apply(hex);
  return true;
}

export function FavColorBar() {
  const t = useT();
  const favs = useEditor((s) => s.favColors);
  const paint = useUi((u) => u.paintColor);
  const setPaint = useUi((u) => u.setPaintColor);
  const removeFavColors = useEditor((s) => s.removeFavColors);
  const [drag, setDrag] = useState<{ color: string; x: number; y: number } | null>(null);
  const sel = useFavSelection();
  if (!favs.length) return null;

  const start = (color: string, e: React.PointerEvent) => {
    if (e.button > 0) return;
    // Editing: taps select colours to delete.
    if (sel.editing) {
      e.preventDefault();
      sel.toggle(color);
      return;
    }
    e.preventDefault();
    const x0 = e.clientX;
    const y0 = e.clientY;
    const id = e.pointerId;
    let active = false;
    // Near the top/bottom of the visible area the page scrolls, so far-away circles can be reached.
    let scroll = 0;
    let frame = 0;
    const autoScroll = () => {
      if (scroll) window.scrollBy(0, scroll);
      frame = scroll ? requestAnimationFrame(autoScroll) : 0;
    };
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return;
      if (!active && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return;
      if (!active) haptic();
      active = true;
      ev.preventDefault();
      setDrag({ color, x: ev.clientX, y: ev.clientY });
      const top = Math.max(0, document.querySelector('.tabbar')?.getBoundingClientRect().bottom ?? 0);
      const bottom = Math.min(window.innerHeight, document.querySelector('.bottom-bar')?.getBoundingClientRect().top ?? window.innerHeight);
      // Upwards only in the band under the tabs (or at the very top): over the preview — e.g. heading for a
      // gradient dot — the page holds still, so the target does not slide away under the finger.
      const up = ev.clientY < top + 40 && (ev.clientY >= top - 8 || ev.clientY < 40);
      scroll = up ? -10 : ev.clientY > bottom - 40 ? 10 : 0;
      if (scroll && !frame) frame = requestAnimationFrame(autoScroll);
    };
    const end = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return;
      scroll = 0;
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      setDrag(null);
      if (ev.type !== 'pointerup') return;
      if (active) {
        if (applyAt(ev.clientX, ev.clientY, color)) haptic();
      } else {
        // Tap: start (or stop) painting with this colour.
        setPaint(useUi.getState().paintColor === color ? null : color);
        haptic();
      }
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  };

  return (
    <section className={`fav-colors${sel.editing ? ' is-editing' : ''}`} aria-label={t('favColorsBar')}>
      <div className="fav-head">
        <span className="label">
          <StarIcon width={14} height={14} filled /> {t('favColorsBar')}
        </span>
        <FavEditToggle
          sel={{
            ...sel,
            start: () => {
              setPaint(null);
              sel.start();
            },
          }}
        />
      </div>
      <div className="fav-colors-row">
        {favs.map((c, i) => (
          <button
            key={c}
            type="button"
            className={`fav-color${paint === c ? ' is-armed' : ''}${sel.selected.has(c) ? ' is-selected' : ''}`}
            style={{ background: c, '--i': i } as React.CSSProperties}
            aria-pressed={sel.editing ? sel.selected.has(c) : paint === c}
            aria-label={`${t('favColorsBar')}: ${c}`}
            title={c}
            onPointerDown={(e) => start(c, e)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' && e.key !== ' ') return;
              e.preventDefault();
              if (sel.editing) sel.toggle(c);
              else setPaint(paint === c ? null : c);
            }}
          >
            {sel.selected.has(c) && <CheckIcon width={16} height={16} strokeWidth={3.5} className="fav-check" />}
          </button>
        ))}
      </div>
      {sel.editing ? (
        <FavEditBar sel={sel} ids={favs} onDelete={removeFavColors} confirmClear={t('favClearColorsConfirm')} />
      ) : (
        <p className="hint">{t('favColorsHint')}</p>
      )}
      {drag && <span className="color-ghost" style={{ background: drag.color, transform: `translate(${drag.x - 22}px, ${drag.y - 22}px)` }} aria-hidden />}
    </section>
  );
}

/** Shown while painting: which colour, and a way to stop. */
export function PaintBanner() {
  const t = useT();
  const paint = useUi((u) => u.paintColor);
  const setPaint = useUi((u) => u.setPaintColor);
  useEffect(() => {
    if (!paint) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setPaint(null);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [paint, setPaint]);
  if (!paint) return null;
  return (
    <div className="paint-banner" role="status">
      <span className="paint-dot" style={{ background: paint }} aria-hidden />
      <span>{t('paintBanner')}</span>
      <button type="button" className="pill-btn is-compact is-accent" onClick={() => setPaint(null)}>
        <CloseIcon width={14} height={14} /> {t('paintDone')}
      </button>
    </div>
  );
}
