/**
 * Buying generations and PRO with crypto. Generations are credited only when the payment is confirmed by the
 * payment system itself — never because the editor says "paid" — and exactly once per payment.
 *
 *   POST /api/app/pay        — creates a payment: a Crypto Bot invoice, or a TON transfer to make.
 *   POST /api/app/pay-status — asks the payment system (Crypto Pay getInvoices / the TON blockchain via toncenter)
 *                              and credits a paid payment.
 *   POST /api/app/cryptopay  — Crypto Pay webhook (signed with the app token): credits right when an invoice is paid.
 *
 * Crypto Pay: https://help.crypt.bot/crypto-pay-api — invoices priced in USD, paid in any crypto the bot accepts.
 * Gram (GRAM, the TON blockchain's coin — Toncoin until June 2026; the method id stays "ton"): a transfer to
 * TON_WALLET with a unique comment, sent from the wallet the user connected (TON Connect) or any other, and found on
 * the blockchain by that comment and amount — the "invoice-based deposits" of https://docs.ton.org/applications/payments/gram.
 */
import { account, accountRequest, keys, readConfig, type AppConfig } from './account.js';
import { json, type Env } from './shared.js';
import { storeOf, type Store } from './store.js';

export type Method = 'cryptobot' | 'ton';

export interface Payment {
  id: string;
  user: number;
  /** "pkg:<package id>" or "pro". */
  item: string;
  /** Generations credited. */
  count: number;
  /** PRO days added. */
  proDays: number;
  usd: number;
  method: Method;
  status: 'pending' | 'paid' | 'expired';
  createdAt: number;
  paidAt?: number;
  /** Crypto Bot. */
  invoiceId?: number;
  url?: string;
  miniAppUrl?: string;
  /** Gram (TON): what to send (nano = 10⁻⁹ GRAM), and the wallet linked when the payment was made. */
  ton?: { address: string; nano: string; comment: string; from?: string };
  /** TON transaction hash, or the asset Crypto Bot was paid in. */
  proof?: string;
}

const DAY = 86_400_000;
const PAYMENT_TTL = 120 * 86_400;
/** A TON transfer may arrive this long after the payment was made. */
const TON_WINDOW = 2 * DAY;

const newId = () => [...crypto.getRandomValues(new Uint8Array(9))].map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, 14);

async function savePayment(store: Store, p: Payment): Promise<void> {
  await store.set(keys.payment(p.id), JSON.stringify(p), { exSeconds: PAYMENT_TTL });
}

async function loadPayment(store: Store, id: string): Promise<Payment | null> {
  const raw = /^[a-z0-9]{6,20}$/.test(id) ? await store.get(keys.payment(id)) : null;
  return raw ? (JSON.parse(raw) as Payment) : null;
}

/** What an item gives and costs (from the admin's settings). */
export function priceOf(config: AppConfig, item: string): { count: number; proDays: number; usd: number; title: string } | null {
  if (item === 'pro') return { count: config.pro.bonus, proDays: config.pro.days, usd: config.pro.usd, title: `PRO ${config.pro.days}d` };
  const pkg = item.startsWith('pkg:') ? config.packages.find((p) => p.id === item.slice(4)) : undefined;
  return pkg ? { count: pkg.count, proDays: 0, usd: pkg.usd, title: `${pkg.count} generations` } : null;
}

// ---------------------------------------------------------------------------
// Crypto Pay (@CryptoBot)
// ---------------------------------------------------------------------------

const cryptoPayBase = (env: Env) => (env.CRYPTO_PAY_API ?? (env.CRYPTO_PAY_NETWORK === 'testnet' ? 'https://testnet-pay.crypt.bot' : 'https://pay.crypt.bot')).replace(/\/+$/, '');

interface Invoice {
  invoice_id: number;
  status: 'active' | 'paid' | 'expired';
  bot_invoice_url?: string;
  mini_app_invoice_url?: string;
  web_app_invoice_url?: string;
  payload?: string;
  amount?: string;
  fiat?: string;
  currency_type?: string;
  paid_asset?: string;
}

/** A Crypto Pay error; `reason` is the API's error name (UNAUTHORIZED, PAID_BTN_URL_INVALID…) — safe to show. */
export class CryptoPayError extends Error {
  constructor(
    method: string,
    readonly reason: string,
  ) {
    super(`crypto pay ${method}: ${reason}`);
  }
}

async function cryptoPay<T>(env: Env, method: string, params: Record<string, unknown>): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${cryptoPayBase(env)}/api/${method}`, {
      method: 'POST',
      headers: { 'Crypto-Pay-API-Token': env.CRYPTO_PAY_TOKEN ?? '', 'content-type': 'application/json' },
      body: JSON.stringify(params),
    });
  } catch {
    throw new CryptoPayError(method, 'NETWORK');
  }
  const body = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: T; error?: { name?: string; code?: number } | string };
  if (!body.ok) {
    const name = typeof body.error === 'string' ? body.error : (body.error?.name ?? `HTTP_${res.status}`);
    throw new CryptoPayError(method, String(name).replace(/[^\w .:-]/g, '').slice(0, 80) || `HTTP_${res.status}`);
  }
  return body.result as T;
}

const isHttpUrl = (url: string | undefined) => !!url && /^https?:\/\/[^\s]+$/i.test(url);

/**
 * A USD invoice, with a "back to the app" button after paying when the app has a web address. Should Crypto Pay
 * refuse the button (its URL rules), the invoice is made without it — a payment matters more than the button.
 */
export async function createCryptoInvoice(env: Env, p: Payment, title: string): Promise<Invoice> {
  const params: Record<string, unknown> = {
    currency_type: 'fiat',
    fiat: 'USD',
    amount: p.usd.toFixed(2),
    description: `MojiMotion — ${title}`.slice(0, 1024),
    payload: p.id,
    allow_comments: false,
    expires_in: 3600,
  };
  const button = isHttpUrl(env.APP_URL) ? { paid_btn_name: 'callback', paid_btn_url: env.APP_URL } : null;
  try {
    return await cryptoPay<Invoice>(env, 'createInvoice', { ...params, ...button });
  } catch (err) {
    if (!button || !(err instanceof CryptoPayError) || !/PAID_BTN|URL/i.test(err.reason)) throw err;
    console.warn('crypto pay refused the paid button, creating the invoice without it', err.reason);
    return cryptoPay<Invoice>(env, 'createInvoice', params);
  }
}

/** Whether an invoice settles this payment: paid, ours, for at least the price. */
const invoicePays = (inv: Invoice, p: Payment) =>
  inv.status === 'paid' && inv.payload === p.id && (inv.currency_type !== 'fiat' || (inv.fiat === 'USD' && Number(inv.amount) + 1e-9 >= p.usd));

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

/** Crypto Pay signs webhooks with HMAC-SHA256 of the body, keyed with SHA-256 of the app token. */
export async function cryptoPaySignature(token: string, body: string): Promise<string> {
  const secret = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  const key = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)));
}

// ---------------------------------------------------------------------------
// TON
// ---------------------------------------------------------------------------

const toncenterBase = (env: Env) => (env.TONCENTER_API ?? (env.TON_NETWORK === 'testnet' ? 'https://testnet.toncenter.com' : 'https://toncenter.com')).replace(/\/+$/, '');

/** GRAM (TON) price in USD: the admin's fixed rate, else Crypto Pay's exchange rates (GRAM, or TON before the rename). */
async function tonUsdRate(env: Env): Promise<number | null> {
  const fixed = Number(env.TON_USD_RATE);
  if (fixed > 0) return fixed;
  if (!env.CRYPTO_PAY_TOKEN) return null;
  try {
    const rates = await cryptoPay<Array<{ is_valid: boolean; source: string; target: string; rate: string }>>(env, 'getExchangeRates', {});
    const r = ['GRAM', 'TON'].map((asset) => rates.find((x) => x.source === asset && x.target === 'USD' && x.is_valid && Number(x.rate) > 0)).find(Boolean);
    return r ? Number(r.rate) : null;
  } catch {
    return null;
  }
}

interface TonTx {
  hash?: string;
  now?: number;
  utime?: number;
  description?: { aborted?: boolean; compute_ph?: { success?: boolean } };
  in_msg?: {
    value?: string;
    source?: string;
    bounced?: boolean;
    message?: string;
    message_content?: { decoded?: { type?: string; comment?: string } };
  } | null;
  transaction_id?: { hash?: string };
}

/** Incoming transfers of the shop wallet (toncenter API v3, newest first). */
async function tonTransactions(env: Env): Promise<TonTx[]> {
  const url = `${toncenterBase(env)}/api/v3/transactions?account=${encodeURIComponent(env.TON_WALLET ?? '')}&limit=100&offset=0&sort=desc`;
  const res = await fetch(url, { headers: env.TONCENTER_API_KEY ? { 'X-API-Key': env.TONCENTER_API_KEY } : {} });
  if (!res.ok) throw new Error(`toncenter ${res.status}`);
  const body = (await res.json()) as { transactions?: TonTx[] };
  return body.transactions ?? [];
}

/** The transfer that pays this payment: our comment, at least the amount, not bounced or failed. */
export function findTonPayment(txs: readonly TonTx[], p: Payment): TonTx | null {
  if (!p.ton) return null;
  for (const tx of txs) {
    const msg = tx.in_msg;
    if (!msg || msg.bounced || tx.description?.aborted) continue;
    const comment = msg.message_content?.decoded?.comment ?? msg.message ?? '';
    const at = (tx.now ?? tx.utime ?? 0) * 1000;
    if (comment.trim() !== p.ton.comment) continue;
    if (at && (at < p.createdAt - 60_000 || at > p.createdAt + TON_WINDOW)) continue;
    if (BigInt(msg.value ?? '0') < BigInt(p.ton.nano)) continue;
    return tx;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Settling
// ---------------------------------------------------------------------------

/** Marks a payment paid and credits it — once, whoever gets here first (the check, the webhook, a retry). */
async function settle(store: Store, p: Payment, proof: string | undefined): Promise<Payment> {
  const now = Date.now();
  await store.creditOnce(keys.paymentDone(p.id), keys.balance(p.user), p.count, keys.pro(p.user), p.proDays * DAY, now);
  const paid: Payment = { ...p, status: 'paid', paidAt: p.paidAt ?? now, proof: p.proof ?? proof };
  await savePayment(store, paid);
  return paid;
}

/** Asks the payment system whether a pending payment is paid; settles it if so. */
async function refresh(store: Store, env: Env, p: Payment): Promise<Payment> {
  if (p.status !== 'pending') return p;
  if (p.method === 'cryptobot' && p.invoiceId) {
    const { items } = await cryptoPay<{ items: Invoice[] }>(env, 'getInvoices', { invoice_ids: String(p.invoiceId) });
    const inv = items?.find((i) => i.invoice_id === p.invoiceId);
    if (inv && invoicePays(inv, p)) return settle(store, p, inv.paid_asset);
    if (inv?.status === 'expired') {
      const expired: Payment = { ...p, status: 'expired' };
      await savePayment(store, expired);
      return expired;
    }
    return p;
  }
  if (p.method === 'ton') {
    const tx = findTonPayment(await tonTransactions(env), p);
    if (tx) return settle(store, p, tx.hash ?? tx.transaction_id?.hash);
    if (Date.now() > p.createdAt + TON_WINDOW) {
      const expired: Payment = { ...p, status: 'expired' };
      await savePayment(store, expired);
      return expired;
    }
  }
  return p;
}

const publicPayment = (p: Payment) => {
  const { user: _user, ...rest } = p;
  return rest;
};

export async function handlePay(req: Request, env: Env, cors: Record<string, string>): Promise<Response> {
  const r = await accountRequest(req, env, cors);
  if ('error' in r) return r.error!;
  const method = String(r.body.method ?? '') as Method;
  const config = await readConfig(r.store);
  const price = priceOf(config, String(r.body.item ?? ''));
  if (!price || (method !== 'cryptobot' && method !== 'ton')) return json({ ok: false, error: 'bad-request' }, 400, cors);
  if ((method === 'cryptobot' && !env.CRYPTO_PAY_TOKEN) || (method === 'ton' && !env.TON_WALLET)) return json({ ok: false, error: 'method-off' }, 503, cors);
  const acc = await account(r.store, env, r.userId, config);
  const p: Payment = {
    id: newId(),
    user: r.userId,
    item: String(r.body.item),
    count: price.count,
    proDays: price.proDays,
    usd: price.usd,
    method,
    status: 'pending',
    createdAt: Date.now(),
  };
  try {
    if (method === 'cryptobot') {
      const inv = await createCryptoInvoice(env, p, price.title);
      p.invoiceId = inv.invoice_id;
      p.url = inv.bot_invoice_url;
      p.miniAppUrl = inv.mini_app_invoice_url;
    } else {
      const rate = await tonUsdRate(env);
      if (!rate) return json({ ok: false, error: 'no-rate' }, 503, cors);
      // Up to the next 0.001 GRAM.
      const nano = BigInt(Math.ceil((price.usd / rate) * 1000)) * 1_000_000n;
      p.ton = { address: env.TON_WALLET!, nano: nano.toString(), comment: `ES-${p.id}`, ...(acc.wallet ? { from: acc.wallet.address } : {}) };
    }
  } catch (err) {
    console.error('payment create failed', err instanceof Error ? err.message : err);
    // The provider's error name tells the admin what to fix (wrong token or network, …); it holds no secrets.
    return json({ ok: false, error: 'provider', detail: err instanceof CryptoPayError ? err.reason : 'UNKNOWN' }, 502, cors);
  }
  await savePayment(r.store, p);
  await r.store.pushList(keys.payments, p.id, 500);
  return json({ ok: true, payment: publicPayment(p) }, 200, cors);
}

export async function handlePayStatus(req: Request, env: Env, cors: Record<string, string>): Promise<Response> {
  const r = await accountRequest(req, env, cors);
  if ('error' in r) return r.error!;
  const p = await loadPayment(r.store, String(r.body.id ?? ''));
  if (!p || p.user !== r.userId) return json({ ok: false, error: 'not-found' }, 404, cors);
  let next = p;
  try {
    next = await refresh(r.store, env, p);
  } catch (err) {
    console.error('payment check failed', err instanceof Error ? err.message : err);
  }
  const acc = await account(r.store, env, r.userId, await readConfig(r.store));
  return json({ ok: true, payment: publicPayment(next), account: acc }, 200, cors);
}

/** Crypto Pay webhook: checked by its signature, then the invoice is read back from the API before crediting. */
export async function handleCryptoPayWebhook(req: Request, env: Env): Promise<Response> {
  const store = storeOf(env);
  const raw = await req.text();
  if (!store || !env.CRYPTO_PAY_TOKEN) return new Response('off', { status: 503 });
  const signature = req.headers.get('crypto-pay-api-signature') ?? '';
  if (signature !== (await cryptoPaySignature(env.CRYPTO_PAY_TOKEN, raw))) return new Response('bad signature', { status: 401 });
  let update: { update_type?: string; payload?: Invoice };
  try {
    update = JSON.parse(raw);
  } catch {
    return new Response('bad request', { status: 400 });
  }
  if (update.update_type === 'invoice_paid' && update.payload?.payload) {
    const p = await loadPayment(store, update.payload.payload);
    if (p && p.status === 'pending' && p.invoiceId === update.payload.invoice_id && invoicePays(update.payload, p)) await settle(store, p, update.payload.paid_asset);
  }
  return new Response('ok');
}
