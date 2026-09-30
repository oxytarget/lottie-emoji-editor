import { useState } from 'react';
import type { I18nKey } from '../i18n';
import { haptic } from '../lib/telegram';
import { paintCss } from '../lottie/paint';
import { PRESETS } from '../state/presets';
import { useEditor, type UserPreset } from '../state/store';
import { useT } from '../state/useT';
import type { ColorRole } from '../templates/types';
import { DiceButton, GradientTools, PaintSwatches, Slider, Toggle } from './controls';
import { CloseIcon, PlusIcon, StarIcon } from './icons';
import { AnimIcon, usePresence } from './motion';

const ROLES: Array<{ role: ColorRole; key: I18nKey }> = [
  { role: 'body', key: 'fill' },
  { role: 'outline', key: 'outline' },
  { role: 'accent', key: 'accent' },
];

const svgUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

/** Saves the current colours as a preset, optionally with the current logo or text. */
function PresetForm({ onDone }: { onDone: () => void }) {
  const t = useT();
  const mode = useEditor((s) => s.mode);
  const logo = useEditor((s) => s.logo);
  const text = useEditor((s) => s.text);
  const count = useEditor((s) => s.userPresets.length);
  const save = useEditor((s) => s.saveUserPreset);
  const [name, setName] = useState('');
  const contentName = mode === 'logo' ? logo?.name.replace(/\.svg$/i, '') : text.split('\n')[0].trim();
  const [withContent, setWithContent] = useState(!!contentName);
  const [full, setFull] = useState(false);
  return (
    <form
      className="preset-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!save(name, withContent && !!contentName)) return setFull(true);
        haptic();
        onDone();
      }}
    >
      <label className="field">
        <span className="label">{t('presetName')}</span>
        <input value={name} maxLength={32} autoFocus placeholder={`★ ${count + 1}`} onChange={(e) => setName(e.target.value)} />
      </label>
      {contentName && (
        <Toggle
          label={t(mode === 'logo' ? 'presetWithLogo' : 'presetWithText').replace('{name}', contentName.slice(0, 24))}
          checked={withContent}
          onChange={setWithContent}
        />
      )}
      <p className="hint">{t('presetHint')}</p>
      {full && <p className="note is-error">{t('presetFull')}</p>}
      <div className="row-actions">
        <button type="submit" className="pill-btn is-accent">
          <StarIcon width={16} height={16} /> {t('save')}
        </button>
        <button type="button" className="pill-btn" onClick={onDone}>
          {t('cancel')}
        </button>
      </div>
    </form>
  );
}

function UserPresetChip({ preset, active, onApply }: { preset: UserPreset; active: boolean; onApply: () => void }) {
  const t = useT();
  const remove = useEditor((s) => s.removeUserPreset);
  const content = preset.content;
  return (
    <span className="preset-wrap" role="listitem">
      <button type="button" className={`preset is-user${active ? ' is-active' : ''}`} onClick={onApply}>
        {content?.mode === 'logo' ? (
          <span className="preset-logo" style={{ background: paintCss(preset.colors.body) }} aria-hidden>
            <img src={svgUrl(content.logo.svg)} alt="" />
          </span>
        ) : (
          <span className="preset-dots" aria-hidden>
            <span style={{ background: paintCss(preset.colors.body) }} />
            <span style={{ background: paintCss(preset.colors.accent) }} />
          </span>
        )}
        {preset.name}
        {content?.mode === 'text' && <em className="preset-text">{content.text.split('\n')[0].slice(0, 10)}</em>}
      </button>
      <button type="button" className="preset-remove" aria-label={`${t('presetRemove')}: ${preset.name}`} title={t('presetRemove')} onClick={() => remove(preset.id)}>
        <CloseIcon width={12} height={12} />
      </button>
    </span>
  );
}

export function ColorsCard() {
  const t = useT();
  const s = useEditor();
  // Replays the dots animation of the preset that was just picked.
  const [spin, setSpin] = useState<{ id: string; n: number }>({ id: '', n: 0 });
  const [presetForm, setPresetForm] = useState(false);
  const form = usePresence(presetForm, 200);
  return (
    <section className="card">
      <h3 className="section-title">{t('presets')}</h3>
      <div className="preset-row" role="list">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            role="listitem"
            className={`preset${s.presetId === p.id ? ' is-active' : ''}`}
            onClick={() => {
              s.applyPreset(p);
              setSpin((v) => ({ id: p.id, n: v.n + 1 }));
            }}
          >
            <AnimIcon motion="swap" play={spin.id === p.id ? spin.n : 0}>
              <span className="preset-dots" aria-hidden>
                <span style={{ background: paintCss(p.colors.body) }} />
                <span style={{ background: paintCss(p.colors.accent) }} />
              </span>
            </AnimIcon>
            {p.name}
          </button>
        ))}
        {s.userPresets.map((p) => (
          <UserPresetChip key={p.id} preset={p} active={s.presetId === p.id} onApply={() => s.applyUserPreset(p)} />
        ))}
        <button type="button" role="listitem" className={`preset is-add${presetForm ? ' is-active' : ''}`} aria-expanded={presetForm} onClick={() => setPresetForm((v) => !v)}>
          <PlusIcon width={18} height={18} />
          {t('presetSave')}
        </button>
      </div>
      {form.mounted && (
        <div className="preset-form-wrap" data-state={form.state}>
          <PresetForm onDone={() => setPresetForm(false)} />
        </div>
      )}

      <div className="subcard">
        <div className="subcard-head">
          <h3 className="section-title">
            {t('emojiColors')}
            <em>{t('emojiColorsSub')}</em>
          </h3>
          <DiceButton className="icon-btn is-round is-accent" label={t('randomColors')} onRoll={s.randomizeEmoji} />
        </div>
        <div className="paint-rows">
        {ROLES.map(({ role, key }) => (
          <div className="paint-row" key={role}>
            <span className="paint-swatches">
              <PaintSwatches paint={s.colors[role]} label={t(key)} size="lg" onChange={(p) => s.setColor(role, p)} />
            </span>
            <span className="label">{t(key)}</span>
            <GradientTools paint={s.colors[role]} onChange={(p) => s.setColor(role, p)} />
          </div>
        ))}
        </div>
      </div>

      <div className="slider-grid">
        <div className="subcard">
          <Slider label={t('size')} value={s.scale} min={0.4} max={1.6} step={0.05} format={(v) => v.toFixed(2)} onChange={(v) => s.set('scale', v)} onReset={() => s.set('scale', 1)} />
        </div>
        <div className="subcard">
          <Slider label={t('height')} value={s.offsetY} min={-100} max={100} step={2} onChange={(v) => s.set('offsetY', v)} onReset={() => s.set('offsetY', 0)} />
        </div>
      </div>
      <div className="subcard">
        <Slider label={t('emojiOutline')} value={s.outlineWidth} min={0} max={28} step={1} onChange={(v) => s.set('outlineWidth', v)} onReset={() => s.set('outlineWidth', 12)} />
      </div>
    </section>
  );
}
