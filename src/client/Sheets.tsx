import { useEffect, useState, type ReactNode } from 'react';
import { canUseBot, packsAvailable } from '../lib/botApi';
import { haptic, isTelegram, openTelegramLink } from '../lib/telegram';
import { useAccount } from '../state/account';
import { CheckIcon, CloseIcon, CrownIcon, DownloadIcon, SendIcon, SparkleIcon, StickersIcon, WarningIcon } from '../components/icons';
import { LottieView } from '../components/LottieView';
import { TelegramLinkCard } from '../components/TelegramLink';
import { downloadResult, packResult, sendResult, type GenerateError } from './generate';
import { useCT } from './i18n';
import type { StoredResult } from './results';
import { useNav } from './state';

/** A sheet from the bottom (a dialog on wide screens), closed by the backdrop, ✕ or Escape. */
export function Sheet({ title, onClose, children, className = '' }: { title: string; onClose: () => void; children: ReactNode; className?: string }) {
  const t = useCT();
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
  return (
    <div className="sheet-backdrop" data-state="open" onClick={onClose}>
      <div className={`sheet ${className}`} role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn is-round" aria-label={t('close')} onClick={onClose}>
            <CloseIcon />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** A finished design: download it, have the bot send it or make an emoji pack of it. */
export function ResultSheet({ result, onClose, onAnother }: { result: StoredResult; onClose: () => void; onAnother?: () => void }) {
  const t = useCT();
  const [busy, setBusy] = useState<null | 'send' | 'pack'>(null);
  const [sent, setSent] = useState(false);
  const [pack, setPack] = useState<{ url: string } | null>(null);
  const [progress, setProgress] = useState('');
  const [failed, setFailed] = useState(false);
  const viaBot = canUseBot();

  const send = async () => {
    setBusy('send');
    setFailed(false);
    const ok = await sendResult(result);
    setBusy(null);
    setSent(ok);
    setFailed(!ok);
    if (ok) haptic();
  };
  const makePack = async () => {
    setBusy('pack');
    setFailed(false);
    const made = await packResult(result, (done, total) => setProgress(`${done} / ${total}`));
    setBusy(null);
    setProgress('');
    setPack(made);
    setFailed(!made);
    if (made) haptic();
  };

  return (
    <Sheet title={t('resultTitle')} onClose={onClose} className="c-result">
      <div className={`c-result-grid${result.files.length > 1 ? ' is-many' : ''}`}>
        {result.files.slice(0, 12).map((f) => (
          <LottieView key={f.name} json={f.json} className="c-result-anim" />
        ))}
      </div>
      <p className="hint is-center">{t('resultText')}</p>
      <button type="button" className="primary-btn" onClick={() => downloadResult(result)}>
        <DownloadIcon /> {result.files.length > 1 ? t('downloadZip') : t('download')}
      </button>
      {viaBot && (
        <>
          <button type="button" className="secondary-btn" disabled={!!busy || sent} onClick={send}>
            {busy === 'send' ? <span className="btn-spinner" aria-hidden /> : sent ? <CheckIcon /> : <SendIcon />} {sent ? t('sentTg') : t('sendTg')}
          </button>
          {pack ? (
            <button type="button" className="secondary-btn" onClick={() => openTelegramLink(pack.url)}>
              <CheckIcon /> {t('packReady')} · {t('openPack')}
            </button>
          ) : (
            <button type="button" className="secondary-btn" disabled={!!busy} onClick={makePack}>
              {busy === 'pack' ? <span className="btn-spinner" aria-hidden /> : <StickersIcon />} {t('makePack')} {progress}
            </button>
          )}
        </>
      )}
      {!viaBot && packsAvailable() && !isTelegram() && <TelegramLinkCard />}
      {failed && (
        <p className="note is-error" role="alert">
          <WarningIcon width={16} height={16} /> {t('actionFailed')}
        </p>
      )}
      {onAnother && (
        <button type="button" className="link-btn is-center" onClick={onAnother}>
          {t('another')}
        </button>
      )}
    </Sheet>
  );
}

/** Out of generations, or a PRO feature: says so plainly and leads to topping up / PRO. */
export function UpsellSheet({ problem, onClose }: { problem: GenerateError; onClose: () => void }) {
  const t = useCT();
  const go = useNav((n) => n.go);
  const account = useAccount((s) => s.account);
  if (problem.kind === 'guest') {
    return (
      <Sheet title={t('signInTitle')} onClose={onClose}>
        <p className="hint">{t('signInText')}</p>
        <TelegramLinkCard />
      </Sheet>
    );
  }
  if (problem.kind === 'no-balance') {
    return (
      <Sheet title={t('noBalanceTitle')} onClose={onClose}>
        <div className="c-upsell-icon">
          <SparkleIcon width={34} height={34} />
        </div>
        <p className="hint is-center">
          {t('noBalanceText', {
            cost: problem.cost,
            balance: problem.balance ?? account?.balance ?? 0,
          })}
        </p>
        <button
          type="button"
          className="primary-btn"
          onClick={() => {
            onClose();
            go('topup');
          }}
        >
          <SparkleIcon /> {t('topUp')}
        </button>
        <button type="button" className="link-btn is-center" onClick={onClose}>
          {t('later')}
        </button>
      </Sheet>
    );
  }
  if (problem.kind === 'pro') {
    return (
      <Sheet title={t('proNeededTitle')} onClose={onClose}>
        <div className="c-upsell-icon is-pro">
          <CrownIcon width={34} height={34} />
        </div>
        <p className="hint is-center">{t(problem.reason === 'batch' ? 'proNeededBatch' : problem.reason === 'font' ? 'proNeededFont' : 'proNeededTemplate')}</p>
        <button
          type="button"
          className="primary-btn c-pro-btn"
          onClick={() => {
            onClose();
            go('pro');
          }}
        >
          <CrownIcon /> {t('getPro')}
        </button>
        <button type="button" className="link-btn is-center" onClick={onClose}>
          {t('later')}
        </button>
      </Sheet>
    );
  }
  return (
    <Sheet title={t('resultTitle')} onClose={onClose}>
      <p className="note is-warn">
        <WarningIcon width={16} height={16} /> {t('tooBig')}
      </p>
    </Sheet>
  );
}
