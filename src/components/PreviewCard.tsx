import { useEffect, useMemo, useRef, useState } from 'react';
import { haptic } from '../lib/telegram';
import { CONTENT_CLASS } from '../lottie/compose';
import { flattenParts, listParts, NO_XF, PART_CLASS, type PartXf } from '../lottie/parts';
import { compileOne, type CompileInput } from '../state/compile';
import { editImport, useUi } from '../state/ui';
import { CanvasEditor, type ContentXf } from './CanvasEditor';
import { MotionButton } from './controls';
import { formatKb } from '../lottie/export';
import { useEditor, type ImportedTemplate, type PreviewBg } from '../state/store';
import type { CompiledEmoji } from '../state/useCompiled';
import { useT } from '../state/useT';
import { ColorSwatch } from './ColorSwatch';
import { Toggle } from './controls';
import { CheckIcon, CloseIcon, GrabIcon, PauseIcon, PlayIcon, ResetIcon, TrashIcon } from './icons';
import { LottieView } from './LottieView';
import { PartsPanel } from './PartsPanel';
import { emojiName } from './TemplateGrid';

const BGS: PreviewBg[] = ['light', 'dark', 'chess'];

/** "Apply to all selected": edits of this animation are repeated on the other selected ones. */
function SyncBar({ imp }: { imp: ImportedTemplate }) {
  const t = useT();
  const sync = useEditor((s) => s.syncImports);
  const set = useEditor((s) => s.set);
  const others = useEditor((s) => s.selected.reduce((n, id) => (id !== imp.id && s.imports.some((i) => i.id === id) ? n + 1 : n), 0));
  const packLeft = useEditor((s) =>
    imp.source ? s.imports.reduce((n, i) => (i.source?.pack === imp.source!.pack && !s.selected.includes(i.id) ? n + 1 : n), 0) : 0,
  );
  const report = useUi((u) => u.syncReport);

  const selectPack = () => {
    const { imports, selected } = useEditor.getState();
    const ids = imports.filter((i) => i.source?.pack === imp.source?.pack).map((i) => i.id);
    set('selected', [...selected, ...ids.filter((id) => !selected.includes(id))]);
    haptic();
  };

  return (
    <div className={`sync-bar${sync ? ' is-on' : ''}`}>
      <Toggle label={t('syncTitle')} checked={sync} onChange={(v) => set('syncImports', v)} />
      <p className="hint">
        {sync && others > 0 ? `${t('syncHint')} ${t('syncCount')}: ${others}.` : sync ? t('syncNone') : t('syncOffHint')}
      </p>
      {packLeft > 0 && (
        <button type="button" className="pill-btn is-compact" onClick={selectPack}>
          <CheckIcon width={16} height={16} /> {t('syncSelectPack')} (+{packLeft})
        </button>
      )}
      {sync && report && (
        <p key={report.n} className={`sync-report${report.applied < report.total ? ' is-partial' : ''}`} role="status">
          <CheckIcon width={14} height={14} strokeWidth={3} /> {t('syncApplied')}: {report.applied} / {report.total}
          {report.applied < report.total ? ` · ${t('syncMissing')}` : ''}
        </p>
      )}
    </div>
  );
}

function ImportedPanel({ id }: { id: string }) {
  const t = useT();
  const imp = useEditor((s) => s.imports.find((i) => i.id === id));
  const remove = useEditor((s) => s.removeImport);
  if (!imp) return null;
  return (
    <div className="imported-panel">
      <SyncBar imp={imp} />
      <PartsPanel key={imp.id} imp={imp} />
      <h3 className="section-title">{t('importedPalette')}</h3>
      <div className="palette-map">
        {imp.palette.map((from) => (
          <ColorSwatch key={from} color={imp.colorMap[from] ?? from} label={from} onChange={(to) => editImport(id, { kind: 'color', from, to })} />
        ))}
      </div>
      <Toggle label={t('importedOverlay')} checked={imp.overlay} onChange={(v) => editImport(id, { kind: 'overlay', value: v })} />
      <div className="row-actions">
        <button type="button" className="pill-btn is-compact" onClick={() => editImport(id, { kind: 'colorsReset' })}>
          <ResetIcon width={18} height={18} /> {t('importedReset')}
        </button>
        {!imp.source && (
          <button type="button" className="pill-btn is-compact is-danger" onClick={() => remove(id)}>
            <TrashIcon width={18} height={18} /> {t('importedRemove')}
          </button>
        )}
      </div>
    </div>
  );
}

const sameXf = (a: ContentXf, b: ContentXf) => a.scale === b.scale && a.offsetX === b.offsetX && a.offsetY === b.offsetY && a.rotation === b.rotation;
const DEFAULT_XF: ContentXf = { scale: 1, offsetX: 0, offsetY: 0, rotation: 0 };
const toContentXf = (p: PartXf): ContentXf => ({ scale: p.scale, offsetX: p.x, offsetY: p.y, rotation: p.rotation });
const toPartXf = (c: ContentXf): PartXf => ({ x: c.offsetX, y: c.offsetY, scale: c.scale, rotation: c.rotation });
/** Canvas selection: the user's text/logo or a part of an imported animation. */
const CONTENT = '@content';

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
  const imp = useEditor((s) => (emoji?.imported ? s.imports.find((i) => i.id === emoji.id) : undefined));
  const grab = useUi((u) => u.grab);
  const setGrab = useUi((u) => u.setGrab);
  const [playing, setPlaying] = useState(true);
  const [editing, setEditing] = useState(false);
  const [live, setLive] = useState<{ key: string; xf: ContentXf } | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const frame = useRef(0);
  const pendingXf = useRef<ContentXf | null>(null);
  const lastPick = useRef<{ x: number; y: number } | null>(null);

  const parts = useMemo(() => (imp ? flattenParts(listParts(imp.data)) : []), [imp?.data]);
  const grabbed = imp && grab?.id === imp.id ? parts.findIndex((p) => p.id === grab.part) : -1;
  const part = grabbed >= 0 ? parts[grabbed] : null;
  const key = part ? part.id : CONTENT;

  const contentXf = useMemo(() => ({ scale, offsetX, offsetY, rotation }), [scale, offsetX, offsetY, rotation]);
  const partXf = part && imp ? imp.transforms[part.id] : undefined;
  const stored = useMemo(() => (part ? toContentXf(partXf ?? NO_XF) : contentXf), [part, partXf, contentXf]);
  const liveXf = live?.key === key ? live.xf : null;
  const xf = liveXf ?? stored;

  // While dragging, rebuild only the visible animation (on the main thread, once per frame).
  const liveJson = useMemo(() => {
    if (!liveXf || !emoji) return null;
    if (!part) return compileOne({ ...input, ...liveXf }, emoji.id);
    const imports = input.imports.map((i) => (i.id === emoji.id ? { ...i, transforms: { ...i.transforms, [part.id]: toPartXf(liveXf) } } : i));
    return compileOne({ ...input, imports }, emoji.id);
  }, [liveXf, input, emoji, part]);
  // Keep the instant preview until the full recompile of the committed transform has landed.
  useEffect(() => {
    if (live && (live.key !== key || (!editing && !pending && sameXf(live.xf, stored)))) setLive(null);
  }, [live, key, editing, pending, stored]);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const onLive = (next: ContentXf) => {
    pendingXf.current = next;
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      if (pendingXf.current) setLive({ key, xf: pendingXf.current });
    });
  };
  const onCommit = (next: ContentXf) => {
    setLive({ key, xf: next });
    if (part && imp) editImport(imp.id, { kind: 'transform', part: part.id, xf: toPartXf(next) });
    else setTransform(next);
  };

  /** Double tap: grab what is under the finger; again on the same spot — the part around it. */
  const onPick = (x: number, y: number) => {
    const stage = stageRef.current;
    if (!stage || !emoji) return;
    const hit = document.elementsFromPoint(x, y).find((el) => stage.contains(el) && el.closest('svg') && !el.closest('.canvas-editor'));
    const chain: string[] = [];
    for (let n: Element | null = hit ?? null; n && n !== stage; n = n.parentElement) {
      if (n.classList.contains(CONTENT_CLASS) && !chain.includes(CONTENT)) chain.push(CONTENT);
      for (const c of n.classList) {
        const m = c.startsWith(PART_CLASS) ? parts[Number(c.slice(PART_CLASS.length))] : undefined;
        if (m && !chain.includes(m.id)) chain.push(m.id);
      }
    }
    const near = lastPick.current && Math.hypot(lastPick.current.x - x, lastPick.current.y - y) < 24;
    lastPick.current = { x, y };
    if (!chain.length) return;
    const at = chain.indexOf(key);
    const next = near && at >= 0 ? chain[(at + 1) % chain.length] : chain[0];
    setGrab(next === CONTENT || !imp ? null : { id: imp.id, part: next });
    haptic();
  };

  if (!emoji) return null;
  const json = liveJson ?? emoji.preview ?? emoji.json;
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
        <CanvasEditor
          stage={stageRef}
          target={part ? `${PART_CLASS}${grabbed}` : CONTENT_CLASS}
          value={xf}
          onLive={onLive}
          onCommit={onCommit}
          onActive={setEditing}
          onPick={onPick}
        />
        {pending && <span className="preview-busy" aria-hidden />}
      </div>
      <div className="canvas-tools">
        {part ? (
          <span className="grab-chip is-pop-in" role="status">
            <GrabIcon width={16} height={16} />
            <span>
              {t('grabbed')}: <strong>{part.name}</strong>
            </span>
            <button type="button" className="grab-release" aria-label={t('grabRelease')} title={t('grabRelease')} onClick={() => setGrab(null)}>
              <CloseIcon width={14} height={14} />
            </button>
          </span>
        ) : (
          <span className="hint">{emoji.imported ? t('canvasHintParts') : t('canvasHint')}</span>
        )}
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
