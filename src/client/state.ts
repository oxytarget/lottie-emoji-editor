import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { haptic } from '../lib/telegram';

export type Screen = 'home' | 'create' | 'history' | 'topup' | 'pro' | 'profile' | 'admin';

/** Which screen of the client app is shown. */
interface Nav {
  screen: Screen;
  go(screen: Screen): void;
}

export const useNav = create<Nav>((set, get) => ({
  screen: 'home',
  go(screen) {
    if (get().screen === screen) return;
    set({ screen });
    window.scrollTo({ top: 0 });
    haptic();
  },
}));

/** What the client put into the design (kept between visits). */
export interface ClientInputs {
  /** Traced photo (SVG). */
  photo: string | null;
  /** Logo (SVG, or a traced PNG/JPG). */
  logo: string | null;
  text: string;
  textColor: string;
  /** Chosen template (editor template id). */
  template: string;
  /** PRO: generate in every template. */
  all: boolean;
  set<K extends keyof Omit<ClientInputs, 'set'>>(key: K, value: ClientInputs[K]): void;
}

export const useInputs = create<ClientInputs>()(
  persist(
    (set) => ({
      photo: null,
      logo: null,
      text: '',
      textColor: '#ffffff',
      template: 'classic',
      all: false,
      set: (key, value) => set({ [key]: value } as Partial<ClientInputs>),
    }),
    { name: 'emoji-studio-client', version: 1 },
  ),
);

/** A payment being made (kept, so a reload or a trip to the wallet comes back to it). */
export interface PendingPayment {
  id: string;
  item: string;
}

interface PaymentState {
  pending: PendingPayment | null;
  setPending(p: PendingPayment | null): void;
}

export const usePaymentState = create<PaymentState>()(
  persist((set) => ({ pending: null, setPending: (pending) => set({ pending }) }), { name: 'emoji-studio-payment', version: 1 }),
);
