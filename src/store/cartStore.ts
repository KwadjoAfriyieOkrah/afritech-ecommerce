import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export interface CartItem {
  productId: string;
  name: string;
  price: number;
  color?: string;
  quantity: number;
  image: string | null;
  /**
   * Mirrors the server flag for the product. Optional because carts persisted
   * before this field existed do not carry it.
   */
  soldOut?: boolean;
}

export interface CartState {
  items: CartItem[];
  totalPrice: number;
  addToCart: (item: CartItem) => void;
  removeFromCart: (productId: string, color?: string) => void;
  updateQuantity: (productId: string, quantity: number, color?: string) => void;
  clearCart: () => void;
  computeTotal: () => void;
  /**
   * Applies the server's sold out status to the cart. Items are never
   * removed here: a sold out item stays visible and blocks checkout until the
   * customer removes it.
   */
  syncSoldOutStatus: (products: Array<{ id: string; soldOut: boolean }>) => void;
}

export const CART_STORAGE_KEY = 'afritech-cart';

function isSameVariant(item: CartItem, productId: string, color?: string): boolean {
  return item.productId === productId && item.color === color;
}

function matches(item: CartItem, productId: string, color?: string): boolean {
  if (item.productId !== productId) return false;
  return color === undefined || item.color === color;
}

function sumItems(items: CartItem[]): number {
  const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  return Math.round(total * 100) / 100;
}

export const useCartStore = create<CartState>()(
  persist(
    (set) => ({
      items: [],
      totalPrice: 0,

      addToCart: (item) =>
        set((state) => {
          const quantity = Math.max(1, Math.trunc(item.quantity));
          const exists = state.items.some((entry) =>
            isSameVariant(entry, item.productId, item.color)
          );

          const items = exists
            ? state.items.map((entry) =>
                isSameVariant(entry, item.productId, item.color)
                  ? { ...entry, quantity: entry.quantity + quantity }
                  : entry
              )
            : [...state.items, { ...item, quantity }];

          return { items, totalPrice: sumItems(items) };
        }),

      removeFromCart: (productId, color) =>
        set((state) => {
          const items = state.items.filter((entry) => !matches(entry, productId, color));
          return { items, totalPrice: sumItems(items) };
        }),

      updateQuantity: (productId, quantity, color) =>
        set((state) => {
          if (!Number.isFinite(quantity)) return state;

          if (quantity <= 0) {
            const items = state.items.filter((entry) => !matches(entry, productId, color));
            return { items, totalPrice: sumItems(items) };
          }

          const next = Math.trunc(quantity);
          const items = state.items.map((entry) =>
            matches(entry, productId, color) ? { ...entry, quantity: next } : entry
          );

          return { items, totalPrice: sumItems(items) };
        }),

      clearCart: () => set({ items: [], totalPrice: 0 }),

      computeTotal: () => set((state) => ({ totalPrice: sumItems(state.items) })),

      syncSoldOutStatus: (products) =>
        set((state) => {
          const status = new Map<string, boolean>();
          for (const product of products) status.set(product.id, product.soldOut);

          let changed = false;
          const items = state.items.map((item) => {
            const soldOut = status.get(item.productId);
            if (soldOut === undefined || soldOut === item.soldOut) return item;

            changed = true;
            return { ...item, soldOut };
          });

          return changed ? { items } : state;
        })
    }),
    {
      name: CART_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ items: state.items, totalPrice: state.totalPrice })
    }
  )
);