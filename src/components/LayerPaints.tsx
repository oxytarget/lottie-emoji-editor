import { useEffect, useMemo } from 'react';
import { listPaintItems, type ItemPaint, type PaintItem } from '../lottie/itemPaints';
import type { Part } from '../lottie/parts';
import type { LottieAnimation } from '../lottie/types';
import { useEditor, type ImportedTemplate } from '../state/store';
import { editImport, useUi } from '../state/ui';
import { useT } from '../state/useT';
import { ColorSwatch } from './ColorSwatch';
import { GradientTools, MotionButton, PaintSwatches } from './controls';
import { GradHandlesIcon, LinearIcon, PaletteIcon, RadialIcon, ResetIcon } from './icons';

/** More would not fit a phone screen; nested layers show the rest. */
const MAX_ITEMS = 16;

/** Edits one item of the layer (merged with what was changed before). */
function paintEdit(imp: ImportedTemplate, item: string, patch: ItemPaint | null) {
  const current = imp.paints?.[item];
  editImport(imp.id, { kind: 'paint', item, paint: patch ? { ...current, ...patch } : null });
}

function ItemRow({ imp, item }: { imp: ImportedTemplate; item: PaintItem }) {
  const t = useT();
  const gradItem = useUi((u) => u.gradItem);
  const setGradItem = useUi((u) => u.setGradItem);
  const edited = !!imp.paints?.[item.id];
  const onCanvas = gradItem?.imp === imp.id && gradItem.item === item.id;
  const label = item.gradient ? t(item.kind === 'fill' ? 'layerGradFill' : 'layerGradStroke') : t(item.kind === 'fill' ? 'layerFill' : 'layerStroke');
  const setStop = (i: number, hex: string) => {
    const stops = [...(imp.paints?.[item.id]?.stops ?? item.colors)];
    stops[i] = hex;
    paintEdit(imp, item.id, { stops });
  };
  return (
    <div className={`layer-paint${onCanvas ? ' is-active' : ''}`} data-item={item.id}>
      <span className="layer-paint-swatches">
        {item.gradient ? (
          item.colors.map((c, i) => (
            <span key={i} data-item-stop={i}>
              <ColorSwatch color={c} size="sm" label={`${label} ${i + 1}`} onChange={(hex) => setStop(i, hex)} />
            </span>
          ))
        ) : (
          <ColorSwatch color={item.colors[0]} label={label} onChange={(hex) => paintEdit(imp, item.id, { color: hex })} />
        )}
      </span>
      <span className="label" title={item.animated ? t('layerAnimated') : undefined}>
        {label}
        {item.animated && <em className="layer-paint-anim">●</em>}
      </span>
      <span className="layer-paint-tools">
        {item.gradient && (
          <>
            <MotionButton
              motion="pop"
              className={`icon-btn is-small${onCanvas ? ' is-accent' : ''}`}
              icon={<GradHandlesIcon width={16} height={16} />}
              label={t('gradOnCanvas')}
              pressed={onCanvas}
              onClick={() => setGradItem(onCanvas ? null : { imp: imp.id, item: item.id })}
            />
            <MotionButton
              motion="pulse"
              className="icon-btn is-small"
              icon={item.type === 2 ? <RadialIcon width={16} height={16} /> : <LinearIcon width={16} height={16} />}
              label={item.type === 2 ? t('radialGradient') : t('gradLinear')}
              onClick={() => paintEdit(imp, item.id, { type: item.type === 2 ? 1 : 2 })}
            />
          </>
        )}
        {edited && (
          <MotionButton
            motion="spin-back"
            className="icon-btn is-small is-pop-in"
            icon={<ResetIcon width={16} height={16} />}
            label={t('layerPaintReset')}
            onClick={() => paintEdit(imp, item.id, null)}
          />
        )}
      </span>
    </div>
  );
}

/** The text/logo's own colours, where it sits in the layer list or replaces a part. */
function ContentPaints() {
  const t = useT();
  const s = useEditor();
  return (
    <>
      <p className="hint">{t('layerContentColors')}</p>
      <div className="layer-paint">
        <span className="layer-paint-swatches">
          <PaintSwatches paint={s.textFill} label={t('fill')} size="sm" onChange={(p) => s.set('textFill', p)} />
        </span>
        <span className="label">{t('fill')}</span>
        <span className="layer-paint-tools">
          <GradientTools paint={s.textFill} onChange={(p) => s.set('textFill', p)} compact target="textFill" />
        </span>
      </div>
      <div className="layer-paint">
        <span className="layer-paint-swatches">
          <PaintSwatches paint={s.textOutline} label={t('outline')} size="sm" onChange={(p) => s.set('textOutline', p)} />
        </span>
        <span className="label">{t('outline')}</span>
      </div>
    </>
  );
}

/**
 * "Layer colours": opens with the selected layer — its fills, strokes and gradients, changed for this layer
 * only. The first gradient shows its handles on the canvas right away.
 */
export function LayerPaints({ imp, part, anim }: { imp: ImportedTemplate; part: Part; anim: LottieAnimation }) {
  const t = useT();
  const all = useMemo(() => listPaintItems(anim, part.id), [anim, part.id]);
  const items = all.slice(0, MAX_ITEMS);
  const content = !!part.slot || imp.replace === part.id;
  const firstGradient = content ? undefined : items.find((i) => i.gradient)?.id;

  // Selecting a layer makes its (first) gradient the active one on the canvas.
  useEffect(() => {
    const ui = useUi.getState();
    if (ui.gradEdit) return;
    const current = ui.gradItem;
    const inside = current?.imp === imp.id && items.some((i) => i.id === current.item);
    if (!inside) ui.setGradItem(firstGradient ? { imp: imp.id, item: firstGradient } : null);
  }, [imp.id, part.id, firstGradient]);
  // Handles go away with the selection.
  useEffect(() => () => {
    const ui = useUi.getState();
    if (ui.gradItem?.imp === imp.id && ui.grab?.part !== part.id) ui.setGradItem(null);
  }, [imp.id, part.id]);

  return (
    <section className="layer-paints" aria-label={t('layerColors')}>
      <span className="label layer-paints-title">
        <PaletteIcon width={14} height={14} /> {t('layerColors')}
      </span>
      {content ? (
        <ContentPaints />
      ) : items.length ? (
        items.map((item) => <ItemRow key={item.id} imp={imp} item={item} />)
      ) : (
        <p className="hint">{t('layerNoColors')}</p>
      )}
      {!content && all.length > MAX_ITEMS && <p className="hint">{t('layerMore').replace('{n}', String(all.length - MAX_ITEMS))}</p>}
    </section>
  );
}
