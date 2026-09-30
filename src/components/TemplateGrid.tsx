import { useRef, useState } from 'react';
import { formatKb, readLottieFile } from '../lottie/export';
import { extractPalette } from '../lottie/imported';
import { haptic } from '../lib/telegram';
import { useEditor } from '../state/store';
import type { CompiledEmoji } from '../state/useCompiled';
import { useT } from '../state/useT';
import type { Localized } from '../templates/types';
import { CheckIcon, PlusIcon } from './icons';
import { LottieView } from './LottieView';

export function emojiName(name: Localized | string, lang: keyof Localized): string {
  return typeof name === 'string' ? name : name[lang];
}

export function TemplateGrid({ emojis }: { emojis: CompiledEmoji[] }) {
  const t = useT();
  const lang = useEditor((s) => s.lang);
  const selected = useEditor((s) => s.selected);
  const active = useEditor((s) => s.active);
  const toggle = useEditor((s) => s.toggleTemplate);
  const addImport = useEditor((s) => s.addImport);
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState(false);

  const onImport = async (file: File | undefined) => {
    if (!file) return;
    setError(false);
    try {
      const data = readLottieFile(new Uint8Array(await file.arrayBuffer()));
      addImport({
        id: `import-${Date.now().toString(36)}`,
        name: file.name.replace(/\.(tgs|json)$/i, ''),
        data,
        palette: extractPalette(data),
        colorMap: {},
        overlay: false,
        hidden: [],
        replace: null,
      });
    } catch {
      setError(true);
    }
  };

  return (
    <section className="grid-section">
      <div className="grid-head">
        <h3 className="section-title">{t('characters')}</h3>
        <span className="hint">
          {t('charactersHint')} · {emojis.length}
        </span>
      </div>
      <div className="tile-grid">
        {emojis.map((e) => {
          const isSelected = selected.includes(e.id);
          const name = emojiName(e.name, lang);
          return (
            <button
              key={e.id}
              type="button"
              className={`tile${isSelected ? ' is-selected' : ''}${active === e.id ? ' is-active' : ''}`}
              aria-pressed={isSelected}
              aria-label={name}
              onClick={() => {
                toggle(e.id);
                haptic();
              }}
            >
              <LottieView json={e.json} className="tile-anim" label={name} />
              <span className="tile-name">{name}</span>
              <span className={`tile-size${e.check.ok ? '' : ' is-bad'}`}>
                {formatKb(e.check.bytes)} {t('kb')}
              </span>
              {isSelected && (
                <span className="tile-check" aria-hidden>
                  <CheckIcon width={16} height={16} strokeWidth={3} />
                </span>
              )}
            </button>
          );
        })}
        <button type="button" className="tile tile-import" onClick={() => fileRef.current?.click()}>
          <PlusIcon width={30} height={30} />
          <span>{t('importLottie')}</span>
        </button>
      </div>
      {error && <p className="note is-error">{t('importError')}</p>}
      <input
        ref={fileRef}
        type="file"
        hidden
        accept=".tgs,.json,application/json,application/gzip"
        onChange={(e) => {
          onImport(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
    </section>
  );
}
