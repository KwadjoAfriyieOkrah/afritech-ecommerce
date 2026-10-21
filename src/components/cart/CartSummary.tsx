'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { HiOutlineTrash } from 'react-icons/hi';
import { useCartStore, useUserStore } from '@/store';
import type { DeliveryZone } from '@/services/api';
import { formatCedis } from '@/utils/format';

interface CartSummaryProps {
  zones: DeliveryZone[];
}

export function CartSummary({ zones }: CartSummaryProps) {
  const items = useCartStore((state) => state.items);
  const updateQuantity = useCartStore((state) => state.updateQuantity);
  const removeFromCart = useCartStore((state) => state.removeFromCart);
  const clearCart = useCartStore((state) => state.clearCart);
  const deliveryArea = useUserStore((state) => state.deliveryInfo.deliveryArea);

  const subtotal = useMemo(
    () => items.reduce((sum, item) => sum + item.price * item.quantity, 0),
    [items]
  );

  const matchedZone = useMemo(
    () => zones.find((zone) => zone.name === deliveryArea),
    [zones, deliveryArea]
  );

  const hasDeliveryArea = deliveryArea.trim().length > 0;
  const hasSoldOutItems = items.some((item) => item.soldOut);

  if (items.length === 0) {
    return (
      <div className="card p-6">
        <h2 className="text-lg font-semibold text-ink">Your cart is empty</h2>
        <p className="mt-1 text-sm text-stone-500">Browse the catalogue to add some items.</p>
        <Link href="/products" className="btn btn-primary mt-4 w-full">
          Shop products
        </Link>
      </div>
    );
  }

  return (
    <aside className="card flex flex-col gap-4 p-5" aria-label="Cart summary">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-ink">
          Cart{' '}
          <span className="text-sm font-normal text-stone-500">
            ({items.reduce((sum, item) => sum + item.quantity, 0)})
          </span>
        </h2>
        <button type="button" onClick={clearCart} className="btn btn-ghost text-xs">
          Clear
        </button>
      </div>

      <ul className="flex max-h-96 flex-col gap-4 overflow-y-auto pr-1">
        {items.map((item) => {
          const key = `${item.productId}-${item.color ?? 'none'}`;

          return (
            <li key={key} className="flex gap-3">
              <div className="h-16 w-16 flex-none rounded-lg bg-stone-50">
                {item.image ? (
                  <img
                    src={item.image}
                    alt={item.name}
                    className="h-full w-full rounded-lg object-contain p-1"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-[10px] text-stone-400">
                    No image
                  </div>
                )}
              </div>

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink">{item.name}</p>
                {item.color && <p className="text-xs text-stone-500">{item.color}</p>}

                {item.soldOut && (
                  <p className="mt-1 text-xs font-semibold text-red-700">
                    Sold out - remove this item to continue
                  </p>
                )}

                <div className="mt-1.5 flex items-center gap-2">
                  <div className="flex items-center rounded-lg border border-stone-300">
                    <button
                      type="button"
                      aria-label={`Decrease quantity of ${item.name}`}
                      onClick={() => updateQuantity(item.productId, item.quantity - 1, item.color)}
                      className="px-2 py-1 text-stone-600 hover:bg-stone-100"
                    >
                      <span aria-hidden="true">&minus;</span>
                    </button>
                    <span className="min-w-7 text-center text-sm font-semibold text-ink">
                      {item.quantity}
                    </span>
                    <button
                      type="button"
                      aria-label={`Increase quantity of ${item.name}`}
                      onClick={() => updateQuantity(item.productId, item.quantity + 1, item.color)}
                      disabled={item.quantity >= 10}
                      className="px-2 py-1 text-stone-600 hover:bg-stone-100 disabled:opacity-40"
                    >
                      <span aria-hidden="true">+</span>
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => removeFromCart(item.productId, item.color)}
                    aria-label={`Remove ${item.name} from cart`}
                    className="rounded p-1.5 text-stone-400 hover:bg-red-50 hover:text-red-600"
                  >
                    <HiOutlineTrash className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              </div>

              <p className="flex-none text-sm font-semibold text-ink">
                {formatCedis(item.price * item.quantity)}
              </p>
            </li>
          );
        })}
      </ul>

      <dl className="flex flex-col gap-1.5 border-t border-stone-200 pt-4 text-sm">
        <div className="flex justify-between">
          <dt className="text-stone-600">Subtotal</dt>
          <dd className="font-medium text-ink">{formatCedis(subtotal)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-stone-600">Delivery</dt>
          <dd className="font-medium text-ink">
            {!hasDeliveryArea
              ? 'Set at checkout'
              : matchedZone
                ? formatCedis(matchedZone.fee)
                : 'Not available'}
          </dd>
        </div>
        <div className="mt-1 flex justify-between border-t border-stone-200 pt-2 text-base">
          <dt className="font-semibold text-ink">Total</dt>
          <dd className="font-bold text-dark-gold">
            {formatCedis(matchedZone ? subtotal + matchedZone.fee : subtotal)}
          </dd>
        </div>
      </dl>

      {hasSoldOutItems ? (
        <div className="flex flex-col gap-2">
          <button type="button" disabled className="btn btn-primary w-full">
            Proceed to Checkout
          </button>
          <p role="alert" className="text-xs font-medium text-red-700">
            Checkout is blocked while the cart holds a sold out item. Remove it to continue.
          </p>
        </div>
      ) : (
        <Link href="/checkout" className="btn btn-primary w-full">
          Proceed to Checkout
        </Link>
      )}
    </aside>
  );
}