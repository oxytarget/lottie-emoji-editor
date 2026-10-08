/**
 * Accounts: generations balance, PRO, history and the settings the admin changes (packages, prices, which
 * templates clients see and which are PRO). Everything that matters is decided here, on the backend: the role
 * comes from ADMIN_IDS and the stored PRO date, never from what the editor says about itself.
 *
 *   POST /api/app/me        — balance, role, PRO, history, packages (the editor's account screen).
 *   POST /api/app/generate  — spends generations for a design (once per generation id), records it.
 *   POST /api/app/admin     — admin only: settings, grants, payments, publishing template set-ups.
 *   GET  /api/app/catalog   — packages, PRO plan and template rules (public).
 *   GET  /api/app/template-edits?pack= — the admin's published set-up of a template pack (public).
 */
import { json, type Env } from './shared.js';
import { storeOf, type Store } from './store.js';
import { validateInitData, validateLinkCode, type InitDataResult } from './telegram.js';
import { adminIds } from './templates.js';

export interface Package {
  id: string;
  count: number;
  /** Price in US dollars. */
  usd: number;
}

export interface AppConfig {
  /** Free generations for a new user. */
  starter: number;
  /** Generations one design costs. */
  cost: number;
  packages: Package[];
  pro: { usd: number; days: number; bonus: number };
  /** Template rules by id (built-in template id, or "pack:<name>" for a whole bot pack). */
  templates: Record<string, { hidden?: boolean; pro?: boolean }>;
}

export const DEFAULT_CONFIG: AppConfig = {
  starter: 3,
  cost: 1,
  packages: [
    { id: 'p10', count: 10, usd: 1.99 },
    { id: 'p25', count: 25, usd: 3.99 },
    { id: 'p50', count: 50, usd: 6.99 },
    { id: 'p100', count: 100, usd: 11.99 },
  ],
  pro: { usd: 4.99, days: 30, bonus: 30 },
  templates: {},
};

export type Role = 'user' | 'pro' | 'admin';

export interface Generation {
  id: string;
  at: number;
  title: string;
  templates: string[];
  cost: number;
}

const DAY = 86_400_000;
const GEN_TTL = 90 * 86_400;
const MAX_HISTORY = 100;

export const keys = {
  balance: (u: number) => `u:${u}:bal`,
  pro: (u: number) => `u:${u}:pro`,
  history: (u: number) => `u:${u}:hist`,
  gen: (u: number, id: string) => `u:${u}:gen:${id}`,
  seen: (u: number) => `u:${u}:seen`,
  wallet: (u: number) => `u:${u}:wallet`,
  config: 'cfg',
  templateEdits: (pack: string) => `tpl:${pack}`,
  payment: (id: string) => `pay:${id}`,
  paymentDone: (id: string) => `pay:${id}:done`,
  payments: 'pays',
};

export async function readConfig(store: Store): Promise<AppConfig> {
  const raw = await store.get(keys.config);
  if (!raw) return DEFAULT_CONFIG;
  try {
    return { ...DEFAULT_CONFIG, ...(JSON.parse(raw) as Partial<AppConfig>) };
  } catch {
    return DEFAULT_CONFIG;
  }
}

/** Keeps admin input sane: positive counts and prices, at most 8 packages. */
export function cleanConfig(input: Partial<AppConfig>, base: AppConfig): AppConfig {
  const int = (v: unknown, min: number, max: number, fallback: number) => (Number.isFinite(Number(v)) ? Math.min(max, Math.max(min, Math.round(Number(v)))) : fallback);
  const money = (v: unknown, fallback: number) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.round(Number(v) * 100) / 100 : fallback);
  const packages = Array.isArray(input.packages)
    ? input.packages
        .slice(0, 8)
        .map((p, i) => ({ id: typeof p?.id === 'string' && /^[a-z0-9_-]{1,16}$/i.test(p.id) ? p.id : `p${i + 1}`, count: int(p?.count, 1, 10_000, 10), usd: money(p?.usd, 1) }))
    : base.packages;
  const pro = input.pro ? { usd: money(input.pro.usd, base.pro.usd), days: int(input.pro.days, 1, 366, base.pro.days), bonus: int(input.pro.bonus, 0, 10_000, base.pro.bonus) } : base.pro;
  const templates: AppConfig['templates'] = {};
  for (const [id, rule] of Object.entries(input.templates ?? base.templates)) {
    if (!/^[\w:-]{1,80}$/.test(id) || !rule) continue;
    if (rule.hidden || rule.pro) templates[id] = { ...(rule.hidden ? { hidden: true } : {}), ...(rule.pro ? { pro: true } : {}) };
  }
  return {
    starter: input.starter !== undefined ? int(input.starter, 0, 1000, base.starter) : base.starter,
    cost: input.cost !== undefined ? int(input.cost, 1, 100, base.cost) : base.cost,
    packages: packages.length ? packages : base.packages,
    pro,
    templates,
  };
}

/** Who sent a JSON request: Mini App `initData`, or a link code from the bot (the editor in a browser). */
export async function authFromBody(body: { initData?: unknown; link?: unknown }, env: Env): Promise<InitDataResult> {
  if (typeof body.initData === 'string' && body.initData) return validateInitData(body.initData, env.TELEGRAM_BOT_TOKEN);
  return validateLinkCode(typeof body.link === 'string' ? body.link : '', env.TELEGRAM_BOT_TOKEN);
}

export const isAdmin = (env: Env, userId: number) => adminIds(env).includes(userId);

export interface Account {
  id: number;
  role: Role;
  balance: number;
  proUntil: number;
  /** The Gram (TON) wallet the user connected on the site. */
  wallet?: LinkedWallet;
}

export interface LinkedWallet {
  /** User-friendly address. */
  address: string;
  /** Wallet app name (Wallet in Telegram, Tonkeeper…). */
  app?: string;
  at: number;
}

async function linkedWallet(store: Store, userId: number): Promise<LinkedWallet | undefined> {
  const raw = await store.get(keys.wallet(userId));
  if (!raw) return undefined;
  try {
    const w = JSON.parse(raw) as LinkedWallet;
    return w?.address ? w : undefined;
  } catch {
    return undefined;
  }
}

/** The account (a new user gets the starter generations once). */
export async function account(store: Store, env: Env, userId: number, config: AppConfig, now = Date.now()): Promise<Account> {
  if (await store.set(keys.seen(userId), String(now), { nx: true })) {
    if (config.starter > 0) await store.incrBy(keys.balance(userId), config.starter);
  }
  const balance = Number((await store.get(keys.balance(userId))) ?? 0);
  const proUntil = Number((await store.get(keys.pro(userId))) ?? 0);
  const role: Role = isAdmin(env, userId) ? 'admin' : proUntil > now ? 'pro' : 'user';
  const wallet = await linkedWallet(store, userId);
  return { id: userId, role, balance, proUntil, ...(wallet ? { wallet } : {}) };
}

/** What a template is to this user: usable, PRO-only (and the user is not PRO), or hidden from clients. */
export function templateAccess(config: AppConfig, id: string, role: Role): 'ok' | 'pro' | 'hidden' {
  if (role === 'admin') return 'ok';
  // Pack stickers are "pack:<pack name>:<sticker>" (the editor's template ids); a rule may name the whole pack.
  const pack = id.startsWith('pack:') ? `pack:${id.split(':')[1]}` : null;
  const rules = [config.templates[id], pack ? config.templates[pack] : undefined];
  if (rules.some((r) => r?.hidden)) return 'hidden';
  if (rules.some((r) => r?.pro) && role !== 'pro') return 'pro';
  return 'ok';
}

const GEN_ID = /^[a-z0-9]{8,32}$/;
const TEMPLATE_ID = /^[\w:/-]{1,120}$/;

export function publicConfig(config: AppConfig, env: Env) {
  return {
    cost: config.cost,
    packages: config.packages,
    pro: config.pro,
    templates: config.templates,
    methods: { cryptobot: !!env.CRYPTO_PAY_TOKEN, ton: !!env.TON_WALLET },
  };
}

type Body = Record<string, unknown>;

async function readBody(req: Request): Promise<Body | null> {
  try {
    const body = (await req.json()) as unknown;
    return body && typeof body === 'object' && !Array.isArray(body) ? (body as Body) : null;
  } catch {
    return null;
  }
}

/** Common start of an account request: body, store, user. */
export async function accountRequest(req: Request, env: Env, cors: Record<string, string>) {
  const store = storeOf(env);
  if (!store) return { error: json({ ok: false, error: 'accounts-off' }, 503, cors) };
  const body = await readBody(req);
  if (!body) return { error: json({ ok: false, error: 'bad-request' }, 400, cors) };
  const auth = await authFromBody(body, env);
  if (!auth.ok) return { error: json({ ok: false, error: 'unauthorized', reason: auth.reason }, 401, cors) };
  return { store, body, userId: auth.user.id, lang: auth.user.language_code };
}

async function history(store: Store, userId: number, count = 50): Promise<Generation[]> {
  return (await store.list(keys.history(userId), count)).flatMap((raw) => {
    try {
      return [JSON.parse(raw) as Generation];
    } catch {
      return [];
    }
  });
}

export async function handleMe(req: Request, env: Env, cors: Record<string, string>): Promise<Response> {
  if (!storeOf(env)) {
    // Accounts not set up yet: the editor is free, but who is an admin still comes from here.
    const body = await readBody(req);
    const auth = body ? await authFromBody(body, env) : null;
    if (!auth?.ok) return json({ ok: false, error: 'unauthorized' }, 401, cors);
    const role: Role = isAdmin(env, auth.user.id) ? 'admin' : 'user';
    return json({ ok: true, accountsOff: true, account: { id: auth.user.id, role, balance: 0, proUntil: 0 }, history: [], config: publicConfig(DEFAULT_CONFIG, env) }, 200, cors);
  }
  const r = await accountRequest(req, env, cors);
  if ('error' in r) return r.error!;
  const config = await readConfig(r.store);
  const acc = await account(r.store, env, r.userId, config);
  return json({ ok: true, account: acc, history: await history(r.store, r.userId), config: publicConfig(config, env) }, 200, cors);
}

/**
 * Spends generations for a design: `id` (made by the editor once per design) makes it idempotent — the same
 * request again (double tap, a retry after a lost answer) costs nothing more and returns the same result.
 */
/** A user-friendly (base64url, 48 chars) or raw (workchain:hex) TON address. */
export const WALLET_ADDRESS = /^(?:[A-Za-z0-9_-]{48}|-?\d{1,3}:[0-9a-fA-F]{64})$/;

/**
 * Links (or with an empty address unlinks) the Gram wallet the user connected on the site with TON Connect. Only
 * shown back and used as the wallet to pay from — payments are still confirmed on the blockchain by their comment.
 */
export async function handleWallet(req: Request, env: Env, cors: Record<string, string>): Promise<Response> {
  const r = await accountRequest(req, env, cors);
  if ('error' in r) return r.error!;
  const address = String(r.body.address ?? '').trim();
  if (address && !WALLET_ADDRESS.test(address)) return json({ ok: false, error: 'bad-request' }, 400, cors);
  const app = String(r.body.app ?? '').replace(/[^\p{L}\p{N} ._-]/gu, '').slice(0, 40) || undefined;
  await r.store.set(keys.wallet(r.userId), address ? JSON.stringify({ address, app, at: Date.now() }) : '');
  const acc = await account(r.store, env, r.userId, await readConfig(r.store));
  return json({ ok: true, account: acc }, 200, cors);
}

export async function handleGenerate(req: Request, env: Env, cors: Record<string, string>): Promise<Response> {
  const r = await accountRequest(req, env, cors);
  if ('error' in r) return r.error!;
  const id = String(r.body.id ?? '');
  const templates = Array.isArray(r.body.templates) ? r.body.templates.map(String).filter((t) => TEMPLATE_ID.test(t)) : [];
  if (!GEN_ID.test(id) || !templates.length || templates.length > 200) return json({ ok: false, error: 'bad-request' }, 400, cors);
  const title = String(r.body.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Emoji';
  const config = await readConfig(r.store);
  const acc = await account(r.store, env, r.userId, config);
  // Several designs at once (the whole template set) is a PRO tool.
  if (templates.length > 1 && acc.role === 'user') return json({ ok: false, error: 'pro-required', reason: 'batch' }, 403, cors);
  for (const t of templates) {
    const access = templateAccess(config, t, acc.role);
    if (access === 'hidden') return json({ ok: false, error: 'template-unavailable', template: t }, 403, cors);
    if (access === 'pro') return json({ ok: false, error: 'pro-required', reason: 'template', template: t }, 403, cors);
  }
  const now = Date.now();
  const cost = acc.role === 'admin' ? 0 : config.cost * templates.length;
  const generation: Generation = { id, at: now, title, templates, cost };
  const res = await r.store.spendOnce(keys.balance(r.userId), keys.gen(r.userId, id), cost, JSON.stringify(generation), GEN_TTL);
  if (res.status === 0) return json({ ok: false, error: 'no-balance', balance: res.balance, cost }, 402, cors);
  if (res.status === 2) await r.store.pushList(keys.history(r.userId), JSON.stringify(generation), MAX_HISTORY);
  const stored = res.status === 1 ? (JSON.parse((await r.store.get(keys.gen(r.userId, id))) ?? 'null') as Generation | null) : generation;
  return json({ ok: true, balance: res.balance, generation: stored ?? generation, repeated: res.status === 1 }, 200, cors);
}

/**
 * For the bot's deliveries (files to the chat, emoji packs): with accounts on, a client may only receive designs
 * it paid for — every file needs a generation id of this user. Admins and the editor without accounts are free.
 */
export async function paidFor(env: Env, userId: number, gens: string[], files: number): Promise<boolean> {
  const store = storeOf(env);
  if (!store || isAdmin(env, userId)) return true;
  const ids = [...new Set(gens.filter((g) => GEN_ID.test(g)))];
  if (!ids.length) return false;
  let covered = 0;
  for (const id of ids) {
    const raw = await store.get(keys.gen(userId, id));
    if (!raw) return false;
    try {
      covered += (JSON.parse(raw) as Generation).templates.length;
    } catch {
      return false;
    }
  }
  return covered >= files;
}

export async function handleCatalog(env: Env, cors: Record<string, string>): Promise<Response> {
  const store = storeOf(env);
  if (!store) return json({ ok: false, error: 'accounts-off' }, 503, cors);
  return json({ ok: true, config: publicConfig(await readConfig(store), env) }, 200, cors);
}

export async function handleTemplateEdits(url: URL, env: Env, cors: Record<string, string>): Promise<Response> {
  const store = storeOf(env);
  const pack = url.searchParams.get('pack') ?? '';
  if (!store || !/^[A-Za-z0-9_]{1,64}$/.test(pack)) return json({ ok: true, edits: null }, 200, cors);
  const raw = await store.get(keys.templateEdits(pack));
  return new Response(`{"ok":true,"edits":${raw ?? 'null'}}`, { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=60', ...cors } });
}

const MAX_TEMPLATE_EDITS = 800_000;

/** Admin panel actions — the role is checked here, whatever the editor shows or hides. */
export async function handleAdmin(req: Request, env: Env, cors: Record<string, string>): Promise<Response> {
  const r = await accountRequest(req, env, cors);
  if ('error' in r) return r.error!;
  if (!isAdmin(env, r.userId)) return json({ ok: false, error: 'forbidden' }, 403, cors);
  const { store, body } = r;
  const action = String(body.action ?? 'get');
  const config = await readConfig(store);
  if (action === 'config') {
    const next = cleanConfig((body.config ?? {}) as Partial<AppConfig>, config);
    await store.set(keys.config, JSON.stringify(next));
    return json({ ok: true, config: next }, 200, cors);
  }
  if (action === 'grant') {
    const user = Number(body.user);
    const amount = Math.round(Number(body.amount) || 0);
    const proDays = Math.max(0, Math.round(Number(body.proDays) || 0));
    if (!Number.isSafeInteger(user) || user <= 0 || Math.abs(amount) > 100_000) return json({ ok: false, error: 'bad-request' }, 400, cors);
    const now = Date.now();
    await account(store, env, user, config, now);
    if (amount) await store.incrBy(keys.balance(user), amount);
    if (proDays) await store.set(keys.pro(user), String(Math.max(now, Number((await store.get(keys.pro(user))) ?? 0)) + proDays * DAY));
    return json({ ok: true, account: await account(store, env, user, config) }, 200, cors);
  }
  if (action === 'user') {
    const user = Number(body.user);
    if (!Number.isSafeInteger(user) || user <= 0) return json({ ok: false, error: 'bad-request' }, 400, cors);
    return json({ ok: true, account: await account(store, env, user, config), history: await history(store, user, 20) }, 200, cors);
  }
  if (action === 'payments') {
    const ids = await store.list(keys.payments, 50);
    const payments = (await Promise.all(ids.map((id) => store.get(keys.payment(id))))).flatMap((raw) => (raw ? [JSON.parse(raw) as unknown] : []));
    return json({ ok: true, payments }, 200, cors);
  }
  if (action === 'publish-template') {
    const pack = String(body.pack ?? '');
    const edits = JSON.stringify(body.edits ?? null);
    if (!/^[A-Za-z0-9_]{1,64}$/.test(pack) || edits.length > MAX_TEMPLATE_EDITS) return json({ ok: false, error: 'bad-request' }, 400, cors);
    await store.set(keys.templateEdits(pack), edits);
    return json({ ok: true }, 200, cors);
  }
  return json({ ok: true, config }, 200, cors);
}
