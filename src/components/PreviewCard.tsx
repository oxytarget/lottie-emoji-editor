import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { haptic } from '../lib/telegram';
import { CONTENT_CLASS } from '../lottie/compose';
import { flattenParts, listParts, NO_XF, PART_CLASS, type PartXf } from '../lottie/parts';
import type { I18nKey } from '../i18n';
import { recolor, type CompatIssue } from '../lottie/imported';
import { applyItemPaints, itemGradientClass, listPaintItems, type ItemPaint } from '../lottie/itemPaints';
import type { GradientPaint, Paint } from '../lottie/paint';
import { compileOne, type CompileInput } from '../state/compile';
import { paintOf, setPaintOf, withPaint, type GradTarget } from '../state/gradients';
import { editImport, useUi } from '../state/ui';
import { CanvasEditor, type ContentXf } from './CanvasEditor';
import { GradientBar, GradientEditor } from './GradientEditor';
import { MotionButton } from './controls';
import { formatKb } from '../lottie/export';
import { useEditor, type ImportedTemplate, type PreviewBg } from '../state/store';
import type { CompiledEmoji } from '../state/useCompiled';
import { useT } from '../state/useT';
import { ColorSwatch } from './ColorSwatch';
import { Toggle } from './controls';
import { CheckIcon, CloseIcon, GrabIcon, PauseIcon, PlayIcon, ResetIcon, StarIcon, TrashIcon, WarningIcon } from './icons';
import { LottieView } from './LottieView';
import { PartsPanel } from './PartsPanel';
import { emojiName } from './TemplateGrid';

const BGS: PreviewBg[] = ['light', 'dark', 'chess'];

const ISSUE_KEYS: Record<CompatIssue, I18nKey> = {
  expressions: 'issueExpressions',
  effects: 'issueEffects',
  text: 'issueText',
  images: 'issueImages',
  '3d': 'issue3d',
  mergePaths: 'issueMergePaths',
};

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

export function ImportedPanel({ id }: { id: string }) {
  const t = useT();
  const imp = useEditor((s) => s.imports.find((i) => i.id === id));
  const remove = useEditor((s) => s.removeImport);
  const addFavColors = useEditor((s) => s.addFavColors);
  if (!imp) return null;
  const issues = imp.notes?.issues ?? [];
  return (
    <div className="imported-panel">
      {imp.notes && imp.notes.baked > 0 && (
        <p className="note is-ok">
          <CheckIcon width={16} height={16} strokeWidth={3} /> {t('importBaked').replace('{n}', String(imp.notes.baked))}
        </p>
      )}
      {issues.length > 0 && (
        <p className="note is-warn">
          <WarningIcon width={16} height={16} /> {t('importIssues').replace('{list}', issues.map((i) => t(ISSUE_KEYS[i])).join(', '))}
        </p>
      )}
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
        <MotionButton
          motion="twinkle"
          className="pill-btn is-compact"
          icon={<StarIcon width={16} height={16} />}
          label={t('favPaletteAdd')}
          onClick={() => addFavColors(imp.palette.map((c) => imp.colorMap[c] ?? c))}
        >
          {t('favPaletteAdd')}
        </MotionButton>
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

/** Current frame of the preview, outside React state: only the player re-renders on every frame. */
function createFrameBus() {
  let value = { frame: 0, total: 0 };
  let last = 0;
  let pending = 0;
  const listeners = new Set<() => void>();
  const notify = () => {
    pending = 0;
    last = performance.now();
    listeners.forEach((l) => l());
  };
  return {
    get: () => value,
    // ~15 updates a second are plenty for a timeline and a clock (React re-rendered the player on every frame).
    set: (frame: number, total: number) => {
      if (frame === value.frame && total === value.total) return;
      value = { frame, total };
      const wait = 66 - (performance.now() - last);
      if (wait <= 0) notify();
      else if (!pending) pending = window.setTimeout(notify, wait);
    },
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
  };
}
type FrameBus = ReturnType<typeof createFrameBus>;

const SPEEDS = [1, 2, 0.5] as const;
const FPS = 60;

/** Play/pause, timeline (drag to scrub — playback pauses meanwhile), time and speed. */
function Player(props: {
  bus: FrameBus;
  playing: boolean;
  setPlaying: (v: boolean) => void;
  speed: number;
  setSpeed: (v: number) => void;
  onSeek: (frame: number) => void;
}) {
  const t = useT();
  const { bus, playing, setPlaying, speed, setSpeed, onSeek } = props;
  const bg = useEditor((s) => s.previewBg);
  const setBg = useEditor((s) => s.set);
  const { frame, total } = useSyncExternalStore(bus.subscribe, bus.get);
  const resume = useRef(false);
  const last = Math.max(total - 1, 1);
  const grab = () => {
    if (!playing) return;
    resume.current = true;
    setPlaying(false);
  };
  const release = () => {
    if (resume.current) setPlaying(true);
    resume.current = false;
  };
  const step = (d: number) => {
    setPlaying(false);
    onSeek((Math.round(frame) + d + total) % Math.max(total, 1));
  };
  return (
    <div className="player">
      <MotionButton
        motion="pop"
        className="icon-btn is-round player-play"
        label={playing ? t('pause') : t('play')}
        icon={playing ? <PauseIcon /> : <PlayIcon />}
        onClick={() => setPlaying(!playing)}
      />
      <input
        type="range"
        className="player-scrub"
        min={0}
        max={last}
        step={1}
        value={Math.min(Math.round(frame), last)}
        aria-label={t('timeline')}
        style={{ '--pct': `${(Math.min(frame, last) / last) * 100}%` } as React.CSSProperties}
        onPointerDown={grab}
        onPointerUp={release}
        onPointerCancel={release}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            e.preventDefault();
            step(e.key === 'ArrowLeft' ? -1 : 1);
          }
        }}
        onChange={(e) => onSeek(Number(e.target.value))}
      />
      <span className="player-time" aria-live="off">
        {(frame / FPS).toFixed(1)}
        <small> / {(total / FPS).toFixed(1)} {t('seconds')}</small>
      </span>
      <button
        type="button"
        className="player-speed"
        aria-label={`${t('speed')}: ${speed}×`}
        title={t('speed')}
        onClick={() => setSpeed(SPEEDS[(SPEEDS.indexOf(speed as (typeof SPEEDS)[number]) + 1) % SPEEDS.length])}
      >
        {speed}×
      </button>
      {/* Phones: background switch here (the row with the name is hidden to keep the preview compact). */}
      <button
        type="button"
        className={`player-bg bg-dot bg-${bg}`}
        aria-label={t('preview')}
        title={t('preview')}
        onClick={() => setBg('previewBg', BGS[(BGS.indexOf(bg) + 1) % BGS.length])}
      />
    </div>
  );
}

const sameXf = (a: ContentXf, b: ContentXf) =>
  a.scale === b.scale && a.offsetX === b.offsetX && a.offsetY === b.offsetY && a.rotation === b.rotation && a.stretch === b.stretch;
const DEFAULT_XF: ContentXf = { scale: 1, offsetX: 0, offsetY: 0, rotation: 0, stretch: 1 };
const toContentXf = (p: PartXf): ContentXf => ({ scale: p.scale, offsetX: p.x, offsetY: p.y, rotation: p.rotation, stretch: p.stretch ?? 1 });
const toPartXf = (c: ContentXf): PartXf => ({ x: c.offsetX, y: c.offsetY, scale: c.scale, rotation: c.rotation, ...(c.stretch !== 1 ? { stretch: c.stretch } : {}) });
/** Canvas selection: the user's text/logo or a part of an imported animation. */
const CONTENT = '@content';
const samePaint = (a: Paint, b: Paint) => JSON.stringify(a) === JSON.stringify(b);

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
  const stretch = useEditor((s) => s.stretch);
  const ratioLock = useUi((u) => u.ratioLock);
  const setRatioLock = useUi((u) => u.setRatioLock);
  const imp = useEditor((s) => (emoji?.imported ? s.imports.find((i) => i.id === emoji.id) : undefined));
  const grab = useUi((u) => u.grab);
  const setGrab = useUi((u) => u.setGrab);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [seek, setSeek] = useState<{ frame: number; n: number } | null>(null);
  const [bus] = useState(createFrameBus);
  const [editing, setEditing] = useState(false);
  const [live, setLive] = useState<{ key: string; xf: ContentXf } | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const frame = useRef(0);
  const pendingXf = useRef<ContentXf | null>(null);
  const lastPick = useRef<{ x: number; y: number } | null>(null);

  // Gradient handles on the canvas (instead of the text/logo frame).
  const gradTarget = useUi((u) => u.gradEdit);
  const setGradEdit = useUi((u) => u.setGradEdit);
  const storedGrad = useEditor((s) => (gradTarget ? paintOf(s, gradTarget) : null));
  const [liveGrad, setLiveGrad] = useState<{ target: GradTarget; paint: GradientPaint } | null>(null);
  const [gradFound, setGradFound] = useState(true);
  const pendingGrad = useRef<GradientPaint | null>(null);
  const gradBar = useRef<HTMLDivElement>(null);
  const gradPaint = liveGrad && liveGrad.target === gradTarget ? liveGrad.paint : storedGrad?.type !== 'solid' ? storedGrad : null;
  const gradEditing = !!gradTarget && !!gradPaint;

  // Handles of a layer's own gradient (imported animations), next to the grabbed layer's frame.
  const gradItem = useUi((u) => u.gradItem);
  const [liveItem, setLiveItem] = useState<{ item: string; edit: ItemPaint } | null>(null);
  const itemInfo = useMemo(() => {
    if (!imp || gradItem?.imp !== imp.id) return null;
    const all = listPaintItems(applyItemPaints(recolor(imp.data, imp.colorMap), imp.paints ?? {}));
    const index = all.findIndex((i) => i.id === gradItem.item);
    const item = all[index];
    return item?.gradient && item.from && item.to ? { item, cls: itemGradientClass(index) } : null;
  }, [imp, gradItem]);
  const itemEdit = (id: string): ItemPaint => imp?.paints?.[id] ?? {};
  const itemPaint: GradientPaint | null = itemInfo
    ? {
        type: itemInfo.item.type === 2 ? 'radial' : 'linear',
        colors: [itemInfo.item.colors[0], itemInfo.item.colors[itemInfo.item.colors.length - 1]],
        angle: 0,
        from: (liveItem?.item === itemInfo.item.id && liveItem.edit.from) || itemInfo.item.from,
        to: (liveItem?.item === itemInfo.item.id && liveItem.edit.to) || itemInfo.item.to,
      }
    : null;

  const parts = useMemo(() => (imp ? flattenParts(listParts(imp.data)) : []), [imp?.data]);
  const grabbed = imp && grab?.id === imp.id ? parts.findIndex((p) => p.id === grab.part) : -1;
  const part = grabbed >= 0 ? parts[grabbed] : null;
  const key = part ? part.id : CONTENT;

  const contentXf = useMemo(() => ({ scale, offsetX, offsetY, rotation, stretch }), [scale, offsetX, offsetY, rotation, stretch]);
  const partXf = part && imp ? imp.transforms[part.id] : undefined;
  const stored = useMemo(() => (part ? toContentXf(partXf ?? NO_XF) : contentXf), [part, partXf, contentXf]);
  const liveXf = live?.key === key ? live.xf : null;
  const xf = liveXf ?? stored;

  // While dragging, rebuild only the visible animation (on the main thread, once per frame).
  const liveJson = useMemo(() => {
    if (liveGrad && emoji && !liveXf) return compileOne(withPaint(input, liveGrad.target, liveGrad.paint), emoji.id);
    if (liveItem && emoji && !liveXf) {
      const imports = input.imports.map((i) => (i.id === emoji.id ? { ...i, paints: { ...i.paints, [liveItem.item]: liveItem.edit } } : i));
      return compileOne({ ...input, imports }, emoji.id);
    }
    if (!liveXf || !emoji) return null;
    if (!part) return compileOne({ ...input, ...liveXf }, emoji.id);
    const imports = input.imports.map((i) => (i.id === emoji.id ? { ...i, transforms: { ...i.transforms, [part.id]: toPartXf(liveXf) } } : i));
    return compileOne({ ...input, imports }, emoji.id);
  }, [liveXf, liveGrad, liveItem, input, emoji, part]);
  // Keep the instant preview until the full recompile of the committed transform has landed.
  useEffect(() => {
    if (live && (live.key !== key || (!editing && !pending && sameXf(live.xf, stored)))) setLive(null);
  }, [live, key, editing, pending, stored]);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  useEffect(() => {
    if (liveGrad && (liveGrad.target !== gradTarget || (!editing && !pending && storedGrad && samePaint(liveGrad.paint, storedGrad)))) setLiveGrad(null);
  }, [liveGrad, gradTarget, editing, pending, storedGrad]);
  useEffect(() => {
    if (liveItem && !editing && !pending && JSON.stringify(imp?.paints?.[liveItem.item] ?? {}) === JSON.stringify(liveItem.edit)) setLiveItem(null);
  }, [liveItem, editing, pending, imp]);
  // A paint that stopped being a gradient (preset, "remove gradient") closes the handles.
  useEffect(() => {
    if (gradTarget && storedGrad?.type === 'solid' && !liveGrad) setGradEdit(null);
  }, [gradTarget, storedGrad, liveGrad, setGradEdit]);
  // The animation holds still while the handles are shown (easier to grab), and plays on again after.
  const resumeAfterGrad = useRef(false);
  useEffect(() => {
    if (gradEditing) {
      resumeAfterGrad.current = resumeAfterGrad.current || playing;
      setPlaying(false);
    } else if (resumeAfterGrad.current) {
      resumeAfterGrad.current = false;
      setPlaying(true);
    }
  }, [gradEditing]);

  const onGradLive = (next: GradientPaint) => {
    if (!gradTarget) return;
    pendingGrad.current = next;
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      if (pendingGrad.current) setLiveGrad({ target: gradTarget, paint: pendingGrad.current });
    });
  };
  const onGradCommit = (next: GradientPaint) => {
    if (!gradTarget) return;
    pendingGrad.current = null;
    setLiveGrad({ target: gradTarget, paint: next });
    setPaintOf(gradTarget, next);
  };
  const onItemLive = (next: GradientPaint) => {
    if (!itemInfo) return;
    const id = itemInfo.item.id;
    const edit: ItemPaint = { ...itemEdit(id), from: next.from, to: next.to };
    pendingGrad.current = null;
    if (frame.current) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      setLiveItem({ item: id, edit });
    });
  };
  const onItemCommit = (edit: ItemPaint) => {
    if (!itemInfo || !imp) return;
    const id = itemInfo.item.id;
    const full = { ...itemEdit(id), ...edit };
    setLiveItem({ item: id, edit: full });
    editImport(imp.id, { kind: 'paint', item: id, paint: full });
  };
  /** A dot of a layer gradient: the matching colour in the "Layer colours" window. */
  const onItemTapStop = (stop: 0 | 1) => {
    if (!itemInfo) return;
    const row = document.querySelector(`[data-item="${CSS.escape(itemInfo.item.id)}"]`);
    const i = stop === 0 ? 0 : itemInfo.item.colors.length - 1;
    row?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    row?.querySelector<HTMLButtonElement>(`[data-item-stop="${i}"] .swatch`)?.click();
  };
  const onItemStopColor = (stop: 0 | 1, hex: string) => {
    if (!itemInfo) return;
    const stops = [...(itemEdit(itemInfo.item.id).stops ?? itemInfo.item.colors)];
    stops[stop === 0 ? 0 : stops.length - 1] = hex;
    onItemCommit({ stops });
  };
  /** A tap on a dot: its colour (the painted favourite, or the palette). */
  const onTapStop = (stop: 0 | 1) => gradBar.current?.querySelector<HTMLButtonElement>(`[data-stop="${stop}"] .swatch`)?.click();

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
    const hit = document.elementsFromPoint(x, y).find((el) => stage.contains(el) && el.closest('svg') && !el.closest('.canvas-editor, .grad-editor'));
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
    // A grabbed part is also highlighted (with its sliders) in the Layers panel.
    if (next !== CONTENT && imp) useUi.getState().setTab('parts');
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
          <LottieView json={json} playing={playing && !editing} speed={speed} seek={seek} onFrame={bus.set} className="preview-anim" label={name} />
        </div>
        {gradEditing && gradTarget && gradPaint ? (
          <GradientEditor
            key={gradTarget}
            stage={stageRef}
            target={gradTarget}
            paint={gradPaint}
            onLive={onGradLive}
            onCommit={onGradCommit}
            onActive={setEditing}
            onTapStop={onTapStop}
            onStopColor={(stop, hex) => onGradCommit({ ...gradPaint, colors: stop === 0 ? [hex, gradPaint.colors[1]] : [gradPaint.colors[0], hex] })}
            onFound={setGradFound}
          />
        ) : (
          <>
            <CanvasEditor
              stage={stageRef}
              target={part ? `${PART_CLASS}${grabbed}` : CONTENT_CLASS}
              value={xf}
              onLive={onLive}
              onCommit={onCommit}
              onActive={setEditing}
              onPick={onPick}
              locked={ratioLock}
              onToggleLock={() => {
                setRatioLock(!ratioLock);
                haptic();
              }}
            />
            {itemInfo && itemPaint && (
              <GradientEditor
                key={itemInfo.item.id}
                stage={stageRef}
                target={itemInfo.cls}
                paint={itemPaint}
                onLive={onItemLive}
                onCommit={(p) => onItemCommit({ from: p.from, to: p.to })}
                onActive={setEditing}
                onTapStop={onItemTapStop}
                onStopColor={onItemStopColor}
                onFound={() => {}}
              />
            )}
          </>
        )}
        {pending && <span className="preview-busy" aria-hidden />}
      </div>
      {gradEditing && gradTarget && gradPaint ? (
        <GradientBar target={gradTarget} paint={gradPaint} found={gradFound} onChange={onGradCommit} onDone={() => setGradEdit(null)} barRef={gradBar} />
      ) : (
        <>
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
          <Player bus={bus} playing={playing} setPlaying={setPlaying} speed={speed} setSpeed={setSpeed} onSeek={(frame) => setSeek((v) => ({ frame, n: (v?.n ?? 0) + 1 }))} />
        </>
      )}
      <div className="preview-bar">
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
    </section>
  );
}
