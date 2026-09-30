import { useState } from 'react';
import { formatKb } from '../lottie/export';
import { useEditor, type PreviewBg } from '../state/store';
import type { CompiledEmoji } from '../state/useCompiled';
import { useT } from '../state/useT';
import { ColorSwatch } from './ColorSwatch';
import { Toggle } from './controls';
import { PauseIcon, PlayIcon, ResetIcon, TrashIcon } from './icons';
import { LottieView } from './LottieView';
import { emojiName } from './TemplateGrid';

const BGS: PreviewBg[] = ['light', 'dark', 'chess'];

function ImportedPanel({ id }: { id: string }) {
  const t = useT();
  const imp = useEditor((s) => s.imports.find((i) => i.id === id));
  const update = useEditor((s) => s.updateImport);
  const remove = useEditor((s) => s.removeImport);
  if (!imp) return null;
  return (
    <div className="imported-panel">
      <h3 className="section-title">{t('importedPalette')}</h3>
      <div className="palette-map">
        {imp.palette.map((from) => (
          <ColorSwatch
            key={from}
            color={imp.colorMap[from] ?? from}
            label={from}
            onChange={(to) => update(id, { colorMap: { ...imp.colorMap, [from]: to } })}
          />
        ))}
      </div>
      <Toggle label={t('importedOverlay')} checked={imp.overlay} onChange={(v) => update(id, { overlay: v })} />
      <div className="row-actions">
        <button type="button" className="pill-btn is-compact" onClick={() => update(id, { colorMap: {} })}>
          <ResetIcon width={18} height={18} /> {t('importedReset')}
        </button>
        <button type="button" className="pill-btn is-compact is-danger" onClick={() => remove(id)}>
          <TrashIcon width={18} height={18} /> {t('importedRemove')}
        </button>
      </div>
    </div>
  );
}

export function PreviewCard({ emoji, pending }: { emoji: CompiledEmoji | undefined; pending: boolean }) {
  const t = useT();
  const lang = useEditor((s) => s.lang);
  const bg = useEditor((s) => s.previewBg);
  const set = useEditor((s) => s.set);
  const [playing, setPlaying] = useState(true);
  if (!emoji) return null;
  const name = emojiName(emoji.name, lang);
  const bgLabel = { light: t('bgLight'), dark: t('bgDark'), chess: t('bgChess') };

  return (
    <section className={`card preview-card bg-${bg}`}>
      <div className="preview-stage">
        <LottieView json={emoji.json} playing={playing} className="preview-anim" label={name} />
        {pending && <span className="preview-busy" aria-hidden />}
      </div>
      <div className="preview-bar">
        <button type="button" className="icon-btn is-round" aria-label={playing ? t('pause') : t('play')} onClick={() => setPlaying((p) => !p)}>
          {playing ? <PauseIcon /> : <PlayIcon />}
        </button>
        <div className="preview-meta">
          <strong>{name}</strong>
          <span className={emoji.check.ok ? 'hint' : 'hint is-bad'}>
            {formatKb(emoji.check.bytes)} {t('kb')} · 512×512 · 60 FPS
          </span>
        </div>
        <div className="bg-switch" role="radiogroup" aria-label={t('preview')}>
          {BGS.map((b) => (
            <button key={b} type="button" role="radio" aria-checked={bg === b} aria-label={bgLabel[b]} title={bgLabel[b]} className={`bg-dot bg-${b}${bg === b ? ' is-active' : ''}`} onClick={() => set('previewBg', b)} />
          ))}
        </div>
      </div>
      <div className="chat-preview" aria-label={t('inChat')}>
        <span className="chat-bubble">
          {t('inChat')} <LottieView json={emoji.json} playing={playing} className="chat-emoji" /> 👋
        </span>
        <LottieView json={emoji.json} playing={playing} className="chat-big" />
      </div>
      {emoji.imported && <ImportedPanel id={emoji.id} />}
    </section>
  );
}
