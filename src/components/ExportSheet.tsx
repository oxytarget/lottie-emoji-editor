import { useEffect, useMemo, useState } from 'react';
import type { I18nKey } from '../i18n';
import { canUseBot, CREATE_BATCH, createPackAll, createPacksSplit, sendAllToChat, type BotError, type JobProgress, type PackResult } from '../lib/botApi';
import { closeApp, haptic, isTelegram, openExternal, openTelegramLink } from '../lib/telegram';
import { downloadBlob, formatKb, slug, tgsFromJson, zipFiles, type TgsCheck } from '../lottie/export';
import { useEditor } from '../state/store';
import type { CompiledEmoji } from '../state/useCompiled';
import { useT } from '../state/useT';
import { MotionButton, Segmented, Toggle } from './controls';
import { CheckIcon, CloseIcon, DownloadIcon, SendIcon, StickersIcon, WarningIcon } from './icons';
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
  flood: 'packFlood',
  'bad-files': 'packBadFiles',
};

const errorKey = (job: 'pack' | 'send', error: BotError): I18nKey =>
  job === 'pack' && (error === 'network' || error === 'server') ? 'packFailed' : ERROR_KEYS[error];

const fill = (text: string, vars: Record<string, number>) => text.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));

/** Telegram allows up to 200 custom emoji per pack. */
const PACK_LIMIT = 200;
const NEW_PACK = '';

type Format = 'tgs' | 'json';
type Busy = null | string;
type Result =
  | { kind: 'none' }
  | { kind: 'pack'; pack: PackResult; added: boolean }
  | { kind: 'packs'; packs: PackResult[] }
  | { kind: 'sent' }
  | { kind: 'error'; job: 'pack' | 'send'; error: BotError; detail?: string; done?: number; total?: number; pack?: PackResult };

/** Files already sent by a "send all" that stopped half-way (the next press sends the rest). */
interface SendResume {
  ids: string[];
}

export function ExportSheet({ emojis, onClose, state = 'open' }: { emojis: CompiledEmoji[]; onClose: () => void; state?: 'open' | 'closed' }) {
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
  const [progress, setProgress] = useState<JobProgress | null>(null);
  const [sendResume, setSendResume] = useState<SendResume | null>(null);
  // A big pack interrupted earlier (even in another session) continues where it stopped.
  const packJob = useEditor((s) => s.packJob);
  const setStore = useEditor((s) => s.set);
  const [split, setSplit] = useState(false);
  // Inside Telegram the bot creates packs and sends files; in a browser the files are downloaded.
  const viaBot = canUseBot();

  const defaultTitle = (mode === 'logo' ? logo?.name.replace(/\.svg$/i, '') : text.split('\n')[0])?.trim().slice(0, 64) || 'Emoji Studio';
  const [title, setTitle] = useState(defaultTitle);
  const [target, setTarget] = useState<string>(() =>
    packJob && packs.some((p) => p.name === packJob.pack) && emojis.some((e) => !packJob.ids.includes(e.id)) && emojis.some((e) => packJob.ids.includes(e.id))
      ? packJob.pack
      : NEW_PACK,
  );
  const [emojiFor, setEmojiFor] = useState<Record<string, string>>(() => Object.fromEntries(emojis.map((e) => [e.id, e.emoji])));
  const targetPack = packs.find((p) => p.name === target);
  const packResume = packJob && packJob.pack === target ? packJob : null;
  const packPending = packResume ? emojis.filter((e) => !packResume.ids.includes(e.id)) : emojis;
  const canSplit = !targetPack && emojis.length > CREATE_BATCH;
  const splitting = canSplit && split;
  const overLimit = targetPack ? targetPack.count + packPending.length > PACK_LIMIT : !splitting && emojis.length > PACK_LIMIT;

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

  const packItems = (list: CompiledEmoji[]) =>
    list.map((e) => ({ id: e.id, name: fileName(e, 'tgs'), data: fileData(e, 'tgs'), type: mime('tgs'), emoji: emojiFor[e.id] ?? e.emoji }));

  /** Several packs of up to 50: each is created in one call, no waiting. */
  const runSplit = async () => {
    setBusy('pack');
    setResult({ kind: 'none' });
    setProgress({ done: 0, total: emojis.length });
    const res = await createPacksSplit(
      { title, items: packItems(emojis) },
      setProgress,
      (items, pack) => savePack({ name: pack.name, title: pack.title, url: pack.url, count: items.length }),
    );
    setBusy(null);
    setProgress(null);
    if (res.ok) {
      setResult({ kind: 'packs', packs: res.data });
      haptic();
    } else {
      setResult({ kind: 'error', job: 'pack', error: res.error, detail: res.detail });
    }
  };

  const runPack = async () => {
    if (busy || !packPending.length) return;
    if (splitting) return runSplit();
    setBusy('pack');
    setResult({ kind: 'none' });
    const before = packResume?.ids ?? [];
    const addedIds = [...before];
    const setName = targetPack?.name;
    const startCount = targetPack?.count ?? 0;
    const createdHere = !!packResume?.created || !setName;
    let addedNow = 0;
    setProgress({ done: before.length, total: emojis.length });
    const res = await createPackAll(
      { title: targetPack?.title ?? title, set: setName, total: emojis.length, fresh: !!packResume?.created, items: packItems(packPending) },
      (p) => setProgress({ ...p, done: p.done + before.length, total: emojis.length }),
      (batch, pack) => {
        addedIds.push(...batch.map((b) => b.id));
        addedNow += batch.length;
        // Remember the pack and the progress as soon as they exist: closing the app loses nothing.
        savePack({ name: pack.name, title: pack.title, url: pack.url, count: startCount + addedNow });
        if (addedIds.length < emojis.length) setStore('packJob', { pack: pack.name, ids: [...addedIds], created: createdHere });
      },
    );
    setBusy(null);
    setProgress(null);
    if (res.ok) {
      setTarget(res.data.name);
      setStore('packJob', null);
      setResult({ kind: 'pack', pack: res.data, added: !createdHere });
      haptic();
      return;
    }
    if (res.data) setTarget(res.data.name);
    setResult({ kind: 'error', job: 'pack', error: res.error, detail: res.detail, done: addedIds.length, total: emojis.length, pack: res.data });
  };

  const runSend = async (items: CompiledEmoji[], key: string) => {
    if (busy) return;
    // "Send all" after a half-finished run sends only what is missing.
    const skip = key === 'send' && sendResume ? sendResume.ids : [];
    const pending = items.filter((e) => !skip.includes(e.id));
    setBusy(key);
    setResult({ kind: 'none' });
    const sentIds = [...skip];
    if (pending.length > 1) setProgress({ done: skip.length, total: items.length });
    const res = await sendAllToChat(
      pending.map((e) => ({ id: e.id, name: fileName(e), data: fileData(e), type: mime() })),
      (p) => pending.length > 1 && setProgress({ ...p, done: p.done + skip.length, total: items.length }),
      (sent) => sentIds.push(...sent.map((f) => f.id)),
    );
    setBusy(null);
    setProgress(null);
    if (res.ok) {
      if (key === 'send') setSendResume(null);
      setResult({ kind: 'sent' });
      haptic();
      return;
    }
    if (key === 'send' && sentIds.length) setSendResume({ ids: sentIds });
    setResult({ kind: 'error', job: 'send', error: res.error, detail: res.detail, done: key === 'send' ? sentIds.length : undefined, total: items.length });
  };

  const progressLabel = (p: JobProgress | null) =>
    p?.waiting ? `${t('packWaiting')}: ${p.waiting} с` : p ? `${p.done} / ${p.total}` : '';

  return (
    <div className="sheet-backdrop" onClick={onClose} data-state={state}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={t('exportTitle')} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>{t('exportTitle')}</h2>
          <MotionButton motion="spin" className="icon-btn is-round" label={t('close')} icon={<CloseIcon />} onClick={onClose} />
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
            {canSplit && (
              <div className="split-option">
                <Toggle label={fill(t('packSplit'), { n: Math.ceil(emojis.length / CREATE_BATCH) })} checked={split} onChange={setSplit} />
                <p className="hint">{splitting ? t('packSplitHint') : fill(t('packOneHint'), { n: CREATE_BATCH, rest: emojis.length - CREATE_BATCH })}</p>
              </div>
            )}
            {packResume && <p className="note">{fill(t('packResumeHint'), { done: packResume.ids.filter((id) => emojis.some((e) => e.id === id)).length, total: emojis.length })}</p>}
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
                <WarningIcon width={16} height={16} /> {t(targetPack ? 'packFull' : 'packTooMany')}
              </p>
            )}
            <button type="button" className="primary-btn" disabled={!!busy || overLimit || tooBig || !packPending.length} onClick={runPack}>
              {busy === 'pack' ? <span className="btn-spinner" aria-hidden /> : <StickersIcon />}
              {busy === 'pack'
                ? `${t('packCreating')} ${progressLabel(progress)}`
                : `${packResume ? t('packContinue') : splitting ? fill(t('packCreateSplit'), { n: Math.ceil(emojis.length / CREATE_BATCH) }) : targetPack ? t('packAdd') : t('packCreate')} (${packPending.length})`}
            </button>
            {busy && progress && (
              <div className="job-progress" aria-hidden>
                <span style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} className={progress.waiting ? 'is-waiting' : ''} />
              </div>
            )}
            {busy === 'pack' && progress && !splitting && progress.total > CREATE_BATCH && (
              <p className="hint">{progress.waiting ? t('packWaitHint') : t('packPaceHint')}</p>
            )}

            {result.kind === 'packs' && (
              <div className="send-done is-list" role="status">
                <p>
                  <CheckIcon width={18} height={18} strokeWidth={3} /> {fill(t('packsCreated'), { n: result.packs.length })}
                </p>
                <div className="row-actions">
                  {result.packs.map((p) => (
                    <button key={p.name} type="button" className="pill-btn is-compact" onClick={() => openTelegramLink(p.url)}>
                      {p.title}
                    </button>
                  ))}
                </div>
              </div>
            )}
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
              <div className="note is-error" role="alert">
                <p>
                  <WarningIcon width={16} height={16} /> {t(errorKey(result.job, result.error))}
                  {result.detail ? ` (${result.detail})` : ''}
                </p>
                {!!result.done && result.total !== undefined && result.done < result.total && (
                  <p>{fill(t(result.job === 'pack' ? 'packPartial' : 'sendPartial'), { done: result.done, total: result.total })}</p>
                )}
                {result.pack && (
                  <button type="button" className="pill-btn is-compact" onClick={() => openTelegramLink(result.pack!.url)}>
                    {t('packOpen')}
                  </button>
                )}
              </div>
            )}

            <button type="button" className="secondary-btn" disabled={!!busy} onClick={() => runSend(emojis, 'send')}>
              {busy === 'send' ? <span className="btn-spinner" aria-hidden /> : <SendIcon />}
              {busy === 'send' && progress ? `${t('sending')} ${progressLabel(progress)}` : `${t('sendToChat')} (${emojis.length - (sendResume?.ids.length ?? 0)})`}
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
