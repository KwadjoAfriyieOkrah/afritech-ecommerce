'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { ProductForm } from '@/components/admin/ProductForm';
import { ProductImages } from '@/components/admin/ProductImages';
import { ColourStock } from '@/components/admin/ColourStock';
import { ApiError } from '@/services/api';
import {
  listAdminProducts,
  type AdminProduct,
  type AdminProductColor
} from '@/services/adminApi';

export default function EditAdminProductPage() {
  const params = useParams<{ id: string }>();
  const productId = typeof params?.id === 'string' ? params.id : '';

  const [product, setProduct] = useState<AdminProduct | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!productId) {
      setProduct(null);
      setError('Product not found');
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const products = await listAdminProducts();
      const match = products.find((item) => item.id === productId) ?? null;
      setProduct(match);
      if (!match) setError('Product not found');
    } catch (caught) {
      setProduct(null);
      setError(ApiError.from(caught).message);
    } finally {
      setIsLoading(false);
    }
  }, [productId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleColorsChange = useCallback(
    (colors: AdminProductColor[]): void => {
      setProduct((current) => (current ? { ...current, colors } : current));
    },
    []
  );

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <div className="skeleton h-8 w-52" />
        <div className="skeleton h-64 w-full" />
      </div>
    );
  }

  if (error || !product) {
    return (
      <div className="flex flex-col gap-4">
        <div
          role="alert"
          className="alert-error flex flex-wrap items-center justify-between gap-3"
        >
          <p>{error ?? 'Product not found'}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="btn btn-outline text-xs"
          >
            Retry
          </button>
        </div>
        <Link href="/admin/products" className="btn btn-outline w-fit">
          Back to products
        </Link>
      </div>
    );
  }

  const outOfStock =
    product.colors.length > 0 &&
    product.colors.every((color) => color.stock <= 0);

  return (
    <div className="flex flex-col gap-4">
      <Link href="/admin/products" className="btn btn-ghost w-fit px-0 text-sm">
        Back to products
      </Link>
      <ProductForm key={product.id} product={product} />
      <ColourStock
        productId={product.id}
        colors={product.colors}
        onColorsChange={handleColorsChange}
      />
      {outOfStock && (
        <div
          role="status"
          className="rounded-lg border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900"
        >
          <p>
            This product is out of stock. Set stock on a colour to sell it
            again, or switch it off with Active in the storefront so it is
            hidden from customers. Nothing is deleted.
          </p>
        </div>
      )}
      <ProductImages productId={product.id} initialImages={product.images} />
    </div>
  );
}
