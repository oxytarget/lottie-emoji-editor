import { useEffect, useMemo, useRef, useState } from 'react';
import type { I18nKey } from '../i18n';
import { recolor } from '../lottie/imported';
import { flattenParts, isolatePart, listParts, partFrame, type Part, type PartKind } from '../lottie/parts';
import type { LottieAnimation } from '../lottie/types';
import { useEditor, type ImportedTemplate } from '../state/store';
import { useT } from '../state/useT';
import { ChevronIcon, EyeIcon, EyeOffIcon, ReplaceIcon, ResetIcon, WarningIcon } from './icons';
import { MotionButton } from './controls';
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

interface RowProps {
  part: Part;
  depth: number;
  anim: LottieAnimation;
  imp: ImportedTemplate;
  expanded: Set<string>;
  toggleExpanded(id: string): void;
  toggleHidden(id: string): void;
  toggleReplace(id: string): void;
}

function PartRow({ part, depth, anim, imp, expanded, toggleExpanded, toggleHidden, toggleReplace }: RowProps) {
  const t = useT();
  const hiddenSelf = imp.hidden.includes(part.id);
  const hiddenByParent = imp.hidden.some((h) => isAncestor(h, part.id));
  const replaced = imp.replace === part.id;
  const open = expanded.has(part.id);
  return (
    <>
      <li
        className={`part-row${hiddenSelf || hiddenByParent ? ' is-hidden' : ''}${replaced ? ' is-replaced' : ''}`}
        style={{ '--depth': depth } as React.CSSProperties}
      >
        {part.children.length ? (
          <button type="button" className="part-expand" aria-expanded={open} aria-label={part.name} onClick={() => toggleExpanded(part.id)}>
            <ChevronIcon width={16} height={16} className={open ? '' : 'is-collapsed'} />
          </button>
        ) : (
          <span className="part-expand" aria-hidden />
        )}
        <PartThumb anim={anim} id={part.id} />
        <div className="part-name">
          <strong title={part.name}>{part.name}</strong>
          <span className="hint">
            {t(KIND_KEYS[part.kind])}
            {part.detected && !replaced && <em className="part-badge">{t('partsBadge')}</em>}
            {replaced && <em className="part-badge is-accent">{t('partsYours')}</em>}
          </span>
        </div>
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
      {open &&
        part.children.map((child) => (
          <PartRow
            key={child.id}
            part={child}
            depth={depth + 1}
            anim={anim}
            imp={imp}
            expanded={expanded}
            toggleExpanded={toggleExpanded}
            toggleHidden={toggleHidden}
            toggleReplace={toggleReplace}
          />
        ))}
    </>
  );
}

/** Lets the user hide parts of an imported animation or swap its text/logo for their own. */
export function PartsPanel({ imp }: { imp: ImportedTemplate }) {
  const t = useT();
  const update = useEditor((s) => s.updateImport);
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

  const toggleHidden = (id: string) => {
    const hidden = imp.hidden.includes(id) ? imp.hidden.filter((h) => h !== id) : [...imp.hidden, id];
    update(imp.id, { hidden, replace: imp.replace === id ? null : imp.replace });
  };
  const toggleReplace = (id: string) => {
    if (imp.replace === id) return update(imp.id, { replace: null });
    // The replaced part and everything around it must stay visible.
    update(imp.id, { replace: id, hidden: imp.hidden.filter((h) => h !== id && !isAncestor(h, id)) });
  };

  const noContent = !!imp.replace && (mode === 'logo' ? !logo : !text.trim());

  return (
    <div className="parts-panel">
      <div className="subcard-head">
        <h3 className="section-title">{t('partsTitle')}</h3>
        {(imp.hidden.length > 0 || imp.replace) && (
          <button type="button" className="pill-btn is-compact" onClick={() => update(imp.id, { hidden: [], replace: null })}>
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
      <ul className="parts-list">
        {parts.map((p) => (
          <PartRow
            key={p.id}
            part={p}
            depth={0}
            anim={anim}
            imp={imp}
            expanded={expanded}
            toggleExpanded={toggleExpanded}
            toggleHidden={toggleHidden}
            toggleReplace={toggleReplace}
          />
        ))}
      </ul>
    </div>
  );
}
