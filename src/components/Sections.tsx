import { useState, type ReactNode } from 'react';
import type { I18nKey } from '../i18n';
import { packsAvailable } from '../lib/botApi';
import { useLinkedCode } from '../lib/botLink';
import { confirmAction, haptic, isTelegram, openTelegramLink, telegramUser } from '../lib/telegram';
import type { Theme } from '../lib/theme';
import { posterDataUrl } from '../state/posters';
import { useEditor } from '../state/store';
import { useUi, type Section } from '../state/ui';
import { useT } from '../state/useT';
import type { Lang } from '../templates/types';
import { Toggle } from './controls';
import { DraftIcon, GlobeIcon, GridIcon, MoonIcon, PenIcon, ResetIcon, SaveIcon, StickersIcon, SunIcon, TrashIcon, UserIcon } from './icons';
import { TelegramLinkCard, unlink } from './TelegramLink';
import { PackForm } from './TemplateGrid';

const LANGS: Lang[] = ['uk', 'ru', 'en'];

const NAV: Array<{ value: Section; key: I18nKey; icon: ReactNode }> = [
  { value: 'create', key: 'navCreate', icon: <PenIcon /> },
  { value: 'studio', key: 'navStudio', icon: <GridIcon /> },
  { value: 'drafts', key: 'navDrafts', icon: <DraftIcon /> },
  { value: 'profile', key: 'navProfile', icon: <UserIcon /> },
];

export const goTo = (section: Section) => {
  if (useUi.getState().section === section) return;
  useUi.getState().setSection(section);
  window.scrollTo({ top: 0 });
  haptic();
};

/** Sections of the app: a bar at the bottom on phones, in the header on wide screens. */
export function SectionNav() {
  const t = useT();
  const section = useUi((u) => u.section);
  const drafts = useEditor((s) => s.drafts.length);
  return (
    <nav className="section-nav" aria-label={t('navCreate')}>
      {NAV.map((item) => (
        <button
          key={item.value}
          type="button"
          className={`section-nav-item${section === item.value ? ' is-active' : ''}`}
          aria-current={section === item.value ? 'page' : undefined}
          onClick={() => goTo(item.value)}
        >
          <span className="section-nav-icon">
            {item.icon}
            {item.value === 'drafts' && drafts > 0 && <em>{drafts}</em>}
          </span>
          <span className="section-nav-label">{t(item.key)}</span>
        </button>
      ))}
    </nav>
  );
}

function PageHead({ title, sub }: { title: string; sub: string }) {
  return (
    <header className="page-head">
      <h2>{title}</h2>
      <p>{sub}</p>
    </header>
  );
}

/** Saves the work as a draft, with a picture of the emoji shown now. */
export async function saveDraft(json: string | undefined, id?: string): Promise<string> {
  const thumb = json ? await posterDataUrl(json, { frac: 0.4 }, 112) : null;
  return useEditor.getState().saveDraft(thumb ?? undefined, id);
}

export function SaveDraftButton({ json, className = 'icon-btn is-round', withLabel = false }: { json?: string; className?: string; withLabel?: boolean }) {
  const t = useT();
  const [saved, setSaved] = useState(0);
  return (
    <button
      type="button"
      className={`${className}${saved ? ' is-saved' : ''}`}
      title={t('draftSave')}
      aria-label={t('draftSave')}
      onClick={async () => {
        await saveDraft(json);
        haptic();
        setSaved(Date.now());
        setTimeout(() => setSaved(0), 1600);
      }}
    >
      <SaveIcon width={20} height={20} />
      {withLabel && <span>{saved ? t('draftSaved') : t('draftSave')}</span>}
      <span className="sr-status" role="status">
        {saved ? t('draftSaved') : ''}
      </span>
    </button>
  );
}

function DraftCard({ id, json }: { id: string; json?: string }) {
  const t = useT();
  const lang = useEditor((s) => s.lang);
  const draft = useEditor((s) => s.drafts.find((d) => d.id === id));
  const [renaming, setRenaming] = useState(false);
  if (!draft) return null;
  const { openDraft, deleteDraft, renameDraft } = useEditor.getState();
  const date = new Date(draft.savedAt).toLocaleString(lang === 'uk' ? 'uk-UA' : lang === 'ru' ? 'ru-RU' : 'en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  return (
    <li className="draft-card">
      <div className="draft-thumb">{draft.thumb ? <img src={draft.thumb} alt="" draggable={false} /> : <DraftIcon width={28} height={28} />}</div>
      <div className="draft-info">
        {renaming ? (
          <form
            className="draft-rename"
            onSubmit={(e) => {
              e.preventDefault();
              renameDraft(id, String(new FormData(e.currentTarget).get('name') ?? ''));
              setRenaming(false);
            }}
          >
            <input name="name" defaultValue={draft.name} autoFocus maxLength={60} onBlur={(e) => e.currentTarget.form?.requestSubmit()} />
          </form>
        ) : (
          <button type="button" className="draft-name" title={t('draftRename')} onClick={() => setRenaming(true)}>
            {draft.name}
          </button>
        )}
        <span className="hint">
          {date} · {draft.design.selected.length} {t('draftEmoji')}
        </span>
        <div className="row-actions">
          <button
            type="button"
            className="pill-btn is-compact is-accent"
            onClick={() => {
              openDraft(id);
              goTo('create');
            }}
          >
            <PenIcon width={16} height={16} /> {t('draftOpen')}
          </button>
          <button type="button" className="pill-btn is-compact" onClick={() => saveDraft(json, id)}>
            <SaveIcon width={16} height={16} /> {t('draftUpdate')}
          </button>
          <button
            type="button"
            className="icon-btn is-small is-danger"
            title={t('draftDelete')}
            aria-label={`${t('draftDelete')}: ${draft.name}`}
            onClick={async () => (await confirmAction(t('draftDeleteConfirm').replace('{name}', draft.name))) && deleteDraft(id)}
          >
            <TrashIcon width={16} height={16} />
          </button>
        </div>
      </div>
    </li>
  );
}

export function DraftsPage({ json }: { json?: string }) {
  const t = useT();
  const ids = useEditor((s) => s.drafts.map((d) => d.id).join(','));
  const list = ids ? ids.split(',') : [];
  return (
    <div className="page">
      <PageHead title={t('navDrafts')} sub={t('draftsSub')} />
      <SaveDraftButton json={json} className="primary-btn draft-save" withLabel />
      {list.length ? (
        <ul className="draft-list">
          {list.map((id) => (
            <DraftCard key={id} id={id} json={json} />
          ))}
        </ul>
      ) : (
        <section className="card empty-card">
          <DraftIcon width={36} height={36} />
          <p className="hint">{t('draftsEmpty')}</p>
        </section>
      )}
    </div>
  );
}

/** Opens a template pack in the editor (its section expanded and scrolled to). */
function openInEditor(name: string) {
  const ui = useUi.getState();
  ui.setTab('templates');
  ui.setPackOpen(name, true);
  goTo('create');
  setTimeout(() => document.getElementById(name === '@builtin' ? 'pack-builtin' : `pack-${name}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120);
}

export function StudioPage() {
  const t = useT();
  const created = useEditor((s) => s.packs);
  const myPacks = useEditor((s) => s.myPacks);
  const removePack = useEditor((s) => s.removePack);
  const botPacks = useUi((u) => u.botPacks) ?? [];
  const status = useUi((u) => u.packStatus);
  const templates = [...botPacks.map((p) => ({ ...p, personal: false })), ...myPacks.filter((p) => !botPacks.some((b) => b.name === p.name)).map((p) => ({ ...p, personal: true }))];
  const count = (name: string) => {
    const s = status[name];
    return s?.state === 'ready' ? `${s.count} ${t('draftEmoji')}` : '';
  };
  return (
    <div className="page">
      <PageHead title={t('navStudio')} sub={t('studioSub')} />
      <section className="card">
        <h3 className="card-kicker">{t('studioCreated')}</h3>
        {created.length ? (
          <ul className="studio-list">
            {created.map((p) => (
              <li key={p.name}>
                <span className="studio-icon">
                  <StickersIcon width={20} height={20} />
                </span>
                <span className="studio-title">
                  <strong>{p.title}</strong>
                  <span className="hint">
                    {p.count} {t('draftEmoji')}
                  </span>
                </span>
                <button type="button" className="pill-btn is-compact is-accent" onClick={() => openTelegramLink(p.url)}>
                  {t('studioOpenTg')}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="hint">{t('studioCreatedEmpty')}</p>
        )}
      </section>
      <section className="card">
        <h3 className="card-kicker">{t('studioTemplates')}</h3>
        <ul className="studio-list">
          <li>
            <span className="studio-icon">
              <GridIcon width={20} height={20} />
            </span>
            <span className="studio-title">
              <strong>{t('studioBuiltin')}</strong>
              <span className="hint">22 {t('draftEmoji')}</span>
            </span>
            <button type="button" className="pill-btn is-compact is-accent" onClick={() => openInEditor('@builtin')}>
              {t('studioOpen')}
            </button>
          </li>
          {templates.map((p) => (
            <li key={p.name}>
              <span className="studio-icon">
                <StickersIcon width={20} height={20} />
              </span>
              <span className="studio-title">
                <strong>{p.title}</strong>
                <span className="hint">{count(p.name)}</span>
              </span>
              <button type="button" className="pill-btn is-compact is-accent" onClick={() => openInEditor(p.name)}>
                {t('studioOpen')}
              </button>
              {p.personal && (
                <button type="button" className="icon-btn is-small" title={t('packRemove')} aria-label={`${t('packRemove')}: ${p.title}`} onClick={() => removePack(p.name)}>
                  <TrashIcon width={16} height={16} />
                </button>
              )}
            </li>
          ))}
        </ul>
        {!templates.length && <p className="hint">{t('studioTemplatesEmpty')}</p>}
        <PackForm onDone={() => goTo('create')} />
      </section>
    </div>
  );
}

export function ProfilePage({ theme, onTheme }: { theme: Theme; onTheme: () => void }) {
  const t = useT();
  const lang = useEditor((s) => s.lang);
  const set = useEditor((s) => s.set);
  const reset = useEditor((s) => s.reset);
  const auto = useEditor((s) => s.autoBrand);
  const selected = useEditor((s) => s.selected.length);
  const drafts = useEditor((s) => s.drafts.length);
  const packs = useEditor((s) => s.packs.length);
  const user = telegramUser();
  const name = user?.name ?? t('profileGuest');
  // In a browser the bot creates packs once it is linked (in Telegram it always can).
  const linked = !!useLinkedCode();
  const canLink = packsAvailable() && !isTelegram();
  return (
    <div className="page">
      <PageHead title={t('navProfile')} sub={t('profileSub')} />
      <section className="card profile-card">
        <div className="profile-avatar">{user?.photo ? <img src={user.photo} alt="" /> : <span>{name.slice(0, 1).toUpperCase()}</span>}</div>
        <h3 className="profile-name">{name}</h3>
        {user?.username && <span className="hint">@{user.username}</span>}
        <p className="profile-stats">
          {t('profileSelected')}: {selected} · {t('profileDrafts')}: {drafts} · {t('profilePacks')}: {packs}
        </p>
        <div className="setting-rows">
          <div className="setting-row">
            <span className="label">{t('profileLang')}</span>
            <button type="button" className="chip-btn" onClick={() => set('lang', LANGS[(LANGS.indexOf(lang) + 1) % LANGS.length])}>
              <GlobeIcon width={16} height={16} /> {lang.toUpperCase()}
            </button>
          </div>
          <div className="setting-row">
            <span className="label">{t('profileTheme')}</span>
            <button type="button" className="chip-btn" onClick={onTheme}>
              {theme === 'dark' ? <MoonIcon width={16} height={16} /> : <SunIcon width={16} height={16} />} {t(theme === 'dark' ? 'themeDarkShort' : 'themeLightShort')}
            </button>
          </div>
          <div className="setting-row">
            <Toggle label={t('profileAutoBrand')} checked={auto} onChange={(v) => set('autoBrand', v)} />
          </div>
          {canLink && linked && (
            <div className="setting-row">
              <span className="label">{t('linkRow')}</span>
              <span className="link-status">
                <span className="is-ok">{t('linkOn')}</span>
                <button type="button" className="chip-btn" onClick={unlink}>
                  {t('linkOff')}
                </button>
              </span>
            </div>
          )}
        </div>
      </section>
      {canLink && !linked && <TelegramLinkCard />}
      <section className="card">
        <h3 className="card-kicker">{t('profileEditor')}</h3>
        <button type="button" className="pill-btn is-danger" onClick={async () => (await confirmAction(t('resetConfirm'))) && reset()}>
          <ResetIcon width={18} height={18} /> {t('reset')}
        </button>
      </section>
    </div>
  );
}
