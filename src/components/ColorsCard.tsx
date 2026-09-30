import { paintCss } from '../lottie/paint';
import { PRESETS } from '../state/presets';
import { useEditor } from '../state/store';
import { useT } from '../state/useT';
import type { ColorRole } from '../templates/types';
import { GradientTools, PaintSwatches, Slider } from './controls';
import { DiceIcon } from './icons';
import type { I18nKey } from '../i18n';

const ROLES: Array<{ role: ColorRole; key: I18nKey }> = [
  { role: 'body', key: 'fill' },
  { role: 'outline', key: 'outline' },
  { role: 'accent', key: 'accent' },
];

export function ColorsCard() {
  const t = useT();
  const s = useEditor();
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
            onClick={() => s.applyPreset(p)}
          >
            <span className="preset-dots" aria-hidden>
              <span style={{ background: paintCss(p.colors.body) }} />
              <span style={{ background: paintCss(p.colors.accent) }} />
            </span>
            {p.name}
          </button>
        ))}
      </div>

      <div className="subcard">
        <div className="subcard-head">
          <h3 className="section-title">
            {t('emojiColors')}
            <em>{t('emojiColorsSub')}</em>
          </h3>
          <button type="button" className="icon-btn is-round is-accent" title={t('randomColors')} aria-label={t('randomColors')} onClick={s.randomizeEmoji}>
            <DiceIcon />
          </button>
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
