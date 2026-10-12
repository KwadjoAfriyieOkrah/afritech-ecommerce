'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  HiCheck,
  HiOutlineMap,
  HiOutlinePhone,
  HiOutlineRefresh,
  HiOutlineTruck
} from 'react-icons/hi';
import { toast } from 'sonner';
import { ApiError, getOrderTracking } from '@/services/api';
import { useOrderStore } from '@/store';
import { OrderStatus, type Order, type TrackingStage } from '@/types';
import { ErrorBoundary } from '@/components/shared/ErrorBoundary';
import { formatCedis, formatDateTime } from '@/utils/format';
import {
  TRACKING_STAGES,
  hasRider,
  isDelivered,
  trackingStageIndex,
  trackingStageState
} from '@/utils/tracking';

const AUTO_REFRESH_INTERVAL_MS = 5000;

const STATUS_LABELS: Record<string, string> = {
  [OrderStatus.PENDING]: 'Order received',
  [OrderStatus.PAID]: 'Payment confirmed',
  [OrderStatus.PACKAGING]: 'Being packaged',
  [OrderStatus.DISPATCHED]: 'Out for delivery',
  [OrderStatus.DELIVERED]: 'Delivered'
};

function TrackingSkeleton() {
  return (
    <div className="card flex flex-col gap-5 p-6">
      <div className="skeleton h-8 w-52" />
      <div className="flex flex-col gap-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="flex items-center gap-4">
            <div className="skeleton h-8 w-8 rounded-full" />
            <div className="skeleton h-4 flex-1" />
          </div>
        ))}
      </div>
    </div>
  );
}

function TimelineStage({
  stage,
  index,
  currentIndex,
  isLast
}: {
  stage: TrackingStage;
  index: number;
  currentIndex: number;
  isLast: boolean;
}) {
  const state = trackingStageState(index, currentIndex);

  const markerClasses =
    state === 'upcoming'
      ? 'border-stone-300 bg-white text-stone-300'
      : state === 'current'
        ? 'border-dark-gold bg-gold text-ink'
        : 'border-dark-gold bg-dark-gold text-white';

  return (
    <li className="flex gap-4">
      <div className="flex flex-col items-center">
        <span
          className={`flex h-8 w-8 flex-none items-center justify-center rounded-full border-2 ${markerClasses}`}
          aria-hidden="true"
        >
          {state === 'completed' && <HiCheck className="h-4 w-4" />}
          {state === 'current' && <span className="h-2.5 w-2.5 rounded-full bg-ink" />}
        </span>
        {!isLast && (
          <span
            className={`w-0.5 flex-1 ${index < currentIndex ? 'bg-dark-gold' : 'bg-stone-200'}`}
            aria-hidden="true"
          />
        )}
      </div>

      <div className={`pb-6 ${isLast ? 'pb-0' : ''}`}>
        <p
          className={`text-sm font-semibold ${
            state === 'upcoming' ? 'text-stone-400' : 'text-ink'
          }`}
        >
          {stage.label}
          {state === 'current' && (
            <span className="ml-2 rounded-full bg-light-gold px-2 py-0.5 text-xs font-medium text-dark-gold">
              Current
            </span>
          )}
        </p>
        <p
          className={`mt-0.5 text-sm ${
            state === 'upcoming' ? 'text-stone-400' : 'text-stone-600'
          }`}
        >
          {stage.description}
        </p>
      </div>
    </li>
  );
}

export default function TrackingPage() {
  const params = useParams<{ orderId: string }>();
  const orderId = typeof params?.orderId === 'string' ? params.orderId : '';

  const storedOrder = useOrderStore((state) => state.currentOrder);

  const [order, setOrder] = useState<Order | null>(
    storedOrder?.id === orderId ? storedOrder : null
  );
  const [isLoading, setIsLoading] = useState(storedOrder?.id !== orderId);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  // Kept in a ref so the auto-refresh effect does not restart on every tick.
  const isFetching = useRef(false);
  const delivered = isDelivered(order?.status);

  const load = useCallback(
    async (silent = false) => {
      if (!orderId) {
        setError('That tracking link is not valid.');
        setIsLoading(false);
        return;
      }

      if (isFetching.current) return;
      isFetching.current = true;

      if (silent) {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
        setError(null);
      }

      try {
        setOrder(await getOrderTracking(orderId));
        setLastUpdated(new Date().toISOString());
        setError(null);
      } catch (caught) {
        const message = ApiError.from(caught).message;

        if (silent) {
          toast.error(message);
        } else {
          setError(message);
        }
      } finally {
        isFetching.current = false;
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [orderId]
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (delivered) return;

    const timer = setInterval(() => {
      void load(true);
    }, AUTO_REFRESH_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [delivered, load]);

  if (isLoading) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
        <TrackingSkeleton />
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-16 text-center sm:px-6">
        <div role="alert" className="alert-error flex flex-col items-start gap-3 text-left">
          <div>
            <p className="font-semibold">We could not load this tracking page</p>
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

  const currentIndex = trackingStageIndex(order.status);
  const riderVisible = hasRider(order.status, order.rider);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <ErrorBoundary title="Tracking failed to load">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-ink sm:text-3xl">Track your order</h1>
            <p className="mt-1 text-sm text-stone-500">
              Reference{' '}
              <span className="rounded bg-light-gold px-2 py-0.5 font-mono font-semibold text-dark-gold">
                {order.reference}
              </span>
            </p>
          </div>

          <button
            type="button"
            onClick={() => void load(true)}
            disabled={isRefreshing}
            className="btn btn-outline flex-none"
            aria-label="Refresh tracking status"
          >
            <HiOutlineRefresh
              className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
            {isRefreshing ? 'Refreshing...' : 'Refresh'}
          </button>
        </header>

        <section className="card mt-6 p-5 sm:p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-stone-500">Status</p>
              <p className="mt-0.5 text-lg font-bold text-dark-gold">
                {STATUS_LABELS[order.status] || order.status}
              </p>
            </div>
            <HiOutlineTruck className="h-8 w-8 flex-none text-dark-gold" aria-hidden="true" />
          </div>

          {lastUpdated && (
            <p aria-live="polite" className="mt-2 text-xs text-stone-400">
              Last updated {formatDateTime(lastUpdated)}
              {!delivered && ` - refreshing every ${AUTO_REFRESH_INTERVAL_MS / 1000}s`}
            </p>
          )}

          <ol className="mt-6 flex flex-col">
            {TRACKING_STAGES.map((stage, index) => (
              <TimelineStage
                key={stage.status}
                stage={stage}
                index={index}
                currentIndex={currentIndex}
                isLast={index === TRACKING_STAGES.length - 1}
              />
            ))}
          </ol>
        </section>

        {riderVisible && order.rider && (
          <section className="card mt-4 p-5">
            <h2 className="text-base font-semibold text-ink">Your rider</h2>

            <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-full bg-light-gold text-sm font-bold text-dark-gold">
                  {order.rider.name.trim().charAt(0).toUpperCase()}
                </span>
                <div>
                  <p className="text-sm font-medium text-ink">{order.rider.name}</p>
                  {order.rider.vehicle && (
                    <p className="text-xs text-stone-500">{order.rider.vehicle}</p>
                  )}
                </div>
              </div>

              <a
                href={`tel:${order.rider.phone.replace(/[^\d+]/g, '')}`}
                className="btn btn-primary w-full sm:w-auto"
              >
                <HiOutlinePhone className="h-4 w-4" aria-hidden="true" />
                Call {order.rider.name.split(' ')[0]}
              </a>
            </div>
          </section>
        )}

        <section className="card mt-4 p-5">
          <h2 className="text-base font-semibold text-ink">Delivery details</h2>

          <div className="mt-3 flex items-start gap-3">
            <HiOutlineMap className="mt-0.5 h-5 w-5 flex-none text-dark-gold" aria-hidden="true" />
            <div className="text-sm text-stone-600">
              <p>{order.customerName}</p>
              <p>{order.deliveryAddress}, {order.deliveryArea}</p>
              <p>{order.customerPhone}</p>
            </div>
          </div>

          <p className="mt-4 border-t border-stone-200 pt-4 text-sm text-stone-600">
            {order.items.length} item{order.items.length === 1 ? '' : 's'} totalling{' '}
            <span className="font-semibold text-dark-gold">{formatCedis(order.totalPrice)}</span>
            {order.expectedDeliveryDate && ` - expected ${order.expectedDeliveryDate}`}
          </p>
        </section>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Link href={`/confirmation/${order.id}`} className="btn btn-primary w-full sm:w-auto">
            View order summary
          </Link>
          <Link href="/products" className="btn btn-outline w-full sm:w-auto">
            Continue shopping
          </Link>
        </div>
      </ErrorBoundary>
    </div>
  );
}
