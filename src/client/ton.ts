/**
 * Paying with TON: TON Connect (the official way for apps to ask a wallet — Wallet in Telegram, Tonkeeper,
 * MyTonWallet… — to send a transaction) with the payment's comment, or a plain ton:// transfer link for any
 * other wallet. The backend then finds the transfer on the blockchain by that comment.
 */
import type { TonConnectUI } from '@tonconnect/ui';

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

export const formatTon = (nano: string) => (Number(BigInt(nano) / 1_000_000n) / 1000).toString();

let ui: Promise<TonConnectUI> | null = null;

/** TON Connect, loaded only when someone pays with TON. */
export function tonConnect(): Promise<TonConnectUI> {
  ui ??= import('@tonconnect/ui').then(
    ({ TonConnectUI: UI }) =>
      new UI({
        manifestUrl: new URL('tonconnect-manifest.json', document.baseURI).href,
        // Back to the app after the wallet in Telegram.
        actionsConfiguration: {
          twaReturnUrl: (import.meta.env.VITE_TWA_URL as `${string}://${string}` | undefined) ?? undefined,
        },
      }),
  );
  return ui;
}

/** Asks the connected wallet (connecting one first) to send the payment. Resolves when the wallet signed it. */
export async function payWithTonConnect(address: string, nano: string, comment: string): Promise<void> {
  const tc = await tonConnect();
  if (!tc.connected) {
    await tc.openModal();
    await new Promise<void>((resolve, reject) => {
      const off = tc.onStatusChange((wallet) => {
        if (wallet) {
          off();
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
  }
  await tc.sendTransaction({
    validUntil: Math.floor(Date.now() / 1000) + 600,
    messages: [{ address, amount: nano, payload: commentPayload(comment) }],
  });
}
