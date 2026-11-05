'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '@/services/api';
import {
  listAdminOrders,
  type AdminFulfillmentStatus,
  type AdminOrderListItem
} from '@/services/adminApi';
import { formatCedis, formatDateTime } from '@/utils/format';

type OrderFilter = 'ALL' | AdminFulfillmentStatus;

const FILTERS: Array<{ label: string; value: OrderFilter }> = [
  { label: 'All', value: 'ALL' },
  { label: 'Pending', value: 'PENDING' },
  { label: 'Packaging', value: 'PACKAGING' },
  { label: 'Dispatched', value: 'DISPATCHED' },
  { label: 'Delivered', value: 'DELIVERED' }
];

const STATUS_LABELS: Record<AdminFulfillmentStatus, string> = {
  PENDING: 'Pending',
  PACKAGING: 'Packaging',
  DISPATCHED: 'Dispatched',
  DELIVERED: 'Delivered'
};

const STATUS_BADGES: Record<AdminFulfillmentStatus, string> = {
  PENDING: 'bg-stone-100 text-stone-600',
  PACKAGING: 'bg-amber-100 text-amber-800',
  DISPATCHED: 'bg-sky-100 text-sky-800',
  DELIVERED: 'bg-green-100 text-green-800'
};

export default function AdminOrdersPage() {
  const [filter, setFilter] = useState<OrderFilter>('ALL');
  const [result, setResult] = useState<{
    filter: OrderFilter;
    orders: AdminOrderListItem[];
    error: string | null;
  } | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const orders = result?.filter === filter ? result.orders : [];
  const error = result?.filter === filter ? result.error : null;
  const isLoading = isRefreshing || result?.filter !== filter;

  const load = useCallback(async () => {
    try {
      const nextOrders = await listAdminOrders(filter === 'ALL' ? undefined : filter);
      setResult({ filter, orders: nextOrders, error: null });
    } catch (caught) {
      setResult({
        filter,
        orders: [],
        error: ApiError.from(caught).message,
      });
    } finally {
      setIsRefreshing(false);
    }
  }, [filter]);

  useEffect(() => {
    let active = true;

    void listAdminOrders(filter === 'ALL' ? undefined : filter)
      .then((nextOrders) => {
        if (!active) return;
        setResult({ filter, orders: nextOrders, error: null });
      })
      .catch((caught: unknown) => {
        if (active) {
          setResult({
            filter,
            orders: [],
            error: ApiError.from(caught).message,
          });
        }
      })

    return () => {
      active = false;
    };
  }, [filter]);

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-ink">Orders</h2>
          <p className="text-sm text-stone-500">Fulfil paid orders in the order they arrive.</p>
        </div>

        <button
          type="button"
          onClick={() => {
            setIsRefreshing(true);
            void load();
          }}
          disabled={isLoading}
          className="btn btn-outline px-3 py-2 text-sm"
        >
          {isLoading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      <div className="flex flex-wrap gap-2" aria-label="Filter orders by fulfillment">
        {FILTERS.map((item) => (
          <button
            key={item.value}
            type="button"
            aria-pressed={filter === item.value}
            onClick={() => setFilter(item.value)}
            className={`btn px-3 py-1.5 text-xs ${
              filter === item.value ? 'btn-primary' : 'btn-outline'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {error && (
        <div role="alert" className="alert-error flex items-center justify-between gap-3">
          <p>{error}</p>
          <button
            type="button"
            onClick={() => {
              setIsRefreshing(true);
              void load();
            }}
            className="btn btn-outline text-xs"
          >
            Retry
          </button>
        </div>
      )}

      {isLoading && <p className="text-sm text-stone-500">Loading orders...</p>}

      {!isLoading && !error && orders.length === 0 && (
        <div className="rounded-lg border border-dashed border-stone-300 p-6">
          <p className="text-sm font-medium text-ink">No orders</p>
        </div>
      )}

      {orders.length > 0 && (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">Reference</th>
                  <th className="px-4 py-3 font-semibold">Customer</th>
                  <th className="px-4 py-3 font-semibold">Delivery area</th>
                  <th className="px-4 py-3 text-right font-semibold">Total</th>
                  <th className="px-4 py-3 font-semibold">Fulfillment</th>
                  <th className="px-4 py-3 font-semibold">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {orders.map((order) => (
                  <tr key={order.id} className="hover:bg-stone-50">
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/orders/${order.id}`}
                        className="font-mono text-sm font-semibold text-dark-gold hover:underline"
                      >
                        {order.reference}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-ink">{order.customerName}</td>
                    <td className="px-4 py-3 text-stone-600">{order.deliveryArea}</td>
                    <td className="px-4 py-3 text-right font-semibold text-ink">
                      {formatCedis(order.total)}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`badge ${STATUS_BADGES[order.fulfillment]}`}>
                        {STATUS_LABELS[order.fulfillment]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-stone-600">
                      {formatDateTime(order.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
