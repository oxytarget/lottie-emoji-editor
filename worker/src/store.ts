/**
 * Persistent state for accounts, generations and payments: Redis over HTTP (Upstash / Vercel KV — works on Vercel
 * and Cloudflare alike). Every operation that moves balance is one atomic script, so a double tap, a reload or two
 * windows cannot spend the same generation twice or credit a payment twice.
 *
 * Settings: KV_REST_API_URL + KV_REST_API_TOKEN (or UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN).
 * Without them accounts are off (the editor stays free); tests use STORE=memory.
 */
import type { Env } from './shared.js';

export interface Store {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, opts?: { nx?: boolean; exSeconds?: number }): Promise<boolean>;
  incrBy(key: string, n: number): Promise<number>;
  /** Newest first, at most `max` kept. */
  pushList(key: string, value: string, max: number): Promise<void>;
  list(key: string, count: number): Promise<string[]>;
  /**
   * Spends `cost` from `balanceKey` unless `markKey` exists already (then nothing is spent again): status 2 = spent,
   * 1 = done before, 0 = not enough. `mark` is stored under `markKey` for `ttlSeconds`.
   */
  spendOnce(balanceKey: string, markKey: string, cost: number, mark: string, ttlSeconds: number): Promise<{ status: 0 | 1 | 2; balance: number }>;
  /** Credits `amount` and extends `proKey` by `proMs` (from now if it ran out) — once per `doneKey`. False if done before. */
  creditOnce(doneKey: string, balanceKey: string, amount: number, proKey: string, proMs: number, now: number): Promise<boolean>;
}

const SPEND = `
if redis.call('EXISTS', KEYS[2]) == 1 then return {1, tonumber(redis.call('GET', KEYS[1]) or '0')} end
local b = tonumber(redis.call('GET', KEYS[1]) or '0')
local c = tonumber(ARGV[1])
if b < c then return {0, b} end
local nb = redis.call('DECRBY', KEYS[1], c)
redis.call('SET', KEYS[2], ARGV[2], 'EX', ARGV[3])
return {2, nb}`;

const CREDIT = `
if redis.call('SET', KEYS[1], '1', 'NX') == false then return 0 end
local amount = tonumber(ARGV[1])
if amount > 0 then redis.call('INCRBY', KEYS[2], amount) end
local ms = tonumber(ARGV[2])
if ms > 0 then
  local now = tonumber(ARGV[3])
  local cur = tonumber(redis.call('GET', KEYS[3]) or '0')
  if cur < now then cur = now end
  redis.call('SET', KEYS[3], tostring(cur + ms))
end
return 1`;

class RedisStore implements Store {
  constructor(
    private readonly url: string,
    private readonly token: string,
  ) {}

  private async cmd<T>(...args: Array<string | number>): Promise<T> {
    const res = await fetch(this.url, { method: 'POST', headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' }, body: JSON.stringify(args.map(String)) });
    const body = (await res.json().catch(() => ({}))) as { result?: T; error?: string };
    if (!res.ok || body.error) throw new Error(`store: ${body.error ?? res.status}`);
    return body.result as T;
  }

  get(key: string) {
    return this.cmd<string | null>('GET', key);
  }
  async set(key: string, value: string, opts: { nx?: boolean; exSeconds?: number } = {}) {
    const args: Array<string | number> = ['SET', key, value];
    if (opts.exSeconds) args.push('EX', opts.exSeconds);
    if (opts.nx) args.push('NX');
    return (await this.cmd<string | null>(...args)) === 'OK';
  }
  incrBy(key: string, n: number) {
    return this.cmd<number>('INCRBY', key, n);
  }
  async pushList(key: string, value: string, max: number) {
    await this.cmd('LPUSH', key, value);
    await this.cmd('LTRIM', key, 0, max - 1);
  }
  list(key: string, count: number) {
    return this.cmd<string[]>('LRANGE', key, 0, count - 1);
  }
  async spendOnce(balanceKey: string, markKey: string, cost: number, mark: string, ttlSeconds: number) {
    const [status, balance] = await this.cmd<[number, number]>('EVAL', SPEND, 2, balanceKey, markKey, cost, mark, ttlSeconds);
    return { status: status as 0 | 1 | 2, balance: Number(balance) };
  }
  async creditOnce(doneKey: string, balanceKey: string, amount: number, proKey: string, proMs: number, now: number) {
    return (await this.cmd<number>('EVAL', CREDIT, 3, doneKey, balanceKey, proKey, amount, proMs, now)) === 1;
  }
}

/** For tests and local runs: the same rules in memory (single process, so trivially atomic). */
export class MemoryStore implements Store {
  readonly data = new Map<string, string>();
  readonly lists = new Map<string, string[]>();

  async get(key: string) {
    return this.data.get(key) ?? null;
  }
  async set(key: string, value: string, opts: { nx?: boolean } = {}) {
    if (opts.nx && this.data.has(key)) return false;
    this.data.set(key, value);
    return true;
  }
  async incrBy(key: string, n: number) {
    const v = Number(this.data.get(key) ?? 0) + n;
    this.data.set(key, String(v));
    return v;
  }
  async pushList(key: string, value: string, max: number) {
    this.lists.set(key, [value, ...(this.lists.get(key) ?? [])].slice(0, max));
  }
  async list(key: string, count: number) {
    return (this.lists.get(key) ?? []).slice(0, count);
  }
  async spendOnce(balanceKey: string, markKey: string, cost: number, mark: string) {
    const balance = Number(this.data.get(balanceKey) ?? 0);
    if (this.data.has(markKey)) return { status: 1 as const, balance };
    if (balance < cost) return { status: 0 as const, balance };
    this.data.set(balanceKey, String(balance - cost));
    this.data.set(markKey, mark);
    return { status: 2 as const, balance: balance - cost };
  }
  async creditOnce(doneKey: string, balanceKey: string, amount: number, proKey: string, proMs: number, now: number) {
    if (this.data.has(doneKey)) return false;
    this.data.set(doneKey, '1');
    if (amount > 0) await this.incrBy(balanceKey, amount);
    if (proMs > 0) this.data.set(proKey, String(Math.max(now, Number(this.data.get(proKey) ?? 0)) + proMs));
    return true;
  }
}

let memory: MemoryStore | null = null;
/** Tests start from an empty memory store. */
export function resetMemoryStore(): MemoryStore {
  memory = new MemoryStore();
  return memory;
}

/** The store, or null when accounts are not configured. */
export function storeOf(env: Env): Store | null {
  if (env.STORE === 'memory') return (memory ??= new MemoryStore());
  if (env.KV_URL && env.KV_TOKEN) return new RedisStore(env.KV_URL.replace(/\/+$/, ''), env.KV_TOKEN);
  return null;
}
