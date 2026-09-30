import { useEffect, useMemo, useState } from 'react';
import type { I18nKey } from '../i18n';
import { canUseBot, createPack, sendToChat, type BotError, type PackResult } from '../lib/botApi';
import { closeApp, haptic, isTelegram, openExternal, openTelegramLink } from '../lib/telegram';
import { downloadBlob, formatKb, slug, tgsFromJson, zipFiles, type TgsCheck } from '../lottie/export';
import { useEditor } from '../state/store';
import type { CompiledEmoji } from '../state/useCompiled';
import { useT } from '../state/useT';
import { Segmented } from './controls';
import { CheckIcon, CloseIcon, DownloadIcon, SendIcon, SparkleIcon, WarningIcon } from './icons';
import { LottieView } from './LottieView';
import { emojiName } from './TemplateGrid';

const PROBLEM_KEYS: Record<TgsCheck['problems'][number], I18nKey> = {
  size: 'problemSize',
  canvas: 'problemCanvas',
  fps: 'problemFps',
  duration: 'problemDuration',
  unsupported: 'problemUnsupported',
};

const ERROR_KEYS: Record<BotError, I18nKey> = {
  denied: 'sendDenied',
  unauthorized: 'sendUnauthorized',
  network: 'sendFailed',
  server: 'sendFailed',
  'pack-full': 'packFull',
  'pack-not-found': 'packNotFound',
  'bad-emoji': 'packBadEmoji',
};

/** Telegram allows up to 200 custom emoji per pack. */
const PACK_LIMIT = 200;
const NEW_PACK = '';

type Format = 'tgs' | 'json';
type Busy = null | string;
type Result =
  | { kind: 'none' }
  | { kind: 'pack'; pack: PackResult; added: boolean }
  | { kind: 'sent' }
  | { kind: 'error'; error: BotError; detail?: string };

export function ExportSheet({ emojis, onClose }: { emojis: CompiledEmoji[]; onClose: () => void }) {
  const t = useT();
  const lang = useEditor((s) => s.lang);
  const mode = useEditor((s) => s.mode);
  const text = useEditor((s) => s.text);
  const logo = useEditor((s) => s.logo);
  const packs = useEditor((s) => s.packs);
  const savePack = useEditor((s) => s.savePack);
  const [format, setFormat] = useState<Format>('tgs');
  const [busy, setBusy] = useState<Busy>(null);
  const [result, setResult] = useState<Result>({ kind: 'none' });
  // Inside Telegram the bot creates packs and sends files; in a browser the files are downloaded.
  const viaBot = canUseBot();

  const defaultTitle = (mode === 'logo' ? logo?.name.replace(/\.svg$/i, '') : text.split('\n')[0])?.trim().slice(0, 64) || 'Emoji Studio';
  const [title, setTitle] = useState(defaultTitle);
  const [target, setTarget] = useState<string>(NEW_PACK);
  const [emojiFor, setEmojiFor] = useState<Record<string, string>>(() => Object.fromEntries(emojis.map((e) => [e.id, e.emoji])));
  const targetPack = packs.find((p) => p.name === target);
  const overLimit = !!targetPack && targetPack.count + emojis.length > PACK_LIMIT;

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

  const fileFormat: Format = viaBot ? 'tgs' : format;
  const base = slug(mode === 'logo' ? logo?.name.replace(/\.svg$/i, '') ?? 'logo' : text);
  const fileName = (e: CompiledEmoji, f: Format = fileFormat) => `${base}-${slug(typeof e.name === 'string' ? e.name : e.id)}.${f}`;
  const fileData = (e: CompiledEmoji, f: Format = fileFormat) => (f === 'tgs' ? tgsFromJson(e.json) : e.json);
  const mime = (f: Format = fileFormat) => (f === 'tgs' ? 'application/x-tgsticker' : 'application/json');
  const tooBig = useMemo(() => emojis.some((e) => !e.check.ok), [emojis]);

  const downloadOne = (e: CompiledEmoji) => downloadBlob(fileData(e), fileName(e), mime());
  const downloadAll = () => {
    if (emojis.length === 1) return downloadOne(emojis[0]);
    const files: Record<string, Uint8Array | string> = {};
    for (const e of emojis) files[fileName(e)] = fileData(e);
    downloadBlob(zipFiles(files), `${base}-emoji-${fileFormat}.zip`, 'application/zip');
  };

  const runPack = async () => {
    if (busy) return;
    setBusy('pack');
    setResult({ kind: 'none' });
    const res = await createPack({
      title: targetPack?.title ?? title,
      set: targetPack?.name,
      items: emojis.map((e) => ({ name: fileName(e, 'tgs'), data: fileData(e, 'tgs'), type: mime('tgs'), emoji: emojiFor[e.id] ?? e.emoji })),
    });
    setBusy(null);
    if (!res.ok) return setResult({ kind: 'error', error: res.error, detail: res.detail });
    const pack = res.data;
    savePack({ name: pack.name, title: pack.title, url: pack.url, count: (targetPack?.count ?? 0) + pack.added });
    setTarget(pack.name);
    setResult({ kind: 'pack', pack, added: !!targetPack });
    haptic();
  };

  const runSend = async (items: CompiledEmoji[], key: string) => {
    if (busy) return;
    setBusy(key);
    setResult({ kind: 'none' });
    const res = await sendToChat(items.map((e) => ({ name: fileName(e), data: fileData(e), type: mime() })));
    setBusy(null);
    setResult(res.ok ? { kind: 'sent' } : { kind: 'error', error: res.error, detail: res.detail });
    if (res.ok) haptic();
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

        {!viaBot && (
          <Segmented
            value={format}
            onChange={setFormat}
            options={[
              { value: 'tgs', label: t('exportTgs') },
              { value: 'json', label: t('exportJson') },
            ]}
          />
        )}

        {viaBot && emojis.length > 0 && (
          <div className="pack-form">
            <h3 className="section-title">{t('packSection')}</h3>
            <label className="field">
              <span className="label">{t('packTarget')}</span>
              <select value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value={NEW_PACK}>{t('packNew')}</option>
                {packs.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.title} · {p.count}/{PACK_LIMIT}
                  </option>
                ))}
              </select>
            </label>
            {!targetPack && (
              <label className="field">
                <span className="label">{t('packTitle')}</span>
                <input value={title} maxLength={64} onChange={(e) => setTitle(e.target.value)} placeholder="Emoji Studio" />
              </label>
            )}
            <p className="hint">{t('packEmojiHint')}</p>
          </div>
        )}

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
                {viaBot && (
                  <input
                    className="emoji-input"
                    value={emojiFor[e.id] ?? ''}
                    maxLength={16}
                    aria-label={`${t('packEmoji')}: ${emojiName(e.name, lang)}`}
                    onChange={(ev) => setEmojiFor((m) => ({ ...m, [e.id]: ev.target.value }))}
                  />
                )}
                {viaBot ? (
                  <button
                    type="button"
                    className="icon-btn is-round"
                    aria-label={`${t('sendToChat')} ${fileName(e)}`}
                    title={t('sendToChat')}
                    disabled={!!busy}
                    onClick={() => runSend([e], e.id)}
                  >
                    {busy === e.id ? <span className="btn-spinner" aria-hidden /> : <SendIcon />}
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

        {viaBot && emojis.length > 0 && (
          <>
            {overLimit && (
              <p className="note is-warn">
                <WarningIcon width={16} height={16} /> {t('packFull')}
              </p>
            )}
            <button type="button" className="primary-btn" disabled={!!busy || overLimit || tooBig} onClick={runPack}>
              {busy === 'pack' ? <span className="btn-spinner" aria-hidden /> : <SparkleIcon />}
              {busy === 'pack' ? t('packCreating') : `${targetPack ? t('packAdd') : t('packCreate')} (${emojis.length})`}
            </button>

            {result.kind === 'pack' && (
              <div className="send-done" role="status">
                <CheckIcon width={18} height={18} strokeWidth={3} />
                <span>{result.added ? t('packUpdated') : t('packCreated')}</span>
                <button type="button" className="pill-btn is-compact" onClick={() => openTelegramLink(result.pack.url)}>
                  {t('packOpen')}
                </button>
              </div>
            )}
            {result.kind === 'sent' && (
              <div className="send-done" role="status">
                <CheckIcon width={18} height={18} strokeWidth={3} />
                <span>{t('sentToChat')}</span>
                <button type="button" className="pill-btn is-compact" onClick={closeApp}>
                  {t('goToChat')}
                </button>
              </div>
            )}
            {result.kind === 'error' && (
              <p className="note is-error" role="alert">
                <WarningIcon width={16} height={16} /> {t(ERROR_KEYS[result.error])}
                {result.detail ? ` (${result.detail})` : ''}
              </p>
            )}

            <button type="button" className="secondary-btn" disabled={!!busy} onClick={() => runSend(emojis, 'send')}>
              {busy === 'send' ? <span className="btn-spinner" aria-hidden /> : <SendIcon />}
              {t('sendToChat')} ({emojis.length})
            </button>
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

        {!viaBot && (
          <details className="howto">
            <summary>{t('howToTitle')}</summary>
            <ol>
              <li>{t('howTo1')}</li>
              <li>{t('howTo2')}</li>
              <li>{t('howTo3')}</li>
            </ol>
          </details>
        )}
      </div>
    </div>
  );
}
