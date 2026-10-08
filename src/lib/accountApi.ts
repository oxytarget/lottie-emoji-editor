import { BOT_API_URL, packsAvailable } from './botApi';
import { linkedCode } from './botLink';
import { initData } from './telegram';

/** The account side of the backend (/api/app/*): balance, generations, payments, PRO, admin. */

export type Role = 'user' | 'pro' | 'admin';

export interface Account {
  id: number;
  role: Role;
  balance: number;
  proUntil: number;
}

export interface Package {
  id: string;
  count: number;
  usd: number;
}

export interface ClientConfig {
  cost: number;
  packages: Package[];
  pro: { usd: number; days: number; bonus: number };
  templates: Record<string, { hidden?: boolean; pro?: boolean }>;
  methods: { cryptobot: boolean; ton: boolean };
}

export interface Generation {
  id: string;
  at: number;
  title: string;
  templates: string[];
  cost: number;
}

export type PayMethod = 'cryptobot' | 'ton';

export interface Payment {
  id: string;
  item: string;
  count: number;
  proDays: number;
  usd: number;
  method: PayMethod;
  status: 'pending' | 'paid' | 'expired';
  createdAt: number;
  paidAt?: number;
  url?: string;
  miniAppUrl?: string;
  ton?: { address: string; nano: string; comment: string };
}

export type ApiResult<T> = ({ ok: true } & T) | { ok: false; error: string; status: number; [k: string]: unknown };

/** Who is asking: the Mini App's signed data, or the browser's link code. */
export function credentials(): { initData?: string; link?: string } | null {
  const data = initData();
  if (data) return { initData: data };
  const link = linkedCode();
  return link ? { link } : null;
}

export const accountsReachable = (): boolean => packsAvailable();

async function post<T>(action: string, body: Record<string, unknown> = {}): Promise<ApiResult<T>> {
  const who = credentials();
  if (!who) return { ok: false, error: 'guest', status: 401 };
  try {
    const res = await fetch(`${BOT_API_URL}/api/app/${action}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...who, ...body }) });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.ok && data.ok) return data as { ok: true } & T;
    return { ...data, ok: false, error: String(data.error ?? `http-${res.status}`), status: res.status };
  } catch {
    return { ok: false, error: 'network', status: 0 };
  }
}

export const fetchMe = () => post<{ account: Account; history: Generation[]; config: ClientConfig; accountsOff?: boolean }>('me');

export const requestGeneration = (id: string, templates: string[], title: string) =>
  post<{ balance: number; generation: Generation; repeated?: boolean }>('generate', { id, templates, title });

export const createPayment = (item: string, method: PayMethod) => post<{ payment: Payment }>('pay', { item, method });

export const paymentStatus = (id: string) => post<{ payment: Payment; account: Account }>('pay-status', { id });

export const adminCall = <T>(action: string, body: Record<string, unknown> = {}) => post<T>('admin', { action, ...body });

/** The admin's published set-up of a template pack (slot, hidden parts, colours), or null. */
export async function fetchTemplateEdits(pack: string): Promise<{ edits: Record<string, unknown>; svgs: Record<string, string> } | null> {
  try {
    const res = await fetch(`${BOT_API_URL}/api/app/template-edits?pack=${encodeURIComponent(pack)}`);
    const body = (await res.json()) as { edits?: { edits: Record<string, unknown>; svgs: Record<string, string> } | null };
    return body.edits ?? null;
  } catch {
    return null;
  }
}

/** Random id of a generation (made once per design, so retries and double taps cost nothing more). */
export const newGenerationId = (): string =>
  [...crypto.getRandomValues(new Uint8Array(12))]
    .map((b) => (b % 36).toString(36))
    .join('');
