/**
 * Paying with Gram (GRAM — the TON blockchain's coin, called Toncoin until June 2026; addresses, links and TON
 * Connect stay the same): the user connects a wallet once with TON Connect (the official way for apps to talk to a
 * wallet — Wallet in Telegram, Tonkeeper, MyTonWallet…), it is linked to the account, and payments are sent from it
 * with the payment's comment; a plain ton:// transfer link works for any other wallet. The backend then finds the
 * transfer on the blockchain by that comment.
 */
import type { TonConnectUI, Wallet } from '@tonconnect/ui';
import { create } from 'zustand';
import { bindWallet } from '../lib/accountApi';
import { useAccount } from '../state/account';
import { useEditor } from '../state/store';

/** CRC-32C (Castagnoli), as the TON bag-of-cells format uses. */
function crc32c(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const b of bytes) {
    crc ^= b;
    for (let k = 0; k < 8; k++) crc = crc & 1 ? (crc >>> 1) ^ 0x82f63b78 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

/**
 * A text comment as a transaction payload: one cell holding a zero 32-bit op and the UTF-8 text, serialized as a
 * bag of cells (with CRC-32C). Comments here are short (well under one cell's 127 bytes).
 */
export function commentPayload(text: string): string {
  const body = new TextEncoder().encode(text);
  if (body.length > 123) throw new Error('comment too long');
  const data = new Uint8Array([0, 0, 0, 0, ...body]);
  // d1: no refs, ordinary, level 0; d2: full bytes only (no completion tag needed).
  const cell = new Uint8Array([0, data.length * 2, ...data]);
  const header = new Uint8Array([
    0xb5,
    0xee,
    0x9c,
    0x72,
    // has_crc32c, size of cell refs: 1 byte
    0x41,
    // size of offsets: 1 byte
    0x01,
    // cells, roots, absent
    1,
    1,
    0,
    // total cells size
    cell.length,
    // root index
    0,
  ]);
  const boc = new Uint8Array([...header, ...cell]);
  const crc = crc32c(boc);
  return base64(new Uint8Array([...boc, crc & 0xff, (crc >>> 8) & 0xff, (crc >>> 16) & 0xff, (crc >>> 24) & 0xff]));
}

/** A transfer link any TON wallet opens (amount in nanotons). */
export const tonTransferLink = (address: string, nano: string, comment: string) =>
  `ton://transfer/${address}?amount=${nano}&text=${encodeURIComponent(comment)}`;

/** Same, as a Tonkeeper universal link (opens the app on phones, the site elsewhere). */
export const tonkeeperLink = (address: string, nano: string, comment: string) =>
  `https://app.tonkeeper.com/transfer/${address}?amount=${nano}&text=${encodeURIComponent(comment)}`;

/** "1.234 GRAM" from nano-GRAM (10⁻⁹). */
export const formatGram = (nano: string) => `${(Number(BigInt(nano) / 1_000_000n) / 1000).toString()} GRAM`;

/** "UQAb…x9Zk". */
export const shortAddress = (address: string) => (address.length > 12 ? `${address.slice(0, 4)}…${address.slice(-4)}` : address);

let ui: Promise<TonConnectUI> | null = null;

/** TON Connect, loaded only when someone pays with TON. */
export function tonConnect(): Promise<TonConnectUI> {
  ui ??= import('@tonconnect/ui').then(
    ({ TonConnectUI: UI }) =>
      new UI({
        manifestUrl: new URL('tonconnect-manifest.json', document.baseURI).href,
        // TON Connect speaks English and Russian.
        language: useEditor.getState().lang === 'ru' ? 'ru' : 'en',
        // Back to the app after the wallet in Telegram.
        actionsConfiguration: {
          twaReturnUrl: (import.meta.env.VITE_TWA_URL as `${string}://${string}` | undefined) ?? undefined,
        },
      }),
  );
  return ui;
}

interface WalletState {
  /** idle: TON Connect not loaded yet. */
  status: 'idle' | 'loading' | 'none' | 'connecting' | 'connected';
  /** User-friendly address of the connected wallet. */
  address: string | null;
  app: string | null;
  /** Loads TON Connect and restores a wallet connected before. */
  init(): Promise<void>;
  /** Opens the wallet list; resolves true once a wallet is connected (and linked to the account). */
  connect(): Promise<boolean>;
  disconnect(): Promise<void>;
}

async function friendly(wallet: Wallet): Promise<{ address: string; app: string | null }> {
  const { toUserFriendlyAddress, CHAIN } = await import('@tonconnect/ui');
  const app = ('name' in wallet && typeof wallet.name === 'string' ? wallet.name : null) ?? wallet.device.appName ?? null;
  return { address: toUserFriendlyAddress(wallet.account.address, wallet.account.chain === CHAIN.TESTNET), app };
}

/** Links the connected wallet to the account (shown on every device; used as the wallet to pay from). */
async function link(address: string, app: string | null): Promise<void> {
  const acc = useAccount.getState();
  if (acc.status !== 'ready' || acc.account?.wallet?.address === address) return;
  const res = await bindWallet(address, app ?? '');
  if (res.ok) acc.setAccount(res.account);
}

let watching = false;

/** The wallet connected on the site with TON Connect. */
export const useWallet = create<WalletState>((set, get) => ({
  status: 'idle',
  address: null,
  app: null,
  async init() {
    if (get().status !== 'idle') return;
    set({ status: 'loading' });
    try {
      const tc = await tonConnect();
      if (!watching) {
        watching = true;
        tc.onStatusChange(async (wallet) => {
          if (!wallet) return set({ status: 'none', address: null, app: null });
          const { address, app } = await friendly(wallet);
          set({ status: 'connected', address, app });
          link(address, app);
        });
      }
      await tc.connectionRestored;
      if (tc.wallet) {
        const { address, app } = await friendly(tc.wallet);
        set({ status: 'connected', address, app });
      } else set({ status: 'none' });
    } catch {
      set({ status: 'none' });
    }
  },
  async connect() {
    await get().init();
    const tc = await tonConnect();
    if (tc.connected) return true;
    set({ status: 'connecting' });
    try {
      await tc.openModal();
      await new Promise<void>((resolve, reject) => {
        const off = tc.onStatusChange((wallet) => {
          if (wallet) {
            off();
            offModal();
            resolve();
          }
        });
        const offModal = tc.onModalStateChange((state) => {
          if (state.status === 'closed' && !tc.connected) {
            offModal();
            off();
            reject(new Error('cancelled'));
          }
        });
      });
      return true;
    } catch {
      if (!tc.connected) set({ status: 'none' });
      return false;
    }
  },
  async disconnect() {
    const tc = await tonConnect();
    try {
      if (tc.connected) await tc.disconnect();
    } finally {
      set({ status: 'none', address: null, app: null });
      const acc = useAccount.getState();
      if (acc.status === 'ready' && acc.account?.wallet) {
        const res = await bindWallet('', '');
        if (res.ok) acc.setAccount(res.account);
      }
    }
  },
}));

/** Asks the connected wallet (connecting one first) to send the payment. Resolves when the wallet signed it. */
export async function payWithTonConnect(address: string, nano: string, comment: string): Promise<void> {
  if (!(await useWallet.getState().connect())) throw new Error('cancelled');
  const tc = await tonConnect();
  await tc.sendTransaction({
    validUntil: Math.floor(Date.now() / 1000) + 600,
    messages: [{ address, amount: nano, payload: commentPayload(comment) }],
  });
}
