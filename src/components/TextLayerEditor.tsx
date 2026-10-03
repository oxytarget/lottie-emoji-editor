import { useEffect, useRef, useState } from 'react';
import { DEFAULT_FONT_ID, fontOptions, hasFont, registerCssFont } from '../content/fonts';
import type { TextLayerSpec } from '../state/logoArt';
import type { ImportedTemplate } from '../state/store';
import { editTextLayer, textLayerOf } from '../state/textLayers';
import { useT } from '../state/useT';
import { ColorSwatch } from './ColorSwatch';
import { Slider, Toggle } from './controls';
import { TypeIcon } from './icons';

const same = (a: TextLayerSpec, b: TextLayerSpec) =>
  a.text === b.text && a.fontId === b.fontId && a.fill === b.fill && a.outline === b.outline && a.outlineWidth === b.outlineWidth && a.uppercase === b.uppercase;

/** Editing a text layer added with "+ Text": its words, font and colours (the layer is rebuilt in place). */
export function TextLayerEditor({ imp, partId }: { imp: ImportedTemplate; partId: string }) {
  const t = useT();
  const layer = textLayerOf(imp, partId);
  const stored = layer?.spec;
  const [draft, setDraft] = useState<TextLayerSpec | null>(stored ?? null);
  const [failed, setFailed] = useState(false);
  const typing = useRef(0);
  const reset = useRef<'fill' | 'stroke' | undefined>(undefined);

  // Another layer, or the stored text changed elsewhere (undo): show what is stored.
  useEffect(() => {
    if (stored && (!draft || !typing.current)) setDraft({ text: stored.text, fontId: stored.fontId, fill: stored.fill, outline: stored.outline, outlineWidth: stored.outlineWidth, uppercase: stored.uppercase });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partId, layer?.key]);

  // Typing is rebuilt a moment after the last key; everything else right away.
  useEffect(() => {
    if (!draft || !stored || same(draft, stored)) return;
    const wait = draft.text !== stored.text ? 350 : 0;
    const timer = window.setTimeout(async () => {
      const ok = await editTextLayer(imp.id, partId, draft, reset.current);
      reset.current = undefined;
      typing.current = 0;
      setFailed(!ok && !!draft.text.trim());
    }, wait);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  if (!layer || !draft) return null;
  const set = (patch: Partial<TextLayerSpec>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const options = fontOptions();
  const fontId = hasFont(draft.fontId) ? draft.fontId : DEFAULT_FONT_ID;
  const font = options.find((o) => o.id === fontId) ?? options[0];
  registerCssFont(font.id);

  return (
    <section className="text-layer" aria-label={t('textLayerTitle')}>
      <span className="label layer-paints-title">
        <TypeIcon width={14} height={14} /> {t('textLayerTitle')}
      </span>
      <textarea
        className="text-layer-input"
        rows={2}
        value={draft.text}
        maxLength={60}
        placeholder={t('textPlaceholder')}
        style={{ fontFamily: `${font.cssFamily}, inherit` }}
        onChange={(e) => {
          typing.current = Date.now();
          set({ text: e.target.value });
        }}
      />
      <div className="text-layer-row">
        <select
          className="text-layer-font"
          value={fontId}
          aria-label={t('fontDefault')}
          style={{ fontFamily: `${font.cssFamily}, inherit` }}
          onChange={(e) => set({ fontId: e.target.value })}
        >
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
        <span className="text-layer-color">
          <ColorSwatch
            color={draft.fill}
            size="sm"
            label={t('fill')}
            onChange={(fill) => {
              reset.current = 'fill';
              set({ fill });
            }}
          />
          <span className="hint">{t('fill')}</span>
        </span>
        <span className="text-layer-color">
          <ColorSwatch
            color={draft.outline}
            size="sm"
            label={t('outline')}
            onChange={(outline) => {
              reset.current = 'stroke';
              set({ outline, outlineWidth: draft.outlineWidth || 8 });
            }}
          />
          <span className="hint">{t('outline')}</span>
        </span>
      </div>
      <Slider label={t('textLayerOutline')} value={draft.outlineWidth} min={0} max={24} step={1} onChange={(outlineWidth) => set({ outlineWidth })} onReset={() => set({ outlineWidth: 8 })} />
      <Toggle label={t('uppercase')} checked={draft.uppercase} onChange={(uppercase) => set({ uppercase })} />
      {failed && <p className="note is-warn">{t('textLayerEmpty')}</p>}
    </section>
  );
}
