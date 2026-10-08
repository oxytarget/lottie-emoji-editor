/**
 * Finished designs kept on this device (IndexedDB), by generation id: the history can show and download them
 * again without generating (and paying) twice. The backend keeps the list of generations itself.
 */

export interface StoredResult {
  /** Generation id. */
  id: string;
  at: number;
  title: string;
  /** One Lottie JSON per template of the generation. */
  files: Array<{ template: string; name: string; json: string }>;
}

const DB = 'emoji-studio-results';
const STORE = 'results';
/** Older ones go (each is a few tens of KB). */
const KEEP = 200;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = run(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveResult(r: StoredResult): Promise<void> {
  try {
    await tx('readwrite', (s) => s.put(r));
    const all = await listResults();
    for (const old of all.slice(KEEP)) await tx('readwrite', (s) => s.delete(old.id));
  } catch {
    /* private mode or full: the result was shown, it just is not kept */
  }
}

export async function listResults(): Promise<StoredResult[]> {
  try {
    const all = await tx<StoredResult[]>('readonly', (s) => s.getAll());
    return all.sort((a, b) => b.at - a.at);
  } catch {
    return [];
  }
}
