import { useEffect, useRef, useState, type ReactNode } from 'react';
import { luminance, shade } from '../lottie/color';
import { primaryColor, rotateGradient, toggleRadial, type Paint } from '../lottie/paint';
import type { GradTarget } from '../state/gradients';
import { useUi } from '../state/ui';
import { useT } from '../state/useT';
import { ColorSwatch } from './ColorSwatch';
import { CloseIcon, DiceIcon, GradHandlesIcon, GradientIcon, RadialIcon, RotateIcon, SwapIcon } from './icons';
import { AnimIcon, useReplay, useSlidingIndicator, type IconMotion } from './motion';

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

/** Tabs with a pill that slides to the active option. */
export function Segmented<T extends string>(props: {
  value: T;
  options: Array<{ value: T; label: ReactNode }>;
  onChange: (v: T) => void;
  label?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const pill = useSlidingIndicator(ref, props.value);
  return (
    <div className="segmented" role="tablist" aria-label={props.label} ref={ref}>
      <span className="slide-pill" style={pill} aria-hidden />
      {props.options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          data-slide-key={o.value}
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

/** Icon button whose icon plays a small animation on every click. */
export function MotionButton(props: {
  motion: IconMotion;
  icon: ReactNode;
  label: string;
  onClick: () => void;
  className?: string;
  children?: ReactNode;
  pressed?: boolean;
  disabled?: boolean;
  title?: string;
}) {
  const [play, replay] = useReplay();
  return (
    <button
      type="button"
      className={props.className ?? 'icon-btn'}
      aria-label={props.children ? undefined : props.label}
      aria-pressed={props.pressed}
      title={props.title ?? props.label}
      disabled={props.disabled}
      onClick={() => {
        replay();
        props.onClick();
      }}
    >
      <AnimIcon motion={props.motion} play={play}>
        {props.icon}
      </AnimIcon>
      {props.children}
    </button>
  );
}

/** Die that really rolls: it tumbles and flicks through faces before landing on a random one. */
export function DiceButton({ onRoll, label, className = 'icon-btn is-accent' }: { onRoll: () => void; label: string; className?: string }) {
  const [face, setFace] = useState(5);
  const [play, replay] = useReplay();
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearInterval(timer.current), []);

  const roll = () => {
    onRoll();
    replay();
    window.clearInterval(timer.current);
    let flips = 0;
    timer.current = window.setInterval(() => {
      setFace((f) => {
        let next = 1 + Math.floor(Math.random() * 6);
        if (next === f) next = (next % 6) + 1;
        return next;
      });
      if (++flips >= 6) window.clearInterval(timer.current);
    }, 75);
  };

  return (
    <button type="button" className={className} title={label} aria-label={label} onClick={roll}>
      <AnimIcon motion="roll" play={play}>
        <DiceIcon face={face} />
      </AnimIcon>
    </button>
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

/**
 * Gradient-specific buttons: handles on the canvas / rotate / swap / radial / remove (or a "make gradient"
 * button for solid paints — with a `target`, a new gradient opens its handles on the canvas right away).
 */
export function GradientTools({ paint, onChange, compact, target }: { paint: Paint; onChange: (p: Paint) => void; compact?: boolean; target?: GradTarget }) {
  const t = useT();
  const gradEdit = useUi((u) => u.gradEdit);
  const setGradEdit = useUi((u) => u.setGradEdit);
  if (paint.type === 'solid') {
    return (
      <MotionButton
        motion="pop"
        className={`pill-btn${compact ? ' is-compact' : ''}`}
        icon={<GradientIcon width={20} height={20} />}
        label={t('makeGradient')}
        onClick={() => {
          onChange(toGradient(paint));
          if (target) setGradEdit(target);
        }}
      >
        <span>{t('makeGradient')}</span>
      </MotionButton>
    );
  }
  const onCanvas = !!target && gradEdit === target;
  return (
    <span className="gradient-tools">
      {target && (
        <MotionButton
          motion="pop"
          className={`icon-btn is-small${onCanvas ? ' is-accent' : ''}`}
          icon={<GradHandlesIcon width={18} height={18} />}
          label={t('gradOnCanvas')}
          pressed={onCanvas}
          onClick={() => setGradEdit(onCanvas ? null : target)}
        />
      )}
      {paint.type === 'linear' ? (
        <MotionButton
          motion="spin"
          className="icon-btn is-small"
          icon={<RotateIcon width={18} height={18} />}
          label={t('rotateGradient')}
          onClick={() => onChange(rotateGradient(paint, 45))}
        />
      ) : (
        <MotionButton
          motion="flip"
          className="icon-btn is-small"
          icon={<SwapIcon width={18} height={18} />}
          label={t('swapColors')}
          onClick={() => onChange({ ...paint, colors: [paint.colors[1], paint.colors[0]] })}
        />
      )}
      <MotionButton
        motion="pulse"
        className={`icon-btn is-small${paint.type === 'radial' ? ' is-accent' : ''}`}
        icon={<RadialIcon width={18} height={18} />}
        label={t('radialGradient')}
        pressed={paint.type === 'radial'}
        onClick={() => onChange(toggleRadial(paint))}
      />
      <MotionButton
        motion="spin"
        className="icon-btn is-small"
        icon={<CloseIcon width={18} height={18} />}
        label={t('removeGradient')}
        onClick={() => onChange({ type: 'solid', color: primaryColor(paint) })}
      />
    </span>
  );
}
