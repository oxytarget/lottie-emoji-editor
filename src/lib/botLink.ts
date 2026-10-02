import { useSyncExternalStore } from 'react';

/**
 * The editor in a browser (not the Mini App) acts for a Telegram user with a link code from the bot
 * ("/start link"): the bot signs it, so the backend can create packs and send files for that user.
 * It is kept in this browser only.
 */

const LINK_KEY = 'emoji-studio-tglink';
/** The bot's code: language letter, user id and expiry day in base 36, signature. */
const CODE = /(?:^|[^0-9a-z])([ure][0-9a-z]{1,14}-[0-9a-z]{1,6}-[A-Za-z0-9_-]{16})(?![A-Za-z0-9_-])/;

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

/** The code in pasted text (the code itself, the bot's whole message or the link back to the editor). */
export function parseLinkCode(text: string): string | null {
  return CODE.exec(text.trim())?.[1] ?? null;
}

export function linkedCode(): string {
  try {
    return localStorage.getItem(LINK_KEY) ?? '';
  } catch {
    return '';
  }
}

export function setLinkedCode(code: string | null): void {
  try {
    if (code) localStorage.setItem(LINK_KEY, code);
    else localStorage.removeItem(LINK_KEY);
  } catch {
    /* blocked storage: nothing to remember */
  }
  notify();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  // Linked or unlinked in another window of this browser.
  const onStorage = (e: StorageEvent) => (e.key === LINK_KEY || e.key === null) && cb();
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener('storage', onStorage);
  };
}

/** The link code, re-rendering when it changes (here or in another window). */
export function useLinkedCode(): string {
  return useSyncExternalStore(subscribe, linkedCode, () => '');
}

/** A code the bot's "back to the editor" button put in the address (#tglink=…), removed from it. */
export function takeLinkFromUrl(): string | null {
  if (typeof window === 'undefined') return null;
  const m = /(?:^#|&)tglink=([^&]+)/.exec(window.location.hash);
  if (!m) return null;
  const rest = window.location.hash.replace(m[0], '').replace(/^#?&/, '#');
  history.replaceState(null, '', window.location.pathname + window.location.search + (rest === '#' ? '' : rest));
  return parseLinkCode(decodeURIComponent(m[1]));
}
