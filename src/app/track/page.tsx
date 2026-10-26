'use client';

import { useState } from 'react';
import { trackOrder } from '@/services/api';

export default function TrackPage() {
  const [reference, setReference] = useState('');
  const [phone, setPhone] = useState('');
  const [result, setResult] = useState<any>(null);
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
    } catch (err: any) {
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
            <p className="text-sm text-stone-500">Status: {result.status}</p>
          </div>
          <div>
            <h3 className="font-medium text-ink">Items</h3>
            <ul className="mt-2 flex flex-col gap-2">
              {result.items?.map((item: any, idx: number) => (
                <li key={idx} className="flex justify-between text-sm">
                  <span>
                    {item.quantity} x {item.name} {item.color ? `(${item.color})` : ''}
                  </span>
                  <span className="font-medium">{item.price}</span>
                </li>
              ))}
            </ul>
          </div>
          <dl className="flex flex-col gap-1.5 text-sm">
            <div className="flex justify-between">
              <dt className="text-stone-600">Delivery fee</dt>
              <dd className="font-medium text-ink">{result.deliveryFee}</dd>
            </div>
            <div className="flex justify-between border-t border-stone-200 pt-2 text-base">
              <dt className="font-semibold text-ink">Total</dt>
              <dd className="font-bold text-dark-gold">{result.total}</dd>
            </div>
          </dl>
          <p className="text-sm text-stone-600">
            Expected delivery date: {result.expectedDeliveryDate}
          </p>
          {result.rider && (
            <div className="border-t border-stone-200 pt-4">
              <p className="text-sm text-stone-600">
                Rider: {result.rider.name}{' '}
                <a href={`tel:${result.rider.phone}`} className="text-dark-gold underline">
                  Call rider
                </a>
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
