/**
 * Telegram sticker packs as editor templates.
 *
 *   GET /api/stickerset?name=…  — the animated (.tgs) stickers of a pack (public data, cached by the CDN)
 *   GET /api/sticker?id=…       — one sticker file, proxied (Telegram file URLs contain the bot token)
 *   GET /api/templates          — packs the bot's admin added for every user
 *
 * In the chat, a sticker, a custom emoji or a pack link gets a reply with a button that opens the pack in the
 * editor; admins (ADMIN_IDS) also get a button that adds it to the bot's templates. That list is kept without a
 * database: in a message the bot pins in the first admin's chat.
 */
import { json, telegram, TelegramError, telegramFileUrl, type Env } from './shared.js';
import { pickLang, type Lang } from './telegram.js';

const PUBLIC = { 'access-control-allow-origin': '*' };
const MAX_STICKER_BYTES = 1024 * 1024;
const MAX_TEMPLATE_PACKS = 40;
export const STORE_HEAD = '📌 Emoji Studio';
const NAME = /^[A-Za-z0-9_]{1,64}$/;

export interface PackRef {
  name: string;
  title: string;
}

interface Sticker {
  file_id: string;
  file_unique_id: string;
  emoji?: string;
  is_animated: boolean;
  is_video: boolean;
  set_name?: string;
}

interface StickerSet {
  name: string;
  title: string;
  sticker_type: string;
  stickers: Sticker[];
}

export interface Message {
  message_id: number;
  chat: { id: number; type: string };
  from?: { id: number; language_code?: string };
  text?: string;
  caption?: string;
  sticker?: Sticker;
  entities?: Array<{ type: string; custom_emoji_id?: string }>;
  reply_markup?: { inline_keyboard: Array<Array<{ text: string; web_app?: { url: string }; callback_data?: string }>> };
}

export interface CallbackQuery {
  id: string;
  from: { id: number; language_code?: string };
  message?: Message;
  data?: string;
}

/** Pack name from a t.me/addstickers/…, t.me/addemoji/… or tg://addstickers?set=… link. */
export function parsePackLink(text: string): string | null {
  const m = /(?:t(?:elegram)?\.me\/|tg:\/\/)add(?:stickers|emoji)(?:\/|\?set=)([A-Za-z0-9_]{1,64})/i.exec(text);
  return m ? m[1] : null;
}

export function adminIds(env: Env): number[] {
  return (env.ADMIN_IDS ?? '')
    .split(/[\s,;]+/)
    .map((s) => Number(s))
    .filter((n) => Number.isSafeInteger(n) && n > 0);
}

async function getSet(env: Env, name: string): Promise<StickerSet | null> {
  try {
    return (await telegram(env, 'getStickerSet', { name })) as StickerSet;
  } catch (err) {
    if (err instanceof TelegramError && err.status === 400) return null;
    throw err;
  }
}

const animatedOf = (set: StickerSet) => set.stickers.filter((s) => s.is_animated && !s.is_video);
const cleanTitle = (title: string) => title.replace(/\s+/g, ' ').trim().slice(0, 64) || 'Pack';

// ---------------------------------------------------------------------------
// Public GET endpoints
// ---------------------------------------------------------------------------

export async function handleStickerSet(url: URL, env: Env): Promise<Response> {
  const name = url.searchParams.get('name') ?? '';
  if (!NAME.test(name)) return json({ ok: false, error: 'bad-name' }, 400, PUBLIC);
  let set: StickerSet | null;
  try {
    set = await getSet(env, name);
  } catch (err) {
    console.error('getStickerSet failed', err instanceof Error ? err.message : err);
    return json({ ok: false, error: 'telegram' }, 502, PUBLIC);
  }
  if (!set) return json({ ok: false, error: 'pack-not-found' }, 404, { ...PUBLIC, 'cache-control': 'public, s-maxage=60' });
  const animated = animatedOf(set);
  return json(
    {
      ok: true,
      name: set.name,
      title: set.title,
      type: set.sticker_type,
      items: animated.map((s) => ({ id: s.file_id, uid: s.file_unique_id, emoji: s.emoji ?? '' })),
      skipped: set.stickers.length - animated.length,
    },
    200,
    { ...PUBLIC, 'cache-control': 'public, max-age=300, s-maxage=600, stale-while-revalidate=86400' },
  );
}

export async function handleSticker(url: URL, env: Env): Promise<Response> {
  const id = url.searchParams.get('id') ?? '';
  if (!/^[A-Za-z0-9_-]{10,256}$/.test(id)) return json({ ok: false, error: 'bad-id' }, 400, PUBLIC);
  let file: { file_path?: string; file_size?: number };
  try {
    file = (await telegram(env, 'getFile', { file_id: id })) as typeof file;
  } catch (err) {
    const notFound = err instanceof TelegramError && err.status === 400;
    return json({ ok: false, error: notFound ? 'not-found' : 'telegram' }, notFound ? 404 : 502, PUBLIC);
  }
  // Only animated stickers — the proxy must not serve other files the bot can see.
  if (!file.file_path || !/\.tgs$/i.test(file.file_path) || (file.file_size ?? 0) > MAX_STICKER_BYTES) {
    return json({ ok: false, error: 'not-a-sticker' }, 404, PUBLIC);
  }
  const res = await fetch(telegramFileUrl(env, file.file_path));
  if (!res.ok) return json({ ok: false, error: 'telegram' }, 502, PUBLIC);
  const bytes = await res.arrayBuffer();
  if (bytes.byteLength > MAX_STICKER_BYTES) return json({ ok: false, error: 'too-big' }, 413, PUBLIC);
  return new Response(bytes, {
    headers: { ...PUBLIC, 'content-type': 'application/x-tgsticker', 'cache-control': 'public, max-age=86400, s-maxage=31536000, immutable' },
  });
}

export async function handleTemplates(env: Env): Promise<Response> {
  let packs: PackRef[] = [];
  try {
    packs = (await readStore(env)).packs;
  } catch (err) {
    console.error('template list failed', err instanceof Error ? err.message : err);
  }
  return json({ ok: true, packs }, 200, { ...PUBLIC, 'cache-control': 'public, max-age=30, s-maxage=30, stale-while-revalidate=600' });
}

// ---------------------------------------------------------------------------
// Template list, stored in a message pinned in the first admin's chat
// ---------------------------------------------------------------------------

const STORE_NOTE: Record<Lang, string> = {
  uk: 'Тут бот зберігає список паків-шаблонів, які бачать усі. Не відкріплюйте й не видаляйте це повідомлення.',
  ru: 'Здесь бот хранит список паков-шаблонов, которые видят все. Не открепляйте и не удаляйте это сообщение.',
  en: 'The bot keeps the list of template packs everyone sees here. Do not unpin or delete this message.',
};

export function formatStore(packs: readonly PackRef[], lang: Lang): string {
  const lines = packs.map((p) => `• ${p.name} — ${cleanTitle(p.title)}`);
  return [`${STORE_HEAD} · templates`, STORE_NOTE[lang], '', ...lines].join('\n');
}

export function parseStore(text: string): PackRef[] {
  const out: PackRef[] = [];
  for (const line of text.split('\n')) {
    const m = /^• ([A-Za-z0-9_]{1,64})(?: — (.*))?$/.exec(line.trim());
    if (m && !out.some((p) => p.name === m[1])) out.push({ name: m[1], title: m[2]?.trim() || m[1] });
  }
  return out;
}

interface Store {
  packs: PackRef[];
  chatId: number | null;
  messageId: number | null;
}

async function readStore(env: Env): Promise<Store> {
  const [admin] = adminIds(env);
  if (!admin) return { packs: [], chatId: null, messageId: null };
  let chat: { pinned_message?: Message & { from?: { id: number } } };
  try {
    chat = (await telegram(env, 'getChat', { chat_id: admin })) as typeof chat;
  } catch (err) {
    // The admin has not started the bot yet.
    if (err instanceof TelegramError && err.status === 400) return { packs: [], chatId: admin, messageId: null };
    throw err;
  }
  const pin = chat.pinned_message;
  const botId = Number(env.TELEGRAM_BOT_TOKEN.split(':')[0]);
  if (pin?.text?.startsWith(STORE_HEAD) && (!pin.from || pin.from.id === botId)) {
    return { packs: parseStore(pin.text), chatId: admin, messageId: pin.message_id };
  }
  return { packs: [], chatId: admin, messageId: null };
}

async function writeStore(env: Env, store: Store, packs: readonly PackRef[], lang: Lang): Promise<void> {
  if (!store.chatId) return;
  const text = formatStore(packs, lang);
  if (store.messageId) {
    try {
      await telegram(env, 'editMessageText', { chat_id: store.chatId, message_id: store.messageId, text });
      return;
    } catch (err) {
      if (err instanceof TelegramError && /not modified/i.test(err.message)) return;
      // The message is gone or not editable: start a new one below.
    }
  }
  const sent = (await telegram(env, 'sendMessage', { chat_id: store.chatId, text, disable_notification: true })) as { message_id: number };
  await telegram(env, 'pinChatMessage', { chat_id: store.chatId, message_id: sent.message_id, disable_notification: true });
}

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

interface Texts {
  found: (title: string, n: number, skipped: number) => string;
  open: string;
  add: string;
  remove: string;
  notFound: string;
  noAnimated: (title: string) => string;
  added: string;
  removed: string;
  full: string;
  onlyAdmins: string;
  adminHint: (id: number) => string;
  yourId: (id: number) => string;
  list: (packs: readonly PackRef[]) => string;
  help: string;
}

export function templateTexts(lang: Lang): Texts {
  if (lang === 'uk') {
    return {
      found: (t, n, s) =>
        `🧩 Пак «${t}»: анімованих стікерів — ${n}${s ? ` (ще ${s} відео чи статичних пропущу)` : ''}.\n\nВідкрийте його в редакторі — я знайду в стікерах лого чи напис і підставлю замість нього ваш текст або лого.`,
      open: '🎨 Відкрити як шаблони',
      add: '➕ Додати в шаблони бота для всіх',
      remove: '➖ Прибрати з шаблонів бота',
      notFound: 'Не знайшов такого паку. Надішліть стікер чи емодзі з нього або посилання t.me/addstickers/… чи t.me/addemoji/…',
      noAnimated: (t) => `У паку «${t}» немає анімованих (.tgs) стікерів — відео й статичні стікери редактор не підтримує.`,
      added: '✅ Пак додано в шаблони бота',
      removed: 'Пак прибрано з шаблонів бота',
      full: `Шаблонів бота вже ${MAX_TEMPLATE_PACKS} — спершу приберіть якийсь пак.`,
      onlyAdmins: 'Це може лише адміністратор бота.',
      adminHint: (id) => `\n\nℹ️ Щоб додавати паки в шаблони для всіх користувачів, додайте у Vercel змінну ADMIN_IDS=${id} і зробіть Redeploy.`,
      yourId: (id) => `Ваш Telegram ID: ${id}`,
      list: (packs) => (packs.length ? `Шаблони бота:\n${packs.map((p) => `• ${p.title} — t.me/addstickers/${p.name}`).join('\n')}\n\nЩоб прибрати пак, надішліть його ще раз.` : 'Шаблонів бота поки немає. Надішліть стікер або посилання на пак.'),
      help: 'Надішліть мені стікер чи емодзі з паку або посилання на пак (t.me/addstickers/… чи t.me/addemoji/…) — зроблю з нього шаблони для редактора.',
    };
  }
  if (lang === 'ru') {
    return {
      found: (t, n, s) =>
        `🧩 Пак «${t}»: анимированных стикеров — ${n}${s ? ` (ещё ${s} видео или статичных пропущу)` : ''}.\n\nОткройте его в редакторе — я найду в стикерах лого или надпись и подставлю вместо неё ваш текст или лого.`,
      open: '🎨 Открыть как шаблоны',
      add: '➕ Добавить в шаблоны бота для всех',
      remove: '➖ Убрать из шаблонов бота',
      notFound: 'Не нашёл такой пак. Пришлите стикер или эмодзи из него либо ссылку t.me/addstickers/… или t.me/addemoji/…',
      noAnimated: (t) => `В паке «${t}» нет анимированных (.tgs) стикеров — видео и статичные стикеры редактор не поддерживает.`,
      added: '✅ Пак добавлен в шаблоны бота',
      removed: 'Пак убран из шаблонов бота',
      full: `Шаблонов бота уже ${MAX_TEMPLATE_PACKS} — сначала уберите какой-нибудь пак.`,
      onlyAdmins: 'Это может только администратор бота.',
      adminHint: (id) => `\n\nℹ️ Чтобы добавлять паки в шаблоны для всех, добавьте в Vercel переменную ADMIN_IDS=${id} и сделайте Redeploy.`,
      yourId: (id) => `Ваш Telegram ID: ${id}`,
      list: (packs) => (packs.length ? `Шаблоны бота:\n${packs.map((p) => `• ${p.title} — t.me/addstickers/${p.name}`).join('\n')}\n\nЧтобы убрать пак, пришлите его ещё раз.` : 'Шаблонов бота пока нет. Пришлите стикер или ссылку на пак.'),
      help: 'Пришлите мне стикер или эмодзи из пака либо ссылку на пак (t.me/addstickers/… или t.me/addemoji/…) — сделаю из него шаблоны для редактора.',
    };
  }
  return {
    found: (t, n, s) =>
      `🧩 Pack “${t}”: ${n} animated stickers${s ? ` (${s} video/static ones will be skipped)` : ''}.\n\nOpen it in the editor — I will find the logo or text in the stickers and put your text or logo in its place.`,
    open: '🎨 Open as templates',
    add: '➕ Add to the bot templates for everyone',
    remove: '➖ Remove from the bot templates',
    notFound: 'Pack not found. Send a sticker or emoji from it, or a t.me/addstickers/… or t.me/addemoji/… link.',
    noAnimated: (t) => `Pack “${t}” has no animated (.tgs) stickers — video and static stickers are not supported.`,
    added: '✅ Added to the bot templates',
    removed: 'Removed from the bot templates',
    full: `There are already ${MAX_TEMPLATE_PACKS} template packs — remove one first.`,
    onlyAdmins: 'Only the bot admin can do this.',
    adminHint: (id) => `\n\nℹ️ To add packs to the templates for everyone, set ADMIN_IDS=${id} in Vercel and redeploy.`,
    yourId: (id) => `Your Telegram ID: ${id}`,
    list: (packs) => (packs.length ? `Bot templates:\n${packs.map((p) => `• ${p.title} — t.me/addstickers/${p.name}`).join('\n')}\n\nTo remove a pack, send it again.` : 'No bot templates yet. Send a sticker or a pack link.'),
    help: 'Send me a sticker or emoji from a pack, or a pack link (t.me/addstickers/… or t.me/addemoji/…) — I will turn it into editor templates.',
  };
}

function editorUrl(env: Env, pack: string): string {
  const url = new URL(env.APP_URL);
  url.searchParams.set('pack', pack);
  return url.toString();
}

function keyboard(env: Env, t: Texts, pack: string, admin: boolean, inBot: boolean) {
  const rows: Array<Array<Record<string, unknown>>> = [[{ text: t.open, web_app: { url: editorUrl(env, pack) } }]];
  if (admin) rows.push([{ text: inBot ? t.remove : t.add, callback_data: inBot ? 'tpl:del' : 'tpl:add' }]);
  return { inline_keyboard: rows };
}

/** Pack name a message points to: a sticker, a custom emoji or a link. */
export async function packFromMessage(env: Env, msg: Message): Promise<string | null> {
  if (msg.sticker?.set_name) return msg.sticker.set_name;
  const custom = msg.entities?.find((e) => e.type === 'custom_emoji' && e.custom_emoji_id);
  if (custom) {
    try {
      const [sticker] = (await telegram(env, 'getCustomEmojiStickers', { custom_emoji_ids: [custom.custom_emoji_id] })) as Sticker[];
      if (sticker?.set_name) return sticker.set_name;
    } catch {
      // Fall through to links.
    }
  }
  return parsePackLink(msg.text ?? msg.caption ?? '');
}

/** Replies to a pack sent to the bot. */
export async function replyWithPack(env: Env, msg: Message, name: string): Promise<void> {
  const lang = pickLang(msg.from?.language_code);
  const t = templateTexts(lang);
  const set = await getSet(env, name);
  if (!set) {
    await telegram(env, 'sendMessage', { chat_id: msg.chat.id, text: t.notFound });
    return;
  }
  const animated = animatedOf(set).length;
  if (!animated) {
    await telegram(env, 'sendMessage', { chat_id: msg.chat.id, text: t.noAnimated(set.title) });
    return;
  }
  const admins = adminIds(env);
  const isAdmin = !!msg.from && admins.includes(msg.from.id);
  const inBot = isAdmin ? (await readStore(env).catch(() => null))?.packs.some((p) => p.name === set.name) ?? false : false;
  const hint = !admins.length && msg.from ? t.adminHint(msg.from.id) : '';
  await telegram(env, 'sendMessage', {
    chat_id: msg.chat.id,
    text: t.found(set.title, animated, set.stickers.length - animated) + hint,
    reply_markup: keyboard(env, t, set.name, isAdmin, inBot),
  });
}

export async function replyWithTemplates(env: Env, msg: Message): Promise<void> {
  const t = templateTexts(pickLang(msg.from?.language_code));
  const packs = (await readStore(env).catch(() => null))?.packs ?? [];
  await telegram(env, 'sendMessage', { chat_id: msg.chat.id, text: t.list(packs), disable_web_page_preview: true });
}

export async function replyWithHelp(env: Env, msg: Message, kind: 'help' | 'id'): Promise<void> {
  const t = templateTexts(pickLang(msg.from?.language_code));
  const text = kind === 'id' && msg.from ? t.yourId(msg.from.id) : t.help;
  await telegram(env, 'sendMessage', { chat_id: msg.chat.id, text });
}

/** The pack a reply is about — taken from its "open" button, so callback data stays tiny. */
function packFromMarkup(msg: Message | undefined): string | null {
  for (const row of msg?.reply_markup?.inline_keyboard ?? []) {
    for (const button of row) {
      if (!button.web_app?.url) continue;
      const name = new URL(button.web_app.url).searchParams.get('pack');
      if (name && NAME.test(name)) return name;
    }
  }
  return null;
}

/** "Add to / remove from the bot templates" buttons. */
export async function handleTemplateCallback(env: Env, cq: CallbackQuery): Promise<void> {
  const lang = pickLang(cq.from.language_code);
  const t = templateTexts(lang);
  const answer = (text: string) => telegram(env, 'answerCallbackQuery', { callback_query_id: cq.id, text });
  if (!adminIds(env).includes(cq.from.id)) return void (await answer(t.onlyAdmins));
  const name = packFromMarkup(cq.message);
  if (!name || (cq.data !== 'tpl:add' && cq.data !== 'tpl:del')) return void (await answer(t.notFound));

  const store = await readStore(env);
  const adding = cq.data === 'tpl:add';
  let packs = store.packs.filter((p) => p.name !== name);
  if (adding) {
    if (packs.length >= MAX_TEMPLATE_PACKS) return void (await answer(t.full));
    const set = await getSet(env, name);
    if (!set) return void (await answer(t.notFound));
    packs = [...packs, { name: set.name, title: cleanTitle(set.title) }];
  }
  await writeStore(env, store, packs, lang);
  await answer(adding ? t.added : t.removed);
  if (cq.message) {
    await telegram(env, 'editMessageReplyMarkup', {
      chat_id: cq.message.chat.id,
      message_id: cq.message.message_id,
      reply_markup: keyboard(env, t, name, true, adding),
    }).catch(() => undefined);
  }
}
