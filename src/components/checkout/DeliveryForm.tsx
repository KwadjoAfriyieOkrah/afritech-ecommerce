'use client';

import { useMemo, useRef, useState, type FormEvent } from 'react';
import { HiOutlineExclamation } from 'react-icons/hi';
import { useUserStore } from '@/store';
import type { DeliveryZone } from '@/services/api';
import type { DeliveryInfo } from '@/types';
import { validateAddress, validatePhoneGH } from '@/utils/validators';
import { expectedDeliveryDate, formatCedis, formatDeliveryDays } from '@/utils/format';

interface DeliveryFormProps {
  zones: DeliveryZone[];
  onComplete?: (info: DeliveryInfo) => void;
}

type FieldName =
  | 'customerName'
  | 'customerPhone'
  | 'deliveryArea'
  | 'deliveryAddress';

type FieldErrors = Partial<Record<FieldName, string>>;

const ERROR_CLASS = 'border-red-400 focus:border-red-500';

/** Renders the inline message tied to a field and moves focus to the first bad one. */
function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;

  return (
    <p id={id} className="mt-1 flex items-start gap-1 text-xs font-medium text-red-600">
      <HiOutlineExclamation className="mt-px h-3.5 w-3.5 flex-none" aria-hidden="true" />
      {message}
    </p>
  );
}

export function DeliveryForm({ zones, onComplete }: DeliveryFormProps) {
  const loggedInEmail = useUserStore((state) => state.user?.email);
  const deliveryInfo = useUserStore((state) => state.deliveryInfo);
  const updateDeliveryInfo = useUserStore((state) => state.updateDeliveryInfo);

  const [errors, setErrors] = useState<FieldErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const matchedZone = useMemo(
    () => zones.find((zone) => zone.name === deliveryInfo.deliveryArea),
    [zones, deliveryInfo.deliveryArea]
  );

  const deliveryEstimate = useMemo(() => {
    const area = deliveryInfo.deliveryArea.trim();

    if (!area || !matchedZone) return null;

    const days = matchedZone.expectedDays;

    return `Delivery to ${area} - ${formatCedis(matchedZone.fee)} - ${formatDeliveryDays(days, days)}`;
  }, [deliveryInfo.deliveryArea, matchedZone]);

  const errorList = useMemo(
    () => Object.entries(errors).filter(([, message]) => Boolean(message)),
    [errors]
  );

  const validate = (): FieldErrors => {
    const nextErrors: FieldErrors = {};

    if (deliveryInfo.customerName.trim().length < 2) {
      nextErrors.customerName = 'Enter the recipient full name (at least 2 characters)';
    }
    if (!validatePhoneGH(deliveryInfo.customerPhone)) {
      nextErrors.customerPhone = 'Enter a valid phone number, for example 0244123456';
    }
    if (!deliveryInfo.deliveryArea) {
      nextErrors.deliveryArea = 'Choose a delivery area';
    } else if (!matchedZone) {
      nextErrors.deliveryArea = 'Delivery is not available to this area';
    }
    if (!validateAddress(deliveryInfo.deliveryAddress)) {
      nextErrors.deliveryAddress = 'Enter a delivery address of at least 5 characters';
    }

    return nextErrors;
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    // Guards against a double-click submitting the step twice.
    if (isSubmitting) return;

    const nextErrors = validate();

    setErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0) {
      const firstInvalid = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
      firstInvalid?.focus();
      return;
    }

    setIsSubmitting(true);

    const deliveryDays = matchedZone ? matchedZone.expectedDays : 0;

    const completed: DeliveryInfo = {
      customerName: deliveryInfo.customerName.trim(),
      customerPhone: deliveryInfo.customerPhone.trim(),
      customerEmail: deliveryInfo.customerEmail.trim() || loggedInEmail || '',
      deliveryArea: deliveryInfo.deliveryArea,
      deliveryAddress: deliveryInfo.deliveryAddress.trim(),
      expectedDeliveryDays: deliveryDays,
      expectedDeliveryDate: expectedDeliveryDate(deliveryDays, deliveryDays)
    };

    updateDeliveryInfo(completed);
    onComplete?.(completed);
  };

  return (
    <form
      ref={formRef}
      onSubmit={handleSubmit}
      noValidate
      className="card flex flex-col gap-5 p-5 sm:p-6"
    >
      <div>
        <h2 className="text-lg font-semibold text-ink">Delivery details</h2>
        <p className="text-sm text-stone-500">Where should we deliver your order?</p>
      </div>

      {errorList.length > 0 && (
        <div role="alert" className="alert-error flex flex-col gap-1">
          <p className="font-semibold">
            Fix {errorList.length} field{errorList.length === 1 ? '' : 's'} to continue
          </p>
          <ul className="list-inside list-disc">
            {errorList.map(([field, message]) => (
              <li key={field}>
                <a href={`#${field}`} className="underline">
                  {message}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="sm:col-span-1">
          <label htmlFor="customerName" className="label">
            Full name
          </label>
          <input
            id="customerName"
            name="customerName"
            type="text"
            autoComplete="name"
            className={`input ${errors.customerName ? ERROR_CLASS : ''}`}
            placeholder="Ama Mensah"
            value={deliveryInfo.customerName}
            onChange={(event) => {
              updateDeliveryInfo({ customerName: event.target.value });
              setErrors((current) => ({ ...current, customerName: undefined }));
            }}
            aria-invalid={Boolean(errors.customerName)}
            aria-describedby={errors.customerName ? 'customerName-error' : undefined}
          />
          <FieldError id="customerName-error" message={errors.customerName} />
        </div>

        <div className="sm:col-span-1">
          <label htmlFor="customerPhone" className="label">
            Phone
          </label>
          <input
            id="customerPhone"
            name="customerPhone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            className={`input ${errors.customerPhone ? ERROR_CLASS : ''}`}
            placeholder="0244123456"
            value={deliveryInfo.customerPhone}
            onChange={(event) => {
              updateDeliveryInfo({ customerPhone: event.target.value });
              setErrors((current) => ({ ...current, customerPhone: undefined }));
            }}
            aria-invalid={Boolean(errors.customerPhone)}
            aria-describedby={errors.customerPhone ? 'customerPhone-error' : undefined}
          />
          <FieldError id="customerPhone-error" message={errors.customerPhone} />
        </div>

        <div className="sm:col-span-2">
          <label htmlFor="deliveryArea" className="label">
            Delivery area
          </label>
          <select
            id="deliveryArea"
            name="deliveryArea"
            className={`input ${errors.deliveryArea ? ERROR_CLASS : ''}`}
            value={deliveryInfo.deliveryArea}
            onChange={(event) => {
              updateDeliveryInfo({ deliveryArea: event.target.value });
              setErrors((current) => ({ ...current, deliveryArea: undefined }));
            }}
            aria-invalid={Boolean(errors.deliveryArea)}
            aria-describedby={errors.deliveryArea ? 'deliveryArea-error' : undefined}
          >
            <option value="">Select an area</option>
            {zones.map((zone) => (
              <option key={zone.name} value={zone.name}>
                {zone.name}
              </option>
            ))}
          </select>
          <FieldError id="deliveryArea-error" message={errors.deliveryArea} />
        </div>

        <div className="sm:col-span-2">
          <label htmlFor="deliveryAddress" className="label">
            Delivery address
          </label>
          <textarea
            id="deliveryAddress"
            name="deliveryAddress"
            rows={3}
            className={`input resize-y ${errors.deliveryAddress ? ERROR_CLASS : ''}`}
            placeholder="House number, street, landmark"
            value={deliveryInfo.deliveryAddress}
            onChange={(event) => {
              updateDeliveryInfo({ deliveryAddress: event.target.value });
              setErrors((current) => ({ ...current, deliveryAddress: undefined }));
            }}
            aria-invalid={Boolean(errors.deliveryAddress)}
            aria-describedby={errors.deliveryAddress ? 'deliveryAddress-error' : undefined}
          />
          <FieldError id="deliveryAddress-error" message={errors.deliveryAddress} />
        </div>
      </div>

      {deliveryEstimate && (
        <p
          aria-live="polite"
          className="rounded-lg bg-light-gold px-4 py-3 text-sm font-medium text-dark-gold"
        >
          {deliveryEstimate}
        </p>
      )}

      <button
        type="submit"
        disabled={isSubmitting}
        className="btn btn-primary w-full sm:w-auto sm:self-end"
      >
        {isSubmitting ? 'Saving...' : 'Continue to payment'}
      </button>
    </form>
  );
}
