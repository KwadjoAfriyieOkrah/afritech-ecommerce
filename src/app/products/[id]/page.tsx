'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ApiError, getProduct } from '@/services/api';
import type { Product } from '@/types';
import { PRODUCT_SPECS } from '@/components/admin/productSpecs';
import { formatCedis } from '@/utils/format';
import { HiChevronLeft, HiChevronRight } from 'react-icons/hi';

function getSpecsCategory(category: string): keyof typeof PRODUCT_SPECS | null {
  switch (category) {
    case 'IPHONE':
    case 'iPhone':
      return 'IPHONE';
    case 'SAMSUNG':
    case 'Samsung':
      return 'SAMSUNG';
    case 'LAPTOP':
    case 'Laptop':
      return 'LAPTOP';
    default:
      return null;
  }
}

export default function ProductDetailsPage() {
  const params = useParams<{ id: string }>();
  const id = typeof params.id === 'string' ? params.id : '';
  const [result, setResult] = useState<{
    id: string;
    product: Product | null;
    error: string | null;
  } | null>(null);
  const [gallerySelection, setGallerySelection] = useState<{ productId: string; index: number }>({ productId: '', index: 0 });
  const isLoading = Boolean(id) && result?.id !== id;
  const product = result?.id === id ? result.product : null;
  const activeIndex = gallerySelection.productId === id ? gallerySelection.index : 0;
  const error =
    id.length === 0
      ? 'Product not found.'
      : result?.id === id
        ? result.error
        : null;

  useEffect(() => {
    if (!id) return;
    let active = true;

    void getProduct(id)
      .then((loaded) => {
        if (active) setResult({ id, product: loaded, error: null });
      })
      .catch((caught: unknown) => {
        if (active) {
          setResult({
            id,
            product: null,
            error: ApiError.from(caught).message,
          });
        }
      });

    return () => {
      active = false;
    };
  }, [id]);

  if (isLoading) {
    return (
      <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6" role="status">
        <p className="text-sm text-stone-500">Loading product details...</p>
      </div>
    );
  }

  if (error || !product) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6">
        <div role="alert" className="alert-error flex flex-col items-start gap-3">
          <p>{error ?? 'Product not found.'}</p>
          <Link href="/products" className="btn btn-outline">
            Back to products
          </Link>
        </div>
      </div>
    );
  }

  const gallery = product.images?.length
    ? product.images
    : product.image
      ? [product.image]
      : [];
  const safeIndex = Math.min(activeIndex, Math.max(gallery.length - 1, 0));
  const specsCategory = getSpecsCategory(product.category);
  const specFields = specsCategory ? PRODUCT_SPECS[specsCategory] : [];
  const hasSpecs = specFields.some(
    (field) => Boolean(product.specs?.[field.key]?.trim()),
  );

  return (
    <article className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <Link
        href="/products"
        className="text-sm font-medium text-dark-gold underline underline-offset-2"
      >
        Back to products
      </Link>

      <div className="mt-5 grid gap-8 md:grid-cols-2">
        <div className="flex flex-col gap-3">
          <div className="relative flex aspect-square items-center justify-center overflow-hidden rounded-xl bg-stone-50">
            {gallery.length === 0 ? (
              <p className="text-sm text-stone-400">No image available</p>
            ) : (
              <>
                <Image
                  src={gallery[safeIndex]}
                  alt={`${product.name}, image ${safeIndex + 1} of ${gallery.length}`}
                  fill
                  unoptimized
                  loading="eager"
                  sizes="(max-width: 768px) 100vw, 50vw"
                  className="object-contain p-6"
                />
                {gallery.length > 1 && (
                  <>
                    <button
                      type="button"
                      aria-label="Previous image"
                      onClick={() =>
                        setGallerySelection({
                          productId: id,
                          index:
                            (activeIndex - 1 + gallery.length) %
                            gallery.length,
                        })
                      }
                      className="absolute left-3 top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-ink shadow-md ring-1 ring-stone-200 transition hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-dark-gold"
                    >
                      <HiChevronLeft aria-hidden="true" className="h-5 w-5" />
                    </button>
                    <button
                      type="button"
                      aria-label="Next image"
                      onClick={() =>
                        setGallerySelection({
                          productId: id,
                          index: (activeIndex + 1) % gallery.length,
                        })
                      }
                      className="absolute right-3 top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-ink shadow-md ring-1 ring-stone-200 transition hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-dark-gold"
                    >
                      <HiChevronRight aria-hidden="true" className="h-5 w-5" />
                    </button>
                  </>
                )}
              </>
            )}
          </div>
          {gallery.length > 1 && (
            <div className="mt-4 flex gap-3 overflow-x-auto pb-2">
              {gallery.map((image, index) => (
                <button
                  key={`${image}-${index}`}
                  type="button"
                  aria-label={`Show image ${index + 1}`}
                  aria-current={index === safeIndex ? 'true' : undefined}
                  onClick={() => setGallerySelection({ productId: id, index })}
                  className={`relative h-16 w-16 flex-none overflow-hidden rounded-lg border-2 transition ${
                    index === safeIndex
                      ? 'border-dark-gold'
                      : 'border-stone-200 hover:border-stone-400'
                  }`}
                >
                  <Image
                    src={image}
                    alt=""
                    fill
                    unoptimized
                    sizes="64px"
                    className="object-contain p-1"
                  />
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-col items-start gap-4">
          <span className="badge bg-light-gold text-dark-gold">{product.category}</span>
          <h1 className="text-3xl font-bold text-ink">{product.name}</h1>
          <p className="text-2xl font-bold text-dark-gold">
            {formatCedis(product.price)}
          </p>
          <p className="text-sm leading-6 text-stone-600">
            {product.description?.trim() || 'Product description coming soon.'}
          </p>

          <section className="w-full" aria-labelledby="product-specifications">
            <h2
              id="product-specifications"
              className="text-lg font-semibold text-ink"
            >
              Specifications
            </h2>
            {!hasSpecs ? (
              <p className="mt-2 text-sm text-stone-500">Specs coming soon</p>
            ) : (
              <div className="mt-3 overflow-hidden rounded-lg border border-stone-200">
                <table className="w-full text-left text-sm">
                  <tbody className="divide-y divide-stone-200">
                    {specFields.map((field) => (
                      <tr key={field.key}>
                        <th
                          scope="row"
                          className="w-2/5 bg-stone-50 px-4 py-3 font-medium text-stone-600"
                        >
                          {field.label}
                        </th>
                        <td className="px-4 py-3 text-ink">
                          {product.specs?.[field.key]?.trim() || '\u2014'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </div>
    </article>
  );
}
