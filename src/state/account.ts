import { create } from 'zustand';
import { accountsReachable, credentials, fetchMe, type Account, type ClientConfig, type Generation, type Role } from '../lib/accountApi';

/**
 * The signed-in user as the backend sees them: role (USER / PRO / ADMIN), balance, PRO, history and the
 * packages/templates rules. The editor only shows what this says; the backend checks it again on every action.
 */
export interface AccountState {
  /** off: no backend; guest: not signed in (a browser not linked to Telegram); free: accounts not set up yet. */
  status: 'idle' | 'loading' | 'ready' | 'free' | 'guest' | 'off' | 'error';
  account: Account | null;
  history: Generation[];
  config: ClientConfig | null;
  /** Admins switch between the client app and the advanced editor. */
  advanced: boolean;
  refresh(): Promise<void>;
  setAccount(account: Account): void;
  addGeneration(g: Generation, balance: number): void;
  setAdvanced(on: boolean): void;
}

export const DEFAULT_CLIENT_CONFIG: ClientConfig = {
  cost: 1,
  packages: [
    { id: 'p10', count: 10, usd: 1.99 },
    { id: 'p25', count: 25, usd: 3.99 },
    { id: 'p50', count: 50, usd: 6.99 },
    { id: 'p100', count: 100, usd: 11.99 },
  ],
  pro: { usd: 4.99, days: 30, bonus: 30 },
  templates: {},
  methods: { cryptobot: false, ton: false },
};

const ADVANCED_KEY = 'emoji-studio-advanced';
const readAdvanced = () => {
  try {
    return localStorage.getItem(ADVANCED_KEY) === '1';
  } catch {
    return false;
  }
};

export const useAccount = create<AccountState>((set, get) => ({
  status: 'idle',
  account: null,
  history: [],
  config: null,
  advanced: readAdvanced(),
  async refresh() {
    if (!accountsReachable()) return set({ status: 'off' });
    if (!credentials()) return set({ status: 'guest', account: null, history: [] });
    if (get().status !== 'ready') set({ status: 'loading' });
    const res = await fetchMe();
    if (!res.ok) return set({ status: res.status === 401 ? 'guest' : get().account ? get().status : 'error' });
    set({ status: res.accountsOff ? 'free' : 'ready', account: res.account, history: res.history, config: res.config });
  },
  setAccount: (account) => set({ account }),
  addGeneration: (g, balance) => {
    const account = get().account;
    set({ history: [g, ...get().history.filter((h) => h.id !== g.id)], ...(account ? { account: { ...account, balance } } : {}) });
  },
  setAdvanced(on) {
    try {
      localStorage.setItem(ADVANCED_KEY, on ? '1' : '0');
    } catch {
      /* per session then */
    }
    set({ advanced: on });
  },
}));

export const roleOf = (s: AccountState): Role => s.account?.role ?? 'user';
export const isPro = (s: AccountState): boolean => roleOf(s) === 'pro' || roleOf(s) === 'admin';
/** The advanced editor is for admins only (the backend decides who is one). */
export const showsAdvanced = (s: AccountState): boolean => roleOf(s) === 'admin' && s.advanced;
