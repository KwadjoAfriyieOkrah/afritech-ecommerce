'use client';

import Link from 'next/link';
import { useState } from 'react';
import { HiOutlineTruck } from 'react-icons/hi';
import { useCartStore, useUserStore } from '@/store';
import { CartSummary } from '@/components/cart/CartSummary';
import { DeliveryForm } from '@/components/checkout/DeliveryForm';
import { PaymentForm } from '@/components/checkout/PaymentForm';
import { ErrorBoundary } from '@/components/shared/ErrorBoundary';

type CheckoutStep = 'delivery' | 'payment' | 'processing';

const STEPS: Array<{ value: CheckoutStep; label: string }> = [
  { value: 'delivery', label: 'Delivery' },
  { value: 'payment', label: 'Payment' }
];

export default function CheckoutPage() {
  const items = useCartStore((state) => state.items);
  const deliveryInfo = useUserStore((state) => state.deliveryInfo);

  const [currentStep, setCurrentStep] = useState<CheckoutStep>('delivery');

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
          <ErrorBoundary title="Checkout failed to load">
            {currentStep === 'delivery' && (
              <DeliveryForm onComplete={() => setCurrentStep('payment')} />
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
                  deliveryInfo={deliveryInfo}
                  onProcessingChange={(processing) =>
                    setCurrentStep(processing ? 'processing' : 'payment')
                  }
                />
              </>
            )}
          </ErrorBoundary>
        </div>

        <div className="lg:sticky lg:top-24 lg:self-start">
          <CartSummary />
        </div>
      </div>
    </div>
  );
}
