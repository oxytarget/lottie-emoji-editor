import { useRef, useState } from 'react';
import { haptic } from '../lib/telegram';
import { checkOp, INSERTED, parentOf, remapId, type Drop, type LayoutOp } from '../lottie/layout';
import type { Part } from '../lottie/parts';
import { useEditor, type FavLogo, type ImportedTemplate } from '../state/store';
import { useUi } from '../state/ui';
import { useT } from '../state/useT';
import { FavEditBar, FavEditToggle, useFavSelection } from './FavEdit';
import { CheckIcon, StarIcon } from './icons';

/**
 * Drag and drop in the layer list (finger or mouse): favourite logos from the strip above the list, and
 * layers by their handle. Dropping on the upper/lower edge of a row puts the item before/after it; dropping
 * on the middle of a group, shape layer or precomp puts it inside (it then moves with that part).
 */

export type DragSource = { kind: 'logo'; logo: FavLogo } | { kind: 'part'; part: Part };
export type Hover = { id: string; where: 'before' | 'after' | 'inside' } | { id: ''; where: 'end' };

interface DragState {
  source: DragSource;
  x: number;
  y: number;
  hover: Hover | null;
  valid: boolean;
}

const canContain = (p: Part | undefined) => !!p && (p.kind === 'precomp' || p.kind === 'shape' || p.kind === 'group');
const svgUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

function dropOf(hover: Hover, imp: ImportedTemplate): Drop {
  if (hover.where === 'end') return { parent: '', index: imp.data.layers.length };
  if (hover.where === 'inside') return { parent: hover.id, index: 0 };
  const { parent, index } = parentOf(hover.id);
  return { parent, index: hover.where === 'before' ? index : index + 1 };
}

function opFor(source: DragSource, at: Drop, logoKey: string): LayoutOp {
  return source.kind === 'logo'
    ? { kind: 'insert', svg: logoKey, name: `${INSERTED}${source.logo.name}`, at }
    : { kind: 'move', part: source.part.id, at };
}

/** A move that would leave the part where it is. */
function isNoop(source: DragSource, at: Drop): boolean {
  if (source.kind !== 'part') return false;
  const from = parentOf(source.part.id);
  return from.parent === at.parent && (at.index === from.index || at.index === from.index + 1);
}

/** Applies a layer operation and keeps the grabbed part (or the new one) selected. */
export function applyLayerOp(imp: ImportedTemplate, op: LayoutOp): string | null {
  const newId = useEditor.getState().layoutImport(imp.id, op);
  const ui = useUi.getState();
  if (newId && op.kind !== 'remove') ui.setGrab({ id: imp.id, part: newId });
  else if (ui.grab?.id === imp.id) {
    const moved = remapId(ui.grab.part, op, imp.data);
    ui.setGrab(moved ? { id: imp.id, part: moved } : null);
  }
  if (newId || op.kind === 'remove') haptic();
  return newId;
}

export function useLayerDnd(opts: { imp: ImportedTemplate; parts: readonly Part[]; listRef: React.RefObject<HTMLElement | null> }) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const latest = useRef(opts);
  latest.current = opts;

  const hoverAt = (x: number, y: number, source: DragSource): { hover: Hover | null; valid: boolean } => {
    const { imp, parts, listRef } = latest.current;
    const list = listRef.current;
    if (!list) return { hover: null, valid: false };
    const box = list.getBoundingClientRect();
    if (x < box.left || x > box.right || y < box.top - 8 || y > box.bottom + 24) return { hover: null, valid: false };
    const covered = y < (document.querySelector('.tabbar')?.getBoundingClientRect().bottom ?? 0);
    const row = covered ? null : document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-part]');
    let hover: Hover | null = null;
    if (row && list.contains(row)) {
      const id = row.dataset.part!;
      const r = row.getBoundingClientRect();
      const f = (y - r.top) / Math.max(r.height, 1);
      const part = parts.find((p) => p.id === id);
      hover = canContain(part) ? { id, where: f < 0.28 ? 'before' : f > 0.72 ? 'after' : 'inside' } : { id, where: f < 0.5 ? 'before' : 'after' };
    } else {
      const rows = list.querySelectorAll<HTMLElement>('[data-part]');
      const last = rows[rows.length - 1];
      if (!last || y > last.getBoundingClientRect().bottom) hover = { id: '', where: 'end' };
    }
    if (!hover) return { hover: null, valid: false };
    const at = dropOf(hover, imp);
    const valid = !isNoop(source, at) && !checkOp(imp.data, opFor(source, at, 'x'));
    return { hover, valid };
  };

  /** Starts a (potential) drag; a press without movement is a tap (`onTap`). */
  const start = (source: DragSource, e: React.PointerEvent, onTap?: () => void) => {
    if (e.button > 0) return;
    e.preventDefault();
    e.stopPropagation();
    const x0 = e.clientX;
    const y0 = e.clientY;
    const id = e.pointerId;
    let active = false;
    let scroll = 0;
    let frame = 0;
    // Near the edges of the visible area (below the sticky preview/tabs, above the bottom button) the page scrolls.
    const autoScroll = () => {
      if (scroll) window.scrollBy(0, scroll);
      frame = scroll ? requestAnimationFrame(autoScroll) : 0;
    };
    const edges = () => {
      const top = document.querySelector('.tabbar')?.getBoundingClientRect().bottom ?? 0;
      const bar = document.querySelector('.bottom-bar')?.getBoundingClientRect().top ?? window.innerHeight;
      return { top: Math.max(0, top), bottom: Math.min(window.innerHeight, bar) };
    };
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return;
      if (!active && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return;
      if (!active) haptic();
      active = true;
      ev.preventDefault();
      const { hover, valid } = hoverAt(ev.clientX, ev.clientY, source);
      setDrag({ source, x: ev.clientX, y: ev.clientY, hover, valid });
      const { top, bottom } = edges();
      scroll = ev.clientY < top + 40 ? -10 : ev.clientY > bottom - 40 ? 10 : 0;
      if (scroll && !frame) frame = requestAnimationFrame(autoScroll);
    };
    const end = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      scroll = 0;
      cancelAnimationFrame(frame);
      setDrag(null);
      if (!active) {
        if (ev.type === 'pointerup') onTap?.();
        return;
      }
      if (ev.type !== 'pointerup') return;
      const { hover, valid } = hoverAt(ev.clientX, ev.clientY, source);
      if (!hover || !valid) return;
      const { imp } = latest.current;
      const key = source.kind === 'logo' ? useEditor.getState().putLayoutSvg(source.logo.svg) : '';
      applyLayerOp(imp, opFor(source, dropOf(hover, imp), key));
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  };

  /** Drop indicator for a row. */
  const dropState = (id: string): string | undefined =>
    drag?.hover && drag.hover.id === id ? `${drag.hover.where}${drag.valid ? '' : '-invalid'}` : undefined;

  return { drag, start, dropState };
}

/** The dragged thing, following the finger/pointer. */
export function DragGhost({ drag }: { drag: DragState | null }) {
  if (!drag) return null;
  return (
    <div className={`drag-ghost${drag.valid ? '' : ' is-invalid'}`} style={{ transform: `translate(${drag.x + 14}px, ${drag.y + 14}px)` }} aria-hidden>
      {drag.source.kind === 'logo' ? <img src={svgUrl(drag.source.logo.svg)} alt="" /> : null}
      <span>{drag.source.kind === 'logo' ? drag.source.logo.name : drag.source.part.name}</span>
    </div>
  );
}

/** Favourite logos to drag into the layer list (a tap adds the logo as the top layer). */
export function FavLogoStrip({ imp, onStart }: { imp: ImportedTemplate; onStart: (source: DragSource, e: React.PointerEvent, onTap?: () => void) => void }) {
  const t = useT();
  const favs = useEditor((s) => s.favLogos);
  const removeMany = useEditor((s) => s.removeFavLogos);
  const sel = useFavSelection();
  if (!favs.length) return <p className="hint">{t('favLayersEmpty')}</p>;
  return (
    <div className={`fav-strip${sel.editing ? ' is-editing' : ''}`}>
      <div className="fav-head">
        <span className="label">
          <StarIcon width={14} height={14} filled /> {t('favorites')}
        </span>
        <FavEditToggle sel={sel} />
      </div>
      <div className="fav-chips">
        {favs.map((f) => (
          <button
            key={f.id}
            type="button"
            className={`fav-chip${sel.selected.has(f.id) ? ' is-selected' : ''}`}
            title={f.name}
            aria-pressed={sel.editing ? sel.selected.has(f.id) : undefined}
            aria-label={`${sel.editing ? t('favEdit') : t('layerAddLogo')}: ${f.name}`}
            onPointerDown={(e) => {
              if (sel.editing) {
                e.preventDefault();
                sel.toggle(f.id);
                return;
              }
              onStart({ kind: 'logo', logo: f }, e, () => {
                const key = useEditor.getState().putLayoutSvg(f.svg);
                applyLayerOp(imp, { kind: 'insert', svg: key, name: `${INSERTED}${f.name}`, at: { parent: '', index: 0 } });
              });
            }}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' && e.key !== ' ') return;
              e.preventDefault();
              if (sel.editing) return sel.toggle(f.id);
              const key = useEditor.getState().putLayoutSvg(f.svg);
              applyLayerOp(imp, { kind: 'insert', svg: key, name: `${INSERTED}${f.name}`, at: { parent: '', index: 0 } });
            }}
          >
            <img src={svgUrl(f.svg)} alt="" draggable={false} />
            <span>{f.name}</span>
            {sel.selected.has(f.id) && <CheckIcon width={14} height={14} strokeWidth={3.5} className="fav-check" />}
          </button>
        ))}
      </div>
      {sel.editing ? (
        <FavEditBar sel={sel} ids={favs.map((f) => f.id)} onDelete={removeMany} confirmClear={t('favClearLogosConfirm')} />
      ) : (
        <p className="hint">{t('favDragHint')}</p>
      )}
    </div>
  );
}
