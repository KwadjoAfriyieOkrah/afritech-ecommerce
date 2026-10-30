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
    set((state) => {
      const current = state.deliveryInfo;
      const changed =
        (info.customerName !== undefined &&
          info.customerName !== current.customerName) ||
        (info.customerPhone !== undefined &&
          info.customerPhone !== current.customerPhone) ||
        (info.customerEmail !== undefined &&
          info.customerEmail !== current.customerEmail) ||
        (info.deliveryArea !== undefined &&
          info.deliveryArea !== current.deliveryArea) ||
        (info.deliveryAddress !== undefined &&
          info.deliveryAddress !== current.deliveryAddress) ||
        (info.expectedDeliveryDays !== undefined &&
          info.expectedDeliveryDays !== current.expectedDeliveryDays) ||
        (info.expectedDeliveryDate !== undefined &&
          info.expectedDeliveryDate !== current.expectedDeliveryDate);

      if (!changed) return state;

      return { deliveryInfo: { ...current, ...info } };
    })
}));