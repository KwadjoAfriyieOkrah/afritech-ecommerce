'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError } from '@/services/api';
import { createRider, listRiders, type AdminRider } from '@/services/adminApi';

const GHANA_PHONE_PATTERN = /^(?:0\d{9}|233\d{9})$/;
const FORMATTING_CHARS = /[\s()-]/g;

export default function AdminRidersPage() {
  const [riders, setRiders] = useState<AdminRider[]>([]);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const nextRiders = await listRiders();
      setRiders(nextRiders);
      setLoadError(null);
    } catch (caught) {
      setLoadError(ApiError.from(caught).message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;

    void listRiders()
      .then((nextRiders) => {
        if (!active) return;
        setRiders(nextRiders);
        setLoadError(null);
      })
      .catch((caught: unknown) => {
        if (active) setLoadError(ApiError.from(caught).message);
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (isSubmitting) return;

    const trimmedName = name.trim();
    const normalisedPhone = phone.trim().replace(FORMATTING_CHARS, '');
    const phoneForApi = normalisedPhone.startsWith('233')
      ? `0${normalisedPhone.slice(3)}`
      : normalisedPhone;
    setFormError(null);

    if (!trimmedName) {
      setFormError('Enter the rider name.');
      return;
    }

    if (!GHANA_PHONE_PATTERN.test(normalisedPhone)) {
      setFormError(
        'Enter a Ghana number: 10 digits starting with 0, or 233 followed by 9 digits.'
      );
      return;
    }

    setIsSubmitting(true);

    void (async () => {
      try {
        const created = await createRider(trimmedName, phoneForApi);
        setRiders((current) => [...current, created]);
        setName('');
        setPhone('');
      } catch (caught) {
        setFormError(ApiError.from(caught).message);
      } finally {
        setIsSubmitting(false);
      }
    })();
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
      <section className="card p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-ink">Active riders</h2>
            <p className="text-sm text-stone-500">Riders who can be assigned to orders.</p>
          </div>

          <button
            type="button"
            onClick={() => {
              setIsLoading(true);
              setLoadError(null);
              void load();
            }}
            disabled={isLoading}
            className="btn btn-outline px-3 py-2 text-sm"
          >
            {isLoading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>

        {loadError && (
          <div role="alert" className="alert-error mt-4 flex items-center justify-between gap-3">
            <p>{loadError}</p>
            <button
              type="button"
              onClick={() => {
                setIsLoading(true);
                setLoadError(null);
                void load();
              }}
              className="btn btn-outline text-xs"
            >
              Retry
            </button>
          </div>
        )}

        {isLoading && riders.length === 0 && (
          <p className="mt-4 text-sm text-stone-500">Loading riders...</p>
        )}

        {!isLoading && !loadError && riders.length === 0 && (
          <div className="mt-4 rounded-lg border border-dashed border-stone-300 p-5">
            <p className="text-sm font-medium text-ink">No active riders</p>
          </div>
        )}

        {riders.length > 0 && (
          <ul className="mt-4 divide-y divide-stone-100">
            {riders.map((rider) => (
              <li key={rider.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <span className="font-medium text-ink">{rider.name}</span>
                <span className="font-mono text-sm text-stone-600">{rider.phone}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card h-fit p-5 sm:p-6">
        <h2 className="text-xl font-bold text-ink">Add a rider</h2>
        <p className="mt-1 text-sm text-stone-500">
          Riders must have a Ghana phone number.
        </p>

        {formError && (
          <div role="alert" className="alert-error mt-4">
            {formError}
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate className="mt-4 flex flex-col gap-4">
          <div>
            <label htmlFor="rider-name" className="label">
              Name
            </label>
            <input
              id="rider-name"
              name="name"
              type="text"
              maxLength={60}
              autoComplete="off"
              className="input"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setFormError(null);
              }}
              placeholder="Rider name"
            />
          </div>

          <div>
            <label htmlFor="rider-phone" className="label">
              Phone
            </label>
            <input
              id="rider-phone"
              name="phone"
              type="tel"
              inputMode="tel"
              autoComplete="off"
              className="input"
              value={phone}
              onChange={(event) => {
                setPhone(event.target.value);
                setFormError(null);
              }}
              placeholder="0241234567 or 233241234567"
            />
          </div>

          <button type="submit" disabled={isSubmitting} className="btn btn-primary">
            {isSubmitting ? 'Adding...' : 'Add rider'}
          </button>
        </form>
      </section>
    </div>
  );
}
