import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
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

const EXIT_MS = 240;
const reducedMotion = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Closes the sheet around: plays the closing animation, then `onClose`, then `then`. */
const SheetCloser = createContext<(then?: () => void) => void>((then) => then?.());
export const useSheetClose = () => useContext(SheetCloser);

/**
 * A sheet from the bottom (a dialog on wide screens), closed by the backdrop, ✕, Escape or a SheetButton — always
 * with its closing animation (slides down / fades) before it goes away.
 */
export function Sheet({ title, onClose, children, className = '' }: { title: string; onClose: () => void; children: ReactNode; className?: string }) {
  const t = useCT();
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const timer = useRef(0);
  const close = useCallback((then?: () => void) => {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    timer.current = window.setTimeout(
      () => {
        onCloseRef.current();
        then?.();
      },
      reducedMotion() ? 0 : EXIT_MS,
    );
  }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [close]);
  return (
    <SheetCloser.Provider value={close}>
      <div className="sheet-backdrop" data-state={closing ? 'closed' : 'open'} onClick={() => close()}>
        <div className={`sheet ${className}`} role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
          <div className="sheet-head">
            <h2>{title}</h2>
            <button type="button" className="icon-btn is-round" aria-label={t('close')} onClick={() => close()}>
              <CloseIcon />
            </button>
          </div>
          {children}
        </div>
      </div>
    </SheetCloser.Provider>
  );
}

/** A button that closes the sheet (with its animation) and then does `then`. */
export function SheetButton({ then, className, children }: { then?: () => void; className: string; children: ReactNode }) {
  const close = useSheetClose();
  return (
    <button type="button" className={className} onClick={() => close(then)}>
      {children}
    </button>
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
        <SheetButton className="link-btn is-center" then={onAnother}>
          {t('another')}
        </SheetButton>
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
        <SheetButton className="primary-btn" then={() => go('topup')}>
          <SparkleIcon /> {t('topUp')}
        </SheetButton>
        <SheetButton className="link-btn is-center">{t('later')}</SheetButton>
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
        <SheetButton className="primary-btn c-pro-btn" then={() => go('pro')}>
          <CrownIcon /> {t('getPro')}
        </SheetButton>
        <SheetButton className="link-btn is-center">{t('later')}</SheetButton>
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
