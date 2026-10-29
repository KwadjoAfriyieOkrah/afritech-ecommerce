'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { HiOutlineCheckCircle, HiOutlineCreditCard, HiOutlineLockClosed } from 'react-icons/hi';
import { toast } from 'sonner';
import {
  ApiError,
  createOrder,
  initializePayment,
  verifyOrderPayment,
  type DeliveryZone
} from '@/services/api';
import {
  clearCheckoutIdempotencyKey,
  getCheckoutIdempotencyKey
} from '@/services/checkoutAttempt';
import { useCartStore, useOrderStore, useUserStore } from '@/store';
import { OrderStatus, type DeliveryInfo, type Order, type PaymentAttempt } from '@/types';
import { ErrorBoundary } from '@/components/shared/ErrorBoundary';
import { formatCedis } from '@/utils/format';
import { resolveReference } from '@/utils/orderReference';

const PAYSTACK_PUBLIC_KEY = process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY ?? '';

function isUsableKey(key: string): boolean {
  return key.startsWith('pk_') && key.length > 10 && !key.includes('your_paystack_key');
}

interface PaymentFormProps {
  zones: DeliveryZone[];
  deliveryInfo: DeliveryInfo;
  /** Re-runs the read-only availability check. Returns true when every line is ok. */
  onBeforePay?: () => Promise<boolean>;
  /** Called after an expired-reservation 409 so the page can refresh stock. */
  onReservationExpired?: () => Promise<void>;
  onProcessingChange?: (processing: boolean) => void;
}

export function PaymentForm({
  zones,
  deliveryInfo,
  onBeforePay,
  onReservationExpired,
  onProcessingChange
}: PaymentFormProps) {
  const router = useRouter();

  const items = useCartStore((state) => state.items);
  const clearCart = useCartStore((state) => state.clearCart);
  const setCurrentOrder = useOrderStore((state) => state.setCurrentOrder);
  const addToHistory = useOrderStore((state) => state.addToHistory);
  const updateStatus = useOrderStore((state) => state.updateStatus);
  const userId = useUserStore((state) => state.user?.id);

  const [phase, setPhase] = useState<'idle' | 'creating' | 'paying' | 'verifying'>('idle');
  const [order, setOrder] = useState<Order | null>(null);

  // Guards against a second Paystack modal opening while one is already live.
  const modalOpen = useRef(false);

  const setStep = useCallback(
    (next: typeof phase) => {
      setPhase(next);
      onProcessingChange?.(next === 'creating' || next === 'verifying');
    },
    [onProcessingChange]
  );

  const keyReady = isUsableKey(PAYSTACK_PUBLIC_KEY);

  const subtotal = useMemo(
    () => items.reduce((sum, item) => sum + item.price * item.quantity, 0),
    [items]
  );

  const matchedZone = useMemo(
    () => zones.find((zone) => zone.name === deliveryInfo.deliveryArea),
    [zones, deliveryInfo.deliveryArea]
  );

  // The area must match a server zone or payment is blocked; no default fee.
  const deliveryAvailable = Boolean(matchedZone);
  const deliveryFee = matchedZone ? matchedZone.fee : 0;

  const subtotalToShow = order ? order.subtotal : subtotal;
  const deliveryFeeToShow = order ? order.deliveryFee : deliveryFee;
  const totalToShow = order ? order.totalPrice : subtotal + deliveryFee;

  const isBusy = phase !== 'idle';
  const availabilityBlocked = items.some((item) => item.stockStatus !== 'ok');

  // Paystack's client callback only proves the window closed; it is not proof
  // of payment. The order is marked paid, the cart and checkout key are
  // cleared, and the customer is sent to the confirmation page only after the
  // backend confirms the payment is genuinely paid.
  const handlePaymentSuccess = useCallback(
    async (current: Order, transactionReference: string) => {
      modalOpen.current = false;
      setStep('verifying');

      try {
        let tokenForVerify: string | null = null;
        try {
          if (typeof window !== 'undefined') {
            tokenForVerify = window.localStorage.getItem(`afritech-order-token:${current.id}`);
          }
        } catch {}
        const verification = await verifyOrderPayment(transactionReference, current.id, tokenForVerify);

        if (!verification?.verified) {
          throw new ApiError(
            verification?.message ??
              'We could not confirm your payment yet. Your order is saved.',
            402,
            'UNVERIFIED_PAYMENT'
          );
        }

        const paid: Order = {
          ...current,
          isPaid: true,
          paymentReference: verification.reference,
          status: OrderStatus.PAID
        };

        setCurrentOrder(paid);
        updateStatus(paid.id, paid.status);
        clearCart();
        // The attempt is definitively finished: the payment is confirmed.
        clearCheckoutIdempotencyKey();

        toast.success('Payment confirmed. Opening your order confirmation...');
        router.push(`/confirmation/${paid.id}`);
      } catch (caught) {
        // Keep the cart and the checkout key: the payment is unconfirmed, so
        // the same attempt can be retried without creating a second order.
        setStep('idle');
        toast.error(ApiError.from(caught).message);
      }
    },
    [setCurrentOrder, updateStatus, clearCart, setStep, router]
  );

  const handlePay = useCallback(async () => {
    // `modalOpen` is a ref, so it cannot gate this on render alone. It is
    // claimed synchronously below, before the first await, so a double-click
    // cannot start a second order creation or a second payment attempt.
    if (phase !== 'idle' || modalOpen.current) return;

    // Guests (no userId) can checkout without account; don't block on session.

    if (!deliveryAvailable) {
      toast.error('Delivery is not available to this area.');
      return;
    }

    // Re-check stock and price immediately before creating the order. The
    // server is the authority, so a stale cart must never be submitted.
    if (onBeforePay) {
      const available = await onBeforePay();
      if (!available) {
        toast.error('Some items need your attention before you can pay.');
        return;
      }
    }

    const currentItems = useCartStore.getState().items;
    if (currentItems.length === 0) {
      toast.error('Your cart is empty. Add a product before checking out again.');
      return;
    }

    modalOpen.current = true;
    setStep('creating');

    let created: Order;

    try {
      // Persisted per checkout attempt: a remount or reload after an ambiguous
      // failure reuses this key so the server replays the same order instead of
      // creating a second one. It is never rotated to retry a payment: the same
      // order is reused and only its payment reference is renewed.
      const idempotencyKey = getCheckoutIdempotencyKey(userId || 'guest');

      // Try to reuse stored token for idempotent replay
      let storedToken: string | null = null;
      if (typeof window !== 'undefined') {
        // We'll check after getting orderId if needed
      }

      const response = await createOrder(
        {
          items: currentItems.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
            color: item.color,
            price: item.price
          })),
          customerName: deliveryInfo.customerName,
          customerPhone: deliveryInfo.customerPhone,
          customerEmail: deliveryInfo.customerEmail.trim() ? deliveryInfo.customerEmail.trim() : '',
          deliveryArea: deliveryInfo.deliveryArea,
          deliveryAddress: deliveryInfo.deliveryAddress
        },
        idempotencyKey
      );

      if (!response?.id) {
        throw new ApiError('The server returned an order without an id.', 500, 'INVALID_ORDER');
      }

      // Handle access token
      const accessToken = response.accessToken;
      if (accessToken) {
        try {
          if (typeof window !== 'undefined') {
            window.localStorage.setItem(`afritech-order-token:${response.id}`, accessToken);
            window.localStorage.setItem('afritech-last-order', JSON.stringify({ orderId: response.id, reference: response.reference }));
          }
        } catch {}
      } else {
        // Replay case - try to get stored token
        try {
          if (typeof window !== 'undefined') {
            storedToken = window.localStorage.getItem(`afritech-order-token:${response.id}`);
          }
        } catch {}
        if (!storedToken) {
          clearCheckoutIdempotencyKey();
          modalOpen.current = false;
          setStep('idle');
          toast.error('Your order needs to be placed again. Tap Pay once more.');
          return;
        }
      }

      created = { ...response, reference: resolveReference(response.reference) };
    } catch (caught) {
      modalOpen.current = false;
      setStep('idle');

      // A 401 means the session ended - no longer redirect to sign-in
      if (ApiError.isApiError(caught) && caught.status === 401) {
        toast.error(ApiError.from(caught).message || 'Order creation failed.');
        return;
      }

      toast.error(ApiError.from(caught).message);
      return;
    }

    setCurrentOrder(created);
    addToHistory(created);
    setOrder(created);

    let attempt: PaymentAttempt;

    try {
      // Get stored token
      let tokenForInit: string | null = null;
      try {
        if (typeof window !== 'undefined') {
          tokenForInit = window.localStorage.getItem(`afritech-order-token:${created.id}`);
        }
      } catch {}
      // The backend owns the reference, the amount and the email. Retrying an
      // unpaid order returns a fresh reference for the same order, so a
      // cancelled or failed attempt never needs a second order or new stock.
      attempt = await initializePayment(created.id, tokenForInit);
    } catch (caught) {
      modalOpen.current = false;
      setStep('idle');

      const conflict =
        ApiError.isApiError(caught) &&
        caught.status === 409 &&
        /can no longer be paid|already paid/i.test(caught.message);
      const expired = conflict && /can no longer be paid/i.test(caught.message);

      if (conflict) {
        // The order can no longer be used (reservation expired or already
        // paid). Forget this attempt so the next tap starts a fresh order
        // instead of reusing the dead idempotency key. The order token is kept
        // so the confirmation page can still load the order.
        clearCheckoutIdempotencyKey();
        setOrder(null);
        setCurrentOrder(null);
        toast.error(
          expired
            ? 'Your reservation expired. We have checked stock again.'
            : ApiError.from(caught).message
        );
        await onReservationExpired?.();
        return;
      }

      toast.error(ApiError.from(caught).message);
      return;
    }

    setStep('paying');

    try {
      const { default: PaystackPop } = await import('@paystack/inline-js');

      new PaystackPop().newTransaction({
        key: PAYSTACK_PUBLIC_KEY,
        email: attempt.email,
        amount: attempt.amount,
        currency: attempt.currency,
        ref: attempt.reference,
        metadata: {
          orderId: created.id,
          userId: created.userId,
          reference: attempt.reference,
          source: 'afritech-checkout'
        },
        onSuccess: (transaction) => {
          void handlePaymentSuccess(created, transaction.reference);
        },
        onCancel: () => {
          modalOpen.current = false;
          setStep('idle');
          toast.info('Payment cancelled. Your order is saved, so you can pay again.');
        }
      });
    } catch (caught) {
      modalOpen.current = false;
      setStep('idle');
      toast.error(
        caught instanceof Error
          ? caught.message
          : 'Could not open the payment window. Check your connection and try again.'
      );
    }
  }, [
    phase,
    deliveryInfo,
    userId,
    deliveryAvailable,
    onBeforePay,
    onReservationExpired,
    setCurrentOrder,
    addToHistory,
    handlePaymentSuccess,
    setStep
  ]);

  if (items.length === 0) {
    return (
      <div className="card flex flex-col items-start gap-3 p-6">
        <h2 className="text-lg font-semibold text-ink">Nothing to pay for</h2>
        <p className="text-sm text-stone-500">
          Your cart is empty. Add a product before checking out again.
        </p>
      </div>
    );
  }

  return (
    <ErrorBoundary title="Payment failed to load">
      <div className="card flex flex-col gap-5 p-5 sm:p-6">
        <div>
          <h2 className="text-lg font-semibold text-ink">Payment</h2>
          <p className="text-sm text-stone-500">
            {order ? (
              <>
                Order <span className="font-medium text-dark-gold">{order.reference}</span>
              </>
            ) : (
              'Review the total, then pay securely with Paystack.'
            )}
          </p>
        </div>

        <ul className="flex flex-col gap-2 border-y border-stone-200 py-4 text-sm">
          {items.map((item) => {
            const key = `${item.productId}-${item.color ?? 'none'}`;

            return (
              <li key={key} className="flex flex-col gap-1">
                <div className="flex justify-between gap-4">
                  <span className="text-stone-600">
                    {item.quantity} x {item.name || item.productId}
                    {item.color ? ` (${item.color})` : ''}
                  </span>
                  <span className="font-medium text-ink">
                    {formatCedis(item.price * item.quantity)}
                  </span>
                </div>

                {item.stockStatus === 'insufficient' && (
                  <p className="text-xs font-medium text-red-600">
                    Only {item.availableStock ?? 0} left in {item.color}. Reduce the quantity to
                    continue.
                  </p>
                )}

                {item.stockStatus === 'unavailable' && (
                  <p className="text-xs font-medium text-red-600">
                    {item.name || item.productId} in {item.color} is sold out. Remove it to
                    continue.
                  </p>
                )}

                {item.priceChanged && (
                  <p className="text-xs font-medium text-amber-700">
                    Price updated to GHS {item.price.toFixed(2)}
                  </p>
                )}
              </li>
            );
          })}
        </ul>

        {!order && !deliveryAvailable && (
          <p className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
            Delivery not available to this area. Go back to delivery details and choose a
            different area.
          </p>
        )}

        <dl className="flex flex-col gap-1.5 text-sm">
          <div className="flex justify-between">
            <dt className="text-stone-600">Subtotal</dt>
            <dd className="font-medium text-ink">{formatCedis(subtotalToShow)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-stone-600">Delivery</dt>
            <dd className="font-medium text-ink">
              {!order && !deliveryAvailable ? '—' : formatCedis(deliveryFeeToShow)}
            </dd>
          </div>
          <div className="mt-1 flex justify-between border-t border-stone-200 pt-2 text-base">
            <dt className="font-semibold text-ink">Total</dt>
            <dd className="font-bold text-dark-gold">
              {!order && !deliveryAvailable ? '—' : formatCedis(totalToShow)}
            </dd>
          </div>
        </dl>

        {!keyReady && (
          <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Paystack is not configured. Set NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY in .env.local to a
            <span className="font-medium"> pk_test_ </span>or<span className="font-medium"> pk_live_ </span>
            key.
          </p>
        )}

        <div aria-live="polite" className="flex flex-col gap-2 text-sm text-stone-500">
          {phase === 'creating' && <p>Saving your order...</p>}

          {phase === 'verifying' && (
            <p className="flex items-center gap-2">
              <HiOutlineCheckCircle className="h-4 w-4" aria-hidden="true" />
              Confirming your payment...
            </p>
          )}

          {phase === 'paying' && (
            <p className="flex items-center gap-2">
              <HiOutlineCreditCard className="h-4 w-4" aria-hidden="true" />
              Complete the payment in the Paystack window.
            </p>
          )}
        </div>

        <div className="rounded-lg border border-yellow-300 bg-yellow-50 px-4 py-3 text-sm text-yellow-900">
          <p className="font-semibold">How payment works</p>
          <p className="mt-1">
            Enter your name, phone number and delivery details, then tap Place Order. You&apos;ll be taken to Paystack&apos;s secure payment page. Choose Mobile Money, enter your number, and approve the payment with your MoMo PIN when the prompt appears on your phone. You may first be asked for a code sent to your phone. Your order is confirmed when payment goes through. Your item is reserved for 15 minutes.
          </p>
          <p className="mt-2">
            Keep your order reference. Track your order any time under Track Order, using your reference and phone number.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void handlePay()}
          disabled={isBusy || !keyReady || !deliveryAvailable || availabilityBlocked}
          className="btn btn-primary w-full"
        >
          {phase === 'creating' && 'Saving order...'}
          {phase === 'verifying' && 'Verifying payment...'}
          {phase === 'paying' && 'Waiting for payment...'}
          {phase === 'idle' &&
            (deliveryAvailable
              ? `Pay ${formatCedis(totalToShow)} with Paystack`
              : 'Payment unavailable')}
        </button>

        <p className="flex items-center justify-center gap-1.5 text-xs text-stone-500">
          <HiOutlineLockClosed className="h-3.5 w-3.5" aria-hidden="true" />
          Payments are processed securely by Paystack.
        </p>
      </div>
    </ErrorBoundary>
  );
}
