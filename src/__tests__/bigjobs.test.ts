import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPackAll, sendAllToChat, takeBatch } from '../lib/botApi';

const item = (i: number, size = 20_000) => ({ id: `e${i}`, name: `e${i}.tgs`, data: new Uint8Array(size), type: 'application/x-tgsticker', emoji: '⭐' });

interface Req {
  files: number;
  set: string | null;
  notify: string | null;
  total: string | null;
  fresh: string | null;
}

/** Fake backend: `reply(n, req)` answers the n-th request (1-based). */
function mockBackend(reply: (n: number, req: Req) => { status: number; body: Record<string, unknown> }) {
  const reqs: Req[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      const form = init.body as FormData;
      const req = { files: form.getAll('files').length, set: form.get('set') as string | null, notify: form.get('notify') as string | null, total: form.get('total') as string | null, fresh: form.get('fresh') as string | null };
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
});

describe('big packs from the editor', () => {
  it('splits by count and by request size', () => {
    expect(takeBatch([item(1), item(2), item(3)], 2)).toHaveLength(2);
    expect(takeBatch([item(1, 2_000_000), item(2, 2_000_000)], 10)).toHaveLength(1);
    expect(takeBatch([item(1, 9_000_000)], 10)).toHaveLength(1);
  });

  it('creates a 97-emoji pack: 30 in the first request, then batches of 10, one chat message', async () => {
    const reqs = mockBackend((_n, req) => ok(req));
    const added: string[] = [];
    const res = await createPackAll({ title: 'T', items: Array.from({ length: 97 }, (_, i) => item(i)) }, () => {}, (batch) => added.push(...batch.map((b) => b.id)));
    expect(res.ok).toBe(true);
    expect(res.data?.added).toBe(97);
    expect(reqs.map((r) => r.files)).toEqual([30, 10, 10, 10, 10, 10, 10, 7]);
    expect(reqs[0].set).toBeNull();
    expect(reqs.slice(1).every((r) => r.set === 'p_by_bot' && r.fresh === '1')).toBe(true);
    expect(reqs.map((r) => r.notify)).toEqual([...Array(7).fill('0'), null]);
    expect(reqs.every((r) => r.total === '97')).toBe(true);
    expect(new Set(added).size).toBe(97);
  });

  it('waits when Telegram asks to and continues without duplicates', async () => {
    vi.useFakeTimers();
    const reqs = mockBackend((n, req) =>
      n === 2 ? { status: 429, body: { ok: false, error: 'flood', retryAfter: 3, added: 4, name: 'p_by_bot' } } : ok(req),
    );
    const waits: number[] = [];
    const added: string[] = [];
    const job = createPackAll(
      { title: 'T', items: Array.from({ length: 45 }, (_, i) => item(i)) },
      (p) => p.waiting && waits.push(p.waiting),
      (batch) => added.push(...batch.map((b) => b.id)),
    );
    await vi.runAllTimersAsync();
    const res = await job;
    expect(res.ok).toBe(true);
    expect(waits).toEqual([3, 2, 1]);
    expect(reqs.map((r) => r.files)).toEqual([30, 10, 10, 1]);
    expect(added).toEqual(Array.from({ length: 45 }, (_, i) => `e${i}`));
  });

  it('stops on other errors and returns the pack so far', async () => {
    mockBackend((n, req) => (n === 3 ? { status: 502, body: { ok: false, error: 'telegram', detail: 'boom', added: 2, name: 'p_by_bot' } } : ok(req)));
    const added: string[] = [];
    const res = await createPackAll({ title: 'T', items: Array.from({ length: 60 }, (_, i) => item(i)) }, () => {}, (batch) => added.push(...batch.map((b) => b.id)));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe('server');
    expect(res.data?.name).toBe('p_by_bot');
    expect(added).toHaveLength(42);
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
