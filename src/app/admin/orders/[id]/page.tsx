'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '@/services/api';
import {
  assignRider,
  deliverOrder,
  dispatchOrder,
  getAdminOrder,
  listRiders,
  packageOrder,
  type AdminFulfillmentStatus,
  type AdminOrderDetail,
  type AdminPaymentStatus,
  type AdminRider
} from '@/services/adminApi';
import { formatCedis, formatDateTime } from '@/utils/format';

type Action = 'assign' | 'package' | 'dispatch' | 'deliver';

const STATUS_LABELS: Record<AdminFulfillmentStatus, string> = {
  PENDING: 'Pending',
  PACKAGING: 'Packaging',
  DISPATCHED: 'Dispatched',
  DELIVERED: 'Delivered'
};

const PAYMENT_LABELS: Record<AdminPaymentStatus, string> = {
  PENDING: 'Unpaid',
  PAID: 'Paid',
  FAILED: 'Payment failed'
};

const STATUS_BADGES: Record<AdminFulfillmentStatus, string> = {
  PENDING: 'bg-stone-100 text-stone-600',
  PACKAGING: 'bg-amber-100 text-amber-800',
  DISPATCHED: 'bg-sky-100 text-sky-800',
  DELIVERED: 'bg-green-100 text-green-800'
};

const PAYMENT_BADGES: Record<AdminPaymentStatus, string> = {
  PENDING: 'bg-stone-100 text-stone-600',
  PAID: 'bg-green-100 text-green-800',
  FAILED: 'bg-red-100 text-red-800'
};

export default function AdminOrderDetailPage() {
  const params = useParams<{ id: string }>();
  const orderId = typeof params?.id === 'string' ? params.id : '';

  const [order, setOrder] = useState<AdminOrderDetail | null>(null);
  const [riders, setRiders] = useState<AdminRider[]>([]);
  const [selectedRiderId, setSelectedRiderId] = useState('');
  const [isLoadingState, setIsLoadingState] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ridersError, setRidersError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<Action | null>(null);
  const isLoading = Boolean(orderId) && isLoadingState;

  const loadOrder = useCallback(async () => {
    if (!orderId) return;

    try {
      const next = await getAdminOrder(orderId);
      setOrder(next);
      setSelectedRiderId(next.riderId ?? '');
      setError(null);
    } catch (caught) {
      setOrder(null);
      setError(ApiError.from(caught).message);
    } finally {
      setIsLoadingState(false);
    }
  }, [orderId]);

  useEffect(() => {
    let active = true;
    if (orderId) {
      void getAdminOrder(orderId)
        .then((next) => {
          if (!active) return;
          setOrder(next);
          setSelectedRiderId(next.riderId ?? '');
          setError(null);
        })
        .catch((caught: unknown) => {
          if (!active) return;
          setOrder(null);
          setError(ApiError.from(caught).message);
        })
        .finally(() => {
          if (active) setIsLoadingState(false);
        });
    }

    void listRiders()
      .then((nextRiders) => {
        if (!active) return;
        setRiders(nextRiders);
        setRidersError(null);
      })
      .catch((caught: unknown) => {
        if (active) setRidersError(ApiError.from(caught).message);
      });

    return () => {
      active = false;
    };
  }, [orderId]);

  const refreshOrder = useCallback(async () => {
    if (!orderId) return;

    try {
      const next = await getAdminOrder(orderId);
      setOrder(next);
      setSelectedRiderId(next.riderId ?? '');
    } catch (caught) {
      setActionError(ApiError.from(caught).message);
    }
  }, [orderId]);

  const runAction = async (action: Action, request: () => Promise<unknown>) => {
    if (busyAction) return;

    setBusyAction(action);
    setActionError(null);

    try {
      await request();
    } catch (caught) {
      setActionError(ApiError.from(caught).message);
    }

    await refreshOrder();
    setBusyAction(null);
  };

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <div className="skeleton h-8 w-52" />
        <div className="skeleton h-64 w-full" />
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="flex flex-col gap-4">
        <div role="alert" className="alert-error flex flex-wrap items-center justify-between gap-3">
          <p>{error ?? 'Order not found'}</p>
          <button
            type="button"
            onClick={() => {
              setIsLoadingState(true);
              setError(null);
              void loadOrder();
            }}
            className="btn btn-outline text-xs"
          >
            Retry
          </button>
        </div>
        <Link href="/admin/orders" className="btn btn-outline w-fit">
          Back to orders
        </Link>
      </div>
    );
  }

  const subtotal = order.items.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0
  );
  const canAssign =
    order.fulfillment === 'PENDING' || order.fulfillment === 'PACKAGING';
  const canPackage = order.fulfillment === 'PENDING' && order.paymentStatus === 'PAID';
  const canDispatch =
    order.fulfillment === 'PACKAGING' &&
    order.paymentStatus === 'PAID' &&
    order.riderId !== null;
  const canDeliver = order.fulfillment === 'DISPATCHED';
  const hasButtons = canPackage || canDispatch || canDeliver;

  return (
    <div className="flex flex-col gap-4">
      <Link href="/admin/orders" className="btn btn-ghost w-fit px-0 text-sm">
        Back to orders
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">Order</p>
          <h2 className="font-mono text-xl font-bold text-ink">{order.reference}</h2>
          <p className="mt-1 text-sm text-stone-500">
            Placed {formatDateTime(order.createdAt)}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <span className={`badge ${PAYMENT_BADGES[order.paymentStatus]}`}>
            {PAYMENT_LABELS[order.paymentStatus]}
          </span>
          <span className={`badge ${STATUS_BADGES[order.fulfillment]}`}>
            {STATUS_LABELS[order.fulfillment]}
          </span>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card p-5 sm:p-6">
          <h3 className="text-base font-semibold text-ink">Items</h3>

          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[420px] text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-stone-500">
                <tr>
                  <th className="py-2 pr-3 font-semibold">Item</th>
                  <th className="py-2 pr-3 font-semibold">Colour</th>
                  <th className="py-2 pr-3 text-right font-semibold">Qty</th>
                  <th className="py-2 text-right font-semibold">Line total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {order.items.map((item) => (
                  <tr key={item.id}>
                    <td className="py-2 pr-3 text-ink">{item.name}</td>
                    <td className="py-2 pr-3 text-stone-600">{item.color}</td>
                    <td className="py-2 pr-3 text-right text-stone-600">{item.quantity}</td>
                    <td className="py-2 text-right font-medium text-ink">
                      {formatCedis(item.price * item.quantity)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex flex-col items-end gap-1 border-t border-stone-200 pt-3 text-sm">
            <div className="flex w-full max-w-xs items-center justify-between">
              <span className="text-stone-500">Subtotal</span>
              <span className="font-medium text-ink">{formatCedis(subtotal)}</span>
            </div>
            <div className="flex w-full max-w-xs items-center justify-between">
              <span className="text-stone-500">Delivery fee</span>
              <span className="font-medium text-ink">{formatCedis(order.deliveryFee)}</span>
            </div>
            <div className="flex w-full max-w-xs items-center justify-between border-t border-stone-200 pt-1 text-base">
              <span className="font-semibold text-ink">Total</span>
              <span className="font-bold text-ink">{formatCedis(order.total)}</span>
            </div>
          </div>
        </section>

        <div className="flex flex-col gap-4">
          <section className="card p-5 sm:p-6">
            <h3 className="text-base font-semibold text-ink">Customer</h3>

            <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-stone-500">Name</dt>
                <dd className="font-medium text-ink">{order.customerName}</dd>
              </div>
              <div>
                <dt className="text-stone-500">Phone</dt>
                <dd>
                  <a
                    href={`tel:${order.customerPhone}`}
                    className="font-medium text-dark-gold hover:underline"
                  >
                    {order.customerPhone}
                  </a>
                </dd>
              </div>
              <div>
                <dt className="text-stone-500">Delivery area</dt>
                <dd className="font-medium text-ink">{order.deliveryArea}</dd>
              </div>
              <div>
                <dt className="text-stone-500">Address</dt>
                <dd className="font-medium text-ink">{order.deliveryAddress}</dd>
              </div>
            </dl>
          </section>

          <section className="card p-5 sm:p-6">
            <h3 className="text-base font-semibold text-ink">Rider</h3>

            {order.rider ? (
              <p className="mt-2 text-sm text-stone-600">
                Assigned to <span className="font-semibold text-ink">{order.rider.name}</span> -{' '}
                {order.rider.phone}
              </p>
            ) : (
              <p className="mt-2 text-sm text-stone-500">No rider assigned.</p>
            )}

            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end">
              <div className="flex-1">
                <label htmlFor="rider" className="label">
                  Assign rider
                </label>
                <select
                  id="rider"
                  className="input"
                  value={selectedRiderId}
                  onChange={(event) => setSelectedRiderId(event.target.value)}
                  disabled={!canAssign || busyAction !== null}
                >
                  <option value="">Select a rider</option>
                  {riders.map((rider) => (
                    <option key={rider.id} value={rider.id}>
                      {rider.name} - {rider.phone}
                    </option>
                  ))}
                </select>
              </div>

              <button
                type="button"
                onClick={() =>
                  void runAction('assign', () => assignRider(orderId, selectedRiderId))
                }
                disabled={!canAssign || !selectedRiderId || busyAction !== null}
                className="btn btn-primary"
              >
                {busyAction === 'assign' ? 'Assigning...' : 'Assign'}
              </button>
            </div>

            {ridersError && (
              <p role="alert" className="mt-2 text-sm text-red-700">
                {ridersError}
              </p>
            )}

            {!ridersError && riders.length === 0 && (
              <p className="mt-2 text-xs text-stone-500">No active riders yet.</p>
            )}

            {!canAssign && (
              <p className="mt-2 text-xs text-stone-500">
                Rider changes are locked after dispatch.
              </p>
            )}
          </section>
        </div>
      </div>

      <section className="card p-5 sm:p-6">
        <h3 className="text-base font-semibold text-ink">Fulfillment actions</h3>
        <p className="mt-1 text-sm text-stone-500">
          Current status: {STATUS_LABELS[order.fulfillment]}
        </p>

        {actionError && (
          <div role="alert" className="alert-error mt-3">
            {actionError}
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          {canPackage && (
            <button
              type="button"
              onClick={() => void runAction('package', () => packageOrder(orderId))}
              disabled={busyAction !== null}
              className="btn btn-primary"
            >
              {busyAction === 'package' ? 'Packaging...' : 'Package'}
            </button>
          )}

          {order.fulfillment === 'PACKAGING' &&
            order.paymentStatus === 'PAID' &&
            (order.riderId ? (
              <button
                type="button"
                onClick={() => void runAction('dispatch', () => dispatchOrder(orderId))}
                disabled={busyAction !== null}
                className="btn btn-primary"
              >
                {busyAction === 'dispatch' ? 'Dispatching...' : 'Dispatch'}
              </button>
            ) : (
              <p className="text-sm text-stone-500">Assign a rider before dispatching.</p>
            ))}

          {canDeliver && (
            <button
              type="button"
              onClick={() => void runAction('deliver', () => deliverOrder(orderId))}
              disabled={busyAction !== null}
              className="btn btn-primary"
            >
              {busyAction === 'deliver' ? 'Saving...' : 'Mark delivered'}
            </button>
          )}

          {!hasButtons &&
            order.fulfillment === 'PENDING' &&
            order.paymentStatus !== 'PAID' && (
              <p className="text-sm text-stone-500">
                Payment must be confirmed before packaging.
              </p>
            )}

          {!hasButtons &&
            order.fulfillment === 'PENDING' &&
            order.paymentStatus === 'PAID' && (
              <p className="text-sm text-stone-500">No action available.</p>
            )}

          {order.fulfillment === 'DELIVERED' && (
            <p className="text-sm text-stone-500">This order is complete.</p>
          )}
        </div>
      </section>
    </div>
  );
}
