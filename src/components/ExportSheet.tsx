import { useEffect, useState } from 'react';
import type { I18nKey } from '../i18n';
import { downloadBlob, formatKb, slug, tgsFromJson, zipFiles, type TgsCheck } from '../lottie/export';
import { canSendToChat, sendToChat, type SendError } from '../lib/sendToChat';
import { closeApp, haptic, isTelegram, openExternal } from '../lib/telegram';
import { useEditor } from '../state/store';
import type { CompiledEmoji } from '../state/useCompiled';
import { useT } from '../state/useT';
import { Segmented } from './controls';
import { CheckIcon, CloseIcon, DownloadIcon, SendIcon, WarningIcon } from './icons';
import { LottieView } from './LottieView';
import { emojiName } from './TemplateGrid';

const PROBLEM_KEYS: Record<TgsCheck['problems'][number], I18nKey> = {
  size: 'problemSize',
  canvas: 'problemCanvas',
  fps: 'problemFps',
  duration: 'problemDuration',
};

type Format = 'tgs' | 'json';

const SEND_ERROR_KEYS: Record<SendError, I18nKey> = {
  denied: 'sendDenied',
  unauthorized: 'sendUnauthorized',
  network: 'sendFailed',
  server: 'sendFailed',
};

type SendState = { kind: 'idle' } | { kind: 'sending'; target: string } | { kind: 'sent'; count: number } | { kind: 'error'; error: SendError };

export function ExportSheet({ emojis, onClose }: { emojis: CompiledEmoji[]; onClose: () => void }) {
  const t = useT();
  const lang = useEditor((s) => s.lang);
  const mode = useEditor((s) => s.mode);
  const text = useEditor((s) => s.text);
  const logo = useEditor((s) => s.logo);
  const [format, setFormat] = useState<Format>('tgs');
  const [send, setSend] = useState<SendState>({ kind: 'idle' });
  // Inside Telegram, "download" means: the bot sends the files to the user's chat.
  const viaBot = canSendToChat();

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

  const sendItems = async (items: CompiledEmoji[], target: string) => {
    if (send.kind === 'sending') return;
    setSend({ kind: 'sending', target });
    const res = await sendToChat(items.map((e) => ({ name: fileName(e), data: fileData(e), type: mime })));
    setSend(res.ok ? { kind: 'sent', count: res.sent } : { kind: 'error', error: res.error });
    if (res.ok) haptic();
  };

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
                {viaBot ? (
                  <button
                    type="button"
                    className="icon-btn is-round"
                    aria-label={`${t('sendToChat')} ${fileName(e)}`}
                    title={fileName(e)}
                    disabled={send.kind === 'sending'}
                    onClick={() => sendItems([e], e.id)}
                  >
                    {send.kind === 'sending' && send.target === e.id ? <span className="btn-spinner" aria-hidden /> : <SendIcon />}
                  </button>
                ) : (
                  <button type="button" className="icon-btn is-round" aria-label={`${t('download')} ${fileName(e)}`} title={fileName(e)} onClick={() => downloadOne(e)}>
                    <DownloadIcon />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        {emojis.length > 0 && viaBot && (
          <>
            <button type="button" className="primary-btn" disabled={send.kind === 'sending'} onClick={() => sendItems(emojis, 'all')}>
              {send.kind === 'sending' && send.target === 'all' ? <span className="btn-spinner" aria-hidden /> : <SendIcon />}
              {send.kind === 'sending' ? t('sending') : `${t('sendToChat')} (${emojis.length})`}
            </button>
            {send.kind === 'idle' && <p className="note">{t('sendHint')}</p>}
            {send.kind === 'sent' && (
              <div className="send-done" role="status">
                <CheckIcon width={18} height={18} strokeWidth={3} />
                <span>{t('sentToChat')}</span>
                <button type="button" className="pill-btn is-compact" onClick={closeApp}>
                  {t('goToChat')}
                </button>
              </div>
            )}
            {send.kind === 'error' && (
              <p className="note is-error" role="alert">
                <WarningIcon width={16} height={16} /> {t(SEND_ERROR_KEYS[send.error])}
              </p>
            )}
            <button type="button" className="link-btn is-center" onClick={downloadAll}>
              {t('downloadInstead')}
            </button>
          </>
        )}

        {emojis.length > 0 && !viaBot && (
          <button type="button" className="primary-btn" onClick={downloadAll}>
            <DownloadIcon /> {emojis.length > 1 ? `${t('exportZip')} (${emojis.length})` : `${t('download')} .${format}`}
          </button>
        )}

        {isTelegram() && !viaBot && (
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
