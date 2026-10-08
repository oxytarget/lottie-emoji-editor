// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handle, type Env } from '../../worker/src/app';
import { findTonPayment } from '../../worker/src/payments';
import { cryptoPaySignature } from '../../worker/src/payments';
import { resetMemoryStore } from '../../worker/src/store';
import { signInitData } from '../../worker/src/telegram';

const TOKEN = '123456:ACC-token';
const ADMIN = 900;
const base: Env = {
  TELEGRAM_BOT_TOKEN: TOKEN,
  APP_URL: 'https://example.github.io/app/',
  ALLOWED_ORIGINS: 'https://example.github.io',
  TELEGRAM_API: 'https://tg.test',
  ADMIN_IDS: String(ADMIN),
  STORE: 'memory',
  CRYPTO_PAY_TOKEN: 'cp-token',
  TON_WALLET: 'UQshop',
  TON_USD_RATE: '5',
  TONCENTER_API: 'https://toncenter.test',
};

async function auth(id: number) {
  return signInitData({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id, first_name: 'U', language_code: 'uk' }) }, TOKEN);
}

async function call(path: string, user: number | null, body: Record<string, unknown> = {}, env: Env = base) {
  const res = await handle(
    new Request(`https://api.test/api/app/${path}`, {
      method: 'POST',
      body: JSON.stringify({ ...(user ? { initData: await auth(user) } : {}), ...body }),
      headers: { origin: 'https://example.github.io', 'content-type': 'application/json' },
    }),
    env,
  );
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

const gen = (n: number) => `gen${String(n).padStart(8, '0')}`;

/** Fake payment systems: Crypto Pay invoices and toncenter transactions. */
function mockProviders() {
  const invoices = new Map<number, Record<string, unknown>>();
  const txs: Array<Record<string, unknown>> = [];
  let next = 1;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('https://pay.crypt.bot/api/createInvoice')) {
        expect((init?.headers as Record<string, string>)['Crypto-Pay-API-Token']).toBe('cp-token');
        const p = JSON.parse(String(init?.body));
        const inv = { invoice_id: next++, status: 'active', payload: p.payload, amount: p.amount, fiat: p.fiat, currency_type: p.currency_type, bot_invoice_url: 'https://t.me/CryptoBot?start=IV1', mini_app_invoice_url: 'https://t.me/CryptoBot/app?startapp=IV1' };
        invoices.set(inv.invoice_id, inv);
        return new Response(JSON.stringify({ ok: true, result: inv }));
      }
      if (url.startsWith('https://pay.crypt.bot/api/getInvoices')) {
        const ids = String(JSON.parse(String(init?.body)).invoice_ids).split(',').map(Number);
        return new Response(JSON.stringify({ ok: true, result: { items: ids.map((id) => invoices.get(id)).filter(Boolean) } }));
      }
      if (url.startsWith('https://toncenter.test/api/v3/transactions')) return new Response(JSON.stringify({ transactions: txs }));
      throw new Error(`unexpected ${url}`);
    }),
  );
  return { invoices, txs };
}

beforeEach(() => resetMemoryStore());
afterEach(() => vi.unstubAllGlobals());

describe('accounts and generations', () => {
  it('gives a new user the starter generations once, and needs a signed user', async () => {
    expect((await call('me', 1)).body.account).toMatchObject({ id: 1, role: 'user', balance: 3 });
    expect((await call('me', 1)).body.account.balance).toBe(3);
    expect((await call('me', null)).status).toBe(401);
    // Without accounts: free editor, admins still known.
    expect((await call('me', 1, {}, { ...base, STORE: undefined })).body).toMatchObject({ accountsOff: true, account: { role: 'user' } });
    expect((await call('me', ADMIN, {}, { ...base, STORE: undefined })).body.account.role).toBe('admin');
    expect((await call('generate', 1, { id: gen(1), templates: ['classic'] }, { ...base, STORE: undefined })).status).toBe(503);
  });

  it('spends one generation per design, once per id (double tap, retry), never below zero', async () => {
    const first = await call('generate', 1, { id: gen(1), templates: ['classic'], title: 'Hi' });
    expect(first.body).toMatchObject({ ok: true, balance: 2 });
    const again = await call('generate', 1, { id: gen(1), templates: ['classic'], title: 'Hi' });
    expect(again.body).toMatchObject({ ok: true, balance: 2, repeated: true });
    await call('generate', 1, { id: gen(2), templates: ['classic'] });
    await call('generate', 1, { id: gen(3), templates: ['classic'] });
    const broke = await call('generate', 1, { id: gen(4), templates: ['classic'] });
    expect(broke.status).toBe(402);
    expect(broke.body).toMatchObject({ error: 'no-balance', balance: 0 });
    // Many taps at once still spend only what there is.
    await call('admin', ADMIN, { action: 'grant', user: 1, amount: 2 });
    const burst = await Promise.all([5, 6, 7, 8, 9].map((n) => call('generate', 1, { id: gen(n), templates: ['classic'] })));
    expect(burst.filter((r) => r.status === 200)).toHaveLength(2);
    expect((await call('me', 1)).body.account.balance).toBe(0);
    expect((await call('me', 1)).body.history.map((h: { id: string }) => h.id).slice(0, 2)).toHaveLength(2);
  });

  it('keeps PRO templates and batches for PRO, hidden templates from clients, admins free', async () => {
    await call('admin', ADMIN, { action: 'config', config: { templates: { sparkle: { pro: true }, secret: { hidden: true }, 'pack:Brand_by_bot': { pro: true } } } });
    expect((await call('generate', 1, { id: gen(1), templates: ['sparkle'] })).body).toMatchObject({ error: 'pro-required', reason: 'template' });
    expect((await call('generate', 1, { id: gen(2), templates: ['pack:Brand_by_bot:UQ1'] })).body).toMatchObject({ error: 'pro-required' });
    expect((await call('generate', 1, { id: gen(3), templates: ['secret'] })).body).toMatchObject({ error: 'template-unavailable' });
    expect((await call('generate', 1, { id: gen(4), templates: ['classic', 'bounce'] })).body).toMatchObject({ error: 'pro-required', reason: 'batch' });
    const admin = await call('generate', ADMIN, { id: gen(5), templates: ['secret', 'sparkle'] });
    expect(admin.body).toMatchObject({ ok: true, balance: 3, generation: { cost: 0 } });
  });

  it('checks the admin on the backend', async () => {
    expect((await call('admin', 1, { action: 'config', config: { starter: 1000 } })).status).toBe(403);
    expect((await call('admin', 1, { action: 'grant', user: 1, amount: 99 })).status).toBe(403);
    const set = await call('admin', ADMIN, { action: 'config', config: { starter: 5, packages: [{ id: 'x', count: 7, usd: 0.99 }, { count: -3, usd: 'a' }] } });
    expect(set.body.config.starter).toBe(5);
    expect(set.body.config.packages).toEqual([
      { id: 'x', count: 7, usd: 0.99 },
      { id: 'p2', count: 1, usd: 1 },
    ]);
    expect((await call('me', 2)).body.account.balance).toBe(5);
    expect((await call('me', ADMIN)).body.account.role).toBe('admin');
  });

  it('lets clients receive through the bot only what they generated', async () => {
    const tgs = () => new File([new Uint8Array(50).fill(1)], 'a.tgs');
    const send = async (gens?: string) => {
      const form = new FormData();
      form.set('initData', await auth(1));
      form.append('files', tgs(), 'a.tgs');
      if (gens) form.set('gens', gens);
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true, result: true }))));
      return handle(new Request('https://api.test/api/send', { method: 'POST', body: form, headers: { origin: 'https://example.github.io' } }), base);
    };
    expect((await send()).status).toBe(402);
    expect((await send(gen(1))).status).toBe(402);
    vi.unstubAllGlobals();
    await call('generate', 1, { id: gen(1), templates: ['classic'] });
    expect((await send(gen(1))).status).toBe(200);
  });
});

describe('payments', () => {
  it('Crypto Bot: credits only after the invoice is paid, and only once', async () => {
    const { invoices } = mockProviders();
    const created = await call('pay', 1, { item: 'pkg:p25', method: 'cryptobot' });
    expect(created.body.payment).toMatchObject({ status: 'pending', count: 25, usd: 3.99, url: 'https://t.me/CryptoBot?start=IV1' });
    const id = created.body.payment.id;
    // "I paid" without paying: nothing.
    expect((await call('pay-status', 1, { id })).body).toMatchObject({ payment: { status: 'pending' }, account: { balance: 3 } });
    invoices.get(1)!.status = 'paid';
    expect((await call('pay-status', 1, { id })).body).toMatchObject({ payment: { status: 'paid' }, account: { balance: 28 } });
    expect((await call('pay-status', 1, { id })).body.account.balance).toBe(28);
    // Someone else's payment is not theirs to check.
    expect((await call('pay-status', 2, { id })).status).toBe(404);
  });

  it('Crypto Bot webhook: signed updates credit, forged ones do not', async () => {
    const { invoices } = mockProviders();
    const id = (await call('pay', 1, { item: 'pro', method: 'cryptobot' })).body.payment.id;
    const inv = { ...invoices.get(1)!, status: 'paid' };
    const raw = JSON.stringify({ update_type: 'invoice_paid', payload: inv });
    const hook = (signature: string) => handle(new Request('https://api.test/api/app/cryptopay', { method: 'POST', body: raw, headers: { 'crypto-pay-api-signature': signature } }), base);
    expect((await hook('forged')).status).toBe(401);
    expect((await call('me', 1)).body.account).toMatchObject({ role: 'user', balance: 3 });
    expect((await hook(await cryptoPaySignature('cp-token', raw))).status).toBe(200);
    expect((await hook(await cryptoPaySignature('cp-token', raw))).status).toBe(200);
    const me = (await call('me', 1)).body.account;
    expect(me).toMatchObject({ role: 'pro', balance: 33 });
    expect(me.proUntil).toBeGreaterThan(Date.now() + 29 * 86_400_000);
    expect((await call('pay-status', 1, { id })).body.payment.status).toBe('paid');
  });

  it('TON: the transfer with our comment and enough TON credits; wrong ones do not', async () => {
    const { txs } = mockProviders();
    const p = (await call('pay', 1, { item: 'pkg:p10', method: 'ton' })).body.payment;
    // $1.99 at $5 per TON = 0.398 TON.
    expect(p.ton).toEqual({ address: 'UQshop', nano: '398000000', comment: `ES-${p.id}` });
    const now = Math.floor(Date.now() / 1000);
    txs.push({ hash: 'h1', now, in_msg: { value: '100000000', message_content: { decoded: { type: 'text_comment', comment: p.ton.comment } } } });
    txs.push({ hash: 'h2', now, in_msg: { value: '398000000', message_content: { decoded: { type: 'text_comment', comment: 'ES-other' } } } });
    expect((await call('pay-status', 1, { id: p.id })).body.payment.status).toBe('pending');
    txs.push({ hash: 'h3', now, in_msg: { value: '398000000', message_content: { decoded: { type: 'text_comment', comment: p.ton.comment } } } });
    const paid = (await call('pay-status', 1, { id: p.id })).body;
    expect(paid).toMatchObject({ payment: { status: 'paid', proof: 'h3' }, account: { balance: 13 } });
    expect((await call('pay-status', 1, { id: p.id })).body.account.balance).toBe(13);
  });

  it('ignores bounced and failed TON transfers', () => {
    const p = { id: 'x', createdAt: Date.now(), ton: { address: 'a', nano: '10', comment: 'ES-x' } } as Parameters<typeof findTonPayment>[1];
    const msg = { value: '10', message_content: { decoded: { comment: 'ES-x' } } };
    expect(findTonPayment([{ in_msg: { ...msg, bounced: true } }], p)).toBeNull();
    expect(findTonPayment([{ in_msg: msg, description: { aborted: true } }], p)).toBeNull();
    expect(findTonPayment([{ in_msg: msg, now: Math.floor(Date.now() / 1000) }], p)).not.toBeNull();
  });

  it('refuses unknown items and switched-off methods', async () => {
    mockProviders();
    expect((await call('pay', 1, { item: 'pkg:nope', method: 'ton' })).status).toBe(400);
    expect((await call('pay', 1, { item: 'pro', method: 'ton' }, { ...base, TON_WALLET: undefined })).status).toBe(503);
  });
});

describe('invoice errors, Gram and the linked wallet', () => {
  /** Crypto Pay answering with `answer` per call (a function of the request body). */
  function cryptoPayAnswers(answer: (method: string, body: Record<string, unknown>) => unknown) {
    const calls: Array<{ method: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = url.split('/api/')[1];
        const body = JSON.parse(String(init?.body ?? '{}'));
        calls.push({ method, body });
        return new Response(JSON.stringify(answer(method, body)));
      }),
    );
    return calls;
  }

  it('says why Crypto Pay refused the invoice (no secrets), and tells the store or method being off apart', async () => {
    cryptoPayAnswers(() => ({ ok: false, error: { code: 401, name: 'UNAUTHORIZED' } }));
    const res = await call('pay', 1, { item: 'pkg:p10', method: 'cryptobot' });
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ ok: false, error: 'provider', detail: 'UNAUTHORIZED' });
    expect(JSON.stringify(res.body)).not.toContain('cp-token');
    expect((await call('pay', 1, { item: 'pkg:p10', method: 'cryptobot' }, { ...base, STORE: undefined })).body.error).toBe('accounts-off');
    expect((await call('pay', 1, { item: 'pkg:p10', method: 'cryptobot' }, { ...base, CRYPTO_PAY_TOKEN: undefined })).body.error).toBe('method-off');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    );
    expect((await call('pay', 1, { item: 'pkg:p10', method: 'cryptobot' })).body).toMatchObject({ error: 'provider', detail: 'NETWORK' });
  });

  it('makes the invoice without the "back to the app" button when Crypto Pay refuses its URL', async () => {
    const calls = cryptoPayAnswers((_m, body) =>
      body.paid_btn_url ? { ok: false, error: { code: 400, name: 'PAID_BTN_URL_INVALID' } } : { ok: true, result: { invoice_id: 7, status: 'active', bot_invoice_url: 'https://t.me/CryptoBot?start=IV7' } },
    );
    const res = await call('pay', 1, { item: 'pkg:p10', method: 'cryptobot' });
    expect(res.body).toMatchObject({ ok: true, payment: { invoiceId: 7, url: 'https://t.me/CryptoBot?start=IV7' } });
    expect(calls.map((c) => c.body.paid_btn_url)).toEqual(['https://example.github.io/app/', undefined]);
    expect(calls[1].body).toMatchObject({ currency_type: 'fiat', fiat: 'USD', amount: '1.99', payload: res.body.payment.id });
    // A non-web app address never goes into the button.
    const plain = cryptoPayAnswers(() => ({ ok: true, result: { invoice_id: 8, status: 'active' } }));
    await call('pay', 1, { item: 'pkg:p10', method: 'cryptobot' }, { ...base, APP_URL: 'tg://resolve?domain=bot' });
    expect(plain[0].body.paid_btn_name).toBeUndefined();
  });

  it('prices Gram with the GRAM rate (TON before the rename)', async () => {
    const env = { ...base, TON_USD_RATE: undefined };
    cryptoPayAnswers(() => ({
      ok: true,
      result: [
        { is_valid: true, source: 'USDT', target: 'USD', rate: '1' },
        { is_valid: true, source: 'GRAM', target: 'USD', rate: '2' },
      ],
    }));
    const gram = await call('pay', 1, { item: 'pkg:p10', method: 'ton' }, env);
    // $1.99 / $2 → 0.995 GRAM.
    expect(gram.body.payment.ton).toMatchObject({ address: 'UQshop', nano: '995000000' });
    cryptoPayAnswers(() => ({ ok: true, result: [{ is_valid: true, source: 'TON', target: 'USD', rate: '1' }] }));
    expect((await call('pay', 1, { item: 'pkg:p10', method: 'ton' }, env)).body.payment.ton.nano).toBe('1990000000');
    cryptoPayAnswers(() => ({ ok: true, result: [] }));
    expect((await call('pay', 1, { item: 'pkg:p10', method: 'ton' }, env)).body.error).toBe('no-rate');
  });

  it('links the wallet connected on the site to the account, and pays from it', async () => {
    const address = 'UQBvW8Z5huBkMJYdnfAEM5JqTNkuWX3diqYENkWsIL0XggGG';
    expect((await call('wallet', 1, { address: 'not an address' })).status).toBe(400);
    expect((await call('wallet', null, { address })).status).toBe(401);
    const linked = await call('wallet', 1, { address, app: 'Tonkeeper' });
    expect(linked.body.account.wallet).toMatchObject({ address, app: 'Tonkeeper' });
    expect((await call('me', 1)).body.account.wallet.address).toBe(address);
    expect((await call('me', 2)).body.account.wallet).toBeUndefined();
    const pay = await call('pay', 1, { item: 'pkg:p10', method: 'ton' });
    expect(pay.body.payment.ton).toMatchObject({ from: address, comment: `ES-${pay.body.payment.id}` });
    expect((await call('wallet', 1, { address: '' })).body.account.wallet).toBeUndefined();
    expect((await call('me', 1)).body.account.wallet).toBeUndefined();
  });
});
