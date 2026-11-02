'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '@/services/api';
import {
  getSalesSummary,
  type AdminSalesSummary,
  type SalesTotals
} from '@/services/adminApi';
import { formatCedis } from '@/utils/format';

interface SalesCard {
  label: string;
  totals: SalesTotals;
}

export default function AdminDashboardPage() {
  const [summary, setSummary] = useState<AdminSalesSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      setSummary(await getSalesSummary(30));
    } catch (caught) {
      setSummary(null);
      setError(ApiError.from(caught).message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const cards: SalesCard[] = summary
    ? [
        { label: 'Today', totals: summary.today },
        { label: 'Last 7 days', totals: summary.last7Days },
        { label: 'Last 30 days', totals: summary.last30Days }
      ]
    : [];

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-ink">Dashboard</h2>
          <p className="text-sm text-stone-500">Sales performance for the last 30 days.</p>
        </div>

        <button
          type="button"
          onClick={() => void load()}
          disabled={isLoading}
          className="btn btn-outline px-3 py-2 text-sm"
        >
          {isLoading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div role="alert" className="alert-error flex items-center justify-between gap-3">
          <p>{error}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="btn btn-outline text-xs"
          >
            Retry
          </button>
        </div>
      )}

      {isLoading && <p className="text-sm text-stone-500">Loading sales...</p>}

      {!isLoading && !error && summary && (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            {cards.map((card) => (
              <div key={card.label} className="card p-5">
                <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">
                  {card.label}
                </p>
                <p className="mt-2 text-2xl font-bold text-ink">
                  {formatCedis(card.totals.amount)}
                </p>
                <p className="mt-1 text-sm text-stone-600">
                  {card.totals.orders} {card.totals.orders === 1 ? 'order' : 'orders'}
                </p>
              </div>
            ))}
          </div>

          {summary.totals.orders === 0 ? (
            <div className="rounded-lg border border-dashed border-stone-300 p-6">
              <p className="text-sm font-medium text-ink">No sales in this period yet</p>
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-ink">Daily sales</h3>
                  <p className="text-sm text-stone-500">Newest day first.</p>
                </div>

                <div className="card overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[620px] text-left text-sm">
                      <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
                        <tr>
                          <th className="px-4 py-3 font-semibold">Date</th>
                          <th className="px-4 py-3 text-right font-semibold">Orders</th>
                          <th className="px-4 py-3 text-right font-semibold">Quantity</th>
                          <th className="px-4 py-3 text-right font-semibold">Revenue</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-stone-100">
                        {summary.byDay.map((day) => (
                          <tr key={day.date} className="hover:bg-stone-50">
                            <td className="px-4 py-3 font-medium text-ink">{day.date}</td>
                            <td className="px-4 py-3 text-right text-stone-600">
                              {day.orders}
                            </td>
                            <td className="px-4 py-3 text-right text-stone-600">
                              {day.quantity}
                            </td>
                            <td className="px-4 py-3 text-right font-semibold text-ink">
                              {formatCedis(day.amount)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-ink">Top products</h3>
                  <p className="text-sm text-stone-500">Ranked by revenue in this period.</p>
                </div>

                {summary.topProducts.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-stone-300 p-6">
                    <p className="text-sm font-medium text-ink">
                      No product sales in this period yet
                    </p>
                  </div>
                ) : (
                  <div className="card overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[620px] text-left text-sm">
                        <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
                          <tr>
                            <th className="px-4 py-3 font-semibold">Product</th>
                            <th className="px-4 py-3 text-right font-semibold">Quantity</th>
                            <th className="px-4 py-3 text-right font-semibold">Revenue</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-stone-100">
                          {summary.topProducts.map((product) => (
                            <tr key={product.productId} className="hover:bg-stone-50">
                              <td className="px-4 py-3 font-medium text-ink">
                                {product.name}
                              </td>
                              <td className="px-4 py-3 text-right text-stone-600">
                                {product.quantity}
                              </td>
                              <td className="px-4 py-3 text-right font-semibold text-ink">
                                {formatCedis(product.amount)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
