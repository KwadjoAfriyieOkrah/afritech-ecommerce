'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, fetchProducts } from '@/services/api';
import type { Product } from '@/types';
import { formatCedis } from '@/utils/format';
import { ProductCard } from '@/components/products/ProductCard';
import { ErrorBoundary } from '@/components/shared/ErrorBoundary';

const FALLBACK_MAX_PRICE = 10000;

function ProductCardSkeleton() {
  return (
    <div className="card overflow-hidden">
      <div className="skeleton aspect-square w-full rounded-none" />
      <div className="flex flex-col gap-2 p-4">
        <div className="skeleton h-4 w-16" />
        <div className="skeleton h-5 w-full" />
        <div className="skeleton h-6 w-24" />
        <div className="skeleton h-9 w-full" />
      </div>
    </div>
  );
}

export function ProductListing() {
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState('all');
  const [minPrice, setMinPrice] = useState(0);
  const [maxPrice, setMaxPrice] = useState(FALLBACK_MAX_PRICE);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const data = await fetchProducts();
      setProducts(Array.isArray(data) ? data : []);
    } catch (caught) {
      setError(ApiError.from(caught).message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const categories = useMemo(() => {
    const unique = new Set(products.map((product) => product.category).filter(Boolean));
    return Array.from(unique).sort();
  }, [products]);

  const priceBounds = useMemo(() => {
    if (products.length === 0) return { min: 0, max: FALLBACK_MAX_PRICE };
    const prices = products.map((product) => product.price);
    return { min: Math.floor(Math.min(...prices)), max: Math.ceil(Math.max(...prices)) };
  }, [products]);

  useEffect(() => {
    setMinPrice(priceBounds.min);
    setMaxPrice(priceBounds.max);
  }, [priceBounds.min, priceBounds.max]);

  const visibleProducts = useMemo(
    () =>
      products.filter((product) => {
        const matchesCategory = category === 'all' || product.category === category;
        const matchesPrice = product.price >= minPrice && product.price <= maxPrice;
        return matchesCategory && matchesPrice;
      }),
    [products, category, minPrice, maxPrice]
  );

  return (
    <section className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
      <ErrorBoundary title="Could not load products">
        <div className="mb-6 flex flex-col gap-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="w-full sm:max-w-xs">
              <label htmlFor="category" className="label">
                Category
              </label>
              <select
                id="category"
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                disabled={isLoading}
                className="input"
              >
                <option value="all">All categories</option>
                {categories.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </div>

            <div className="w-full sm:max-w-xs">
              <label htmlFor="price-range" className="label">
                Max price: <span className="font-bold text-dark-gold">{formatCedis(maxPrice)}</span>
              </label>
              <input
                id="price-range"
                type="range"
                min={priceBounds.min}
                max={priceBounds.max}
                step={1}
                value={maxPrice}
                onChange={(event) => setMaxPrice(Number(event.target.value))}
                disabled={isLoading}
                className="w-full accent-dark-gold"
              />
              <p className="mt-1 text-xs text-stone-500">
                From {formatCedis(priceBounds.min)}
              </p>
            </div>
          </div>

          {!isLoading && !error && (
            <p className="text-sm text-stone-500">
              Showing {visibleProducts.length} of {products.length} products
            </p>
          )}
        </div>

        {isLoading && (
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {Array.from({ length: 8 }).map((_, index) => (
              <ProductCardSkeleton key={index} />
            ))}
          </div>
        )}

        {!isLoading && error && (
          <div role="alert" className="alert-error flex flex-col items-start gap-3">
            <p>{error}</p>
            <button type="button" onClick={() => void load()} className="btn btn-outline">
              Retry
            </button>
          </div>
        )}

        {!isLoading && !error && visibleProducts.length === 0 && (
          <div className="card p-10 text-center">
            <p className="font-semibold text-ink">No products match your filters</p>
            <button
              type="button"
              onClick={() => {
                setCategory('all');
                setMinPrice(priceBounds.min);
                setMaxPrice(priceBounds.max);
              }}
              className="btn btn-ghost mt-2"
            >
              Clear filters
            </button>
          </div>
        )}

        {!isLoading && !error && visibleProducts.length > 0 && (
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {visibleProducts.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        )}
      </ErrorBoundary>
    </section>
  );
}