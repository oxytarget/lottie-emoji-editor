import { useCallback, useEffect, useRef, useState } from 'react';
import { ColorsCard } from './components/ColorsCard';
import { ContentCard } from './components/ContentCard';
import { ExportSheet } from './components/ExportSheet';
import { MotionButton } from './components/controls';
import { Segmented } from './components/controls';
import { DownloadIcon, GridIcon, LayersIcon, PaletteIcon, ResetIcon, TypeIcon } from './components/icons';
import { Bump, usePresence, useSlidingIndicator } from './components/motion';
import { FavColorBar, PaintBanner } from './components/FavColors';
import { ImportedPanel, PreviewCard } from './components/PreviewCard';
import { TemplateGrid } from './components/TemplateGrid';
import type { I18nKey } from './i18n';
import { fetchBotPacks, packsAvailable } from './lib/botApi';
import { confirmAction, haptic, useBackButton, useMainButton } from './lib/telegram';
import { openPack } from './state/packs';
import { useEditor } from './state/store';
import { useUi, type Tab } from './state/ui';
import { useCompiled } from './state/useCompiled';
import { useT } from './state/useT';
import type { Lang } from './templates/types';

const LANGS: Lang[] = ['uk', 'ru', 'en'];

const TABS: Array<{ value: Tab; key: I18nKey; icon: React.ReactNode }> = [
  { value: 'templates', key: 'tabTemplates', icon: <GridIcon width={18} height={18} /> },
  { value: 'content', key: 'tabContent', icon: <TypeIcon width={18} height={18} /> },
  { value: 'colors', key: 'tabColors', icon: <PaletteIcon width={18} height={18} /> },
  { value: 'parts', key: 'tabParts', icon: <LayersIcon width={18} height={18} /> },
];

/** Editor sections under the preview; "Layers" appears for imported animations. */
function TabBar({ selected, hasParts }: { selected: number; hasParts: boolean }) {
  const t = useT();
  const tab = useUi((u) => u.tab);
  const setTab = useUi((u) => u.setTab);
  const current = tab === 'parts' && !hasParts ? 'templates' : tab;
  return (
    <nav className="tabbar" aria-label={t('preview')}>
      <Segmented
        value={current}
        onChange={(v) => {
          setTab(v);
          haptic();
          // Scrolled down into the old panel? Start the new one at its top (under the sticky preview and tabs).
          requestAnimationFrame(() => {
            const panel = document.querySelector<HTMLElement>('.panel');
            if (panel && panel.getBoundingClientRect().top < 0) panel.scrollIntoView({ block: 'start' });
          });
        }}
        options={TABS.filter((tb) => tb.value !== 'parts' || hasParts).map((tb) => ({
          value: tb.value,
          label: (
            <>
              {tb.icon}
              <span className="tab-label">{t(tb.key)}</span>
              {tb.value === 'templates' && selected > 0 && <Bump value={selected} className="tab-badge" />}
            </>
          ),
        }))}
      />
    </nav>
  );
}

/**
 * Phones: the preview stays on top while the panel scrolls (its height feeds the sticky tab bar);
 * typing un-sticks it so the keyboard never hides the field.
 */
function useStickyPreview(ref: React.RefObject<HTMLElement | null>, app: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    const root = app.current;
    if (!el || !root) return;
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => root.style.setProperty('--preview-h', `${el.offsetHeight}px`)) : null;
    ro?.observe(el);
    const isField = (el: Element | null) => !!el?.matches('textarea, select, input:not([type=range]):not([type=checkbox]):not([type=color])');
    let timer = 0;
    const typing = (e: FocusEvent) => {
      window.clearTimeout(timer);
      if (e.type === 'focusin') {
        if (isField(e.target as Element)) root.classList.add('is-typing');
        return;
      }
      // Re-pin a moment later: the tap that moved focus (e.g. on "Save") must land before the layout shifts.
      timer = window.setTimeout(() => {
        if (!isField(document.activeElement)) root.classList.remove('is-typing');
      }, 350);
    };
    root.addEventListener('focusin', typing);
    root.addEventListener('focusout', typing);
    // Scrolled into the panel: the canvas gets compact (hysteresis, so it does not flicker at the edge).
    let scrolled = false;
    const onScroll = () => {
      const next = scrolled ? window.scrollY > 40 : window.scrollY > 140;
      if (next === scrolled) return;
      scrolled = next;
      root.classList.toggle('is-scrolled', next);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.clearTimeout(timer);
      ro?.disconnect();
      root.removeEventListener('focusin', typing);
      root.removeEventListener('focusout', typing);
      window.removeEventListener('scroll', onScroll);
    };
  }, [ref, app]);
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
  const hasParts = !!activeEmoji?.imported;
  const tab = useUi((u) => u.tab);
  const panel = tab === 'parts' && !hasParts ? 'templates' : tab;
  const painting = useUi((u) => !!u.paintColor);
  const appRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  useStickyPreview(previewRef, appRef);
  // Inside Telegram the main action is Telegram's own bottom button; the Back button closes the sheet.
  const nativeButton = useMainButton({
    text: `${t('download')} (${selectedEmojis.length})`,
    visible: !sheet.mounted,
    enabled: selectedEmojis.length > 0,
    onClick: () => setExportOpen(true),
  });
  useBackButton(exportOpen, closeExport);

  return (
    <div className={`app${nativeButton ? ' has-native-button' : ''}${painting ? ' is-painting' : ''}`} ref={appRef}>
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
            onClick={async () => (await confirmAction(t('resetConfirm'))) && reset()}
          />
        </div>
      </header>

      <main className="layout">
        <div className="area-preview" ref={previewRef}>
          <PreviewCard emoji={activeEmoji} pending={compiled.pending} input={compiled.input} />
        </div>
        <div className="area-panel">
          <TabBar selected={selectedEmojis.length} hasParts={hasParts} />
          <div className="panel" key={panel}>
            {panel !== 'templates' && <FavColorBar />}
            {panel === 'templates' && <TemplateGrid emojis={compiled.emojis} byId={compiled.byId} />}
            {panel === 'content' && <ContentCard missing={compiled.missingChars} fontLoading={compiled.fontLoading} svg={compiled.svg} />}
            {panel === 'colors' && <ColorsCard />}
            {panel === 'parts' && activeEmoji && (
              <section className="card">
                <ImportedPanel id={activeEmoji.id} />
              </section>
            )}
          </div>
        </div>
      </main>

      {!nativeButton && (
        <div className="bottom-bar">
          <MotionButton motion="drop" className="primary-btn" label={t('download')} icon={<DownloadIcon />} disabled={selectedEmojis.length === 0} onClick={() => setExportOpen(true)}>
            <span>
              {t('download')} (<Bump value={selectedEmojis.length} />)
            </span>
          </MotionButton>
        </div>
      )}

      <PaintBanner />
      {sheet.mounted && <ExportSheet emojis={selectedEmojis} onClose={closeExport} state={sheet.state} />}
    </div>
  );
}
