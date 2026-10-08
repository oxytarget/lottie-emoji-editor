import { useCallback, useEffect, useRef, useState } from 'react';
import { createPayment, paymentStatus, type PayMethod, type Payment } from '../lib/accountApi';
import { haptic, isTelegram, openExternal, openTelegramLink } from '../lib/telegram';
import { DEFAULT_CLIENT_CONFIG, isPro, useAccount } from '../state/account';
import { useEditor } from '../state/store';
import { CheckIcon, CopyIcon, CrownIcon, SparkleIcon, WalletIcon, WarningIcon } from '../components/icons';
import { formatDate, money, useCT } from './i18n';
import { formatGram, payWithTonConnect, shortAddress, tonkeeperLink, tonTransferLink, useWallet } from './ton';
import { Crown3D } from './Crown3D';
import { Sheet, SheetButton } from './Sheets';
import { useNav, usePaymentState } from './state';

/** Official pictures: Crypto Bot's Telegram avatar; the Gram (GRAM, ex-Toncoin) coin icon as Tonkeeper ships it. */
const LOGOS: Record<PayMethod, { src: string }> = {
  cryptobot: { src: 'https://t.me/i/userpic/320/CryptoBot.jpg' },
  ton: { src: `${import.meta.env.BASE_URL}pay/gram.svg` },
};

type CT = ReturnType<typeof useCT>;

/** Why a payment could not be made, in words (with the code, so the admin can tell what to fix). */
function payError(t: CT, error: string, detail?: string): { text: string; code?: string } {
  if (error === 'accounts-off') return { text: t('payErrAccountsOff'), code: error };
  if (error === 'method-off') return { text: t('payErrMethodOff'), code: error };
  if (error === 'no-rate') return { text: t('payErrRate'), code: error };
  if (error === 'guest' || error === 'unauthorized') return { text: t('payErrGuest'), code: error };
  if (error === 'network') return { text: t('payErrNetwork') };
  if (error === 'provider') {
    if (detail && /UNAUTHORIZED|TOKEN/i.test(detail)) return { text: t('payErrToken'), code: detail };
    return { text: t('payErrProvider', { d: detail || '?' }), code: detail };
  }
  return { text: t('payFailed'), code: error };
}

/** The wallet connected on the site: connect, see which, disconnect. */
export function WalletCard() {
  const t = useCT();
  const wallet = useWallet();
  const linked = useAccount((s) => s.account?.wallet);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    wallet.init();
  }, []);
  const busy = wallet.status === 'idle' || wallet.status === 'loading' || wallet.status === 'connecting';
  return (
    <section className="card c-wallet">
      <div className="c-wallet-head">
        <MethodLogo method="ton" />
        <span className="c-method-text">
          <strong>{t('walletTitle')}</strong>
          {wallet.status === 'connected' && wallet.address ? (
            <small>
              <span className="c-wallet-dot" aria-hidden /> {t('walletLinked')}
              {wallet.app ? ` · ${wallet.app}` : ''}
            </small>
          ) : (
            <small>{linked ? t('walletOther', { a: shortAddress(linked.address) }) : t('walletText')}</small>
          )}
        </span>
      </div>
      {wallet.status === 'connected' && wallet.address ? (
        <div className="c-wallet-row">
          <code title={wallet.address}>{shortAddress(wallet.address)}</code>
          <button type="button" className="pill-btn is-compact" onClick={() => wallet.disconnect()}>
            {t('walletDisconnect')}
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="primary-btn"
          disabled={busy}
          onClick={async () => {
            setFailed(false);
            haptic();
            const ok = await wallet.connect();
            if (!ok && useWallet.getState().status !== 'connected') setFailed(true);
          }}
        >
          {busy ? <span className="btn-spinner" aria-hidden /> : <WalletIcon />} {wallet.status === 'connecting' ? t('walletConnecting') : t('walletConnect')}
        </button>
      )}
      {failed && <p className="hint is-center">{t('walletFailed')}</p>}
    </section>
  );
}

function MethodLogo({ method }: { method: PayMethod }) {
  const [broken, setBroken] = useState(false);
  return (
    <span className={`c-method-logo is-${method}`}>
      {broken ? <WalletIcon width={26} height={26} /> : <img src={LOGOS[method].src} alt="" onError={() => setBroken(true)} draggable={false} />}
    </span>
  );
}

/** The payment methods as cards; a tap starts the payment of `item`. */
function Methods({ item, price, onStart }: { item: string; price: number; onStart: (method: PayMethod) => void }) {
  const t = useCT();
  const methods = useAccount((s) => s.config?.methods ?? DEFAULT_CLIENT_CONFIG.methods);
  const list: PayMethod[] = (['cryptobot', 'ton'] as const).filter((m) => methods[m]);
  if (!list.length) {
    return (
      <p className="note is-warn">
        <WarningIcon width={16} height={16} /> {t('methodsOff')}
      </p>
    );
  }
  return (
    <div className="c-methods" data-item={item}>
      {list.map((m) => (
        <button key={m} type="button" className={`c-method is-${m}`} onClick={() => onStart(m)}>
          <MethodLogo method={m} />
          <span className="c-method-text">
            <strong>{t(m === 'cryptobot' ? 'cryptobotName' : 'tonName')}</strong>
            <small>{t(m === 'cryptobot' ? 'cryptobotDesc' : 'tonDesc')}</small>
          </span>
          <span className="pill-btn is-compact is-accent">{t('pay', { p: money(price) })}</span>
        </button>
      ))}
    </div>
  );
}

function Copyable({ label, value }: { label: string; value: string }) {
  const t = useCT();
  const [copied, setCopied] = useState(false);
  return (
    <div className="c-copy">
      <span className="label">{label}</span>
      <code>{value}</code>
      <button
        type="button"
        className="icon-btn is-small"
        aria-label={t('copy')}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            /* select by hand */
          }
        }}
      >
        {copied ? <CheckIcon width={16} height={16} /> : <CopyIcon width={16} height={16} />}
      </button>
    </div>
  );
}

/**
 * A payment from creation to confirmation: the backend creates it, the user pays in Crypto Bot or a Gram wallet,
 * and the backend confirms it with the payment system (checked here every few seconds and on return to the app).
 */
export function PaymentSheet({ item, method, resumeId, onClose }: { item: string; method?: PayMethod; resumeId?: string; onClose: () => void }) {
  const t = useCT();
  const lang = useEditor((s) => s.lang);
  const setPending = usePaymentState((s) => s.setPending);
  const setAccount = useAccount((s) => s.setAccount);
  const [payment, setPayment] = useState<Payment | null>(null);
  const [state, setState] = useState<'creating' | 'waiting' | 'checking' | 'paid' | 'expired' | 'failed'>(resumeId ? 'checking' : 'creating');
  const [note, setNote] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ text: string; code?: string } | null>(null);
  const wallet = useWallet();
  const started = useRef(false);

  const check = useCallback(
    async (id: string, manual = false) => {
      if (manual) setState('checking');
      const res = await paymentStatus(id);
      if (!res.ok) {
        if (manual) setState('waiting');
        if (res.status === 404) {
          setPending(null);
          setState('failed');
        }
        return;
      }
      setPayment(res.payment);
      setAccount(res.account);
      if (res.payment.status === 'paid') {
        setPending(null);
        setState('paid');
        haptic();
        useAccount.getState().refresh();
      } else if (res.payment.status === 'expired') {
        setPending(null);
        setState('expired');
      } else {
        setState('waiting');
        if (manual) setNote(t('notYet'));
      }
    },
    [setAccount, setPending],
  );

  // Create (or pick up) the payment once.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (resumeId) {
      check(resumeId);
      return;
    }
    (async () => {
      const res = await createPayment(item, method!);
      if (!res.ok) {
        setFailure(payError(t, res.error, typeof res.detail === 'string' ? res.detail : undefined));
        return setState('failed');
      }
      if (res.payment.method === 'ton') useWallet.getState().init();
      setPayment(res.payment);
      setPending({ id: res.payment.id, item });
      setState('waiting');
      // Crypto Bot: straight to the invoice.
      if (res.payment.method === 'cryptobot') openInvoice(res.payment);
    })();
  }, []);

  // While waiting: ask every 5 s, and right away when the user comes back from the wallet/bot.
  useEffect(() => {
    if (!payment || (state !== 'waiting' && state !== 'checking')) return;
    const id = payment.id;
    const timer = window.setInterval(() => check(id), 5000);
    const onVisible = () => document.visibilityState === 'visible' && check(id);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [payment?.id, state === 'waiting' || state === 'checking']);

  const openInvoice = (p: Payment) => {
    const url = (isTelegram() ? p.miniAppUrl : null) ?? p.url;
    if (url) openTelegramLink(url);
  };

  const payTon = async () => {
    if (!payment?.ton) return;
    setNote(null);
    try {
      await payWithTonConnect(payment.ton.address, payment.ton.nano, payment.ton.comment);
      setState('checking');
      check(payment.id);
    } catch {
      setNote(t('walletCancelled'));
    }
  };

  const title = state === 'paid' ? t('paidTitle') : state === 'expired' ? t('expiredTitle') : state === 'failed' ? t('payFailedTitle') : t('payWaiting');
  return (
    <Sheet title={title} onClose={onClose} className="c-pay">
      {state === 'creating' && (
        <p className="c-pay-status">
          <span className="btn-spinner" aria-hidden /> {t('payCreating')}
        </p>
      )}
      {state === 'failed' && (
        <p className="note is-error" role="alert">
          <WarningIcon width={16} height={16} />{' '}
          <span>
            {failure?.text ?? t('payFailed')}
            {failure?.code && <small className="c-pay-code">{t('payErrCode', { c: failure.code })}</small>}
          </span>
        </p>
      )}
      {state === 'paid' && payment && (
        <div className="c-paid">
          <div className="c-upsell-icon is-ok">
            <CheckIcon width={34} height={34} strokeWidth={3} />
          </div>
          {payment.count > 0 && <p className="c-paid-line">{t('paidCredits', { n: payment.count })}</p>}
          {payment.proDays > 0 && (
            <p className="c-paid-line">
              {t('paidPro', {
                date: formatDate(lang, useAccount.getState().account?.proUntil ?? Date.now()),
              })}
            </p>
          )}
          <SheetButton className="primary-btn">{t('done')}</SheetButton>
        </div>
      )}
      {state === 'expired' && (
        <>
          <p className="hint">{t('expiredText')}</p>
          <SheetButton className="primary-btn">{t('back')}</SheetButton>
        </>
      )}
      {(state === 'waiting' || state === 'checking') && payment && (
        <>
          <div className="c-pay-summary">
            <MethodLogo method={payment.method} />
            <span>
              <strong>{payment.item === 'pro' ? 'PRO' : t('packageCount', { n: payment.count })}</strong>
              <small>{payment.method === 'ton' && payment.ton ? `${formatGram(payment.ton.nano)} · ${money(payment.usd)}` : money(payment.usd)}</small>
            </span>
          </div>
          <p className="hint">{t('payWaitingText')}</p>
          {payment.method === 'cryptobot' && (
            <button type="button" className="primary-btn" onClick={() => openInvoice(payment)}>
              <WalletIcon /> {t('openInvoice')}
            </button>
          )}
          {payment.method === 'ton' && payment.ton && (
            <>
              <button type="button" className="primary-btn" onClick={payTon}>
                <WalletIcon /> {wallet.status === 'connected' && wallet.address ? t('payFrom', { a: shortAddress(wallet.address) }) : t('payTonConnect')}
              </button>
              <button
                type="button"
                className="secondary-btn"
                onClick={() =>
                  isTelegram()
                    ? openExternal(tonkeeperLink(payment.ton!.address, payment.ton!.nano, payment.ton!.comment))
                    : (window.location.href = tonTransferLink(payment.ton!.address, payment.ton!.nano, payment.ton!.comment))
                }
              >
                {t('payTonLink')}
              </button>
              <details className="howto">
                <summary>{t('tonManual')}</summary>
                <Copyable label={t('tonAmount')} value={formatGram(payment.ton.nano)} />
                <Copyable label={t('tonAddress')} value={payment.ton.address} />
                <Copyable label={t('tonComment')} value={payment.ton.comment} />
              </details>
            </>
          )}
          <button type="button" className="link-btn is-center" disabled={state === 'checking'} onClick={() => check(payment.id, true)}>
            {state === 'checking' ? t('checking') : t('checkNow')}
          </button>
          {note && <p className="hint is-center">{note}</p>}
        </>
      )}
    </Sheet>
  );
}

/** A payment left half-way (closed app, trip to the wallet): a bar to come back to it. */
export function PendingPaymentBar() {
  const t = useCT();
  const pending = usePaymentState((s) => s.pending);
  const [open, setOpen] = useState(false);
  if (!pending) return null;
  return (
    <>
      <button type="button" className="c-pending" onClick={() => setOpen(true)}>
        <span className="btn-spinner" aria-hidden /> {t('pendingPayment')} <strong>{t('continuePay')}</strong>
      </button>
      {open && <PaymentSheet item={pending.item} resumeId={pending.id} onClose={() => setOpen(false)} />}
    </>
  );
}

export function TopUpScreen() {
  const t = useCT();
  const config = useAccount((s) => s.config ?? DEFAULT_CLIENT_CONFIG);
  const balance = useAccount((s) => s.account?.balance ?? 0);
  const status = useAccount((s) => s.status);
  const [chosen, setChosen] = useState(config.packages[1]?.id ?? config.packages[0]?.id);
  const [paying, setPaying] = useState<PayMethod | null>(null);
  const pkg = config.packages.find((p) => p.id === chosen) ?? config.packages[0];
  const each = (p: { usd: number; count: number }) => p.usd / p.count;
  const best = config.packages.reduce((a, b) => (each(b) < each(a) ? b : a), config.packages[0]);
  // "Best value" only when some package really is cheaper per generation.
  const showBest = !!best && config.packages.some((p) => each(p) - each(best) > 0.0005);
  return (
    <div className="page">
      <section className="card c-balance-card">
        <SparkleIcon width={28} height={28} />
        <strong>{t('balanceShort', { n: balance })}</strong>
      </section>
      {status === 'free' && (
        <p className="note">
          <WarningIcon width={16} height={16} /> {t('balanceFree')}
        </p>
      )}
      <section className="card">
        <h3 className="c-step-title">{t('packagesTitle')}</h3>
        <div className="c-packages">
          {config.packages.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`c-package${p.id === pkg?.id ? ' is-selected' : ''}`}
              aria-pressed={p.id === pkg?.id}
              onClick={() => setChosen(p.id)}
            >
              {showBest && p.id === best?.id && <em className="c-best">{t('bestValue')}</em>}
              <span className="c-package-count">
                <SparkleIcon width={18} height={18} /> {p.count}
              </span>
              <span className="c-package-label">{t('packageCount', { n: p.count })}</span>
              <strong className="c-package-price">{money(p.usd)}</strong>
              <small>
                {t('perOne', {
                  p: `$${Number(each(p).toFixed(3))}`,
                })}
              </small>
            </button>
          ))}
        </div>
      </section>
      {pkg && (
        <section className="card">
          <h3 className="c-step-title">{t('methodTitle')}</h3>
          <Methods item={`pkg:${pkg.id}`} price={pkg.usd} onStart={setPaying} />
        </section>
      )}
      {config.methods.ton && status === 'ready' && <WalletCard />}
      {paying && pkg && <PaymentSheet item={`pkg:${pkg.id}`} method={paying} onClose={() => setPaying(null)} />}
    </div>
  );
}

export function ProScreen() {
  const t = useCT();
  const lang = useEditor((s) => s.lang);
  const config = useAccount((s) => s.config ?? DEFAULT_CLIENT_CONFIG);
  const pro = useAccount(isPro);
  const account = useAccount((s) => s.account);
  const [paying, setPaying] = useState<PayMethod | null>(null);
  const [choose, setChoose] = useState(false);
  const benefits = [t('proBonus', { n: config.pro.bonus }), t('proTemplates'), t('proBatch'), t('proFonts'), t('proPacks'), t('proPriority')];
  return (
    <div className="page">
      <section className="c-pro-hero">
        <Crown3D />
        <h2>{t('proTitle')}</h2>
        <p>{t('proSub')}</p>
        <strong className="c-pro-price">{t('proPrice', { p: money(config.pro.usd), d: config.pro.days })}</strong>
        {account?.role === 'pro' && <span className="c-pro-active">{t('proActive', { date: formatDate(lang, account.proUntil) })}</span>}
      </section>
      <section className="card">
        <ul className="c-benefits">
          {benefits.map((b, i) => (
            <li key={i}>
              <CheckIcon width={18} height={18} strokeWidth={3} /> {b}
            </li>
          ))}
        </ul>
        <p className="hint">{t('proFree')}</p>
      </section>
      {account?.role !== 'admin' && (
        <section className="card">
          {choose ? (
            <>
              <h3 className="c-step-title">{t('methodTitle')}</h3>
              <Methods item="pro" price={config.pro.usd} onStart={setPaying} />
            </>
          ) : (
            <button type="button" className="primary-btn c-pro-btn" onClick={() => setChoose(true)}>
              <CrownIcon /> {pro ? t('proExtend') : t('proBuy')} · {money(config.pro.usd)}
            </button>
          )}
        </section>
      )}
      {paying && <PaymentSheet item="pro" method={paying} onClose={() => setPaying(null)} />}
    </div>
  );
}

/** "Generations: 12" at the top: always visible, leads to topping up. */
export function BalanceChip() {
  const t = useCT();
  const balance = useAccount((s) => s.account?.balance);
  const status = useAccount((s) => s.status);
  const role = useAccount((s) => s.account?.role);
  const go = useNav((n) => n.go);
  if (status !== 'ready') return null;
  return (
    <button type="button" className="selected-chip c-balance-chip" onClick={() => go('topup')} title={t('topUp')}>
      {role === 'pro' && <CrownIcon width={14} height={14} className="c-chip-crown" />}
      <SparkleIcon width={16} height={16} />
      <span className="selected-chip-label">{t('balanceChip')}:</span> {balance ?? 0}
    </button>
  );
}
