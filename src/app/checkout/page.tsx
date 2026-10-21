'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { HiOutlineTruck } from 'react-icons/hi';
import { useCartStore, useUserStore } from '@/store';
import { ApiError, fetchProducts, getDeliveryZones, type DeliveryZone } from '@/services/api';
import type { DeliveryInfo } from '@/types';
import { AuthForm } from '@/components/auth/AuthForm';
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
  const syncSoldOutStatus = useCartStore((state) => state.syncSoldOutStatus);
  const deliveryInfo = useUserStore((state) => state.deliveryInfo);
  const updateDeliveryInfo = useUserStore((state) => state.updateDeliveryInfo);
  const user = useUserStore((state) => state.user);
  const sessionReady = useUserStore((state) => state.sessionReady);

  const [currentStep, setCurrentStep] = useState<CheckoutStep>('delivery');
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [zones, setZones] = useState<DeliveryZone[] | null>(null);
  const [zonesError, setZonesError] = useState<string | null>(null);

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

  // The cart is persisted, so a product can sell out after it was added. Ask
  // the server which products are sold out and flag those cart items. Nothing
  // is removed from the cart here.
  useEffect(() => {
    let cancelled = false;

    fetchProducts()
      .then((products) => {
        if (!cancelled) syncSoldOutStatus(products);
      })
      .catch(() => {
        // A failed lookup leaves the stored flags untouched.
      });

    return () => {
      cancelled = true;
    };
  }, [syncSoldOutStatus]);

  // Pre-fill the checkout draft from the signed-in account without overwriting
  // anything the visitor already typed.
  useEffect(() => {
    if (!user) return;

    const seed: Partial<DeliveryInfo> = {};
    if (!deliveryInfo.customerName.trim()) seed.customerName = user.name;
    if (!deliveryInfo.customerEmail.trim()) seed.customerEmail = user.email;
    if (!deliveryInfo.customerPhone.trim()) seed.customerPhone = user.phone;
    if (Object.keys(seed).length > 0) updateDeliveryInfo(seed);
  }, [user, deliveryInfo, updateDeliveryInfo]);

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

  // Checkout needs an account, so rather than bouncing to /login we show the
  // sign-in or create-account step inline and keep the cart and progress.
  if (!user) {
    return (
      <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">
        <header className="mb-6">
          <h1 className="text-2xl font-bold text-ink sm:text-3xl">Checkout</h1>
          <p className="mt-2 text-sm text-stone-500">
            Sign in or create an account to finish your order. Your cart is saved.
          </p>
        </header>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <AuthForm
            mode={authMode}
            onSuccess={() => undefined}
            onSwitchMode={() =>
              setAuthMode((current) => (current === 'login' ? 'register' : 'login'))
            }
          />
          <div className="lg:sticky lg:top-24 lg:self-start">
            {zones ? (
              <CartSummary zones={zones} />
            ) : (
              <div className="card h-40 p-6">
                <div className="skeleton h-5 w-32" />
                <div className="skeleton mt-4 h-4 w-full" />
                <div className="skeleton mt-3 h-4 w-full" />
              </div>
            )}
          </div>
        </div>
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
  const hasSoldOutItems = items.some((item) => item.soldOut);

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
          {hasSoldOutItems ? (
            <div role="alert" className="alert-error flex flex-col items-start gap-2">
              <p className="font-semibold text-ink">Your cart holds a sold out item</p>
              <p className="text-sm">
                Checkout is blocked until it is removed. The item stays in your cart so nothing
                is taken away from you without you knowing.
              </p>
            </div>
          ) : (
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
                    onProcessingChange={(processing) =>
                      setCurrentStep(processing ? 'processing' : 'payment')
                    }
                  />
                </>
              )}
            </ErrorBoundary>
          )}
        </div>

        <div className="lg:sticky lg:top-24 lg:self-start">
          <CartSummary zones={zones} />
        </div>
      </div>
    </div>
  );
}
