import type { ReactNode } from 'react';
import { luminance, shade } from '../lottie/color';
import { primaryColor, type Paint } from '../lottie/paint';
import { useT } from '../state/useT';
import { ColorSwatch } from './ColorSwatch';
import { CloseIcon, GradientIcon, RadialIcon, RotateIcon, SwapIcon } from './icons';

export function Slider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  onReset?: () => void;
}) {
  const { label, value, min, max, step, onChange, format } = props;
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <label className="slider">
      <span className="slider-head">
        <span className="label">{label}</span>
        <span className="slider-value" onDoubleClick={props.onReset}>
          {format ? format(value) : value}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ '--pct': `${pct}%` } as React.CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
        onDoubleClick={props.onReset}
      />
    </label>
  );
}

export function Segmented<T extends string>(props: {
  value: T;
  options: Array<{ value: T; label: ReactNode }>;
  onChange: (v: T) => void;
  label?: string;
}) {
  return (
    <div className="segmented" role="tablist" aria-label={props.label}>
      {props.options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={props.value === o.value}
          className={props.value === o.value ? 'is-active' : ''}
          onClick={() => props.onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle(props: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="toggle">
      <span>{props.label}</span>
      <input type="checkbox" role="switch" checked={props.checked} onChange={(e) => props.onChange(e.target.checked)} />
      <span className="toggle-track" aria-hidden />
    </label>
  );
}

/** Swatch(es) editing a paint in place: one for solid colours, two for gradients. */
export function PaintSwatches({ paint, onChange, label, size }: { paint: Paint; onChange: (p: Paint) => void; label: string; size?: 'sm' | 'md' | 'lg' }) {
  if (paint.type === 'solid') {
    return <ColorSwatch color={paint.color} label={label} size={size} onChange={(color) => onChange({ type: 'solid', color })} />;
  }
  return (
    <span className="swatch-pair">
      <ColorSwatch color={paint.colors[0]} label={`${label} 1`} size={size} onChange={(c) => onChange({ ...paint, colors: [c, paint.colors[1]] })} />
      <ColorSwatch color={paint.colors[1]} label={`${label} 2`} size={size} onChange={(c) => onChange({ ...paint, colors: [paint.colors[0], c] })} />
    </span>
  );
}

export function toGradient(p: Paint): Paint {
  if (p.type !== 'solid') return p;
  const c = p.color;
  const second = shade(c, luminance(c) > 0.45 ? -0.35 : 0.45);
  return { type: 'linear', colors: [second, c], angle: 90 };
}

/** Gradient-specific buttons: rotate / swap / remove (or a "make gradient" button for solid paints). */
export function GradientTools({ paint, onChange, compact }: { paint: Paint; onChange: (p: Paint) => void; compact?: boolean }) {
  const t = useT();
  if (paint.type === 'solid') {
    return (
      <button type="button" className={`pill-btn${compact ? ' is-compact' : ''}`} onClick={() => onChange(toGradient(paint))}>
        <GradientIcon width={20} height={20} />
        <span>{t('makeGradient')}</span>
      </button>
    );
  }
  return (
    <span className="gradient-tools">
      {paint.type === 'linear' ? (
        <button type="button" className="icon-btn is-small" title={t('rotateGradient')} aria-label={t('rotateGradient')} onClick={() => onChange({ ...paint, angle: (paint.angle + 45) % 360 })}>
          <RotateIcon width={18} height={18} />
        </button>
      ) : (
        <button
          type="button"
          className="icon-btn is-small"
          title={t('swapColors')}
          aria-label={t('swapColors')}
          onClick={() => onChange({ ...paint, colors: [paint.colors[1], paint.colors[0]] })}
        >
          <SwapIcon width={18} height={18} />
        </button>
      )}
      <button
        type="button"
        className={`icon-btn is-small${paint.type === 'radial' ? ' is-accent' : ''}`}
        title={t('radialGradient')}
        aria-label={t('radialGradient')}
        aria-pressed={paint.type === 'radial'}
        onClick={() => onChange(paint.type === 'radial' ? { type: 'linear', colors: paint.colors, angle: 90 } : { type: 'radial', colors: paint.colors })}
      >
        <RadialIcon width={18} height={18} />
      </button>
      <button type="button" className="icon-btn is-small" title={t('removeGradient')} aria-label={t('removeGradient')} onClick={() => onChange({ type: 'solid', color: primaryColor(paint) })}>
        <CloseIcon width={18} height={18} />
      </button>
    </span>
  );
}
