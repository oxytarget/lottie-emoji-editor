import { useEffect, useState } from 'react';
import type { I18nKey } from '../i18n';
import { downloadBlob, formatKb, slug, tgsFromJson, zipFiles, type TgsCheck } from '../lottie/export';
import { isTelegram, openExternal } from '../lib/telegram';
import { useEditor } from '../state/store';
import type { CompiledEmoji } from '../state/useCompiled';
import { useT } from '../state/useT';
import { Segmented } from './controls';
import { CheckIcon, CloseIcon, DownloadIcon, WarningIcon } from './icons';
import { LottieView } from './LottieView';
import { emojiName } from './TemplateGrid';

const PROBLEM_KEYS: Record<TgsCheck['problems'][number], I18nKey> = {
  size: 'problemSize',
  canvas: 'problemCanvas',
  fps: 'problemFps',
  duration: 'problemDuration',
};

type Format = 'tgs' | 'json';

export function ExportSheet({ emojis, onClose }: { emojis: CompiledEmoji[]; onClose: () => void }) {
  const t = useT();
  const lang = useEditor((s) => s.lang);
  const mode = useEditor((s) => s.mode);
  const text = useEditor((s) => s.text);
  const logo = useEditor((s) => s.logo);
  const [format, setFormat] = useState<Format>('tgs');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const base = slug(mode === 'logo' ? logo?.name.replace(/\.svg$/i, '') ?? 'logo' : text);
  const fileName = (e: CompiledEmoji) => `${base}-${slug(typeof e.name === 'string' ? e.name : e.id)}.${format}`;
  const fileData = (e: CompiledEmoji) => (format === 'tgs' ? tgsFromJson(e.json) : e.json);
  const mime = format === 'tgs' ? 'application/x-tgsticker' : 'application/json';

  const downloadOne = (e: CompiledEmoji) => downloadBlob(fileData(e), fileName(e), mime);
  const downloadAll = () => {
    if (emojis.length === 1) return downloadOne(emojis[0]);
    const files: Record<string, Uint8Array | string> = {};
    for (const e of emojis) files[fileName(e)] = fileData(e);
    downloadBlob(zipFiles(files), `${base}-emoji-${format}.zip`, 'application/zip');
  };

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={t('exportTitle')} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>{t('exportTitle')}</h2>
          <button type="button" className="icon-btn is-round" aria-label={t('close')} onClick={onClose}>
            <CloseIcon />
          </button>
        </div>

        <Segmented
          value={format}
          onChange={setFormat}
          options={[
            { value: 'tgs', label: t('exportTgs') },
            { value: 'json', label: t('exportJson') },
          ]}
        />

        {emojis.length === 0 ? (
          <p className="note">{t('exportEmpty')}</p>
        ) : (
          <ul className="export-list">
            {emojis.map((e) => (
              <li key={e.id}>
                <LottieView json={e.json} className="export-thumb" />
                <div className="export-meta">
                  <strong>{emojiName(e.name, lang)}</strong>
                  <span className={e.check.ok ? 'hint is-ok' : 'hint is-bad'}>
                    {e.check.ok ? <CheckIcon width={14} height={14} strokeWidth={3} /> : <WarningIcon width={14} height={14} />}
                    {formatKb(e.check.bytes)} {t('kb')} · {e.check.ok ? t('exportOk') : e.check.problems.map((p) => t(PROBLEM_KEYS[p])).join(', ')}
                  </span>
                </div>
                <button type="button" className="icon-btn is-round" aria-label={`${t('download')} ${fileName(e)}`} title={fileName(e)} onClick={() => downloadOne(e)}>
                  <DownloadIcon />
                </button>
              </li>
            ))}
          </ul>
        )}

        {emojis.length > 0 && (
          <button type="button" className="primary-btn" onClick={downloadAll}>
            <DownloadIcon /> {emojis.length > 1 ? `${t('exportZip')} (${emojis.length})` : `${t('download')} .${format}`}
          </button>
        )}

        {isTelegram() && (
          <p className="note">
            {t('telegramDownloadNote')}{' '}
            <button type="button" className="link-btn" onClick={() => openExternal(window.location.href.split('#')[0])}>
              {t('openInBrowser')}
            </button>
          </p>
        )}

        <details className="howto">
          <summary>{t('howToTitle')}</summary>
          <ol>
            <li>{t('howTo1')}</li>
            <li>{t('howTo2')}</li>
            <li>{t('howTo3')}</li>
          </ol>
        </details>
      </div>
    </div>
  );
}
