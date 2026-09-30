import { useEffect, useId, useRef, useState } from 'react';
import { normalizeHex } from '../lottie/color';
import { haptic } from '../lib/telegram';
import { useEditor } from '../state/store';
import { useUi } from '../state/ui';
import { useT } from '../state/useT';
import { useSwatchTarget } from './FavColors';
import { StarIcon } from './icons';
import { usePresence } from './motion';

const SWATCHES = [
  '#ffffff', '#111111', '#6b7280', '#ef4444', '#f97316', '#f59e0b', '#facc15', '#84cc16', '#22c55e',
  '#10b981', '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6', '#a855f7', '#d946ef', '#ec4899', '#f43f5e',
];

interface Props {
  color: string;
  onChange: (hex: string) => void;
  label: string;
  size?: 'sm' | 'md' | 'lg';
}

/** Round colour swatch that opens a small palette popover. */
export function ColorSwatch({ color, onChange, label, size = 'md' }: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [hex, setHex] = useState(color);
  const wrap = useRef<HTMLDivElement>(null);
  const id = useId();
  const popover = usePresence(open, 160);
  const favColors = useEditor((s) => s.favColors);
  const toggleFav = useEditor((s) => s.toggleFavColor);
  const current = normalizeHex(color).toLowerCase();
  const isFav = favColors.includes(current);
  // Favourite colours can be dropped on this circle, or painted onto it with a tap.
  const paint = useUi((u) => u.paintColor);
  useSwatchTarget(id, onChange);
  const firstColor = useRef(color);
  const changed = useRef(false);
  if (color !== firstColor.current) changed.current = true;

  useEffect(() => setHex(color), [color]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const commitHex = (value: string) => {
    const v = value.trim();
    if (/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)) onChange(normalizeHex(v.startsWith('#') ? v : `#${v}`));
    else setHex(color);
  };

  return (
    <div className="swatch-wrap" ref={wrap}>
      <button
        type="button"
        className={`swatch swatch-${size}`}
        style={{ background: color }}
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        data-swatch={id}
        onClick={() => {
          if (!paint) return setOpen((o) => !o);
          onChange(paint);
          haptic();
        }}
      >
        {/* Re-keyed on every colour change: a ring flashes out of the swatch. */}
        {changed.current && <span key={color} className="swatch-flash" aria-hidden />}
      </button>
      {popover.mounted && (
        <div className="popover" id={id} role="dialog" aria-label={label} data-state={popover.state}>
          {favColors.length > 0 && (
            <div className="popover-favs">
              <span className="label">
                <StarIcon width={12} height={12} filled /> {t('favorites')}
              </span>
              <div className="popover-grid">
                {favColors.map((c, i) => (
                  <button
                    key={c}
                    type="button"
                    className={`swatch swatch-sm${c === current ? ' is-current' : ''}`}
                    style={{ background: c, '--i': i } as React.CSSProperties}
                    aria-label={`${t('favorites')}: ${c}`}
                    onClick={() => {
                      onChange(c);
                      setOpen(false);
                    }}
                  />
                ))}
              </div>
            </div>
          )}
          <div className="popover-grid">
            {SWATCHES.map((c, i) => (
              <button
                key={c}
                type="button"
                className={`swatch swatch-sm${c === color.toLowerCase() ? ' is-current' : ''}`}
                style={{ background: c, '--i': i } as React.CSSProperties}
                aria-label={c}
                onClick={() => {
                  onChange(c);
                  setOpen(false);
                }}
              />
            ))}
          </div>
          <div className="popover-row">
            <label className="hex-field">
              <span>{t('hex')}</span>
              <input
                value={hex}
                maxLength={7}
                spellCheck={false}
                onChange={(e) => setHex(e.target.value)}
                onBlur={(e) => commitHex(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && commitHex((e.target as HTMLInputElement).value)}
              />
            </label>
            <label className="native-color" title={t('customColor')}>
              <input type="color" value={normalizeHex(color)} onChange={(e) => onChange(e.target.value)} aria-label={t('customColor')} />
              <span style={{ background: 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)' }} />
            </label>
            <button
              type="button"
              className={`fav-star${isFav ? ' is-on' : ''}`}
              aria-pressed={isFav}
              title={isFav ? t('favColorRemove') : t('favColorAdd')}
              aria-label={isFav ? t('favColorRemove') : t('favColorAdd')}
              onClick={() => toggleFav(current)}
            >
              <StarIcon key={String(isFav)} width={20} height={20} filled={isFav} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
