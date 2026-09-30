import { useEffect, useRef, useState } from 'react';
import { packsAvailable, parsePackLink } from '../lib/botApi';
import { haptic } from '../lib/telegram';
import { formatKb, readLottieFile } from '../lottie/export';
import { extractPalette, normalizeForTgs } from '../lottie/imported';
import { loadPack, openPack } from '../state/packs';
import { useEditor, type PackRef } from '../state/store';
import { useUi } from '../state/ui';
import type { CompiledEmoji } from '../state/useCompiled';
import { useT } from '../state/useT';
import type { Localized } from '../templates/types';
import { MotionButton } from './controls';
import { CheckIcon, ChevronIcon, PlusIcon, StickersIcon, TrashIcon } from './icons';
import { LottieView } from './LottieView';
import { usePresence } from './motion';

export function emojiName(name: Localized | string, lang: keyof Localized): string {
  return typeof name === 'string' ? name : name[lang];
}

/** Tells the compiler which pack stickers are on screen (only those are rebuilt while editing). */
function useReportVisible(ref: React.RefObject<Element | null>, id: string | null) {
  useEffect(() => {
    const el = ref.current;
    if (!el || !id) return;
    const setVisible = useUi.getState().setVisible;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(id, true);
      return () => setVisible(id, false);
    }
    const io = new IntersectionObserver(([entry]) => setVisible(id, entry.isIntersecting), { rootMargin: '200px' });
    io.observe(el);
    return () => {
      io.disconnect();
      setVisible(id, false);
    };
  }, [ref, id]);
}

function Tile(props: { id: string; name: string; emoji?: CompiledEmoji; index: number; report?: boolean }) {
  const t = useT();
  const { id, name, emoji } = props;
  const selected = useEditor((s) => s.selected.includes(id));
  const active = useEditor((s) => s.active === id);
  const toggle = useEditor((s) => s.toggleTemplate);
  const ref = useRef<HTMLButtonElement>(null);
  useReportVisible(ref, props.report ? id : null);
  return (
    <button
      ref={ref}
      type="button"
      className={`tile${selected ? ' is-selected' : ''}${active ? ' is-active' : ''}${emoji ? '' : ' is-pending'}`}
      aria-pressed={selected}
      aria-label={name}
      style={{ '--i': Math.min(props.index, 24) } as React.CSSProperties}
      onClick={() => {
        toggle(id);
        haptic();
      }}
    >
      {emoji ? <LottieView json={emoji.json} className="tile-anim" label={name} /> : <span className="tile-skeleton" aria-hidden />}
      <span className="tile-name">{name}</span>
      {emoji && (
        <span className={`tile-size${emoji.check.ok ? '' : ' is-bad'}`}>
          {formatKb(emoji.check.bytes)} {t('kb')}
        </span>
      )}
      {selected && (
        <span className="tile-check" aria-hidden>
          <CheckIcon width={16} height={16} strokeWidth={3} />
        </span>
      )}
    </button>
  );
}

function PackForm({ onDone }: { onDone: () => void }) {
  const t = useT();
  const [value, setValue] = useState('');
  const [bad, setBad] = useState(false);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const name = parsePackLink(value);
    if (!name) return setBad(true);
    openPack(name);
    setValue('');
    setBad(false);
    onDone();
  };
  return (
    <form className="pack-form-inline" onSubmit={submit}>
      <label className="field">
        <span className="label">{t('packLinkLabel')}</span>
        <span className="pack-link-row">
          <input
            value={value}
            autoFocus
            inputMode="url"
            placeholder="t.me/addstickers/…"
            onChange={(e) => {
              setValue(e.target.value);
              setBad(false);
            }}
          />
          <button type="submit" className="pill-btn is-accent" disabled={!value.trim()}>
            {t('packLoad')}
          </button>
        </span>
      </label>
      {bad ? <p className="note is-error">{t('packLinkBad')}</p> : <p className="hint">{t('packLinkHint')}</p>}
    </form>
  );
}

function PackSection({ pack, personal, byId }: { pack: PackRef; personal: boolean; byId: Map<string, CompiledEmoji> }) {
  const t = useT();
  const status = useUi((u) => u.packStatus[pack.name]);
  const open = useUi((u) => u.openPacks[pack.name] ?? false);
  const setOpen = useUi((u) => u.setPackOpen);
  const templates = useEditor((s) => s.imports).filter((i) => i.source?.pack === pack.name);
  const selected = useEditor((s) => s.selected);
  const removePack = useEditor((s) => s.removePack);
  const allSelected = templates.length > 0 && templates.every((i) => selected.includes(i.id));
  const replaced = templates.filter((i) => i.defaults?.replace).length;

  useEffect(() => {
    if (open && !status) loadPack(pack.name, personal);
  }, [open, status, pack.name, personal]);

  const selectAll = () => {
    const ids = templates.map((i) => i.id);
    const { selected: current, set } = useEditor.getState();
    set('selected', allSelected ? current.filter((id) => !ids.includes(id)) : [...current, ...ids.filter((id) => !current.includes(id))]);
    haptic();
  };

  const meta =
    status?.state === 'loading'
      ? `${t('packLoading')} ${status.total ? `${status.done}/${status.total}` : '…'}`
      : status?.state === 'ready'
        ? [`${status.count}`, replaced ? `${t('packLogoFound')}: ${replaced}` : '', status.skipped ? `${t('packSkipped')}: ${status.skipped}` : ''].filter(Boolean).join(' · ')
        : '';

  return (
    <div className={`pack-section${open ? ' is-open' : ''}`} id={`pack-${pack.name}`}>
      <div className="pack-head">
        <button type="button" className="pack-toggle" aria-expanded={open} onClick={() => setOpen(pack.name, !open)}>
          <StickersIcon width={20} height={20} />
          <span className="pack-title">
            <strong>{pack.title}</strong>
            {meta && <span className="hint">{meta}</span>}
          </span>
          <ChevronIcon width={18} height={18} className={open ? 'is-flipped' : ''} />
        </button>
        {status?.state === 'ready' && open && (
          <button type="button" className="pill-btn is-compact" onClick={selectAll}>
            {allSelected ? t('packUnselectAll') : t('packSelectAll')}
          </button>
        )}
        {personal && <MotionButton motion="wiggle" className="icon-btn is-small" icon={<TrashIcon width={18} height={18} />} label={t('packRemove')} onClick={() => removePack(pack.name)} />}
      </div>
      {status?.state === 'loading' && (
        <div className="pack-progress" aria-hidden>
          <span style={{ width: `${status.total ? (status.done / status.total) * 100 : 8}%` }} />
        </div>
      )}
      <div className="collapsible-anim" inert={!open}>
        <div className="collapsible-clip">
          <div className="collapsible-body">
            {status?.state === 'error' && (
              <p className="note is-error">
                {t(status.error === 'not-found' ? 'packNotFound2' : status.error === 'empty' ? 'packEmpty' : 'packLoadFailed')}{' '}
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => useUi.getState().clearPackStatus(pack.name)}
                >
                  {t('packRetry')}
                </button>
              </p>
            )}
            {open && templates.length > 0 && (
              <div className="tile-grid">
                {templates.map((imp, i) => (
                  <Tile key={imp.id} id={imp.id} name={imp.name} emoji={byId.get(imp.id)} index={i} report />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function PackSections({ byId }: { byId: Map<string, CompiledEmoji> }) {
  const t = useT();
  const botPacks = useUi((u) => u.botPacks) ?? [];
  const myPacks = useEditor((s) => s.myPacks).filter((p) => !botPacks.some((b) => b.name === p.name));
  return (
    <>
      {botPacks.length > 0 && (
        <section className="grid-section">
          <div className="grid-head">
            <h3 className="section-title">{t('packsBot')}</h3>
          </div>
          {botPacks.map((p) => (
            <PackSection key={p.name} pack={p} personal={false} byId={byId} />
          ))}
        </section>
      )}
      {myPacks.length > 0 && (
        <section className="grid-section">
          <div className="grid-head">
            <h3 className="section-title">{t('packsMine')}</h3>
          </div>
          {myPacks.map((p) => (
            <PackSection key={p.name} pack={p} personal byId={byId} />
          ))}
        </section>
      )}
    </>
  );
}

export function TemplateGrid({ emojis, byId }: { emojis: CompiledEmoji[]; byId: Map<string, CompiledEmoji> }) {
  const t = useT();
  const lang = useEditor((s) => s.lang);
  const addImport = useEditor((s) => s.addImport);
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState(false);
  const [packForm, setPackForm] = useState(false);
  const form = usePresence(packForm, 200);
  const main = emojis.filter((e) => !e.pack);

  const onImport = async (file: File | undefined) => {
    if (!file) return;
    setError(false);
    try {
      const data = normalizeForTgs(readLottieFile(new Uint8Array(await file.arrayBuffer())));
      addImport({
        id: `import-${Date.now().toString(36)}`,
        name: file.name.replace(/\.(tgs|json)$/i, ''),
        data,
        palette: extractPalette(data),
        colorMap: {},
        overlay: false,
        hidden: [],
        replace: null,
        transforms: {},
      });
    } catch {
      setError(true);
    }
  };

  return (
    <>
      <section className="grid-section">
        <div className="grid-head">
          <h3 className="section-title">{t('characters')}</h3>
          <span className="hint">
            {t('charactersHint')} · {main.length}
          </span>
        </div>
        <div className="tile-grid">
          {main.map((e, i) => (
            <Tile key={e.id} id={e.id} name={emojiName(e.name, lang)} emoji={e} index={i} />
          ))}
          <button
            type="button"
            className="tile tile-import"
            style={{ '--i': Math.min(main.length, 24) } as React.CSSProperties}
            onClick={() => fileRef.current?.click()}
          >
            <PlusIcon width={30} height={30} />
            <span>{t('importLottie')}</span>
          </button>
          {packsAvailable() && (
            <button
              type="button"
              className={`tile tile-import${packForm ? ' is-active' : ''}`}
              aria-expanded={packForm}
              style={{ '--i': Math.min(main.length + 1, 24) } as React.CSSProperties}
              onClick={() => setPackForm((v) => !v)}
            >
              <StickersIcon width={30} height={30} />
              <span>{t('packAddTile')}</span>
            </button>
          )}
        </div>
        {form.mounted && (
          <div className="pack-form-wrap" data-state={form.state}>
            <PackForm onDone={() => setPackForm(false)} />
          </div>
        )}
        {error && <p className="note is-error">{t('importError')}</p>}
        <input
          ref={fileRef}
          type="file"
          hidden
          accept=".tgs,.json,application/json,application/gzip"
          onChange={(e) => {
            onImport(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </section>
      <PackSections byId={byId} />
    </>
  );
}
