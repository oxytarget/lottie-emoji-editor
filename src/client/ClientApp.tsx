import { useEffect, useRef, useState, type ReactNode } from 'react';
import { packsAvailable } from '../lib/botApi';
import { useLinkedCode } from '../lib/botLink';
import { isTelegram, telegramUser, useBackButton } from '../lib/telegram';
import type { Theme } from '../lib/theme';
import { isPro, useAccount } from '../state/account';
import { usePoster } from '../state/posters';
import { useEditor } from '../state/store';
import type { Compiled } from '../state/useCompiled';
import type { Lang } from '../templates/types';
import { Toggle } from '../components/controls';
import { Toast } from '../components/Hotkeys';
import { ClockIcon, CrownIcon, GlobeIcon, HomeIcon, MoonIcon, PenIcon, ShieldIcon, SparkleIcon, SunIcon, UserIcon } from '../components/icons';
import { useInView } from '../components/LottieView';
import { TelegramLinkCard, unlink } from '../components/TelegramLink';
import { AdminScreen } from './Admin';
import { CreateScreen, useApplyInputs } from './CreateScreen';
import { formatDate, formatDateTime, useCT, type ClientKey } from './i18n';
import { BalanceChip, PendingPaymentBar, ProScreen, TopUpScreen } from './Payments';
import { listResults, type StoredResult } from './results';
import { ResultSheet } from './Sheets';
import { useNav, type Screen } from './state';

const LANGS: Lang[] = ['uk', 'ru', 'en'];

const NAV: Array<{ screen: Screen; key: ClientKey; icon: ReactNode }> = [
  { screen: 'home', key: 'navHome', icon: <HomeIcon /> },
  { screen: 'create', key: 'navCreate', icon: <PenIcon /> },
  { screen: 'history', key: 'navHistory', icon: <ClockIcon /> },
  { screen: 'pro', key: 'navPro', icon: <CrownIcon /> },
  { screen: 'profile', key: 'navProfile', icon: <UserIcon /> },
];

const TITLES: Record<Screen, ClientKey> = {
  home: 'titleHome',
  create: 'titleCreate',
  history: 'titleHistory',
  topup: 'titleTopUp',
  pro: 'titlePro',
  profile: 'titleProfile',
  admin: 'titleAdmin',
};

function ClientNav() {
  const t = useCT();
  const screen = useNav((n) => n.screen);
  const go = useNav((n) => n.go);
  return (
    <nav className="section-nav is-5" aria-label={t('navHome')}>
      {NAV.map((item) => (
        <button
          key={item.screen}
          type="button"
          className={`section-nav-item${screen === item.screen ? ' is-active' : ''}${item.screen === 'pro' ? ' is-pro' : ''}`}
          aria-current={screen === item.screen ? 'page' : undefined}
          onClick={() => go(item.screen)}
        >
          <span className="section-nav-icon">{item.icon}</span>
          <span className="section-nav-label">{t(item.key)}</span>
        </button>
      ))}
    </nav>
  );
}

function Thumb({ json }: { json: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const poster = usePoster(json, { frac: 0.45 }, 96, useInView(ref));
  return (
    <span ref={ref} className="c-thumb">
      {poster && <img src={poster} alt="" draggable={false} />}
    </span>
  );
}

/** Generations: the backend's list, with the files this device keeps. */
function useHistoryItems() {
  const history = useAccount((s) => s.history);
  const [local, setLocal] = useState<StoredResult[]>([]);
  useEffect(() => {
    listResults().then(setLocal);
  }, [history.length]);
  const byId = new Map(local.map((r) => [r.id, r]));
  const ids = new Set(history.map((h) => h.id));
  return [
    ...history.map((h) => ({
      id: h.id,
      at: h.at,
      title: h.title,
      cost: h.cost,
      count: h.templates.length,
      result: byId.get(h.id) ?? null,
    })),
    // Kept here but not listed by the backend (free mode, another account): still the user's.
    ...local
      .filter((r) => !ids.has(r.id))
      .map((r) => ({
        id: r.id,
        at: r.at,
        title: r.title,
        cost: 0,
        count: r.files.length,
        result: r,
      })),
  ].sort((a, b) => b.at - a.at);
}

function HistoryList({ limit }: { limit?: number }) {
  const t = useCT();
  const lang = useEditor((s) => s.lang);
  const items = useHistoryItems();
  const [open, setOpen] = useState<StoredResult | null>(null);
  const shown = limit ? items.slice(0, limit) : items;
  if (!shown.length) return <p className="hint">{t('historyEmpty')}</p>;
  return (
    <>
      <ul className="c-history">
        {shown.map((h) => (
          <li key={h.id}>
            <button type="button" className="c-history-item" disabled={!h.result} onClick={() => h.result && setOpen(h.result)}>
              {h.result ? <Thumb json={h.result.files[0].json} /> : <span className="c-thumb is-empty" />}
              <span className="c-history-text">
                <strong>{h.title}</strong>
                <small>
                  {formatDateTime(lang, h.at)}
                  {h.count > 1 ? ` · ${t('templatesN', { n: h.count })}` : ''} · {h.cost ? t('historyCost', { n: h.cost }) : t('historyFree')}
                </small>
                {!h.result && <small className="c-elsewhere">{t('historyElsewhere')}</small>}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {open && <ResultSheet result={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function Home() {
  const t = useCT();
  const go = useNav((n) => n.go);
  const status = useAccount((s) => s.status);
  const balance = useAccount((s) => s.account?.balance ?? 0);
  const pro = useAccount(isPro);
  const user = telegramUser();
  return (
    <div className="page">
      <section className="c-hero">
        <h2>{user ? t('hello', { name: user.name.split(' ')[0] }) : t('helloGuest')}</h2>
        <p>{t('heroText')}</p>
        <button type="button" className="primary-btn" onClick={() => go('create')}>
          <SparkleIcon /> {t('createCta')}
        </button>
      </section>
      {status === 'ready' && (
        <section className="card c-balance-card">
          <SparkleIcon width={26} height={26} />
          <strong>{t('balanceShort', { n: balance })}</strong>
          <button type="button" className="pill-btn is-compact is-accent" onClick={() => go('topup')}>
            {t('topUp')}
          </button>
        </section>
      )}
      {status === 'guest' && packsAvailable() && !isTelegram() && (
        <section className="card">
          <h3 className="c-step-title">{t('signInTitle')}</h3>
          <p className="hint">{t('signInText')}</p>
          <TelegramLinkCard />
        </section>
      )}
      {!pro && status === 'ready' && (
        <button type="button" className="c-pro-promo" onClick={() => go('pro')}>
          <CrownIcon width={28} height={28} />
          <span>
            <strong>PRO</strong>
            <small>{t('proPromo')}</small>
          </span>
          <em>{t('proMore')}</em>
        </button>
      )}
      <section className="card">
        <h3 className="c-step-title">{t('howTitle')}</h3>
        <ol className="c-how">
          {(['how1', 'how2', 'how3', 'how4'] as const).map((k, i) => (
            <li key={k}>
              <span className="c-step-n">{i + 1}</span> {t(k)}
            </li>
          ))}
        </ol>
      </section>
      <section className="card">
        <div className="c-section-head">
          <h3 className="c-step-title">{t('recent')}</h3>
          <button type="button" className="link-btn" onClick={() => go('history')}>
            {t('seeAll')}
          </button>
        </div>
        <HistoryList limit={3} />
      </section>
    </div>
  );
}

function Profile({ theme, onTheme }: { theme: Theme; onTheme: () => void }) {
  const t = useCT();
  const lang = useEditor((s) => s.lang);
  const set = useEditor((s) => s.set);
  const account = useAccount((s) => s.account);
  const status = useAccount((s) => s.status);
  const advanced = useAccount((s) => s.advanced);
  const setAdvanced = useAccount((s) => s.setAdvanced);
  const go = useNav((n) => n.go);
  const linked = !!useLinkedCode();
  const user = telegramUser();
  const name = user?.name ?? (account ? `#${account.id}` : t('helloGuest'));
  const role = account?.role ?? 'user';
  return (
    <div className="page">
      <section className="card profile-card">
        <div className="profile-avatar">{user?.photo ? <img src={user.photo} alt="" /> : <span>{name.slice(0, 1).toUpperCase()}</span>}</div>
        <h3 className="profile-name">{name}</h3>
        <span className={`c-role is-${role}`}>{t(role === 'admin' ? 'roleAdmin' : role === 'pro' ? 'rolePro' : 'roleUser')}</span>
        {account && <span className="hint">{t('userId', { id: account.id })}</span>}
        {status === 'ready' && account && (
          <p className="profile-stats">
            ✨ {account.balance}
            {account.role === 'pro' ? ` · PRO → ${formatDate(lang, account.proUntil)}` : ''}
          </p>
        )}
        <div className="setting-rows">
          <div className="setting-row">
            <span className="label">{t('language')}</span>
            <button type="button" className="chip-btn" onClick={() => set('lang', LANGS[(LANGS.indexOf(lang) + 1) % LANGS.length])}>
              <GlobeIcon width={16} height={16} /> {lang.toUpperCase()}
            </button>
          </div>
          <div className="setting-row">
            <span className="label">{t('theme')}</span>
            <button type="button" className="chip-btn" onClick={onTheme}>
              {theme === 'dark' ? <MoonIcon width={16} height={16} /> : <SunIcon width={16} height={16} />} {t(theme === 'dark' ? 'themeDark' : 'themeLight')}
            </button>
          </div>
          {packsAvailable() && !isTelegram() && linked && (
            <div className="setting-row">
              <span className="label">Telegram</span>
              <button type="button" className="chip-btn" onClick={unlink}>
                ✕
              </button>
            </div>
          )}
        </div>
      </section>
      {packsAvailable() && !isTelegram() && !linked && <TelegramLinkCard />}
      {status === 'ready' && (
        <div className="row-actions c-profile-actions">
          <button type="button" className="pill-btn" onClick={() => go('topup')}>
            <SparkleIcon width={16} height={16} /> {t('topUp')}
          </button>
          <button type="button" className="pill-btn" onClick={() => go('history')}>
            <ClockIcon width={16} height={16} /> {t('titleHistory')}
          </button>
        </div>
      )}
      {role === 'admin' && (
        <section className="card">
          <h3 className="c-step-title">
            <ShieldIcon width={18} height={18} /> {t('roleAdmin')}
          </h3>
          <button type="button" className="secondary-btn" onClick={() => go('admin')}>
            {t('adminPanel')}
          </button>
          <Toggle label={t('advanced')} checked={advanced} onChange={setAdvanced} />
          <p className="hint">{t('advancedHint')}</p>
        </section>
      )}
    </div>
  );
}

/** The app for clients: a few clear screens, the editor's power hidden behind automatic layout. */
export function ClientApp({ compiled, theme, onTheme }: { compiled: Compiled; theme: Theme; onTheme: () => void }) {
  const t = useCT();
  const screen = useNav((n) => n.screen);
  const go = useNav((n) => n.go);
  const role = useAccount((s) => s.account?.role);
  useApplyInputs();
  // Telegram's Back button goes home from any other screen.
  useBackButton(screen !== 'home', () => go('home'));
  // Not an admin (any more): no admin screen.
  useEffect(() => {
    if (screen === 'admin' && role !== 'admin') go('home');
  }, [screen, role]);
  return (
    <div className="app c-app">
      <header className="topbar">
        <h1 className="topbar-title">{t(TITLES[screen])}</h1>
        <ClientNav />
        <BalanceChip />
      </header>
      <PendingPaymentBar />
      {screen === 'home' && <Home />}
      {screen === 'create' && <CreateScreen compiled={compiled} />}
      {screen === 'history' && (
        <div className="page">
          <section className="card">
            <HistoryList />
          </section>
        </div>
      )}
      {screen === 'topup' && <TopUpScreen />}
      {screen === 'pro' && <ProScreen />}
      {screen === 'profile' && <Profile theme={theme} onTheme={onTheme} />}
      {screen === 'admin' && role === 'admin' && <AdminScreen />}
      <Toast />
    </div>
  );
}
