import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPackAll, createPacksSplit, floodUntil, sendAllToChat, takeBatch } from '../lib/botApi';

const item = (i: number, size = 20_000) => ({ id: `e${i}`, name: `e${i}.tgs`, data: new Uint8Array(size), type: 'application/x-tgsticker', emoji: '⭐' });

interface Req {
  files: number;
  title: string | null;
  pace: string | null;
  set: string | null;
  notify: string | null;
  total: string | null;
  fresh: string | null;
  size: string | null;
  nonce: string | null;
}

/** Fake backend: `reply(n, req)` answers the n-th request (1-based). */
function mockBackend(reply: (n: number, req: Req) => { status: number; body: Record<string, unknown> }) {
  const reqs: Req[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      const form = init.body as FormData;
      const req = { files: form.getAll('files').length, title: form.get('title') as string | null, pace: form.get('pace') as string | null, set: form.get('set') as string | null, notify: form.get('notify') as string | null, total: form.get('total') as string | null, fresh: form.get('fresh') as string | null, size: form.get('size') as string | null, nonce: form.get('nonce') as string | null };
      reqs.push(req);
      const { status, body } = reply(reqs.length, req);
      return new Response(JSON.stringify(body), { status });
    }),
  );
  return reqs;
}

const ok = (req: Req) => ({ status: 200, body: { ok: true, name: 'p_by_bot', url: 'https://t.me/addemoji/p_by_bot', title: 'T', added: req.files, canvas: 100 } });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  localStorage.clear();
});

describe('big packs from the editor', () => {
  it('splits by count and by request size', () => {
    expect(takeBatch([item(1), item(2), item(3)], 2)).toHaveLength(2);
    expect(takeBatch([item(1, 2_000_000), item(2, 2_000_000)], 10)).toHaveLength(1);
    expect(takeBatch([item(1, 9_000_000)], 10)).toHaveLength(1);
  });

  it('creates a 97-emoji pack: 50 in the creating request, then paced batches, one chat message', async () => {
    const reqs = mockBackend((_n, req) => ok(req));
    const added: string[] = [];
    const res = await createPackAll({ title: 'T', items: Array.from({ length: 97 }, (_, i) => item(i)) }, () => {}, (batch) => added.push(...batch.map((b) => b.id)));
    expect(res.ok).toBe(true);
    expect(res.data?.added).toBe(97);
    expect(reqs.map((r) => r.files)).toEqual([50, 10, 10, 10, 10, 7]);
    expect(reqs[0].set).toBeNull();
    expect(reqs[0].pace).toBeNull();
    expect(reqs.slice(1).every((r) => r.set === 'p_by_bot' && r.fresh === '1')).toBe(true);
    // A steady pace that speeds up a little while it goes well.
    expect(reqs.map((r) => r.pace)).toEqual([null, '900', '810', '800', '800', '800']);
    // The new pack is named after a nonce; additions say how many stickers the pack has so far.
    expect(reqs[0].nonce).toMatch(/^[a-z0-9]{6}$/);
    expect(reqs.map((r) => r.size)).toEqual([null, '50', '60', '70', '80', '90']);
    expect(reqs.map((r) => r.notify)).toEqual([...Array(5).fill('0'), null]);
    expect(reqs.every((r) => r.total === '97')).toBe(true);
    expect(new Set(added).size).toBe(97);
  });

  it('waits when Telegram asks to, slows down, and continues without duplicates', async () => {
    vi.useFakeTimers();
    const reqs = mockBackend((n, req) =>
      n === 2 ? { status: 429, body: { ok: false, error: 'flood', retryAfter: 3, added: 4, name: 'p_by_bot' } } : ok(req),
    );
    const waits: number[] = [];
    const added: string[] = [];
    const job = createPackAll(
      { title: 'T', items: Array.from({ length: 75 }, (_, i) => item(i)) },
      (p) => p.waiting && waits.push(p.waiting),
      (batch) => added.push(...batch.map((b) => b.id)),
    );
    await vi.runAllTimersAsync();
    const res = await job;
    expect(res.ok).toBe(true);
    // Telegram's wait plus a margin, counted down by the clock.
    expect(waits).toEqual([5, 4, 3, 2, 1]);
    expect(reqs.map((r) => r.files)).toEqual([50, 10, 10, 10, 1]);
    // Slower after a short wait, and not faster again in this job.
    expect(reqs.map((r) => r.pace)).toEqual([null, '900', '1500', '1500', '1500']);
    expect(reqs.map((r) => r.size)).toEqual([null, '50', '54', '64', '74']);
    expect(added).toEqual(Array.from({ length: 75 }, (_, i) => `e${i}`));
  });

  it('stops on other errors and returns the pack so far', async () => {
    mockBackend((n, req) => (n === 3 ? { status: 502, body: { ok: false, error: 'telegram', detail: 'boom', added: 2, name: 'p_by_bot' } } : ok(req)));
    const added: string[] = [];
    const res = await createPackAll({ title: 'T', items: Array.from({ length: 80 }, (_, i) => item(i)) }, () => {}, (batch) => added.push(...batch.map((b) => b.id)));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe('server');
    expect(res.data?.name).toBe('p_by_bot');
    expect(added).toHaveLength(62);
  });

  it('splits into packs of 50 that are created without waiting', async () => {
    const reqs = mockBackend((_n, req) => ok(req));
    const packs: number[] = [];
    const res = await createPacksSplit({ title: 'T', items: Array.from({ length: 120 }, (_, i) => item(i)) }, () => {}, (items) => packs.push(items.length));
    expect(res.ok).toBe(true);
    expect(reqs.map((r) => [r.files, r.title, r.set, r.notify])).toEqual([
      [50, 'T 1', null, null],
      [50, 'T 2', null, null],
      [20, 'T 3', null, null],
    ]);
    expect(packs).toEqual([50, 50, 20]);
  });

  it('sends many files to the chat in batches of 20 with the caption only once', async () => {
    const reqs: Array<{ files: number; last: string | null }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        const form = init.body as FormData;
        reqs.push({ files: form.getAll('files').length, last: form.get('last') as string | null });
        return new Response(JSON.stringify({ ok: true, sent: form.getAll('files').length }));
      }),
    );
    const sent: string[] = [];
    const res = await sendAllToChat(Array.from({ length: 45 }, (_, i) => item(i)), () => {}, (files) => sent.push(...files.map((f) => f.id)));
    expect(res.ok).toBe(true);
    expect(reqs).toEqual([
      { files: 20, last: '0' },
      { files: 20, last: '0' },
      { files: 5, last: null },
    ]);
    expect(sent).toHaveLength(45);
  });
});

describe('Telegram limits on big packs', () => {
  const items = (n: number) => Array.from({ length: n }, (_, i) => item(i));
  async function run<T>(job: Promise<T>): Promise<T> {
    await vi.runAllTimersAsync();
    return job;
  }

  it('sits out a long wait (Telegram quota) however long, without slowing down afterwards', async () => {
    vi.useFakeTimers();
    const reqs = mockBackend((n, req) => (n === 2 ? { status: 429, body: { ok: false, error: 'flood', retryAfter: 268, added: 3, name: 'p_by_bot' } } : ok(req)));
    const waits: number[] = [];
    const res = await run(createPackAll({ title: 'T', items: items(70) }, (p) => p.waiting && waits.push(p.waiting), () => {}));
    expect(res.ok).toBe(true);
    expect(res.data?.added).toBe(70);
    expect(waits[0]).toBe(270);
    expect(waits.at(-1)).toBe(1);
    expect(reqs.map((r) => r.pace)).toEqual([null, '900', '900', '810']);
  });

  it('remembers the wait: the next job (another pack, after a reload) waits before asking Telegram again', async () => {
    vi.useFakeTimers();
    mockBackend((n) => (n === 1 ? { status: 429, body: { ok: false, error: 'flood', retryAfter: 60 } } : { status: 500, body: {} }));
    const stop = new AbortController();
    const first = createPackAll({ title: 'T', items: items(3), signal: stop.signal }, (p) => p.waiting === 30 && stop.abort(), () => {});
    expect(await run(first)).toMatchObject({ ok: false, error: 'stopped' });
    expect(floodUntil()).toBeGreaterThan(Date.now());

    const reqs = mockBackend((_n, req) => ok(req));
    const waits: number[] = [];
    const second = createPackAll({ title: 'T', items: items(2) }, (p) => p.waiting && waits.push(p.waiting), () => {});
    expect((await run(second)).ok).toBe(true);
    expect(waits[0]).toBeLessThanOrEqual(30);
    expect(waits[0]).toBeGreaterThan(25);
    expect(reqs).toHaveLength(1);
  });

  it('repeats a request whose answer was lost, with the same nonce and pack size (the backend skips what landed)', async () => {
    vi.useFakeTimers();
    const reqs: Req[] = [];
    let n = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        const form = init.body as FormData;
        reqs.push({ files: form.getAll('files').length, title: null, pace: null, set: form.get('set') as string | null, notify: null, total: null, fresh: null, size: form.get('size') as string | null, nonce: form.get('nonce') as string | null });
        n++;
        if (n === 1 || n === 3) throw new TypeError('Failed to fetch');
        if (n === 4) return new Response('An error occurred with your deployment\n\nFUNCTION_INVOCATION_TIMEOUT', { status: 504 });
        return new Response(JSON.stringify({ ok: true, name: 'p_by_bot', url: 'u', title: 'T', added: form.getAll('files').length, canvas: 100 }));
      }),
    );
    const waits: number[] = [];
    const res = await run(createPackAll({ title: 'T', items: items(55) }, (p) => p.waiting && waits.push(p.waiting), () => {}));
    expect(res.ok).toBe(true);
    expect(res.data?.added).toBe(55);
    expect(reqs[0].nonce).toBe(reqs[1].nonce);
    expect(reqs.slice(2).map((r) => [r.set, r.size])).toEqual([
      ['p_by_bot', '50'],
      ['p_by_bot', '50'],
      ['p_by_bot', '50'],
    ]);
    // 3 s, then 3 s again (a success in between resets the count), then 10 s.
    expect(waits.filter((w, i) => i === 0 || waits[i - 1] < w)).toEqual([3, 3, 10]);
  });

  it('gives up on a request after three repeats', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('offline'))));
    const res = await run(createPackAll({ title: 'T', items: items(2) }, () => {}, () => {}));
    expect(res).toMatchObject({ ok: false, error: 'network' });
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(4);
  });

  it('continues with the rest when a request was cut short by its time budget', async () => {
    const reqs = mockBackend((n, req) => ({ status: 200, body: { ...ok(req).body, added: n === 2 ? 4 : req.files } }));
    const added: string[] = [];
    const res = await createPackAll({ title: 'T', items: items(60) }, () => {}, (batch) => added.push(...batch.map((b) => b.id)));
    expect(res.ok).toBe(true);
    expect(reqs.map((r) => r.files)).toEqual([50, 10, 6]);
    expect(added).toEqual(items(60).map((i) => i.id));
  });

  it('stops when asked, keeping the pack so far', async () => {
    vi.useFakeTimers();
    mockBackend((n, req) => (n === 2 ? { status: 429, body: { ok: false, error: 'flood', retryAfter: 120, added: 2, name: 'p_by_bot' } } : ok(req)));
    const stop = new AbortController();
    const added: string[] = [];
    const job = createPackAll({ title: 'T', items: items(80), signal: stop.signal }, (p) => p.waiting && stop.abort(), (batch) => added.push(...batch.map((b) => b.id)));
    const res = await run(job);
    expect(res).toMatchObject({ ok: false, error: 'stopped', data: { name: 'p_by_bot', added: 52 } });
    expect(added).toHaveLength(52);
  });
});
