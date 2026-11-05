'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '@/services/api';
import {
  listAdminProducts,
  type AdminProduct,
  type AdminProductCategory
} from '@/services/adminApi';
import { formatCedis } from '@/utils/format';

const CATEGORY_LABELS: Record<AdminProductCategory, string> = {
  IPHONE: 'iPhone',
  SAMSUNG: 'Samsung',
  LAPTOP: 'Laptop'
};

export default function AdminProductsPage() {
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const nextProducts = await listAdminProducts();
      setProducts(nextProducts);
      setError(null);
    } catch (caught) {
      setError(ApiError.from(caught).message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;

    void listAdminProducts()
      .then((nextProducts) => {
        if (!active) return;
        setProducts(nextProducts);
        setError(null);
      })
      .catch((caught: unknown) => {
        if (active) setError(ApiError.from(caught).message);
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-ink">Products</h2>
          <p className="text-sm text-stone-500">
            Manage the catalogue and category specs.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setIsLoading(true);
              setError(null);
              void load();
            }}
            disabled={isLoading}
            className="btn btn-outline px-3 py-2 text-sm"
          >
            {isLoading ? 'Refreshing...' : 'Refresh'}
          </button>
          <Link href="/admin/products/new" className="btn btn-primary px-3 py-2 text-sm">
            New product
          </Link>
        </div>
      </div>

      {error && (
        <div role="alert" className="alert-error flex items-center justify-between gap-3">
          <p>{error}</p>
          <button
            type="button"
            onClick={() => {
              setIsLoading(true);
              setError(null);
              void load();
            }}
            className="btn btn-outline text-xs"
          >
            Retry
          </button>
        </div>
      )}

      {isLoading && <p className="text-sm text-stone-500">Loading products...</p>}

      {!isLoading && !error && products.length === 0 && (
        <div className="rounded-lg border border-dashed border-stone-300 p-6">
          <p className="text-sm font-medium text-ink">No products yet</p>
          <Link
            href="/admin/products/new"
            className="mt-2 inline-block text-sm font-semibold text-dark-gold hover:underline"
          >
            Create the first product
          </Link>
        </div>
      )}

      {products.length > 0 && (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">Name</th>
                  <th className="px-4 py-3 font-semibold">Category</th>
                  <th className="px-4 py-3 text-right font-semibold">Base price</th>
                  <th className="px-4 py-3 text-right font-semibold">Stock</th>
                  <th className="px-4 py-3 text-right font-semibold">Images</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {products.map((product) => {
                  const totalStock = product.colors.reduce(
                    (sum, color) => sum + color.stock,
                    0
                  );
                  const hasColors = product.colors.length > 0;
                  const status = !product.isActive
                    ? {
                        label: 'Hidden',
                        className: 'bg-stone-200 text-stone-700'
                      }
                    : !hasColors
                      ? {
                          label: 'No stock set',
                          className: 'bg-amber-100 text-amber-800'
                        }
                      : totalStock === 0
                        ? {
                            label: 'Sold out',
                            className: 'bg-red-100 text-red-800'
                          }
                        : {
                            label: 'In stock',
                            className: 'bg-green-100 text-green-800'
                          };

                  return (
                    <tr key={product.id} className="hover:bg-stone-50">
                      <td className="px-4 py-3">
                        <Link
                          href={`/admin/products/${product.id}`}
                          className="font-semibold text-ink hover:text-dark-gold hover:underline"
                        >
                          {product.name}
                        </Link>
                        <p className="text-xs text-stone-500">{product.brand}</p>
                      </td>
                      <td className="px-4 py-3 text-stone-600">
                        {CATEGORY_LABELS[product.category]}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-ink">
                        {formatCedis(Number(product.basePrice))}
                      </td>
                      <td className="px-4 py-3 text-right text-stone-600">
                        {totalStock}
                      </td>
                      <td className="px-4 py-3 text-right text-stone-600">
                        {product.images.length}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`badge ${status.className}`}>
                          {status.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          href={`/admin/products/${product.id}`}
                          className="text-sm font-semibold text-dark-gold hover:underline"
                        >
                          Edit
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
