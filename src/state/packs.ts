import { fetchSticker, fetchStickerSet } from '../lib/botApi';
import { readLottieFile } from '../lottie/export';
import { extractPalette, normalizeForTgs } from '../lottie/imported';
import { applyLayout } from '../lottie/layout';
import { analyzePack, packCandidates } from '../lottie/packs';
import { logoArt } from './logoArt';
import type { LottieAnimation } from '../lottie/types';
import { useEditor, type ImportedTemplate } from './store';
import { useUi } from './ui';

async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export const packTemplateId = (pack: string, uid: string) => `pack:${pack}:${uid}`;

/**
 * Loads a Telegram sticker pack as templates: downloads every animated sticker through the bot, converts it
 * to the sticker format, finds the logo shared by the stickers and sets it up to be replaced by the user's
 * text/logo (earlier edits of the same stickers are restored).
 */
export async function loadPack(name: string, personal: boolean): Promise<void> {
  const ui = useUi.getState();
  if (personal) useEditor.getState().rememberPack({ name, title: name });
  const current = ui.packStatus[name];
  if (current?.state === 'loading') return;
  if (current?.state === 'ready' && useEditor.getState().imports.some((t) => t.source?.pack === name)) return;
  const status = (s: Parameters<typeof ui.setPackStatus>[1]) => useUi.getState().setPackStatus(name, s);

  status({ state: 'loading', done: 0, total: 0 });
  const set = await fetchStickerSet(name);
  if (!set.ok) return status({ state: 'error', error: set.error });
  const { items, title, skipped } = set.data;
  if (!items.length) return status({ state: 'error', error: 'empty' });

  let done = 0;
  status({ state: 'loading', done, total: items.length });
  const anims = await mapLimit(items, 6, async (item) => {
    try {
      const data = normalizeForTgs(readLottieFile(await fetchSticker(item.id)));
      return data;
    } catch {
      return null;
    } finally {
      status({ state: 'loading', done: ++done, total: items.length });
    }
  });
  const loaded = items.flatMap((item, i) => (anims[i] ? [{ item, data: anims[i] as LottieAnimation }] : []));
  if (!loaded.length) return status({ state: 'error', error: 'network' });

  // The analysis sticker by sticker, giving the page a breath in between (one long task froze phones).
  const all = [];
  for (const { data } of loaded) {
    await new Promise((r) => setTimeout(r, 0));
    all.push(packCandidates(data));
  }
  const picks = analyzePack(loaded.map((l) => l.data), all);
  const edits = useEditor.getState().packEdits;
  const templates: ImportedTemplate[] = loaded.map(({ item, data }, i) => {
    const pick = picks[i];
    const defaults = { hidden: pick.hidden, replace: pick.replace, overlay: !pick.replace };
    const saved = edits[item.uid];
    // Layer-list edits are replayed on the freshly downloaded sticker.
    const layout = saved?.layout ?? [];
    const svgs = useEditor.getState().layoutSvgs;
    const edited = applyLayout(data, layout, (key) => logoArt(svgs[key]));
    return {
      id: packTemplateId(name, item.uid),
      name: `${item.emoji || '⭐'} ${i + 1}`,
      data: edited,
      base: data,
      layout,
      palette: extractPalette(edited),
      colorMap: saved?.colorMap ?? {},
      // Older saved edits could have both a replaced part and the copy on top: keep only the replaced one.
      overlay: (saved?.overlay ?? defaults.overlay) && !(saved?.replace ?? defaults.replace),
      hidden: saved?.hidden ?? defaults.hidden,
      replace: saved?.replace ?? defaults.replace,
      transforms: saved?.transforms ?? {},
      paints: saved?.paints ?? {},
      source: { pack: name, uid: item.uid, emoji: item.emoji || '⭐' },
      defaults,
    };
  });
  useEditor.getState().addPackTemplates({ name, title }, templates, personal);
  status({ state: 'ready', count: templates.length, skipped: skipped + (items.length - loaded.length) });
}

/** Adds a pack to "My packs", opens its section, scrolls to it and loads it. */
export async function openPack(name: string): Promise<void> {
  useUi.getState().setPackOpen(name, true);
  const scroll = () => document.getElementById(`pack-${name}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const done = loadPack(name, true);
  requestAnimationFrame(scroll);
  await done;
  // The section may have moved meanwhile (e.g. the bot's template list arrived).
  setTimeout(scroll, 50);
}
