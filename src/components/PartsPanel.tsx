import { useEffect, useMemo, useRef, useState } from 'react';
import type { I18nKey } from '../i18n';
import { recolor } from '../lottie/imported';
import { flattenParts, isIdentityXf, isolatePart, listParts, NO_XF, partFrame, partSvg, type Part, type PartKind, type PartXf } from '../lottie/parts';
import type { LottieAnimation } from '../lottie/types';
import { useEditor, type ImportedTemplate } from '../state/store';
import { editImport, useUi } from '../state/ui';
import { useT } from '../state/useT';
import { CheckIcon, ChevronIcon, EyeIcon, EyeOffIcon, GrabIcon, GripIcon, ReplaceIcon, ResetIcon, StarIcon, TrashIcon, WarningIcon } from './icons';
import { applyLayerOp, DragGhost, FavLogoStrip, useLayerDnd, type DragSource } from './LayerDnd';
import { checkOp, INSERTED, parentOf, type Drop } from '../lottie/layout';
import { MotionButton, Slider } from './controls';
import { LottieView, useInView } from './LottieView';

const KIND_KEYS: Record<PartKind, I18nKey> = {
  shape: 'partShape',
  precomp: 'partPrecomp',
  null: 'partNull',
  image: 'partImage',
  text: 'partText',
  solid: 'partSolid',
  group: 'partGroup',
  other: 'partOther',
};

/** `a` is an ancestor of `b` in the part tree. */
const isAncestor = (a: string, b: string) => b.startsWith(`${a}/`) || b.startsWith(`${a}>`);

/** Static preview of one part on its own (computed only once the row scrolls into view). */
function PartThumb({ anim, id }: { anim: LottieAnimation; id: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    if (inView) setSeen(true);
  }, [inView]);
  const json = useMemo(() => (seen ? JSON.stringify(isolatePart(anim, id, true)) : null), [seen, anim, id]);
  const frame = useMemo(() => partFrame(anim, id), [anim, id]);
  return (
    <div ref={ref} className="part-thumb" aria-hidden>
      {json && <LottieView json={json} playing={false} frame={frame} className="part-thumb-anim" />}
    </div>
  );
}

/** Colours used by an SVG (fills, strokes, gradient stops). */
const svgColors = (svg: string) => [...new Set([...svg.matchAll(/(?:fill|stroke|stop-color)="(#[0-9a-f]{6})"/gi)].map((m) => m[1].toLowerCase()))];

type FavStatus = { kind: 'logo'; logo: { name: string; svg: string } } | { kind: 'colors'; n: number } | { kind: 'fail' | 'too-big' } | null;

/** Keep a part as a logo (SVG) or its colours in Favourites. */
function PartFavorites({ anim, part }: { anim: LottieAnimation; part: Part }) {
  const t = useT();
  const addFavLogo = useEditor((s) => s.addFavLogo);
  const addFavColors = useEditor((s) => s.addFavColors);
  const useLogo = useEditor((s) => s.useLogo);
  const [status, setStatus] = useState<FavStatus>(null);
  useEffect(() => setStatus(null), [part.id]);

  const saveLogo = () => {
    const svg = partSvg(anim, part.id);
    if (!svg) return setStatus({ kind: 'fail' });
    const logo = addFavLogo({ name: part.name, svg });
    setStatus(logo ? { kind: 'logo', logo } : { kind: 'too-big' });
  };
  const saveColors = () => {
    const svg = partSvg(anim, part.id);
    if (!svg) return setStatus({ kind: 'fail' });
    setStatus({ kind: 'colors', n: addFavColors(svgColors(svg)) });
  };

  return (
    <>
      <div className="row-actions">
        <MotionButton motion="twinkle" className="pill-btn is-compact" icon={<StarIcon width={16} height={16} />} label={t('favLogoAdd')} onClick={saveLogo}>
          {t('favLogoAdd')}
        </MotionButton>
        <MotionButton motion="twinkle" className="pill-btn is-compact" icon={<StarIcon width={16} height={16} />} label={t('favPartColors')} onClick={saveColors}>
          {t('favPartColors')}
        </MotionButton>
      </div>
      {status?.kind === 'logo' && (
        <div className="fav-status" role="status">
          <CheckIcon width={14} height={14} strokeWidth={3} /> <span>{t('favLogoSaved')}</span>
          <button type="button" className="link-btn" onClick={() => useLogo(status.logo)}>
            {t('favLogoUse')}
          </button>
        </div>
      )}
      {status?.kind === 'colors' && (
        <p className="fav-status" role="status">
          <CheckIcon width={14} height={14} strokeWidth={3} /> {t('favColorsAdded').replace('{n}', String(status.n))}
        </p>
      )}
      {(status?.kind === 'fail' || status?.kind === 'too-big') && (
        <p className="note is-warn">
          <WarningIcon width={16} height={16} /> {t(status.kind === 'fail' ? 'favLogoFail' : 'favLogoTooBig')}
        </p>
      )}
    </>
  );
}

/** Up / down among its siblings, out of its group, and removing a logo inserted from Favourites. */
function LayerMoves({ imp, part, flat }: { imp: ImportedTemplate; part: Part; flat: readonly Part[] }) {
  const t = useT();
  const here = parentOf(part.id);
  const siblings = flat.filter((p) => parentOf(p.id).parent === here.parent);
  const at = siblings.findIndex((p) => p.id === part.id);
  const prev = siblings[at - 1];
  const next = siblings[at + 1];
  const move = (drop: Drop | null) => {
    if (!drop) return;
    applyLayerOp(imp, { kind: 'move', part: part.id, at: drop });
  };
  const upDrop = prev ? { parent: here.parent, index: parentOf(prev.id).index } : null;
  const downDrop = next ? { parent: here.parent, index: parentOf(next.id).index + 1 } : null;
  const outDrop = here.parent ? { parent: parentOf(here.parent).parent, index: parentOf(here.parent).index } : null;
  const ok = (drop: Drop | null) => !!drop && !checkOp(imp.data, { kind: 'move', part: part.id, at: drop });
  return (
    <div className="row-actions layer-moves">
      <button type="button" className="pill-btn is-compact" disabled={!ok(upDrop)} onClick={() => move(upDrop)}>
        ↑ {t('layerUp')}
      </button>
      <button type="button" className="pill-btn is-compact" disabled={!ok(downDrop)} onClick={() => move(downDrop)}>
        ↓ {t('layerDown')}
      </button>
      {outDrop && (
        <button type="button" className="pill-btn is-compact" disabled={!ok(outDrop)} onClick={() => move(outDrop)}>
          ⤴ {t('layerOut')}
        </button>
      )}
      {part.name.startsWith(INSERTED) && (
        <MotionButton motion="wiggle" className="pill-btn is-compact is-danger" icon={<TrashIcon width={16} height={16} />} label={t('layerRemove')} onClick={() => applyLayerOp(imp, { kind: 'remove', part: part.id })}>
          {t('layerRemove')}
        </MotionButton>
      )}
    </div>
  );
}

/** Sliders for a grabbed part — the same move/size/rotation as dragging it on the canvas. */
function PartControls({ imp, part, anim, flat }: { imp: ImportedTemplate; part: Part; anim: LottieAnimation; flat: readonly Part[] }) {
  const t = useT();
  const xf = imp.transforms[part.id] ?? NO_XF;
  const set = (patch: Partial<PartXf>) => editImport(imp.id, { kind: 'transform', part: part.id, xf: { ...xf, ...patch } });
  const reset = () => editImport(imp.id, { kind: 'transform', part: part.id, xf: null });
  return (
    <li className="part-controls" style={{ '--depth': 0 } as React.CSSProperties}>
      <div className="slider-grid">
        <Slider label={t('partX')} value={Math.round(xf.x)} min={-256} max={256} step={1} onChange={(x) => set({ x })} onReset={() => set({ x: 0 })} />
        <Slider label={t('partY')} value={Math.round(xf.y)} min={-256} max={256} step={1} onChange={(y) => set({ y })} onReset={() => set({ y: 0 })} />
        <Slider
          label={t('partSize')}
          value={Math.round(xf.scale * 100)}
          min={20}
          max={300}
          step={1}
          format={(v) => `${v}%`}
          onChange={(v) => set({ scale: v / 100 })}
          onReset={() => set({ scale: 1 })}
        />
        <Slider
          label={t('partRotation')}
          value={Math.round(xf.rotation)}
          min={-180}
          max={180}
          step={1}
          format={(v) => `${v}°`}
          onChange={(rotation) => set({ rotation })}
          onReset={() => set({ rotation: 0 })}
        />
      </div>
      {!isIdentityXf(xf) && (
        <MotionButton motion="spin-back" className="pill-btn is-compact is-pop-in" icon={<ResetIcon width={16} height={16} />} label={t('canvasReset')} onClick={reset}>
          {t('canvasReset')}
        </MotionButton>
      )}
      <LayerMoves imp={imp} part={part} flat={flat} />
      <PartFavorites anim={anim} part={part} />
    </li>
  );
}

interface RowProps {
  part: Part;
  depth: number;
  anim: LottieAnimation;
  imp: ImportedTemplate;
  expanded: Set<string>;
  grabbed: string | null;
  flat: readonly Part[];
  /** Drop indicator for a row while something is dragged ("before", "inside-invalid", …). */
  dropState(id: string): string | undefined;
  startDrag(source: DragSource, e: React.PointerEvent): void;
  toggleExpanded(id: string): void;
  toggleHidden(id: string): void;
  toggleReplace(id: string): void;
  toggleGrab(id: string): void;
}

function PartRow(props: RowProps) {
  const { part, depth, anim, imp, expanded, grabbed, flat, dropState, startDrag, toggleExpanded, toggleHidden, toggleReplace, toggleGrab } = props;
  const t = useT();
  const hiddenSelf = imp.hidden.includes(part.id);
  const hiddenByParent = imp.hidden.some((h) => isAncestor(h, part.id));
  const replaced = imp.replace === part.id;
  const isGrabbed = grabbed === part.id;
  const moved = !isIdentityXf(imp.transforms[part.id]);
  const open = expanded.has(part.id);
  return (
    <>
      <li
        className={`part-row${hiddenSelf || hiddenByParent ? ' is-hidden' : ''}${replaced ? ' is-replaced' : ''}${isGrabbed ? ' is-grabbed' : ''}`}
        style={{ '--depth': depth } as React.CSSProperties}
        data-part={part.id}
        data-drop={dropState(part.id)}
      >
        <span className="part-grip" title={t('layerDrag')} aria-hidden onPointerDown={(e) => startDrag({ kind: 'part', part }, e)}>
          <GripIcon width={16} height={16} />
        </span>
        {part.children.length ? (
          <button type="button" className="part-expand" aria-expanded={open} aria-label={part.name} onClick={() => toggleExpanded(part.id)}>
            <ChevronIcon width={16} height={16} className={open ? '' : 'is-collapsed'} />
          </button>
        ) : (
          <span className="part-expand" aria-hidden />
        )}
        <button
          type="button"
          className="part-main"
          aria-pressed={isGrabbed}
          title={t('partsGrab')}
          aria-label={`${t('partsGrab')}: ${part.name}`}
          onClick={() => toggleGrab(part.id)}
        >
          <PartThumb anim={anim} id={part.id} />
          <span className="part-name">
            <strong title={part.name}>{part.name}</strong>
            <span className="hint">
              {t(KIND_KEYS[part.kind])}
              {part.detected && !replaced && <em className="part-badge">{t('partsBadge')}</em>}
              {replaced && <em className="part-badge is-accent">{t('partsYours')}</em>}
              {moved && <GrabIcon width={12} height={12} className="part-moved" />}
            </span>
          </span>
        </button>
        {part.replaceable && (
          <MotionButton
            motion="swap"
            className={`icon-btn is-small${replaced ? ' is-accent' : ''}`}
            pressed={replaced}
            title={t('partsReplace')}
            label={`${t('partsReplace')}: ${part.name}`}
            icon={<ReplaceIcon width={18} height={18} />}
            onClick={() => toggleReplace(part.id)}
          />
        )}
        <MotionButton
          motion="blink"
          className="icon-btn is-small"
          pressed={hiddenSelf}
          disabled={hiddenByParent}
          title={hiddenSelf ? t('partsShow') : t('partsHide')}
          label={`${hiddenSelf ? t('partsShow') : t('partsHide')}: ${part.name}`}
          icon={hiddenSelf ? <EyeOffIcon width={18} height={18} /> : <EyeIcon width={18} height={18} />}
          onClick={() => toggleHidden(part.id)}
        />
      </li>
      {isGrabbed && <PartControls imp={imp} part={part} anim={anim} flat={flat} />}
      {open && part.children.map((child) => <PartRow key={child.id} {...props} part={child} depth={depth + 1} />)}
    </>
  );
}

/** Lets the user hide parts of an imported animation or swap its text/logo for their own. */
export function PartsPanel({ imp }: { imp: ImportedTemplate }) {
  const t = useT();
  const mode = useEditor((s) => s.mode);
  const text = useEditor((s) => s.text);
  const logo = useEditor((s) => s.logo);

  const anim = useMemo(() => recolor(imp.data, imp.colorMap), [imp.data, imp.colorMap]);
  const parts = useMemo(() => listParts(imp.data), [imp.data]);
  const flat = useMemo(() => flattenParts(parts), [parts]);
  const detected = flat.filter((p) => p.detected && p.replaceable);
  const suggestion = !imp.replace && detected.length ? detected[0] : null;

  // Open the branches that contain a detected part so the user sees it right away.
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(flat.filter((p) => p.children.length && detected.some((d) => isAncestor(p.id, d.id))).map((p) => p.id)),
  );
  const toggleExpanded = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleHidden = (id: string) => editImport(imp.id, { kind: 'hide', part: id, hidden: !imp.hidden.includes(id) });
  const toggleReplace = (id: string) => editImport(imp.id, { kind: 'replace', part: imp.replace === id ? null : id });

  const grab = useUi((u) => u.grab);
  const setGrab = useUi((u) => u.setGrab);
  const grabbed = grab?.id === imp.id ? grab.part : null;
  const toggleGrab = (id: string) => setGrab(grabbed === id ? null : { id: imp.id, part: id });
  const listRef = useRef<HTMLUListElement>(null);
  const dnd = useLayerDnd({ imp, parts: flat, listRef });

  // A part grabbed on the canvas: open its branch and bring its row into view.
  useEffect(() => {
    if (!grabbed) return;
    const ancestors = flat.filter((p) => isAncestor(p.id, grabbed)).map((p) => p.id);
    setExpanded((prev) => (ancestors.every((a) => prev.has(a)) ? prev : new Set([...prev, ...ancestors])));
  }, [grabbed, flat]);
  useEffect(() => {
    const row = grabbed ? listRef.current?.querySelector<HTMLElement>(`[data-part="${CSS.escape(grabbed)}"]`) : null;
    row?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [grabbed, expanded]);

  const edited = imp.hidden.length > 0 || !!imp.replace || Object.keys(imp.transforms).length > 0;
  const atDefaults =
    !!imp.defaults &&
    Object.keys(imp.transforms).length === 0 &&
    imp.replace === imp.defaults.replace &&
    imp.hidden.length === imp.defaults.hidden.length &&
    imp.hidden.every((h) => imp.defaults!.hidden.includes(h));
  const resetParts = () => editImport(imp.id, { kind: 'partsReset' });

  const noContent = !!imp.replace && (mode === 'logo' ? !logo : !text.trim());

  return (
    <div className="parts-panel">
      <div className="subcard-head">
        <h3 className="section-title">{t('partsTitle')}</h3>
        {edited && !atDefaults && (
          <button type="button" className="pill-btn is-compact" onClick={resetParts}>
            <ResetIcon width={16} height={16} /> {t('partsReset')}
          </button>
        )}
      </div>

      {suggestion && (
        <div className="part-suggest">
          <span>
            {t('partsDetected')} <strong>«{suggestion.name}»</strong>
          </span>
          <div className="row-actions">
            <button type="button" className="pill-btn is-compact is-accent" onClick={() => toggleReplace(suggestion.id)}>
              <ReplaceIcon width={16} height={16} /> {t('partsReplace')}
            </button>
            <button type="button" className="pill-btn is-compact" onClick={() => toggleHidden(suggestion.id)}>
              <EyeOffIcon width={16} height={16} /> {t('partsRemove')}
            </button>
          </div>
        </div>
      )}

      {noContent && (
        <p className="note is-warn">
          <WarningIcon width={16} height={16} /> {t('partsNoContent')}
        </p>
      )}

      <p className="hint">{t('partsHint')}</p>
      <FavLogoStrip imp={imp} onStart={dnd.start} />
      <ul className="parts-list" ref={listRef} data-drop-end={dnd.dropState('') ?? undefined}>
        {parts.map((p) => (
          <PartRow
            key={p.id}
            part={p}
            depth={0}
            anim={anim}
            imp={imp}
            expanded={expanded}
            grabbed={grabbed}
            flat={flat}
            dropState={dnd.dropState}
            startDrag={dnd.start}
            toggleExpanded={toggleExpanded}
            toggleHidden={toggleHidden}
            toggleReplace={toggleReplace}
            toggleGrab={toggleGrab}
          />
        ))}
      </ul>
      <DragGhost drag={dnd.drag} />
    </div>
  );
}
