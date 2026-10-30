'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { HiOutlineTruck } from 'react-icons/hi';
import { useCartStore, useUserStore } from '@/store';
import {
  ApiError,
  checkAvailability,
  getDeliveryZones,
  type DeliveryZone
} from '@/services/api';
import type { DeliveryInfo } from '@/types';
import { CartSummary } from '@/components/cart/CartSummary';
import { DeliveryForm } from '@/components/checkout/DeliveryForm';
import { PaymentForm } from '@/components/checkout/PaymentForm';
import { ErrorBoundary } from '@/components/shared/ErrorBoundary';

type CheckoutStep = 'delivery' | 'payment' | 'processing';

const STEPS: Array<{ value: CheckoutStep; label: string }> = [
  { value: 'delivery', label: 'Delivery' },
  { value: 'payment', label: 'Payment' }
];

function CheckoutSkeleton() {
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">
      <div className="skeleton h-8 w-40" />
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="card p-6">
          <div className="skeleton h-5 w-48" />
          <div className="mt-5 grid gap-5 sm:grid-cols-2">
            <div className="skeleton h-10 w-full sm:col-span-1" />
            <div className="skeleton h-10 w-full sm:col-span-1" />
            <div className="skeleton h-10 w-full sm:col-span-2" />
            <div className="skeleton h-10 w-full sm:col-span-2" />
            <div className="skeleton h-24 w-full sm:col-span-2" />
          </div>
        </div>
        <div className="card h-40 p-6">
          <div className="skeleton h-5 w-32" />
          <div className="skeleton mt-4 h-4 w-full" />
          <div className="skeleton mt-3 h-4 w-full" />
        </div>
      </div>
    </div>
  );
}

export default function CheckoutPage() {
  const items = useCartStore((state) => state.items);
  const syncAvailability = useCartStore((state) => state.syncAvailability);
  const deliveryInfo = useUserStore((state) => state.deliveryInfo);
  const updateDeliveryInfo = useUserStore((state) => state.updateDeliveryInfo);
  const user = useUserStore((state) => state.user);
  const sessionReady = useUserStore((state) => state.sessionReady);

  const [currentStep, setCurrentStep] = useState<CheckoutStep>('delivery');
  const [zones, setZones] = useState<DeliveryZone[] | null>(null);
  const [zonesError, setZonesError] = useState<string | null>(null);
  const [availabilityError, setAvailabilityError] = useState<string | null>(null);
  const [expiredNotice, setExpiredNotice] = useState(false);

  const loadZones = useCallback(async () => {
    setZonesError(null);
    try {
      setZones(await getDeliveryZones());
    } catch (caught) {
      setZonesError(ApiError.from(caught).message);
    }
  }, []);

  useEffect(() => {
    void loadZones();
  }, [loadZones]);

  // Read-only stock and price probe. It never removes a line and never changes
  // a quantity: it only records each line's status and the server unit price.
  // The same probe is run before every payment attempt, because POST /orders
  // is the authority and the reservation may have expired.
  const refreshAvailability = useCallback(async (): Promise<boolean> => {
    const currentItems = useCartStore.getState().items;
    if (currentItems.length === 0) return true;

    try {
      const results = await checkAvailability(
        currentItems.map((item) => ({
          productId: item.productId,
          color: item.color ?? '',
          quantity: item.quantity
        }))
      );
      syncAvailability(results);
      setAvailabilityError(null);
      return results.every((line) => line.status === 'ok');
    } catch (caught) {
      setAvailabilityError(ApiError.from(caught).message);
      return false;
    }
  }, [syncAvailability]);

  useEffect(() => {
    void refreshAvailability();
  }, [refreshAvailability]);

  useEffect(() => {
    const onFocus = () => {
      void refreshAvailability();
    };

    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
    };
  }, [refreshAvailability]);

  const handleReservationExpired = useCallback(async () => {
    setExpiredNotice(true);
    await refreshAvailability();
  }, [refreshAvailability]);

  // Pre-fill the checkout draft from the signed-in account without overwriting
  // anything the visitor already typed.
  useEffect(() => {
    if (!user) return;

    const current = useUserStore.getState().deliveryInfo;
    const seed: Partial<DeliveryInfo> = {};
    if (!current.customerName.trim() && user.name.trim()) {
      seed.customerName = user.name;
    }
    if (!current.customerEmail.trim() && user.email.trim()) {
      seed.customerEmail = user.email;
    }
    if (!current.customerPhone.trim() && user.phone.trim()) {
      seed.customerPhone = user.phone;
    }
    if (Object.keys(seed).length > 0) updateDeliveryInfo(seed);
  }, [user, updateDeliveryInfo]);

  if (!sessionReady) return <CheckoutSkeleton />;

  if (items.length === 0) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-16 text-center sm:px-6">
        <h1 className="text-2xl font-bold text-ink">Your cart is empty</h1>
        <p className="mt-2 text-sm text-stone-500">Add a product before checking out.</p>
        <Link href="/products" className="btn btn-primary mt-6">
          Shop products
        </Link>
      </div>
    );
  }

  if (zones === null && zonesError === null) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-16 text-center sm:px-6" role="status">
        <p className="text-sm text-stone-500">Loading delivery options...</p>
      </div>
    );
  }

  if (zonesError || zones === null) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-16 text-center sm:px-6">
        <h1 className="text-2xl font-bold text-ink">Could not load delivery options</h1>
        <p className="mt-2 text-sm text-stone-500">{zonesError}</p>
        <button type="button" onClick={() => void loadZones()} className="btn btn-primary mt-6">
          Try again
        </button>
      </div>
    );
  }

  const currentIndex = STEPS.findIndex((entry) => entry.value === currentStep);
  const isProcessing = currentStep === 'processing';

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-ink sm:text-3xl">Checkout</h1>
        <ol className="mt-3 flex flex-wrap gap-4 text-sm">
          {STEPS.map(({ value, label }, index) => (
            <li
              key={value}
              aria-current={currentStep === value ? 'step' : undefined}
              className={`flex items-center gap-2 ${
                index <= currentIndex ? 'font-semibold text-dark-gold' : 'text-stone-400'
              }`}
            >
              <span className="flex h-6 w-6 items-center justify-center rounded-full border border-current text-xs">
                {index + 1}
              </span>
              {label}
            </li>
          ))}
        </ol>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div>
          {expiredNotice && (
            <div role="status" className="card mb-4 p-4 text-sm text-ink">
              Your reservation expired. We have checked stock again.
            </div>
          )}

          {availabilityError && (
            <div role="alert" className="alert-error mb-4">
              {availabilityError}
            </div>
          )}

          <ErrorBoundary title="Checkout failed to load">
            {currentStep === 'delivery' && (
              <DeliveryForm zones={zones} onComplete={() => setCurrentStep('payment')} />
            )}

            {(currentStep === 'payment' || isProcessing) && (
              <>
                {isProcessing && (
                  <div
                    className="card mb-4 flex flex-col items-start gap-2 p-4"
                    aria-live="polite"
                    role="status"
                  >
                    <p className="flex items-center gap-2 text-sm font-medium text-ink">
                      <HiOutlineTruck className="h-4 w-4 text-dark-gold" aria-hidden="true" />
                      Processing your order
                    </p>
                    <p className="text-xs text-stone-500">
                      Hold on while we confirm your payment. This usually takes a few seconds.
                    </p>
                    <div className="skeleton h-1.5 w-full" />
                  </div>
                )}

                {!isProcessing && (
                  <button
                    type="button"
                    onClick={() => setCurrentStep('delivery')}
                    disabled={isProcessing}
                    className="btn btn-ghost mb-4 text-sm"
                  >
                    Back to delivery details
                  </button>
                )}

                <PaymentForm
                  zones={zones}
                  deliveryInfo={deliveryInfo}
                  onBeforePay={refreshAvailability}
                  onReservationExpired={handleReservationExpired}
                  onProcessingChange={(processing) =>
                    setCurrentStep(processing ? 'processing' : 'payment')
                  }
                />
              </>
            )}
          </ErrorBoundary>
        </div>

        <div className="lg:sticky lg:top-24 lg:self-start">
          <CartSummary zones={zones} />
        </div>
      </div>
    </div>
  );
}
