import { useEffect, useState } from 'react';
import { adminCall, type Account, type ClientConfig, type Generation, type Payment } from '../lib/accountApi';
import { useAccount } from '../state/account';
import { useEditor } from '../state/store';
import { useUi } from '../state/ui';
import { BUILTIN_TEMPLATES } from '../templates/builtin';
import { Segmented } from '../components/controls';
import { CheckIcon, PlusIcon, ShieldIcon, TrashIcon, WarningIcon } from '../components/icons';
import { formatDate, formatDateTime, money, useCT } from './i18n';

type Tab = 'settings' | 'templates' | 'users' | 'payments';
type Editable = Pick<ClientConfig, 'packages' | 'pro' | 'templates'> & {
  starter: number;
  cost: number;
};

function Settings({ config, onSaved }: { config: Editable; onSaved: (c: Editable) => void }) {
  const t = useCT();
  const [draft, setDraft] = useState<Editable>(config);
  const [state, setState] = useState<null | 'saving' | 'saved' | string>(null);
  const num = (v: string) => (v === '' ? 0 : Number(v));
  const save = async () => {
    setState('saving');
    const res = await adminCall<{ config: Editable }>('config', {
      config: draft,
    });
    if (!res.ok) return setState(res.error);
    setDraft(res.config);
    onSaved(res.config);
    setState('saved');
  };
  return (
    <section className="card c-admin">
      <label className="field">
        <span className="label">{t('admStarter')}</span>
        <input type="number" min={0} value={draft.starter} onChange={(e) => setDraft({ ...draft, starter: num(e.target.value) })} />
      </label>
      <label className="field">
        <span className="label">{t('admCost')}</span>
        <input type="number" min={1} value={draft.cost} onChange={(e) => setDraft({ ...draft, cost: num(e.target.value) })} />
      </label>
      <h3 className="c-step-title">{t('admPackages')}</h3>
      {draft.packages.map((p, i) => (
        <div key={i} className="c-admin-row">
          <label className="field">
            <span className="label">{t('admCount')}</span>
            <input
              type="number"
              min={1}
              value={p.count}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  packages: draft.packages.map((q, j) => (j === i ? { ...q, count: num(e.target.value) } : q)),
                })
              }
            />
          </label>
          <label className="field">
            <span className="label">{t('admPrice')}</span>
            <input
              type="number"
              min={0.01}
              step={0.01}
              value={p.usd}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  packages: draft.packages.map((q, j) => (j === i ? { ...q, usd: num(e.target.value) } : q)),
                })
              }
            />
          </label>
          <button
            type="button"
            className="icon-btn is-small"
            aria-label="−"
            onClick={() =>
              setDraft({
                ...draft,
                packages: draft.packages.filter((_, j) => j !== i),
              })
            }
          >
            <TrashIcon width={16} height={16} />
          </button>
        </div>
      ))}
      {draft.packages.length < 8 && (
        <button
          type="button"
          className="pill-btn is-compact"
          onClick={() =>
            setDraft({
              ...draft,
              packages: [...draft.packages, { id: `p${Date.now().toString(36)}`, count: 10, usd: 10 }],
            })
          }
        >
          <PlusIcon width={16} height={16} /> {t('admAddPackage')}
        </button>
      )}
      <h3 className="c-step-title">{t('admProPlan')}</h3>
      <div className="c-admin-row is-3">
        <label className="field">
          <span className="label">{t('admPrice')}</span>
          <input
            type="number"
            min={0.01}
            step={0.01}
            value={draft.pro.usd}
            onChange={(e) =>
              setDraft({
                ...draft,
                pro: { ...draft.pro, usd: num(e.target.value) },
              })
            }
          />
        </label>
        <label className="field">
          <span className="label">{t('admDays')}</span>
          <input
            type="number"
            min={1}
            value={draft.pro.days}
            onChange={(e) =>
              setDraft({
                ...draft,
                pro: { ...draft.pro, days: num(e.target.value) },
              })
            }
          />
        </label>
        <label className="field">
          <span className="label">{t('admBonus')}</span>
          <input
            type="number"
            min={0}
            value={draft.pro.bonus}
            onChange={(e) =>
              setDraft({
                ...draft,
                pro: { ...draft.pro, bonus: num(e.target.value) },
              })
            }
          />
        </label>
      </div>
      <button type="button" className="primary-btn" disabled={state === 'saving'} onClick={save}>
        {state === 'saving' ? <span className="btn-spinner" aria-hidden /> : state === 'saved' ? <CheckIcon /> : null}{' '}
        {state === 'saved' ? t('admSaved') : t('admSave')}
      </button>
      {state && state !== 'saving' && state !== 'saved' && <p className="note is-error">{t('admFailed', { e: state })}</p>}
    </section>
  );
}

function Templates({ config, onSaved }: { config: Editable; onSaved: (c: Editable) => void }) {
  const t = useCT();
  const lang = useEditor((s) => s.lang);
  const botPacks = useUi((u) => u.botPacks) ?? [];
  const [rules, setRules] = useState(config.templates);
  const [saving, setSaving] = useState(false);
  const toggle = async (id: string, key: 'hidden' | 'pro') => {
    const next = { ...rules, [id]: { ...rules[id], [key]: !rules[id]?.[key] } };
    setRules(next);
    setSaving(true);
    const res = await adminCall<{ config: Editable }>('config', {
      config: { ...config, templates: next },
    });
    setSaving(false);
    if (res.ok) {
      setRules(res.config.templates);
      onSaved(res.config);
    }
  };
  const row = (id: string, name: string) => (
    <li key={id} className="c-admin-template">
      <span>{name}</span>
      <button
        type="button"
        className={`chip-btn${rules[id]?.pro ? ' is-active' : ''}`}
        aria-pressed={!!rules[id]?.pro}
        disabled={saving}
        onClick={() => toggle(id, 'pro')}
      >
        {t('admPro')}
      </button>
      <button
        type="button"
        className={`chip-btn${rules[id]?.hidden ? ' is-active' : ''}`}
        aria-pressed={!!rules[id]?.hidden}
        disabled={saving}
        onClick={() => toggle(id, 'hidden')}
      >
        {t('admHidden')}
      </button>
    </li>
  );
  return (
    <section className="card c-admin">
      <p className="hint">{t('admTemplatesHint')}</p>
      <h3 className="c-step-title">{t('admBuiltIn')}</h3>
      <ul className="c-admin-list">{BUILTIN_TEMPLATES.map((tpl) => row(tpl.id, tpl.name[lang] ?? tpl.id))}</ul>
      {botPacks.length > 0 && (
        <>
          <h3 className="c-step-title">{t('admPacks')}</h3>
          <ul className="c-admin-list">{botPacks.map((p) => row(`pack:${p.name}`, p.title))}</ul>
        </>
      )}
    </section>
  );
}

function Users() {
  const t = useCT();
  const lang = useEditor((s) => s.lang);
  const [user, setUser] = useState('');
  const [amount, setAmount] = useState('10');
  const [proDays, setProDays] = useState('0');
  const [found, setFound] = useState<{
    account: Account;
    history?: Generation[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lookup = async () => {
    setError(null);
    const res = await adminCall<{ account: Account; history: Generation[] }>('user', { user: Number(user) });
    if (res.ok) setFound(res);
    else setError(res.error);
  };
  const grant = async () => {
    setError(null);
    const res = await adminCall<{ account: Account }>('grant', {
      user: Number(user),
      amount: Number(amount),
      proDays: Number(proDays),
    });
    if (res.ok) setFound({ ...found, account: res.account });
    else setError(res.error);
  };
  return (
    <section className="card c-admin">
      <div className="c-admin-row">
        <label className="field">
          <span className="label">{t('admUserId')}</span>
          <input inputMode="numeric" value={user} onChange={(e) => setUser(e.target.value.replace(/\D/g, ''))} />
        </label>
        <button type="button" className="pill-btn is-compact" disabled={!user} onClick={lookup}>
          {t('admLookup')}
        </button>
      </div>
      {found && (
        <p className="c-admin-user">
          <ShieldIcon width={16} height={16} /> #{found.account.id} · {found.account.role.toUpperCase()} · ✨ {found.account.balance}
          {found.account.proUntil > Date.now() ? ` · PRO → ${formatDate(lang, found.account.proUntil)}` : ''}
        </p>
      )}
      <div className="c-admin-row">
        <label className="field">
          <span className="label">{t('admAmount')}</span>
          <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <label className="field">
          <span className="label">{t('admProDays')}</span>
          <input type="number" min={0} value={proDays} onChange={(e) => setProDays(e.target.value)} />
        </label>
      </div>
      <button type="button" className="primary-btn" disabled={!user} onClick={grant}>
        {t('admGrant')}
      </button>
      {error && <p className="note is-error">{t('admFailed', { e: error })}</p>}
    </section>
  );
}

function Payments() {
  const t = useCT();
  const lang = useEditor((s) => s.lang);
  const [list, setList] = useState<Array<Payment & { user?: number }> | null>(null);
  useEffect(() => {
    adminCall<{ payments: Array<Payment & { user?: number }> }>('payments').then((res) => setList(res.ok ? res.payments : []));
  }, []);
  if (!list) return <span className="btn-spinner" aria-hidden />;
  if (!list.length) return <p className="hint">{t('admNoPayments')}</p>;
  return (
    <section className="card c-admin">
      <ul className="c-admin-list">
        {list.map((p) => (
          <li key={p.id} className={`c-admin-payment is-${p.status}`}>
            <span>
              <strong>{p.item === 'pro' ? 'PRO' : `✨ ${p.count}`}</strong> · {money(p.usd)} · {p.method}
            </span>
            <small>
              #{p.user} · {formatDateTime(lang, p.createdAt)} · {p.status}
            </small>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Admin panel: the settings, templates, users and payments — every action is checked by the backend again. */
export function AdminScreen() {
  const t = useCT();
  const status = useAccount((s) => s.status);
  const setAdvanced = useAccount((s) => s.setAdvanced);
  const [tab, setTab] = useState<Tab>('settings');
  const [config, setConfig] = useState<Editable | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (status !== 'ready') return;
    adminCall<{ config: Editable }>('get').then((res) => (res.ok ? setConfig(res.config) : setError(res.error)));
  }, [status]);
  return (
    <div className="page">
      <button type="button" className="primary-btn" onClick={() => setAdvanced(true)}>
        <ShieldIcon /> {t('admOpenEditor')}
      </button>
      {status === 'free' ? (
        <p className="note is-warn">
          <WarningIcon width={16} height={16} /> {t('admAccountsOff')}
        </p>
      ) : (
        <>
          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              { value: 'settings', label: t('admSettings') },
              { value: 'templates', label: t('admTemplates') },
              { value: 'users', label: t('admUsers') },
              { value: 'payments', label: t('admPayments') },
            ]}
          />
          {error && <p className="note is-error">{t('admFailed', { e: error })}</p>}
          {config && tab === 'settings' && <Settings config={config} onSaved={setConfig} />}
          {config && tab === 'templates' && <Templates config={config} onSaved={setConfig} />}
          {tab === 'users' && <Users />}
          {tab === 'payments' && <Payments />}
        </>
      )}
    </div>
  );
}
