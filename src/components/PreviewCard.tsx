import { useEffect, useMemo, useRef, useState } from 'react';
import { compileOne, type CompileInput } from '../state/compile';
import { CanvasEditor, type ContentXf } from './CanvasEditor';
import { MotionButton } from './controls';
import { formatKb } from '../lottie/export';
import { useEditor, type PreviewBg } from '../state/store';
import type { CompiledEmoji } from '../state/useCompiled';
import { useT } from '../state/useT';
import { ColorSwatch } from './ColorSwatch';
import { Toggle } from './controls';
import { PauseIcon, PlayIcon, ResetIcon, TrashIcon } from './icons';
import { LottieView } from './LottieView';
import { PartsPanel } from './PartsPanel';
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
      <PartsPanel key={imp.id} imp={imp} />
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

const sameXf = (a: ContentXf, b: ContentXf) => a.scale === b.scale && a.offsetX === b.offsetX && a.offsetY === b.offsetY && a.rotation === b.rotation;
const DEFAULT_XF: ContentXf = { scale: 1, offsetX: 0, offsetY: 0, rotation: 0 };

export function PreviewCard({ emoji, pending, input }: { emoji: CompiledEmoji | undefined; pending: boolean; input: CompileInput }) {
  const t = useT();
  const lang = useEditor((s) => s.lang);
  const bg = useEditor((s) => s.previewBg);
  const set = useEditor((s) => s.set);
  const setTransform = useEditor((s) => s.setTransform);
  const scale = useEditor((s) => s.scale);
  const offsetX = useEditor((s) => s.offsetX);
  const offsetY = useEditor((s) => s.offsetY);
  const rotation = useEditor((s) => s.rotation);
  const [playing, setPlaying] = useState(true);
  const [editing, setEditing] = useState(false);
  const [live, setLive] = useState<ContentXf | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const frame = useRef(0);
  const pendingXf = useRef<ContentXf | null>(null);

  const stored = useMemo(() => ({ scale, offsetX, offsetY, rotation }), [scale, offsetX, offsetY, rotation]);
  const xf = live ?? stored;

  // While dragging, rebuild only the visible animation (on the main thread, once per frame).
  const liveJson = useMemo(() => (live && emoji ? compileOne({ ...input, ...live }, emoji.id) : null), [live, input, emoji]);
  // Keep the instant preview until the full recompile of the committed transform has landed.
  useEffect(() => {
    if (live && !editing && !pending && sameXf(live, stored)) setLive(null);
  }, [live, editing, pending, stored]);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const onLive = (next: ContentXf) => {
    pendingXf.current = next;
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      if (pendingXf.current) setLive(pendingXf.current);
    });
  };
  const onCommit = (next: ContentXf) => {
    setLive(next);
    setTransform(next);
  };

  if (!emoji) return null;
  const json = liveJson ?? emoji.json;
  const moved = !sameXf(xf, DEFAULT_XF);
  const name = emojiName(emoji.name, lang);
  const bgLabel = { light: t('bgLight'), dark: t('bgDark'), chess: t('bgChess') };

  return (
    <section className={`card preview-card bg-${bg}`}>
      <div className="preview-stage" ref={stageRef}>
        {/* Keyed by template: switching characters cross-fades the stage. */}
        <div key={emoji.id} className="preview-swap">
          <LottieView json={json} playing={playing && !editing} className="preview-anim" label={name} />
        </div>
        <CanvasEditor stage={stageRef} value={xf} onLive={onLive} onCommit={onCommit} onActive={setEditing} />
        {pending && <span className="preview-busy" aria-hidden />}
      </div>
      <div className="canvas-tools">
        <span className="hint">{t('canvasHint')}</span>
        {moved && (
          <MotionButton motion="spin-back" className="pill-btn is-compact is-pop-in" icon={<ResetIcon width={16} height={16} />} label={t('canvasReset')} onClick={() => onCommit(DEFAULT_XF)}>
            {t('canvasReset')}
          </MotionButton>
        )}
      </div>
      <div className="preview-bar">
        <MotionButton
          motion="pop"
          className="icon-btn is-round"
          label={playing ? t('pause') : t('play')}
          icon={playing ? <PauseIcon /> : <PlayIcon />}
          onClick={() => setPlaying((p) => !p)}
        />
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
