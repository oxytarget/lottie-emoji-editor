import { useCallback, useEffect, useRef, useState } from 'react';
import { ColorsCard } from './components/ColorsCard';
import { ContentCard } from './components/ContentCard';
import { ExportSheet } from './components/ExportSheet';
import { MotionButton } from './components/controls';
import { DownloadIcon, ResetIcon } from './components/icons';
import { Bump, usePresence, useSlidingIndicator } from './components/motion';
import { PreviewCard } from './components/PreviewCard';
import { TemplateGrid } from './components/TemplateGrid';
import { fetchBotPacks, packsAvailable } from './lib/botApi';
import { paintCss } from './lottie/paint';
import { openPack } from './state/packs';
import { useEditor } from './state/store';
import { useUi } from './state/ui';
import { useCompiled } from './state/useCompiled';
import { useT } from './state/useT';
import type { Lang } from './templates/types';

const LANGS: Lang[] = ['uk', 'ru', 'en'];

function SummaryBar({ selectedCount }: { selectedCount: number }) {
  const t = useT();
  const s = useEditor();
  const value = s.mode === 'logo' ? s.logo?.name ?? '—' : s.text.replace(/\n/g, ' ') || '—';
  return (
    <div className="summary">
      <div className="summary-item is-grow">
        <span className="label">{s.mode === 'logo' ? t('summaryLogo') : t('summaryText')}</span>
        <strong className="summary-value">{value}</strong>
      </div>
      <div className="summary-item">
        <span className="label">{t('summaryColors')}</span>
        <span className="summary-swatches">
          <span style={{ background: paintCss(s.colors.body) }} />
          <span style={{ background: paintCss(s.textFill) }} />
        </span>
      </div>
      <div className="summary-item">
        <span className="label">{t('summarySelected')}</span>
        <strong className="summary-count">
          <Bump value={selectedCount} />
        </strong>
      </div>
    </div>
  );
}

/** Loads the bot's template packs and a pack passed by the bot as `?pack=<name>`. */
function usePackBootstrap() {
  useEffect(() => {
    if (!packsAvailable()) return;
    fetchBotPacks().then((packs) => useUi.getState().setBotPacks(packs));
    const params = new URLSearchParams(window.location.search);
    const name = params.get('pack');
    if (!name || !/^[A-Za-z0-9_]{1,64}$/.test(name)) return;
    params.delete('pack');
    const query = params.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`);
    openPack(name);
  }, []);
}

export default function App() {
  const t = useT();
  const compiled = useCompiled();
  usePackBootstrap();
  const lang = useEditor((s) => s.lang);
  const set = useEditor((s) => s.set);
  const reset = useEditor((s) => s.reset);
  const selected = useEditor((s) => s.selected);
  const active = useEditor((s) => s.active);
  const [exportOpen, setExportOpen] = useState(false);
  const sheet = usePresence(exportOpen, 260);
  const langRef = useRef<HTMLDivElement>(null);
  const langPill = useSlidingIndicator(langRef, lang);
  const closeExport = useCallback(() => setExportOpen(false), []);

  const selectedEmojis = selected.map((id) => compiled.byId.get(id)).filter((e) => e !== undefined);
  const activeEmoji = compiled.byId.get(active) ?? compiled.emojis[0];

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden>
            ✦
          </span>
          <div>
            <h1>{t('appTitle')}</h1>
            <p>{t('appSubtitle')}</p>
          </div>
        </div>
        <div className="topbar-actions">
          <div className="lang-switch" role="radiogroup" aria-label="Language" ref={langRef}>
            <span className="slide-pill" style={langPill} aria-hidden />
            {LANGS.map((l) => (
              <button
                key={l}
                type="button"
                role="radio"
                data-slide-key={l}
                aria-checked={lang === l}
                className={lang === l ? 'is-active' : ''}
                onClick={() => set('lang', l)}
              >
                {l.toUpperCase()}
              </button>
            ))}
          </div>
          <MotionButton
            motion="spin-back"
            className="icon-btn is-round is-ghost"
            label={t('reset')}
            icon={<ResetIcon />}
            onClick={() => window.confirm(t('resetConfirm')) && reset()}
          />
        </div>
      </header>

      <SummaryBar selectedCount={selectedEmojis.length} />

      <main className="layout">
        <div className="area-preview">
          <PreviewCard emoji={activeEmoji} pending={compiled.pending} input={compiled.input} />
        </div>
        <div className="area-controls">
          <ContentCard missing={compiled.missingChars} fontLoading={compiled.fontLoading} svg={compiled.svg} />
          <ColorsCard />
        </div>
        <div className="area-grid">
          <TemplateGrid emojis={compiled.emojis} byId={compiled.byId} />
        </div>
      </main>

      <div className="bottom-bar">
        <MotionButton motion="drop" className="primary-btn" label={t('download')} icon={<DownloadIcon />} disabled={selectedEmojis.length === 0} onClick={() => setExportOpen(true)}>
          <span>
            {t('download')} (<Bump value={selectedEmojis.length} />)
          </span>
        </MotionButton>
      </div>

      {sheet.mounted && <ExportSheet emojis={selectedEmojis} onClose={closeExport} state={sheet.state} />}
    </div>
  );
}
