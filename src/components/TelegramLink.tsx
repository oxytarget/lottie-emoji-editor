import { useEffect, useState } from 'react';
import { translate } from '../i18n';
import { botUsername, checkLinkCode } from '../lib/botApi';
import { parseLinkCode, setLinkedCode } from '../lib/botLink';
import { haptic, openTelegramLink } from '../lib/telegram';
import { useEditor } from '../state/store';
import { useUi } from '../state/ui';
import { useT } from '../state/useT';
import { SendIcon, StickersIcon, WarningIcon } from './icons';

const say = (key: Parameters<typeof translate>[1]) => useUi.getState().showToast(translate(useEditor.getState().lang, key));

/**
 * Links the editor in this browser to the user's Telegram with a code from the bot. A code the backend rejects
 * is not kept; one that cannot be checked right now (no network) is — the backend checks it on every request.
 */
export async function linkWith(code: string): Promise<'ok' | 'bad' | 'network'> {
  const res = await checkLinkCode(code);
  if (res === 'bad') return res;
  setLinkedCode(code);
  haptic();
  say('linkDone');
  return res;
}

/** A code the bot's "back to the editor" button put in the address. */
export async function linkFromUrl(code: string): Promise<void> {
  if ((await linkWith(code)) === 'bad') say('linkBad');
}

export function unlink(): void {
  setLinkedCode(null);
  say('linkOffDone');
}

/** The bot's @username once the backend told it (null: unknown, undefined: still asking). */
function useBotUsername(): string | null | undefined {
  const [name, setName] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    botUsername().then((n) => live && setName(n));
    return () => {
      live = false;
    };
  }, []);
  return name;
}

/** Opens the chat with the bot (after a pack is made or files are sent from a browser). */
export function openBotChat(): void {
  void botUsername().then((name) => name && openTelegramLink(`https://t.me/${name}`));
}

/** "Create the pack in Telegram": open the bot (it answers with a code), paste the code or come back by its button. */
export function TelegramLinkCard({ expired = false }: { expired?: boolean }) {
  const t = useT();
  const bot = useBotUsername();
  const [code, setCode] = useState('');
  const [state, setState] = useState<null | 'checking' | 'bad' | 'network'>(null);

  const connect = async (text = code) => {
    const parsed = parseLinkCode(text);
    if (!parsed) return setState('bad');
    setState('checking');
    const res = await linkWith(parsed);
    setState(res === 'ok' ? null : res);
  };

  const error = state === 'bad' ? 'linkBad' : state === 'network' ? 'linkNetwork' : bot === null ? 'linkNoBot' : expired ? 'linkExpired' : null;

  return (
    <div className="pack-form link-card">
      <h3 className="section-title">
        <StickersIcon width={20} height={20} /> {t('linkTitle')}
      </h3>
      <p className="hint">{t('linkText')}</p>
      {bot ? (
        // A real link (not window.open after a request), so no popup blocker gets in the way.
        <a className="primary-btn" href={`https://t.me/${bot}?start=link`} target="_blank" rel="noopener noreferrer">
          <SendIcon /> {t('linkOpenBot')}
        </a>
      ) : (
        <button type="button" className="primary-btn" disabled>
          {bot === undefined ? <span className="btn-spinner" aria-hidden /> : <SendIcon />} {t('linkOpenBot')}
        </button>
      )}
      <p className="hint">{t('linkPasteHint')}</p>
      <form
        className="link-code"
        onSubmit={(e) => {
          e.preventDefault();
          void connect();
        }}
      >
        <input
          value={code}
          placeholder={t('linkCode')}
          aria-label={t('linkCode')}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => {
            setCode(e.target.value);
            setState(null);
          }}
          onPaste={(e) => {
            const text = e.clipboardData.getData('text');
            if (!parseLinkCode(text)) return;
            e.preventDefault();
            setCode(parseLinkCode(text)!);
            void connect(text);
          }}
        />
        <button type="submit" className="pill-btn is-accent" disabled={!code.trim() || state === 'checking'}>
          {state === 'checking' ? <span className="btn-spinner" aria-hidden /> : t('linkConnect')}
        </button>
      </form>
      {error && (
        <p className="note is-warn" role="alert">
          <WarningIcon width={16} height={16} /> {t(error)}
        </p>
      )}
    </div>
  );
}

/** Shown above the pack form when the browser acts through the bot. */
export function TelegramLinkStatus() {
  const t = useT();
  return (
    <p className="link-status">
      <span>{t('linkVia')}</span>
      <button type="button" className="link-btn" onClick={unlink}>
        {t('linkOff')}
      </button>
    </p>
  );
}
