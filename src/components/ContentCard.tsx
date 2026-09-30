import { useEffect, useMemo, useRef, useState } from 'react';
import { addCustomFont, fontOptions, hasFont, registerCssFont, DEFAULT_FONT_ID } from '../content/fonts';
import { MAX_SVG_BYTES, svgToArt, type SvgImportResult, type SvgWarning } from '../content/svg';
import type { I18nKey } from '../i18n';
import { useEditor } from '../state/store';
import { useT } from '../state/useT';
import { DiceButton, GradientTools, MotionButton, PaintSwatches, Segmented, Slider, Toggle } from './controls';
import { usePresence } from './motion';
import { ChevronIcon, CloseIcon, ImageIcon, SlidersIcon, StarIcon, TrashIcon, TypeIcon, UploadIcon, WarningIcon } from './icons';

const WARNING_KEYS: Record<SvgWarning, I18nKey> = {
  text: 'warnText',
  image: 'warnImage',
  clip: 'warnClip',
  mask: 'warnMask',
  filter: 'warnFilter',
  pattern: 'warnPattern',
  complex: 'warnComplex',
};

const ERROR_KEYS: Record<NonNullable<SvgImportResult['error']>, I18nKey> = {
  parse: 'errParse',
  empty: 'errEmpty',
  'too-large': 'errTooLarge',
};

function FontPicker() {
  const t = useT();
  const fontId = useEditor((s) => s.fontId);
  const set = useEditor((s) => s.set);
  const [open, setOpen] = useState(false);
  const menu = usePresence(open, 180);
  const [error, setError] = useState(false);
  const [, forceUpdate] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const options = fontOptions();
  const currentId = hasFont(fontId) ? fontId : DEFAULT_FONT_ID;
  const current = options.find((o) => o.id === currentId) ?? options[0];

  useEffect(() => registerCssFont(current.id), [current.id]);
  useEffect(() => {
    if (!open) return;
    fontOptions().forEach((o) => registerCssFont(o.id));
    const onDown = (e: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError(false);
    try {
      const id = await addCustomFont(file);
      registerCssFont(id);
      set('fontId', id);
      forceUpdate((n) => n + 1);
      setOpen(false);
    } catch {
      setError(true);
    }
  };

  return (
    <div className="font-picker" ref={wrap}>
      <button type="button" className="font-trigger" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="font-aa">Aa</span>
        <span className="font-name" style={{ fontFamily: `${current.cssFamily}, inherit` }}>
          {current.label}
        </span>
        <ChevronIcon width={20} height={20} className={open ? 'is-flipped' : ''} />
      </button>
      {menu.mounted && (
        <div className="font-menu" role="listbox" aria-label={t('fontDefault')} data-state={menu.state}>
          {options.map((o, i) => (
            <button
              key={o.id}
              type="button"
              role="option"
              aria-selected={o.id === current.id}
              className={o.id === current.id ? 'is-active' : ''}
              style={{ fontFamily: `${o.cssFamily}, inherit`, '--i': i } as React.CSSProperties}
              onClick={() => {
                set('fontId', o.id);
                setOpen(false);
              }}
            >
              {o.label} <span className="font-sample">Ab Жж</span>
            </button>
          ))}
          <button type="button" className="font-upload" onClick={() => fileRef.current?.click()}>
            <UploadIcon width={18} height={18} /> {t('fontUpload')}
          </button>
        </div>
      )}
      <input ref={fileRef} type="file" hidden accept=".ttf,.otf,.woff,font/ttf,font/otf,font/woff" onChange={(e) => onFile(e.target.files?.[0])} />
      {error && <p className="note is-error">{t('fontError')}</p>}
    </div>
  );
}

function StyleSettings({ fill }: { fill: boolean }) {
  const t = useT();
  const s = useEditor();
  const [open, setOpen] = useState(false);
  const isText = s.mode === 'text';
  return (
    <div className={`collapsible${open ? ' is-open' : ''}`}>
      <button type="button" className="collapsible-head" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <SlidersIcon />
        <span>{t('styleSettings')}</span>
        <ChevronIcon className={open ? 'is-flipped' : ''} />
      </button>
      {/* Always rendered: height animates via grid rows; `inert` keeps the closed body out of tab order. */}
      <div className="collapsible-anim" inert={!open}>
        <div className="collapsible-clip">
        <div className="collapsible-body">
          {fill && (
            <div className="paint-line">
              <span className="label">{t('fill')}</span>
              <GradientTools paint={s.textFill} onChange={(p) => s.set('textFill', p)} compact />
            </div>
          )}
          <Slider label={t('outlineWidth')} value={s.textOutlineWidth} min={0} max={20} step={1} onChange={(v) => s.set('textOutlineWidth', v)} onReset={() => s.set('textOutlineWidth', 8)} />
          {isText && (
            <>
              <Slider
                label={t('letterSpacing')}
                value={s.letterSpacing}
                min={-0.1}
                max={0.4}
                step={0.01}
                format={(v) => v.toFixed(2)}
                onChange={(v) => s.set('letterSpacing', v)}
                onReset={() => s.set('letterSpacing', 0)}
              />
              <Slider
                label={t('lineHeight')}
                value={s.lineHeight}
                min={0.7}
                max={1.6}
                step={0.05}
                format={(v) => v.toFixed(2)}
                onChange={(v) => s.set('lineHeight', v)}
                onReset={() => s.set('lineHeight', 1.05)}
              />
              <Toggle label={t('uppercase')} checked={s.uppercase} onChange={(v) => s.set('uppercase', v)} />
            </>
          )}
        </div>
        </div>
      </div>
    </div>
  );
}

function TextColors({ fill, outline }: { fill: boolean; outline: boolean }) {
  const t = useT();
  const s = useEditor();
  return (
    <div className="color-chips">
      {fill && (
        <div className="color-chip">
          <PaintSwatches paint={s.textFill} label={t('fill')} onChange={(p) => s.set('textFill', p)} />
          <span className="label">{t('fill')}</span>
        </div>
      )}
      {outline && (
        <div className="color-chip">
          <PaintSwatches paint={s.textOutline} label={t('outline')} onChange={(p) => s.set('textOutline', p)} />
          <span className="label">{t('outline')}</span>
        </div>
      )}
      <DiceButton label={t('randomColors')} onRoll={s.randomizeText} />
    </div>
  );
}

function TextEditor({ missing, fontLoading }: { missing: string[]; fontLoading: boolean }) {
  const t = useT();
  const text = useEditor((s) => s.text);
  const set = useEditor((s) => s.set);
  const rows = Math.min(3, Math.max(1, text.split('\n').length));
  return (
    <>
      <div className="text-field">
        <textarea
          value={text}
          rows={rows}
          maxLength={60}
          placeholder={t('textPlaceholder')}
          aria-label={t('textPlaceholder')}
          spellCheck={false}
          onChange={(e) => set('text', e.target.value.split('\n').slice(0, 3).join('\n'))}
        />
      </div>
      <p className="hint">{fontLoading ? t('fontLoading') : t('textHint')}</p>
      {missing.length > 0 && (
        <p className="note is-warn">
          <WarningIcon width={16} height={16} /> {t('missingChars')} {missing.join(' ')}
        </p>
      )}
      <FontPicker />
    </>
  );
}

const svgUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

/** Saved logos: tap to use (previews are <img>, so nothing inside an SVG can run). */
function FavLogos() {
  const t = useT();
  const favs = useEditor((s) => s.favLogos);
  const logo = useEditor((s) => s.logo);
  const useLogo = useEditor((s) => s.useLogo);
  const remove = useEditor((s) => s.removeFavLogo);
  return (
    <div className="fav-logos">
      <span className="label">
        <StarIcon width={14} height={14} filled /> {t('favorites')}
      </span>
      {favs.length === 0 ? (
        <p className="hint">{t('favLogosEmpty')}</p>
      ) : (
        <div className="fav-logo-grid">
          {favs.map((f, i) => (
            <div key={f.id} className={`fav-logo${logo?.svg === f.svg ? ' is-active' : ''}`} style={{ '--i': i } as React.CSSProperties}>
              <button type="button" className="fav-logo-main" title={f.name} aria-label={`${t('favLogoUse')}: ${f.name}`} onClick={() => useLogo(f)}>
                <img src={svgUrl(f.svg)} alt="" />
                <span>{f.name}</span>
              </button>
              <button type="button" className="fav-logo-remove" aria-label={`${t('favLogoRemove')}: ${f.name}`} title={t('favLogoRemove')} onClick={() => remove(f.id)}>
                <CloseIcon width={12} height={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LogoEditor({ result }: { result: SvgImportResult | null }) {
  const t = useT();
  const s = useEditor();
  const [error, setError] = useState<I18nKey | null>(null);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const favLogo = s.logo ? s.favLogos.find((f) => f.svg === s.logo!.svg) : undefined;

  // Preview through <img> so scripts inside the SVG can never run (a data URL: nothing to revoke mid-load).
  const previewUrl = useMemo(() => (s.logo ? svgUrl(s.logo.svg) : null), [s.logo]);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (file.size > MAX_SVG_BYTES) return setError('errTooLarge');
    const svg = await file.text();
    const res = svgToArt(svg);
    if (res.error) return setError(ERROR_KEYS[res.error]);
    s.set('logo', { name: file.name, svg });
  };

  return (
    <>
      {s.logo && previewUrl ? (
        <div className="logo-card">
          <div className="logo-thumb">
            <img src={previewUrl} alt={s.logo.name} />
          </div>
          <div className="logo-meta">
            <strong title={s.logo.name}>{s.logo.name}</strong>
            {result?.art && (
              <span className="hint">
                {result.stats.items} {t('logoStats')}
              </span>
            )}
            <div className="logo-actions">
              <MotionButton motion="lift" className="pill-btn is-compact" icon={<UploadIcon width={18} height={18} />} label={t('logoReplace')} onClick={() => fileRef.current?.click()}>
                {t('logoReplace')}
              </MotionButton>
              <MotionButton
                motion="twinkle"
                className={`icon-btn is-small${favLogo ? ' is-accent' : ''}`}
                icon={<StarIcon width={18} height={18} filled={!!favLogo} />}
                label={favLogo ? t('favLogoRemove') : t('favLogoAdd')}
                pressed={!!favLogo}
                onClick={() => {
                  if (favLogo) return s.removeFavLogo(favLogo.id);
                  if (!s.addFavLogo({ name: s.logo!.name.replace(/\.svg$/i, ''), svg: s.logo!.svg })) setError('favLogoTooBig');
                }}
              />
              <MotionButton motion="wiggle" className="icon-btn is-small" icon={<TrashIcon width={18} height={18} />} label={t('logoRemove')} onClick={() => s.set('logo', null)} />
            </div>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className={`dropzone${drag ? ' is-drag' : ''}`}
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            onFile(e.dataTransfer.files?.[0]);
          }}
        >
          <UploadIcon width={28} height={28} />
          <span>{t('logoDrop')}</span>
          <small>{t('logoHint')}</small>
        </button>
      )}
      <input
        ref={fileRef}
        type="file"
        hidden
        accept=".svg,image/svg+xml"
        onChange={(e) => {
          onFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      {error && <p className="note is-error">{t(error)}</p>}
      <FavLogos />
      {result?.warnings.map((w) => (
        <p key={w} className="note is-warn">
          <WarningIcon width={16} height={16} /> {t(WARNING_KEYS[w])}
        </p>
      ))}
      {s.logo && (
        <>
          <div className="field-row">
            <span className="label">{t('logoColors')}</span>
            <Segmented
              value={s.logoColors}
              onChange={(v) => s.set('logoColors', v)}
              options={[
                { value: 'original', label: t('logoOriginal') },
                { value: 'paint', label: t('logoRecolor') },
              ]}
            />
          </div>
          <Toggle label={t('logoOutline')} checked={s.logoOutline} onChange={(v) => s.set('logoOutline', v)} />
        </>
      )}
    </>
  );
}

export function ContentCard(props: { missing: string[]; fontLoading: boolean; svg: SvgImportResult | null }) {
  const t = useT();
  const mode = useEditor((s) => s.mode);
  const logo = useEditor((s) => s.logo);
  const logoColors = useEditor((s) => s.logoColors);
  const logoOutline = useEditor((s) => s.logoOutline);
  const set = useEditor((s) => s.set);
  const isText = mode === 'text';
  const fill = isText || (!!logo && logoColors === 'paint');
  const outline = isText || (!!logo && logoOutline);
  return (
    <section className="card">
      <Segmented
        value={mode}
        label={t('tabText')}
        onChange={(v) => set('mode', v)}
        options={[
          { value: 'text', label: (<><TypeIcon width={18} height={18} /> {t('tabText')}</>) },
          { value: 'logo', label: (<><ImageIcon width={18} height={18} /> {t('tabLogo')}</>) },
        ]}
      />
      {mode === 'text' ? <TextEditor missing={props.missing} fontLoading={props.fontLoading} /> : <LogoEditor result={props.svg} />}
      {(fill || outline) && <TextColors fill={fill} outline={outline} />}
      {(fill || outline) && <StyleSettings fill={fill} />}
    </section>
  );
}
