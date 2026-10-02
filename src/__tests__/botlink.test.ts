import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { botUsername, canUseBot, checkLinkCode, createPack, sendToChat } from '../lib/botApi';
import { linkedCode, parseLinkCode, setLinkedCode, takeLinkFromUrl } from '../lib/botLink';

const CODE = 'u16-1abc-AbCdEfGh_jKl-nOp';

/** Fake backend: answers with `status`, records the forms it got. */
function mockBackend(status = 200, body: Record<string, unknown> = { ok: true, name: 'p_by_bot', url: 'https://t.me/addemoji/p_by_bot', title: 'T', added: 1, canvas: 100, sent: 1 }) {
  const forms: FormData[] = [];
  const urls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      urls.push(url);
      if (init?.body instanceof FormData) forms.push(init.body);
      return new Response(JSON.stringify(body), { status });
    }),
  );
  return { forms, urls };
}

const file = { name: 'a.tgs', data: new Uint8Array(10), type: 'application/x-tgsticker' };

beforeEach(() => setLinkedCode(null));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('link code from the bot (the editor in a browser)', () => {
  it('finds the code in what the user pastes', () => {
    expect(parseLinkCode(CODE)).toBe(CODE);
    expect(parseLinkCode(`  ${CODE}\n`)).toBe(CODE);
    expect(parseLinkCode(`Код для редактора в браузері:\n\n${CODE}\n\nНатисніть «Повернутися в редактор»`)).toBe(CODE);
    expect(parseLinkCode(`https://example.github.io/app/#tglink=${CODE}`)).toBe(CODE);
    expect(parseLinkCode('hello')).toBeNull();
    expect(parseLinkCode(`${CODE}x`)).toBeNull();
    expect(parseLinkCode('x16-1abc-AbCdEfGh_jKl-nOp')).toBeNull();
  });

  it('takes the code from the address and removes it from there', () => {
    history.replaceState(null, '', `/app/?a=1#tglink=${CODE}`);
    expect(takeLinkFromUrl()).toBe(CODE);
    expect(location.hash).toBe('');
    expect(location.search).toBe('?a=1');
    history.replaceState(null, '', `/app/#x=1&tglink=${CODE}`);
    expect(takeLinkFromUrl()).toBe(CODE);
    expect(location.hash).toBe('#x=1');
    expect(takeLinkFromUrl()).toBeNull();
  });

  it('keeps the code in this browser', () => {
    setLinkedCode(CODE);
    expect(linkedCode()).toBe(CODE);
    expect(localStorage.getItem('emoji-studio-tglink')).toBe(CODE);
    setLinkedCode(null);
    expect(linkedCode()).toBe('');
  });

  it('lets a linked browser use the bot: requests carry the code instead of Mini App data', async () => {
    const { forms } = mockBackend();
    setLinkedCode(CODE);
    expect((await createPack({ title: 'T', items: [{ ...file, emoji: '⭐' }] })).ok).toBe(true);
    expect((await sendToChat([file])).ok).toBe(true);
    for (const form of forms) {
      expect(form.get('link')).toBe(CODE);
      expect(form.get('initData')).toBeNull();
    }
  });

  it('forgets a code the backend rejects (expired), so the editor asks to link again', async () => {
    mockBackend(401, { ok: false, error: 'unauthorized' });
    setLinkedCode(CODE);
    const res = await createPack({ title: 'T', items: [{ ...file, emoji: '⭐' }] });
    expect(res).toMatchObject({ ok: false, error: 'unauthorized' });
    expect(linkedCode()).toBe('');
  });

  it('only counts as able to use the bot with a backend configured', () => {
    setLinkedCode(CODE);
    // No VITE_BOT_API_URL in tests: the bot is off whatever the link.
    expect(canUseBot()).toBe(false);
  });

  it('checks a code with the backend', async () => {
    const { urls } = mockBackend(200, { ok: true });
    expect(await checkLinkCode(CODE)).toBe('ok');
    expect(urls[0]).toBe(`/api/link?code=${CODE}`);
    mockBackend(401, { ok: false });
    expect(await checkLinkCode(CODE)).toBe('bad');
    mockBackend(404, { ok: false });
    expect(await checkLinkCode(CODE)).toBe('network');
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('offline'))));
    expect(await checkLinkCode(CODE)).toBe('network');
  });

  it("gets the bot's username from the backend, asking again after a failure", async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('offline'))));
    expect(await botUsername()).toBeNull();
    const { urls } = mockBackend(200, { ok: true, username: 'Emoji_test_bot' });
    expect(await botUsername()).toBe('Emoji_test_bot');
    expect(await botUsername()).toBe('Emoji_test_bot');
    expect(urls).toEqual(['/api/health']);
  });
});
