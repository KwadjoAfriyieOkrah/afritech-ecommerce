import { create } from 'zustand';
import type { Order, OrderStatus } from '@/types';

export interface OrderState {
  currentOrder: Order | null;
  orderHistory: Order[];
  setCurrentOrder: (order: Order | null) => void;
  addToHistory: (order: Order) => void;
  updateStatus: (orderId: string, status: OrderStatus) => void;
  clearOrders: () => void;
}

export const useOrderStore = create<OrderState>()((set) => ({
  currentOrder: null,
  orderHistory: [],

  setCurrentOrder: (order) => set({ currentOrder: order }),

  addToHistory: (order) =>
    set((state) => ({
      orderHistory: [order, ...state.orderHistory.filter((entry) => entry.id !== order.id)]
    })),

  updateStatus: (orderId, status) =>
    set((state) => ({
      currentOrder:
        state.currentOrder && state.currentOrder.id === orderId
          ? { ...state.currentOrder, status }
          : state.currentOrder,
      orderHistory: state.orderHistory.map((order) =>
        order.id === orderId ? { ...order, status } : order
      )
    })),

  // Called on sign-out so the next person on a shared device sees no orders.
  clearOrders: () => set({ currentOrder: null, orderHistory: [] })
}));