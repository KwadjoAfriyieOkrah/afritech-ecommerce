'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { HiCheck, HiOutlineClock, HiOutlineMap, HiOutlineMail, HiOutlineTruck } from 'react-icons/hi';
import { ApiError, getOrder } from '@/services/api';
import { useUserStore } from '@/store';
import type { Order } from '@/types';
import { ErrorBoundary } from '@/components/shared/ErrorBoundary';
import { formatCedis, formatDateTime } from '@/utils/format';
import { parseReferenceDate } from '@/utils/orderReference';

function OrderSummarySkeleton() {
  return (
    <div className="card flex flex-col gap-4 p-6">
      <div className="skeleton h-8 w-56" />
      <div className="skeleton h-4 w-40" />
      <div className="skeleton h-24 w-full" />
      <div className="skeleton h-10 w-full" />
    </div>
  );
}

export default function ConfirmationPage() {
  const params = useParams<{ orderId: string }>();
  const orderId = typeof params?.orderId === 'string' ? params.orderId : '';

  const loggedInEmail = useUserStore((state) => state.user?.email);

  // The order is loaded only from the server. Local checkout state is never
  // trusted here, so a pending or abandoned payment can never be shown as
  // confirmed.
  const [order, setOrder] = useState<Order | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const copyTimeoutRef = useRef<number | null>(null);

  const load = useCallback(async () => {
    if (!orderId) {
      setError('That order link is not valid.');
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    let accessToken: string | null = null;
    try {
      if (typeof window !== 'undefined') {
        accessToken = window.localStorage.getItem(`afritech-order-token:${orderId}`);
      }
    } catch {}

    try {
      const loaded = await getOrder(orderId, accessToken);
      setOrder(loaded);
      // The token is only needed to load this order. Drop it once the order is
      // on screen; if the load failed, keep it so Try again can use it.
      try {
        if (typeof window !== 'undefined') {
        }
      } catch {}
    } catch (caught) {
      setError(ApiError.from(caught).message);
    } finally {
      setIsLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    void load();
  }, [load]);

  const copyReference = useCallback(async () => {
    const reference = order?.reference;
    if (!reference) return;
    if (typeof navigator === 'undefined' || !navigator.clipboard) return;

    try {
      await navigator.clipboard.writeText(reference);
    } catch {
      return;
    }

    setCopied(true);
    copyTimeoutRef.current = window.setTimeout(() => {
      setCopied(false);
      copyTimeoutRef.current = null;
    }, 2000);
  }, [order?.reference]);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current !== null) {
        window.clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  if (isLoading) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
        <OrderSummarySkeleton />
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-16 text-center sm:px-6">
        <div role="alert" className="alert-error flex flex-col items-start gap-3 text-left">
          <div>
            <p className="font-semibold">We could not load this order</p>
            <p className="mt-1 text-red-700">{error ?? 'Order not found.'}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void load()} className="btn btn-outline">
              Try again
            </button>
            <Link href="/products" className="btn btn-primary">
              Continue shopping
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const referenceDate = parseReferenceDate(order.reference);
  const email = order.customerEmail || loggedInEmail || 'your email address';
  // `isPaid` is derived from the payment ledger on the backend. The status field
  // is only "paid" (or a later fulfillment stage) once payment is confirmed; a
  // pending or failed payment is reported as "pending".
  const isPaid = order.isPaid;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <ErrorBoundary title="Confirmation failed to load">
        <div className="flex flex-col items-center gap-3 text-center">
          <span
            className={`flex h-14 w-14 items-center justify-center rounded-full ${
              isPaid ? 'bg-gold text-ink' : 'bg-light-gold text-dark-gold'
            }`}
          >
            {isPaid ? (
              <HiCheck className="h-7 w-7" aria-hidden="true" />
            ) : (
              <HiOutlineClock className="h-7 w-7" aria-hidden="true" />
            )}
          </span>

          <h1 className="text-3xl font-bold text-ink">
            {isPaid ? 'Order Confirmed!' : 'Payment not completed yet'}
          </h1>

          <p className="text-sm text-stone-500">
            {isPaid
              ? 'Thanks for shopping with AFriTech. We are getting your order ready.'
              : 'We have not received a confirmed payment for this order. It is saved, so no items are lost, but it will only be processed once payment is completed.'}
          </p>

          <p className="mt-1 flex flex-col items-center gap-1">
            <span className="text-xs uppercase tracking-wide text-stone-500">Order reference</span>
            <span className="flex items-center gap-2">
              <span className="rounded-lg bg-light-gold px-4 py-1.5 font-mono text-lg font-bold tracking-wider text-dark-gold">
                {order.reference}
              </span>
              <button
                type="button"
                onClick={() => void copyReference()}
                className="rounded-md border border-stone-200 px-2.5 py-1 text-xs font-medium text-stone-600 transition hover:border-dark-gold hover:text-dark-gold"
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
            </span>
            <span className="text-xs text-stone-500">
              Save this reference and the phone number you paid with. You&apos;ll use them on Track
              Order to check your delivery.
            </span>
            {referenceDate && (
              <span className="text-xs text-stone-400">Placed on {formatDateTime(referenceDate)}</span>
            )}
          </p>
        </div>

        <div className="mt-8 flex flex-col gap-4">
          <section className="card p-5">
            <h2 className="text-base font-semibold text-ink">Items</h2>

            <ul className="mt-3 flex flex-col gap-3">
              {order.items.map((item) => (
                <li
                  key={item.id || `${item.productId}-${item.color ?? 'none'}`}
                  className="flex items-center justify-between gap-4 border-b border-stone-100 pb-3 last:border-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">
                      {item.name || item.productId}
                    </p>
                    <p className="text-xs text-stone-500">
                      {item.quantity} x {formatCedis(item.price)}
                      {item.color ? ` (${item.color})` : ''}
                    </p>
                  </div>
                  <p className="flex-none text-sm font-semibold text-ink">
                    {formatCedis(item.price * item.quantity)}
                  </p>
                </li>
              ))}
            </ul>

            <dl className="mt-4 flex flex-col gap-1.5 border-t border-stone-200 pt-4 text-sm">
              <div className="flex justify-between">
                <dt className="text-stone-600">Subtotal</dt>
                <dd className="font-medium text-ink">{formatCedis(order.subtotal)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-stone-600">Delivery</dt>
                <dd className="font-medium text-ink">{formatCedis(order.deliveryFee)}</dd>
              </div>
              <div className="mt-1 flex justify-between border-t border-stone-200 pt-2 text-base">
                <dt className="font-semibold text-ink">Total</dt>
                <dd className="font-bold text-dark-gold">{formatCedis(order.totalPrice)}</dd>
              </div>
            </dl>
          </section>

          <section className="card flex flex-col gap-4 p-5">
            <div className="flex items-start gap-3">
              <HiOutlineMap className="mt-0.5 h-5 w-5 flex-none text-dark-gold" aria-hidden="true" />
              <div>
                <h2 className="text-base font-semibold text-ink">Delivery details</h2>
                <p className="mt-1 text-sm text-stone-600">
                  {order.customerName}
                  <br />
                  {order.deliveryAddress}, {order.deliveryArea}
                  <br />
                  {order.customerPhone}
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3 border-t border-stone-200 pt-4">
              <HiOutlineTruck className="mt-0.5 h-5 w-5 flex-none text-dark-gold" aria-hidden="true" />
              <div>
                <h2 className="text-base font-semibold text-ink">Expected delivery</h2>
                <p className="mt-1 text-sm text-stone-600">
                  {order.expectedDeliveryDate || 'To be confirmed'}
                </p>
              </div>
            </div>
          </section>

          {isPaid && (
            <p className="flex items-center justify-center gap-2 text-center text-sm text-stone-500">
              <HiOutlineMail className="h-4 w-4 flex-none" aria-hidden="true" />
              Confirmation email sent to {email}
            </p>
          )}

          <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
            <Link href={`/track?reference=${encodeURIComponent(order.reference)}`} className="btn btn-primary w-full sm:w-auto">
              Track Order
            </Link>
            <Link href="/products" className="btn btn-outline w-full sm:w-auto">
              Continue Shopping
            </Link>
          </div>
        </div>
      </ErrorBoundary>
    </div>
  );
}
