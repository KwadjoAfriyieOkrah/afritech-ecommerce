'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { trackOrder, type TrackOrderResponse } from '@/services/api';
import { OrderStatus, type OrderItem } from '@/types';

const MONEY_FORMAT = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

const STATUS_LABELS: Record<OrderStatus, string> = {
  [OrderStatus.PENDING]: 'Order received',
  [OrderStatus.PAID]: 'Payment confirmed',
  [OrderStatus.PACKAGING]: 'Being packaged',
  [OrderStatus.DISPATCHED]: 'Out for delivery',
  [OrderStatus.DELIVERED]: 'Delivered'
};

function formatMoney(value: number | undefined): string {
  if (typeof value !== 'number') return 'GHS 0.00';
  return `GHS ${MONEY_FORMAT.format(value)}`;
}

function formatStatus(status: OrderStatus): string {
  return STATUS_LABELS[status] ?? status;
}

function TrackPageContent() {
  const searchParams = useSearchParams();
  const [reference, setReference] = useState(searchParams.get('reference') ?? '');
  const [phone, setPhone] = useState('');
  const [result, setResult] = useState<TrackOrderResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleTrack = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const data = await trackOrder(reference, phone);
      setResult(data);
    } catch {
      setError('We couldn\'t find an order with those details. Check the reference and phone number.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-bold text-ink sm:text-3xl">Track Order</h1>
      <form onSubmit={handleTrack} className="mt-6 card flex flex-col gap-4 p-5 sm:p-6">
        <div>
          <label htmlFor="reference" className="label">
            Order reference
          </label>
          <input
            id="reference"
            type="text"
            className="input"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            required
          />
        </div>
        <div>
          <label htmlFor="phone" className="label">
            Phone number
          </label>
          <input
            id="phone"
            type="tel"
            className="input"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
          />
        </div>
        <button type="submit" disabled={loading} className="btn btn-primary">
          {loading ? 'Tracking...' : 'Track'}
        </button>
      </form>

      {error && (
        <div className="mt-4 alert-error">
          <p>{error}</p>
        </div>
      )}

      {result && (
        <div className="mt-6 card flex flex-col gap-4 p-5 sm:p-6">
          <div>
            <h2 className="text-lg font-semibold text-ink">Order {result.reference}</h2>
            <p className="text-sm text-stone-500">Status: {formatStatus(result.status)}</p>
          </div>
          <div>
            <h3 className="font-medium text-ink">Items</h3>
            <ul className="mt-2 flex flex-col gap-2">
              {result.items?.map((item: OrderItem, idx: number) => (
                <li key={idx} className="flex justify-between text-sm">
                  <span>
                    {item.quantity} x {item.name} {item.color ? `(${item.color})` : ''}
                  </span>
                  <span className="font-medium">{formatMoney(item.price)}</span>
                </li>
              ))}
            </ul>
          </div>
          <dl className="flex flex-col gap-1.5 text-sm">
            <div className="flex justify-between">
              <dt className="text-stone-600">Delivery fee</dt>
              <dd className="font-medium text-ink">{formatMoney(result.deliveryFee)}</dd>
            </div>
            <div className="flex justify-between border-t border-stone-200 pt-2 text-base">
              <dt className="font-semibold text-ink">Total</dt>
              <dd className="font-bold text-dark-gold">{formatMoney(result.total)}</dd>
            </div>
          </dl>
          <p className="text-sm text-stone-600">
            Expected delivery date: {result.expectedDeliveryDate}
          </p>
          {(result.status === OrderStatus.DISPATCHED || result.status === OrderStatus.DELIVERED) &&
            result.rider &&
            result.rider.name.trim() !== '' &&
            result.rider.phone.trim() !== '' && (
              <div className="border-t border-stone-200 pt-4">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-stone-600">
                  <p>
                    Your rider: {result.rider.name} · {result.rider.phone}
                  </p>
                  <a
                    href={`tel:${result.rider.phone.replace(/\s+/g, '')}`}
                    className="text-dark-gold underline"
                  >
                    Call rider
                  </a>
                </div>
              </div>
            )}
        </div>
      )}
    </div>
  );
}

export default function TrackPage() {
  return (
    <Suspense fallback={<div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6" />}>
      <TrackPageContent />
    </Suspense>
  );
}
