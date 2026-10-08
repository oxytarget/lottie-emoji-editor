import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_FONT_ID, fontOptions, hasFont, registerCssFont } from '../content/fonts';
import { luminance } from '../lottie/color';
import { solid } from '../lottie/paint';
import { fetchTemplateEdits } from '../lib/accountApi';
import { haptic } from '../lib/telegram';
import { isPro, useAccount } from '../state/account';
import { CONTENT_CLASS } from '../lottie/compose';
import { compileOne } from '../state/compile';
import { loadPack } from '../state/packs';
import { PRESETS } from '../state/presets';
import { usePoster } from '../state/posters';
import { useEditor, type PackEdit } from '../state/store';
import { useUi } from '../state/ui';
import type { Compiled, CompiledEmoji } from '../state/useCompiled';
import { CanvasEditor, type ContentXf } from '../components/CanvasEditor';
import { Slider } from '../components/controls';
import { CameraIcon, CheckIcon, CrownIcon, ImageIcon, ResetIcon, TrashIcon, TypeIcon, WarningIcon } from '../components/icons';
import { LottieView, useInView } from '../components/LottieView';
import { emojiName } from '../components/TemplateGrid';
import { buildDesign, pictureToSvg, type PictureKind } from './design';
import { generate, type GenerateError } from './generate';
import { useCT } from './i18n';
import type { StoredResult } from './results';
import { ResultSheet, UpsellSheet } from './Sheets';
import { useInputs, useNav } from './state';

/** Fonts everyone has; the rest come with PRO. */
const FREE_FONTS = 3;
const TEXT_COLORS = ['#ffffff', '#111111', '#facc15', '#f97316', '#ef4444', '#ec4899', '#8b5cf6', '#3b82f6', '#22c55e'];

/** Whether a template can be used by this client: visible, and PRO-only ones for PRO. */
export function templateAccess(id: string, pack: string | undefined): 'ok' | 'pro' | 'hidden' {
  const s = useAccount.getState();
  const rules = s.config?.templates ?? {};
  const role = s.account?.role ?? 'user';
  if (role === 'admin') return 'ok';
  const list = [rules[id], pack ? rules[`pack:${pack}`] : undefined];
  if (list.some((r) => r?.hidden)) return 'hidden';
  if (list.some((r) => r?.pro) && role !== 'pro') return 'pro';
  return 'ok';
}

/** Client templates: the built-in ones and the bot's template packs (not the user's own imports). */
export function clientTemplates(compiled: Compiled): CompiledEmoji[] {
  useAccount.getState();
  return compiled.emojis.filter((e) => (!e.imported || e.pack) && templateAccess(e.id, e.pack) !== 'hidden');
}

/** The client's photo/logo/text put into the editor as content: everything placed automatically. */
export function useApplyInputs(): void {
  const photo = useInputs((s) => s.photo);
  const logo = useInputs((s) => s.logo);
  const text = useInputs((s) => s.text);
  const textColor = useInputs((s) => s.textColor);
  const fontId = useEditor((s) => s.fontId);
  useEffect(() => {
    let alive = true;
    const outline = luminance(textColor) > 0.45 ? '#111111' : '#ffffff';
    const timer = window.setTimeout(async () => {
      const s = useEditor.getState();
      if (!photo && !logo) {
        s.set('mode', 'text');
        s.set('text', text.trim() ? text : 'EMOJI');
        s.set('textFill', solid(textColor));
        s.set('textOutline', solid(outline));
        return;
      }
      const svg = await buildDesign({
        photo,
        logo,
        text,
        fontId,
        textColor,
        outline,
      });
      if (!alive || !svg) return;
      s.set('logo', { name: 'design.svg', svg });
      s.set('logoColors', 'original');
      s.set('logoOutline', true);
      s.set('mode', 'logo');
    }, 220);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [photo, logo, text, textColor, fontId]);
}

function Tile({ emoji, selected, onPick }: { emoji: CompiledEmoji; selected: boolean; onPick: () => void }) {
  const lang = useEditor((s) => s.lang);
  const ref = useRef<HTMLButtonElement>(null);
  const inView = useInView(ref);
  const poster = usePoster(emoji.json, { frac: 0.45 }, 120, inView);
  const locked = templateAccess(emoji.id, emoji.pack) === 'pro';
  return (
    <button ref={ref} type="button" className={`c-tile${selected ? ' is-selected' : ''}`} aria-pressed={selected} onClick={onPick}>
      <span className="c-tile-img">{poster ? <img src={poster} alt="" draggable={false} /> : <span className="c-tile-ph" />}</span>
      <span className="c-tile-name">{emojiName(emoji.name, lang)}</span>
      {locked && (
        <em className="c-pro-badge">
          <CrownIcon width={11} height={11} /> PRO
        </em>
      )}
      {selected && <CheckIcon className="c-tile-check" width={16} height={16} strokeWidth={3.5} />}
    </button>
  );
}

/** Opens a bot template pack for clients, with the set-up the admin published for it. */
async function openTemplatePack(name: string): Promise<void> {
  const published = await fetchTemplateEdits(name);
  if (published) {
    const s = useEditor.getState();
    useEditor.setState({
      packEdits: {
        ...s.packEdits,
        ...(published.edits as Record<string, PackEdit>),
      },
      layoutSvgs: { ...s.layoutSvgs, ...published.svgs },
    });
  }
  await loadPack(name, false);
}

function TemplatePicker({ templates, onUpsell }: { templates: CompiledEmoji[]; onUpsell: (e: GenerateError) => void }) {
  const t = useCT();
  const template = useInputs((s) => s.template);
  const setInput = useInputs((s) => s.set);
  const botPacks = useUi((u) => u.botPacks);
  const packStatus = useUi((u) => u.packStatus);
  const rules = useAccount((s) => s.config?.templates);
  return (
    <section className="card c-step">
      <h3 className="c-step-title">
        <span className="c-step-n">1</span> {t('stepTemplate')}
      </h3>
      <div className="c-tiles">
        {templates.map((e) => (
          <Tile
            key={e.id}
            emoji={e}
            selected={e.id === template}
            onPick={() => {
              if (templateAccess(e.id, e.pack) === 'pro') return onUpsell({ kind: 'pro', reason: 'template' });
              setInput('template', e.id);
              haptic();
            }}
          />
        ))}
      </div>
      {!!botPacks?.length && (
        <div className="c-more">
          <span className="label">{t('moreTemplates')}</span>
          <div className="row-actions">
            {botPacks
              .filter((p) => !rules?.[`pack:${p.name}`]?.hidden || useAccount.getState().account?.role === 'admin')
              .map((p) => {
                const st = packStatus[p.name];
                const loaded = st?.state === 'ready';
                return (
                  <button
                    key={p.name}
                    type="button"
                    className={`pill-btn is-compact${loaded ? ' is-accent' : ''}`}
                    disabled={st?.state === 'loading' || loaded}
                    onClick={() => openTemplatePack(p.name)}
                  >
                    {st?.state === 'loading' ? (
                      <span className="btn-spinner" aria-hidden />
                    ) : rules?.[`pack:${p.name}`]?.pro ? (
                      <CrownIcon width={14} height={14} />
                    ) : null}
                    {p.title}
                  </button>
                );
              })}
          </div>
        </div>
      )}
    </section>
  );
}

function PictureStep({ kind, n }: { kind: PictureKind; n: number }) {
  const t = useCT();
  const value = useInputs((s) => s[kind]);
  const setInput = useInputs((s) => s.set);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const preview = useMemo(() => (value ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(value)}` : null), [value]);
  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setFailed(false);
    try {
      setInput(kind, await pictureToSvg(file, kind));
      haptic();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };
  return (
    <section className="card c-step">
      <h3 className="c-step-title">
        <span className="c-step-n">{n}</span> {t(kind === 'photo' ? 'stepPhoto' : 'stepLogo')} <em className="c-optional">{t('optional')}</em>
      </h3>
      <input ref={input} type="file" accept={kind === 'logo' ? 'image/*,.svg' : 'image/*'} hidden onChange={(e) => onFile(e.target.files?.[0])} />
      {value && preview ? (
        <div className="c-picture">
          <img src={preview} alt="" className={kind === 'photo' ? 'is-round' : ''} />
          <div className="row-actions">
            <button type="button" className="pill-btn is-compact" disabled={busy} onClick={() => input.current?.click()}>
              {busy ? <span className="btn-spinner" aria-hidden /> : <CameraIcon width={16} height={16} />} {t('replace')}
            </button>
            <button type="button" className="pill-btn is-compact is-danger" onClick={() => setInput(kind, null)}>
              <TrashIcon width={16} height={16} /> {t('remove')}
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="c-upload" disabled={busy} onClick={() => input.current?.click()}>
          <span className="c-upload-icon">
            {busy ? (
              <span className="btn-spinner" aria-hidden />
            ) : kind === 'photo' ? (
              <CameraIcon width={28} height={28} />
            ) : (
              <ImageIcon width={28} height={28} />
            )}
          </span>
          <span>
            <strong>{busy ? t('processing') : t(kind === 'photo' ? 'uploadPhoto' : 'uploadLogo')}</strong>
            <small>{t(kind === 'photo' ? 'uploadHintPhoto' : 'uploadHintLogo')}</small>
          </span>
        </button>
      )}
      {failed && (
        <p className="note is-warn">
          <WarningIcon width={16} height={16} /> {t('pictureFailed')}
        </p>
      )}
    </section>
  );
}

function TextStep({ onUpsell }: { onUpsell: (e: GenerateError) => void }) {
  const t = useCT();
  const text = useInputs((s) => s.text);
  const textColor = useInputs((s) => s.textColor);
  const setInput = useInputs((s) => s.set);
  const fontId = useEditor((s) => s.fontId);
  const pro = useAccount(isPro);
  const options = fontOptions().filter((o) => !o.custom);
  const current = hasFont(fontId) ? fontId : DEFAULT_FONT_ID;
  useEffect(() => options.forEach((o) => registerCssFont(o.id)), [options.length]);
  return (
    <section className="card c-step">
      <h3 className="c-step-title">
        <span className="c-step-n">4</span> {t('stepText')} <em className="c-optional">{t('optional')}</em>
      </h3>
      <input className="c-text-input" value={text} maxLength={40} placeholder={t('textPlaceholder')} onChange={(e) => setInput('text', e.target.value)} />
      <span className="label">{t('textColor')}</span>
      <div className="c-colors">
        {TEXT_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            className={`swatch swatch-md${c === textColor ? ' is-current' : ''}`}
            style={{ background: c }}
            aria-label={c}
            onClick={() => setInput('textColor', c)}
          />
        ))}
      </div>
      <span className="label">{t('font')}</span>
      <div className="c-fonts">
        {options.map((o, i) => {
          const locked = i >= FREE_FONTS && !pro;
          return (
            <button
              key={o.id}
              type="button"
              className={`c-font${o.id === current ? ' is-active' : ''}`}
              style={{ fontFamily: `${o.cssFamily}, inherit` }}
              onClick={() => (locked ? onUpsell({ kind: 'pro', reason: 'font' }) : useEditor.getState().set('fontId', o.id))}
            >
              Aa
              <small>{o.label}</small>
              {locked && <CrownIcon className="c-font-lock" width={12} height={12} />}
            </button>
          );
        })}
      </div>
    </section>
  );
}

const DEFAULT_XF: ContentXf = { scale: 1, offsetX: 0, offsetY: 0, rotation: 0, stretch: 1 };
const sameXf = (a: ContentXf, b: ContentXf) =>
  a.scale === b.scale && a.offsetX === b.offsetX && a.offsetY === b.offsetY && a.rotation === b.rotation && a.stretch === b.stretch;

/**
 * The chosen template with the client's design on it, edited with the fingers right on the figure (the advanced
 * editor's frame): drag to move, two fingers to resize and rotate, corners and edges to stretch.
 */
function DesignCanvas({ emoji, compiled }: { emoji: CompiledEmoji; compiled: Compiled }) {
  const t = useCT();
  const scale = useEditor((s) => s.scale);
  const offsetX = useEditor((s) => s.offsetX);
  const offsetY = useEditor((s) => s.offsetY);
  const rotation = useEditor((s) => s.rotation);
  const stretch = useEditor((s) => s.stretch);
  const setTransform = useEditor((s) => s.setTransform);
  const ratioLock = useUi((u) => u.ratioLock);
  const setRatioLock = useUi((u) => u.setRatioLock);
  const stage = useRef<HTMLDivElement>(null);
  const frame = useRef(0);
  const pendingXf = useRef<ContentXf | null>(null);
  const [live, setLive] = useState<ContentXf | null>(null);
  const [editing, setEditing] = useState(false);
  const stored = useMemo(() => ({ scale, offsetX, offsetY, rotation, stretch }), [scale, offsetX, offsetY, rotation, stretch]);
  const xf = live ?? stored;
  // While dragging only this animation is rebuilt, once per frame; then the full compile takes over.
  const liveJson = useMemo(() => (live ? compileOne({ ...compiled.input, ...live }, emoji.id) : null), [live, compiled.input, emoji.id]);
  useEffect(() => {
    if (live && !editing && !compiled.pending && sameXf(live, stored)) setLive(null);
  }, [live, editing, compiled.pending, stored]);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  const onLive = useCallback((next: ContentXf) => {
    pendingXf.current = next;
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      if (pendingXf.current) setLive(pendingXf.current);
    });
  }, []);
  const onCommit = (next: ContentXf) => {
    setLive(next);
    setTransform(next);
  };
  const moved = !sameXf(xf, DEFAULT_XF);
  return (
    <>
      <div className="c-stage" ref={stage}>
        <LottieView json={liveJson ?? emoji.preview ?? emoji.json} playing={!editing} className="c-preview-anim" label={t('preview')} />
        <CanvasEditor
          stage={stage}
          target={CONTENT_CLASS}
          value={xf}
          onLive={onLive}
          onCommit={onCommit}
          onActive={setEditing}
          locked={ratioLock}
          onToggleLock={() => {
            setRatioLock(!ratioLock);
            haptic();
          }}
        />
      </div>
      {moved && (
        <button type="button" className="pill-btn is-compact is-pop-in" onClick={() => onCommit(DEFAULT_XF)}>
          <ResetIcon width={14} height={14} /> {t('resetTweaks')}
        </button>
      )}
    </>
  );
}

function Tweaks() {
  const t = useCT();
  const scale = useEditor((s) => s.scale);
  const offsetY = useEditor((s) => s.offsetY);
  const presetId = useEditor((s) => s.presetId);
  const set = useEditor((s) => s.set);
  const applyPreset = useEditor((s) => s.applyPreset);
  const pro = useAccount(isPro);
  const [open, setOpen] = useState(false);
  return (
    <details className="c-tweaks" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>{t('tweaks')}</summary>
      <div className="slider-grid">
        <Slider
          label={t('size')}
          value={scale}
          min={0.2}
          max={2}
          step={0.05}
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={(v) => set('scale', v)}
          onReset={() => set('scale', 1)}
        />
        <Slider label={t('position')} value={offsetY} min={-120} max={120} step={1} onChange={(v) => set('offsetY', v)} onReset={() => set('offsetY', 0)} />
      </div>
      <span className="label">{t('colors')}</span>
      <div className="c-presets">
        {PRESETS.map((p) => {
          const fancy = [p.colors.body, p.colors.outline, p.colors.accent].some((c) => c.type !== 'solid');
          return (
            <button
              key={p.id}
              type="button"
              className={`chip-btn${p.id === presetId ? ' is-active' : ''}`}
              disabled={fancy && !pro}
              onClick={() => applyPreset(p)}
            >
              {fancy && !pro && <CrownIcon width={12} height={12} />} {p.name}
            </button>
          );
        })}
      </div>
      <button type="button" className="link-btn" onClick={() => useEditor.getState().setTransform(DEFAULT_XF)}>
        <ResetIcon width={14} height={14} /> {t('resetTweaks')}
      </button>
    </details>
  );
}

export function CreateScreen({ compiled }: { compiled: Compiled }) {
  const t = useCT();
  const templates = clientTemplates(compiled);
  const template = useInputs((s) => s.template);
  const all = useInputs((s) => s.all);
  const setInput = useInputs((s) => s.set);
  const inputs = useInputs();
  const pro = useAccount(isPro);
  const config = useAccount((s) => s.config);
  const status = useAccount((s) => s.status);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<StoredResult | null>(null);
  const [problem, setProblem] = useState<GenerateError | null>(null);
  const go = useNav((n) => n.go);

  // The chosen template (or the first one, if it went away) is the one shown.
  const chosen = templates.find((e) => e.id === template) ?? templates.find((e) => templateAccess(e.id, e.pack) === 'ok');
  useEffect(() => {
    if (!chosen) return;
    const s = useEditor.getState();
    if (s.active !== chosen.id) s.set('active', chosen.id);
    const want = all && pro ? templates.filter((e) => templateAccess(e.id, e.pack) === 'ok').map((e) => e.id) : [chosen.id];
    if (want.join() !== s.selected.join()) s.set('selected', want);
  }, [chosen?.id, all, pro, templates.length]);

  const targets = all && pro ? templates.filter((e) => templateAccess(e.id, e.pack) === 'ok') : chosen ? [chosen] : [];
  const empty = !inputs.photo && !inputs.logo && !inputs.text.trim();
  const tooBig = targets.some((e) => !e.check.ok);
  const cost = (config?.cost ?? 1) * targets.length;
  const free = status === 'free' || status === 'off' || useAccount.getState().account?.role === 'admin';

  const run = async () => {
    if (busy || empty || !targets.length) return;
    setBusy(true);
    setProblem(null);
    const title = inputs.text.trim() || 'Emoji';
    const res = await generate(targets, title);
    setBusy(false);
    if (res.ok) {
      haptic();
      setResult(res.result);
    } else setProblem(res.error);
  };

  return (
    <>
      <div className="page c-create">
        <section className="card c-preview">
          {chosen && !empty ? (
            <DesignCanvas emoji={chosen} compiled={compiled} />
          ) : chosen ? (
            <LottieView json={chosen.json} className="c-preview-anim" label={t('preview')} />
          ) : (
            <div className="c-preview-anim" />
          )}
          <p className="hint">{empty ? t('emptyDesign') : t('autoNote')}</p>
          {tooBig && (
            <p className="note is-warn">
              <WarningIcon width={16} height={16} /> {t('tooBig')}
            </p>
          )}
          <Tweaks />
        </section>
        <TemplatePicker templates={templates} onUpsell={setProblem} />
        <PictureStep kind="photo" n={2} />
        <PictureStep kind="logo" n={3} />
        <TextStep onUpsell={setProblem} />
        {(problem?.kind === 'failed' || problem?.kind === 'template') && (
          <p className="note is-error" role="alert">
            <WarningIcon width={16} height={16} /> {t(problem.kind === 'failed' ? 'genFailed' : 'templateGone')}
          </p>
        )}
      </div>
      {/* Outside the page: its entrance animation would make "fixed" relative to it. */}
      <div className="bottom-bar c-bottom">
        {templates.length > 1 && (
          <button
            type="button"
            className={`chip-btn c-all${all && pro ? ' is-active' : ''}`}
            title={t('allTemplates', { n: templates.filter((e) => templateAccess(e.id, e.pack) === 'ok').length })}
            onClick={() => (pro ? setInput('all', !all) : setProblem({ kind: 'pro', reason: 'batch' }))}
          >
            {!pro ? <CrownIcon width={14} height={14} /> : <TypeIcon width={14} height={14} />}{' '}
            {t('allShort', {
              n: templates.filter((e) => templateAccess(e.id, e.pack) === 'ok').length,
            })}
          </button>
        )}
        <button type="button" className="primary-btn" disabled={busy || empty || tooBig || !targets.length} onClick={run}>
          {busy ? <span className="btn-spinner" aria-hidden /> : null}
          {busy ? t('generating') : `${t('generate')}${free ? '' : ` · ${t('costLabel', { n: cost })}`}`}
        </button>
      </div>
      {result && (
        <ResultSheet
          result={result}
          onClose={() => setResult(null)}
          onAnother={() => {
            setResult(null);
            go('create');
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
        />
      )}
      {problem && problem.kind !== 'failed' && problem.kind !== 'template' && <UpsellSheet problem={problem} onClose={() => setProblem(null)} />}
    </>
  );
}
