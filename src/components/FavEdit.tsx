import { useState } from 'react';
import { confirmAction, haptic } from '../lib/telegram';
import { useT } from '../state/useT';
import { CheckIcon, TrashIcon } from './icons';

/**
 * Managing a favourites list: "Edit" turns taps into selection; then delete the selected items, or clear
 * everything after a confirmation.
 */
export function useFavSelection() {
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const stop = () => {
    setEditing(false);
    setSelected(new Set());
  };
  return { editing, selected, toggle, setSelected, start: () => setEditing(true), stop };
}

export type FavSelection = ReturnType<typeof useFavSelection>;

/** "Edit" / "Done" next to a favourites title. */
export function FavEditToggle({ sel }: { sel: FavSelection }) {
  const t = useT();
  return (
    <button type="button" className={`fav-edit-toggle${sel.editing ? ' is-on' : ''}`} aria-pressed={sel.editing} onClick={() => (sel.editing ? sel.stop() : sel.start())}>
      {sel.editing ? t('favDone') : t('favEdit')}
    </button>
  );
}

/** Actions while editing: select all / none, delete the selected ones, clear everything (with confirmation). */
export function FavEditBar(props: { sel: FavSelection; ids: readonly string[]; onDelete: (ids: string[]) => void; confirmClear: string }) {
  const t = useT();
  const { sel, ids, onDelete } = props;
  if (!sel.editing) return null;
  const count = ids.filter((id) => sel.selected.has(id)).length;
  const all = count === ids.length && ids.length > 0;
  return (
    <div className="fav-edit-bar" role="toolbar">
      <p className="hint">{t('favSelectHint')}</p>
      <div className="row-actions">
        <button type="button" className="pill-btn is-compact" onClick={() => sel.setSelected(new Set(all ? [] : ids))}>
          <CheckIcon width={14} height={14} strokeWidth={3} /> {all ? t('favSelectNone') : t('favSelectAll')}
        </button>
        <button
          type="button"
          className="pill-btn is-compact is-danger"
          disabled={!count}
          onClick={() => {
            onDelete(ids.filter((id) => sel.selected.has(id)));
            // Nothing left to edit: leave the mode (so a new favourite does not appear in it).
            if (count === ids.length) sel.stop();
            else sel.setSelected(new Set());
            haptic();
          }}
        >
          <TrashIcon width={14} height={14} /> {t('favDeleteSelected').replace('{n}', String(count))}
        </button>
        <button
          type="button"
          className="pill-btn is-compact is-danger"
          disabled={!ids.length}
          onClick={async () => {
            if (!(await confirmAction(props.confirmClear.replace('{n}', String(ids.length))))) return;
            onDelete([...ids]);
            sel.stop();
            haptic();
          }}
        >
          {t('favClearAll')}
        </button>
      </div>
    </div>
  );
}
