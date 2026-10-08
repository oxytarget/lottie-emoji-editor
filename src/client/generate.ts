import { newGenerationId, requestGeneration, type Generation } from '../lib/accountApi';
import { createPackAll, sendAllToChat, type PackResult } from '../lib/botApi';
import { downloadBlob, slug, tgsFromJson, zipFiles } from '../lottie/export';
import { svgKey } from '../state/logoArt';
import { useAccount } from '../state/account';
import type { CompiledEmoji } from '../state/useCompiled';
import { saveResult, type StoredResult } from './results';

export type GenerateError =
  | { kind: 'guest' }
  | { kind: 'too-big' }
  | { kind: 'no-balance'; cost: number; balance: number }
  | { kind: 'pro'; reason: 'template' | 'batch' | 'font' }
  | { kind: 'template' }
  | { kind: 'failed' };

/** The generation id of a design: the same design asks again with the same id (a retry is never charged twice). */
function idFor(signature: string): string {
  const key = `emoji-studio-gen:${signature}`;
  try {
    const known = sessionStorage.getItem(key);
    if (known) return known;
    const id = newGenerationId();
    sessionStorage.setItem(key, id);
    return id;
  } catch {
    return newGenerationId();
  }
}

/**
 * Generates a design in the given templates: the backend checks the balance and the templates and spends the
 * generations (accounts on), then the result is kept on this device for the history.
 */
export async function generate(
  emojis: readonly CompiledEmoji[],
  title: string,
): Promise<{ ok: true; result: StoredResult; generation: Generation } | { ok: false; error: GenerateError }> {
  if (!emojis.length) return { ok: false, error: { kind: 'failed' } };
  if (emojis.some((e) => !e.check.ok)) return { ok: false, error: { kind: 'too-big' } };
  const account = useAccount.getState();
  if (account.status === 'guest') return { ok: false, error: { kind: 'guest' } };
  const templates = emojis.map((e) => e.id);
  const id = idFor(svgKey(templates.join('|') + emojis.map((e) => e.json).join('|')));
  let generation: Generation;
  if (account.status === 'ready') {
    const res = await requestGeneration(id, templates, title);
    if (!res.ok) {
      if (res.error === 'no-balance')
        return {
          ok: false,
          error: {
            kind: 'no-balance',
            cost: Number(res.cost) || templates.length,
            balance: Number(res.balance) || 0,
          },
        };
      if (res.error === 'pro-required')
        return {
          ok: false,
          error: {
            kind: 'pro',
            reason: res.reason === 'batch' ? 'batch' : 'template',
          },
        };
      if (res.error === 'template-unavailable') return { ok: false, error: { kind: 'template' } };
      if (res.error === 'unauthorized' || res.error === 'guest') return { ok: false, error: { kind: 'guest' } };
      return { ok: false, error: { kind: 'failed' } };
    }
    generation = res.generation;
    account.addGeneration(res.generation, res.balance);
  } else {
    // Accounts not set up (or no backend): free.
    generation = { id, at: Date.now(), title, templates, cost: 0 };
    account.addGeneration(generation, account.account?.balance ?? 0);
  }
  const result: StoredResult = {
    id: generation.id,
    at: generation.at,
    title,
    files: emojis.map((e, i) => ({
      template: e.id,
      name: `${slug(title)}-${i + 1}`,
      json: e.json,
    })),
  };
  await saveResult(result);
  return { ok: true, result, generation };
}

export function downloadResult(result: StoredResult): void {
  if (result.files.length === 1) return downloadBlob(tgsFromJson(result.files[0].json), `${result.files[0].name}.tgs`, 'application/x-tgsticker');
  const files: Record<string, Uint8Array> = {};
  for (const f of result.files) files[`${f.name}.tgs`] = tgsFromJson(f.json);
  downloadBlob(zipFiles(files), `${slug(result.title)}.zip`, 'application/zip');
}

const outgoing = (result: StoredResult) =>
  result.files.map((f) => ({
    id: f.name,
    name: `${f.name}.tgs`,
    data: tgsFromJson(f.json),
    type: 'application/x-tgsticker',
    emoji: '⭐',
  }));

/** The bot sends the files to the user's chat (the generation id proves they were paid for). */
export async function sendResult(result: StoredResult): Promise<boolean> {
  const res = await sendAllToChat(
    outgoing(result),
    () => {},
    () => {},
    [result.id],
  );
  return res.ok;
}

/** The bot makes a custom emoji pack of the result. */
export async function packResult(result: StoredResult, onProgress: (done: number, total: number) => void): Promise<PackResult | null> {
  const res = await createPackAll(
    { title: result.title, items: outgoing(result), gens: [result.id] },
    (p) => onProgress(p.done, p.total),
    () => {},
  );
  return res.ok ? res.data : null;
}
