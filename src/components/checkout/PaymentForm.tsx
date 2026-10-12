'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { HiOutlineCheckCircle, HiOutlineCreditCard, HiOutlineLockClosed } from 'react-icons/hi';
import { toast } from 'sonner';
import { ApiError, createOrder } from '@/services/api';
import { useCartStore, useOrderStore, useUserStore } from '@/store';
import { OrderStatus, type DeliveryInfo, type Order, type PaymentVerification } from '@/types';
import { ErrorBoundary } from '@/components/shared/ErrorBoundary';
import { formatCedis } from '@/utils/format';
import { resolveReference } from '@/utils/orderReference';
import { calculateDeliveryFee, validateEmail } from '@/utils/validators';

const PAYSTACK_PUBLIC_KEY = process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY ?? '';

function isUsableKey(key: string): boolean {
  return key.startsWith('pk_') && key.length > 10 && !key.includes('your_paystack_key');
}

interface PaymentFormProps {
  deliveryInfo: DeliveryInfo;
  onProcessingChange?: (processing: boolean) => void;
}

export function PaymentForm({ deliveryInfo, onProcessingChange }: PaymentFormProps) {
  const router = useRouter();

  const items = useCartStore((state) => state.items);
  const clearCart = useCartStore((state) => state.clearCart);
  const setCurrentOrder = useOrderStore((state) => state.setCurrentOrder);
  const addToHistory = useOrderStore((state) => state.addToHistory);
  const updateStatus = useOrderStore((state) => state.updateStatus);
  const loggedInEmail = useUserStore((state) => state.user?.email);

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

  const email = deliveryInfo.customerEmail || loggedInEmail || '';
  const keyReady = isUsableKey(PAYSTACK_PUBLIC_KEY);
  const emailReady = validateEmail(email);

  const subtotal = useMemo(
    () => items.reduce((sum, item) => sum + item.price * item.quantity, 0),
    [items]
  );

  const deliveryFee = useMemo(
    () => (items.length > 0 ? calculateDeliveryFee(deliveryInfo.deliveryArea) : 0),
    [items.length, deliveryInfo.deliveryArea]
  );

  const subtotalToShow = order ? order.subtotal : subtotal;
  const deliveryFeeToShow = order ? order.deliveryFee : deliveryFee;
  const totalToShow = order ? order.totalPrice : subtotal + deliveryFee;

  const isBusy = phase !== 'idle';

  // Mock flow: trusts Paystack's success callback directly, so no request is
  // made to /api/orders/verify-payment. Swap back to verifyOrderPayment for real payments.
  const handlePaymentSuccess = useCallback(
    async (current: Order, transactionReference: string) => {
      modalOpen.current = false;
      setStep('verifying');

      try {
        const mockSuccessResponse: PaymentVerification = {
          verified: true,
          reference: transactionReference,
          message: 'Payment confirmed (mock).'
        };

        if (!mockSuccessResponse.verified) {
          throw new ApiError(
            mockSuccessResponse.message ?? 'We could not confirm the payment yet. Please try again.',
            402,
            'UNVERIFIED_PAYMENT'
          );
        }

        const paid: Order = {
          ...current,
          isPaid: true,
          paymentReference: mockSuccessResponse.reference,
          status: OrderStatus.PAID
        };

        const mockOrderId = paid.id || `mock-${mockSuccessResponse.reference}`;

        setCurrentOrder(paid);
        updateStatus(paid.id, paid.status);
        clearCart();

        toast.success('Payment confirmed. Opening your order confirmation...');
        router.push(`/confirmation/${mockOrderId}`);
      } catch (caught) {
        setStep('idle');
        toast.error(ApiError.from(caught).message);
      }
    },
    [setCurrentOrder, updateStatus, clearCart, setStep, router]
  );

  const handlePay = useCallback(async () => {
    // `modalOpen` is a ref, so it cannot gate this on render alone.
    if (phase !== 'idle' || modalOpen.current) return;

    setStep('creating');

    let created: Order;

    try {
      const response = await createOrder({
        items: items.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
          color: item.color,
          price: item.price
        })),
        customerName: deliveryInfo.customerName,
        customerPhone: deliveryInfo.customerPhone,
        customerEmail: email,
        deliveryArea: deliveryInfo.deliveryArea,
        deliveryAddress: deliveryInfo.deliveryAddress,
        expectedDeliveryDate: deliveryInfo.expectedDeliveryDate
      });

      if (!response?.id) {
        throw new ApiError('The server returned an order without an id.', 500, 'INVALID_ORDER');
      }

      created = { ...response, reference: resolveReference(response.reference) };
    } catch (caught) {
      setStep('idle');
      toast.error(ApiError.from(caught).message);
      return;
    }

    setCurrentOrder(created);
    addToHistory(created);
    setOrder(created);
    setStep('paying');
    modalOpen.current = true;

    try {
      const { default: PaystackPop } = await import('@paystack/inline-js');

      new PaystackPop().newTransaction({
        key: PAYSTACK_PUBLIC_KEY,
        email,
        amount: Math.round(created.totalPrice * 100),
        currency: 'GHS',
        ref: created.reference,
        metadata: {
          orderId: created.id,
          userId: created.userId,
          reference: created.reference,
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
    items,
    deliveryInfo,
    email,
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
              <li key={key} className="flex justify-between gap-4">
                <span className="text-stone-600">
                  {item.quantity} x {item.name || item.productId}
                  {item.color ? ` (${item.color})` : ''}
                </span>
                <span className="font-medium text-ink">
                  {formatCedis(item.price * item.quantity)}
                </span>
              </li>
            );
          })}
        </ul>

        <dl className="flex flex-col gap-1.5 text-sm">
          <div className="flex justify-between">
            <dt className="text-stone-600">Subtotal</dt>
            <dd className="font-medium text-ink">{formatCedis(subtotalToShow)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-stone-600">Delivery</dt>
            <dd className="font-medium text-ink">{formatCedis(deliveryFeeToShow)}</dd>
          </div>
          <div className="mt-1 flex justify-between border-t border-stone-200 pt-2 text-base">
            <dt className="font-semibold text-ink">Total</dt>
            <dd className="font-bold text-dark-gold">{formatCedis(totalToShow)}</dd>
          </div>
        </dl>

        {!emailReady && (
          <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Paystack needs a valid email address. Go back to delivery details and add yours.
          </p>
        )}

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

        <button
          type="button"
          onClick={() => void handlePay()}
          disabled={isBusy || !keyReady || !emailReady}
          className="btn btn-primary w-full"
        >
          {phase === 'creating' && 'Saving order...'}
          {phase === 'verifying' && 'Verifying payment...'}
          {phase === 'paying' && 'Waiting for payment...'}
          {phase === 'idle' && `Pay ${formatCedis(totalToShow)} with Paystack`}
        </button>

        <p className="flex items-center justify-center gap-1.5 text-xs text-stone-500">
          <HiOutlineLockClosed className="h-3.5 w-3.5" aria-hidden="true" />
          Payments are processed securely by Paystack.
        </p>
      </div>
    </ErrorBoundary>
  );
}
