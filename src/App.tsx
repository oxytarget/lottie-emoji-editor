import { useCallback, useState } from 'react';
import { ColorsCard } from './components/ColorsCard';
import { ContentCard } from './components/ContentCard';
import { ExportSheet } from './components/ExportSheet';
import { DownloadIcon, ResetIcon } from './components/icons';
import { PreviewCard } from './components/PreviewCard';
import { TemplateGrid } from './components/TemplateGrid';
import { paintCss } from './lottie/paint';
import { useEditor } from './state/store';
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
        <strong className="summary-count">{selectedCount}</strong>
      </div>
    </div>
  );
}

export default function App() {
  const t = useT();
  const compiled = useCompiled();
  const lang = useEditor((s) => s.lang);
  const set = useEditor((s) => s.set);
  const reset = useEditor((s) => s.reset);
  const selected = useEditor((s) => s.selected);
  const active = useEditor((s) => s.active);
  const [exportOpen, setExportOpen] = useState(false);
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
          <div className="lang-switch" role="radiogroup" aria-label="Language">
            {LANGS.map((l) => (
              <button key={l} type="button" role="radio" aria-checked={lang === l} className={lang === l ? 'is-active' : ''} onClick={() => set('lang', l)}>
                {l.toUpperCase()}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="icon-btn is-round is-ghost"
            title={t('reset')}
            aria-label={t('reset')}
            onClick={() => window.confirm(t('resetConfirm')) && reset()}
          >
            <ResetIcon />
          </button>
        </div>
      </header>

      <SummaryBar selectedCount={selectedEmojis.length} />

      <main className="layout">
        <div className="area-preview">
          <PreviewCard emoji={activeEmoji} pending={compiled.pending} />
        </div>
        <div className="area-controls">
          <ContentCard missing={compiled.missingChars} fontLoading={compiled.fontLoading} svg={compiled.svg} />
          <ColorsCard />
        </div>
        <div className="area-grid">
          <TemplateGrid emojis={compiled.emojis} />
        </div>
      </main>

      <div className="bottom-bar">
        <button type="button" className="primary-btn" disabled={selectedEmojis.length === 0} onClick={() => setExportOpen(true)}>
          <DownloadIcon /> {t('download')} ({selectedEmojis.length})
        </button>
      </div>

      {exportOpen && <ExportSheet emojis={selectedEmojis} onClose={closeExport} />}
    </div>
  );
}
