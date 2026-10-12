import { create } from 'zustand';
import type { DeliveryInfo, User } from '@/types';

export const EMPTY_DELIVERY_INFO: DeliveryInfo = {
  customerName: '',
  customerPhone: '',
  customerEmail: '',
  deliveryArea: '',
  deliveryAddress: '',
  expectedDeliveryDays: 0,
  expectedDeliveryDate: ''
};

export interface UserState {
  user: User | null;
  deliveryInfo: DeliveryInfo;
  /** False until the stored token has been checked against the API on app load. */
  sessionReady: boolean;
  setUser: (user: User | null) => void;
  setSessionReady: (ready: boolean) => void;
  logout: () => void;
  updateDeliveryInfo: (info: Partial<DeliveryInfo>) => void;
}

export const useUserStore = create<UserState>()((set) => ({
  user: null,
  deliveryInfo: { ...EMPTY_DELIVERY_INFO },
  sessionReady: false,

  setUser: (user) => set({ user }),

  setSessionReady: (ready) => set({ sessionReady: ready }),

  logout: () => set({ user: null, deliveryInfo: { ...EMPTY_DELIVERY_INFO } }),

  updateDeliveryInfo: (info) =>
    set((state) => ({ deliveryInfo: { ...state.deliveryInfo, ...info } }))
}));