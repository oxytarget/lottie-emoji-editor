import { useEffect, useRef, useState } from 'react';
import { haptic } from '../lib/telegram';
import { normalizeHex } from '../lottie/color';
import { useEditor } from '../state/store';
import { useUi } from '../state/ui';
import { useT } from '../state/useT';
import { SWATCHES, toggleFavorite } from './ColorSwatch';
import { FavEditBar, FavEditToggle, useFavSelection } from './FavEdit';
import { CheckIcon, CloseIcon, PlusIcon, StarIcon } from './icons';
import { usePresence } from './motion';

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

/** "+" on the favourites strip: a palette where a tap adds the colour to the favourites (another tap takes it out). */
function FavColorAdd() {
  const t = useT();
  const favs = useEditor((s) => s.favColors);
  const [open, setOpen] = useState(false);
  const popover = usePresence(open, 160);
  const wrap = useRef<HTMLDivElement>(null);
  const [custom, setCustom] = useState('#8b5cf6');
  const [hex, setHex] = useState('');

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => wrap.current && !wrap.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const valid = (v: string) => /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v.trim());
  const addHex = () => {
    const v = hex.trim();
    if (!valid(v)) return;
    const c = normalizeHex(v.startsWith('#') ? v : `#${v}`).toLowerCase();
    if (!useEditor.getState().favColors.includes(c)) toggleFavorite(c);
    setHex('');
  };
  const addCustom = () => {
    const c = custom.toLowerCase();
    if (!useEditor.getState().favColors.includes(c)) toggleFavorite(c);
  };

  return (
    <div className="swatch-wrap fav-add" ref={wrap}>
      <button type="button" className="pill-btn is-compact" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <PlusIcon width={14} height={14} /> {t('favAddColor')}
      </button>
      {popover.mounted && (
        <div className="popover fav-add-popover" role="dialog" aria-label={t('favAddTitle')} data-state={popover.state}>
          <span className="label">
            <StarIcon width={12} height={12} filled /> {t('favAddTitle')}
          </span>
          <div className="popover-grid">
            {SWATCHES.map((c, i) => (
              <button
                key={c}
                type="button"
                className={`swatch swatch-sm${favs.includes(c) ? ' is-fav' : ''}`}
                style={{ background: c, '--i': i } as React.CSSProperties}
                aria-pressed={favs.includes(c)}
                aria-label={c}
                onClick={() => toggleFavorite(c)}
              />
            ))}
          </div>
          <div className="popover-row">
            <label className="hex-field">
              <span>{t('hex')}</span>
              <input
                value={hex}
                maxLength={7}
                placeholder="#ff8800"
                spellCheck={false}
                onChange={(e) => setHex(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addHex()}
              />
            </label>
            <button type="button" className="fav-star" disabled={!valid(hex)} title={t('favColorAdd')} aria-label={t('favColorAdd')} onClick={addHex}>
              <PlusIcon width={18} height={18} />
            </button>
          </div>
          <div className="popover-row">
            <label className="native-color" title={t('customColor')}>
              <input type="color" value={custom} onChange={(e) => setCustom(e.target.value)} aria-label={t('customColor')} />
              <span style={{ background: 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)' }} />
            </label>
            <span className="swatch swatch-md" style={{ background: custom }} aria-hidden />
            <button type="button" className={`pill-btn is-compact${favs.includes(custom.toLowerCase()) ? '' : ' is-accent'}`} disabled={favs.includes(custom.toLowerCase())} onClick={addCustom}>
              <StarIcon width={14} height={14} filled /> {t('favAddColor')}
            </button>
          </div>
          <p className="popover-hint">{t('favAddHint')}</p>
        </div>
      )}
    </div>
  );
}

export function FavColorBar() {
  const t = useT();
  const favs = useEditor((s) => s.favColors);
  const paint = useUi((u) => u.paintColor);
  const setPaint = useUi((u) => u.setPaintColor);
  const removeFavColors = useEditor((s) => s.removeFavColors);
  const [drag, setDrag] = useState<{ color: string; x: number; y: number } | null>(null);
  const sel = useFavSelection();

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
        <div className="row-actions">
          {!sel.editing && <FavColorAdd />}
          {favs.length > 0 && (
            <FavEditToggle
              sel={{
                ...sel,
                start: () => {
                  setPaint(null);
                  sel.start();
                },
              }}
            />
          )}
        </div>
      </div>
      {favs.length > 0 && (
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
      )}
      {sel.editing ? (
        <FavEditBar sel={sel} ids={favs} onDelete={removeFavColors} confirmClear={t('favClearColorsConfirm')} />
      ) : (
        <p className="hint">{t(favs.length ? 'favColorsHint' : 'favColorsEmpty')}</p>
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
