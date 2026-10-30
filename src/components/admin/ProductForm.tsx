'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { ApiError } from '@/services/api';
import {
  createAdminProduct,
  updateAdminProduct,
  type AdminProduct,
  type AdminProductCategory,
  type AdminProductInput,
  type ProductSpecs
} from '@/services/adminApi';
import { PRODUCT_CATEGORIES, PRODUCT_SPECS } from './productSpecs';

interface ProductFormProps {
  product?: AdminProduct;
}

const BASE_FIELDS = new Set([
  'name',
  'brand',
  'category',
  'description',
  'basePrice',
  'isActive',
  'specs'
]);

const ERROR_CLASS = 'border-red-400 focus:border-red-500';

function isProductCategory(value: string): value is AdminProductCategory {
  return value === 'IPHONE' || value === 'SAMSUNG' || value === 'LAPTOP';
}

function parseFieldError(
  message: string
): { field: string; message: string } | null {
  const separator = message.indexOf(': ');
  if (separator <= 0) return null;

  const field = message.slice(0, separator).trim();
  if (!/^[A-Za-z][A-Za-z0-9_.]*$/.test(field)) return null;

  return { field, message: message.slice(separator + 2) };
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;

  return (
    <p id={id} className="mt-1 text-xs font-medium text-red-600">
      {message}
    </p>
  );
}

export function ProductForm({ product }: ProductFormProps) {
  const router = useRouter();
  const [name, setName] = useState(product?.name ?? '');
  const [brand, setBrand] = useState(product?.brand ?? '');
  const [category, setCategory] = useState<AdminProductCategory>(
    product?.category ?? 'IPHONE'
  );
  const [description, setDescription] = useState(product?.description ?? '');
  const [basePrice, setBasePrice] = useState(product?.basePrice ?? '');
  const [isActive, setIsActive] = useState(product?.isActive ?? true);
  const [specs, setSpecs] = useState<ProductSpecs>(() => product?.specs ?? {});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [categoryNotice, setCategoryNotice] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const specFields = PRODUCT_SPECS[category];
  const categoryLabel =
    PRODUCT_CATEGORIES.find((item) => item.value === category)?.label ?? category;

  const clearFieldError = (field: string): void => {
    setFieldErrors((current) => {
      if (!(field in current)) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  };

  const handleCategoryChange = (next: AdminProductCategory): void => {
    if (next === category) return;

    setCategory(next);
    setSpecs({});
    setFieldErrors({});
    setGeneralError(null);
    setCategoryNotice('Category changed. The spec fields were cleared.');
  };

  const handleSpecChange = (key: string, value: string): void => {
    setSpecs((current) => ({ ...current, [key]: value }));
    clearFieldError(key);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSaving) return;

    setFieldErrors({});
    setGeneralError(null);
    setCategoryNotice(null);

    const specPayload: ProductSpecs = {};
    for (const field of specFields) {
      specPayload[field.key] = (specs[field.key] ?? '').trim();
    }

    const price = basePrice.trim();
    const normalizedPrice =
      price !== '' && Number.isFinite(Number(price))
        ? Number(price).toFixed(2)
        : price;

    const input: AdminProductInput = {
      name: name.trim(),
      brand: brand.trim(),
      category,
      description: description.trim(),
      basePrice: normalizedPrice,
      isActive,
      specs: specPayload
    };

    setIsSaving(true);

    try {
      if (product) {
        await updateAdminProduct(product.id, input);
      } else {
        await createAdminProduct(input);
      }
      router.push('/admin/products');
      router.refresh();
    } catch (caught) {
      const apiError = ApiError.from(caught);
      const parsed = parseFieldError(apiError.message);
      const isSpecField =
        parsed !== null &&
        specFields.some((field) => field.key === parsed.field);

      if (parsed && (BASE_FIELDS.has(parsed.field) || isSpecField)) {
        setFieldErrors({ [parsed.field]: parsed.message });
      } else {
        setGeneralError(apiError.message);
      }
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="card flex flex-col gap-5 p-5 sm:p-6"
    >
      <div>
        <h2 className="text-xl font-bold text-ink">
          {product ? 'Edit product' : 'New product'}
        </h2>
        <p className="text-sm text-stone-500">
          {product
            ? 'Update the product details and category specs.'
            : 'Add a product with the specs for its category.'}
        </p>
      </div>

      {generalError && (
        <div role="alert" className="alert-error">
          {generalError}
        </div>
      )}

      {categoryNotice && (
        <div
          role="status"
          className="rounded-lg bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800"
        >
          {categoryNotice}
        </div>
      )}

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="name" className="label">
            Name
          </label>
          <input
            id="name"
            type="text"
            className={`input ${fieldErrors.name ? ERROR_CLASS : ''}`}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              clearFieldError('name');
            }}
            aria-invalid={Boolean(fieldErrors.name)}
            aria-describedby={fieldErrors.name ? 'name-error' : undefined}
          />
          <FieldError id="name-error" message={fieldErrors.name} />
        </div>

        <div>
          <label htmlFor="brand" className="label">
            Brand
          </label>
          <input
            id="brand"
            type="text"
            className={`input ${fieldErrors.brand ? ERROR_CLASS : ''}`}
            value={brand}
            onChange={(event) => {
              setBrand(event.target.value);
              clearFieldError('brand');
            }}
            aria-invalid={Boolean(fieldErrors.brand)}
            aria-describedby={fieldErrors.brand ? 'brand-error' : undefined}
          />
          <FieldError id="brand-error" message={fieldErrors.brand} />
        </div>

        <div>
          <label htmlFor="category" className="label">
            Category
          </label>
          <select
            id="category"
            className={`input ${fieldErrors.category ? ERROR_CLASS : ''}`}
            value={category}
            onChange={(event) => {
              const next = event.target.value;
              if (isProductCategory(next)) handleCategoryChange(next);
            }}
            aria-invalid={Boolean(fieldErrors.category)}
            aria-describedby={
              fieldErrors.category ? 'category-error' : undefined
            }
          >
            {PRODUCT_CATEGORIES.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
          <FieldError id="category-error" message={fieldErrors.category} />
        </div>

        <div>
          <label htmlFor="basePrice" className="label">
            Base price (GHS)
          </label>
          <input
            id="basePrice"
            type="number"
            min="0.01"
            step="0.01"
            className={`input ${fieldErrors.basePrice ? ERROR_CLASS : ''}`}
            value={basePrice}
            onChange={(event) => {
              setBasePrice(event.target.value);
              clearFieldError('basePrice');
            }}
            aria-invalid={Boolean(fieldErrors.basePrice)}
            aria-describedby={
              fieldErrors.basePrice ? 'basePrice-error' : undefined
            }
          />
          <FieldError id="basePrice-error" message={fieldErrors.basePrice} />
        </div>

        <div className="sm:col-span-2">
          <label htmlFor="description" className="label">
            Description
          </label>
          <textarea
            id="description"
            rows={3}
            className={`input resize-y ${
              fieldErrors.description ? ERROR_CLASS : ''
            }`}
            value={description}
            onChange={(event) => {
              setDescription(event.target.value);
              clearFieldError('description');
            }}
            aria-invalid={Boolean(fieldErrors.description)}
            aria-describedby={
              fieldErrors.description ? 'description-error' : undefined
            }
          />
          <FieldError id="description-error" message={fieldErrors.description} />
        </div>

        <div className="sm:col-span-2">
          <label className="flex items-center gap-2 text-sm font-medium text-ink">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(event) => setIsActive(event.target.checked)}
              className="h-4 w-4 rounded border-stone-300"
            />
            Active in the storefront
          </label>
        </div>
      </div>

      <section className="flex flex-col gap-4 border-t border-stone-200 pt-5">
        <div>
          <h3 className="text-base font-semibold text-ink">
            {categoryLabel} specs
          </h3>
          <p className="text-sm text-stone-500">
            Only the fields for the selected category are sent.
          </p>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          {specFields.map((field) => {
            const inputId = `spec-${field.key}`;
            const errorId = `${inputId}-error`;
            const error = fieldErrors[field.key];

            return (
              <div key={field.key}>
                <label htmlFor={inputId} className="label">
                  {field.label}
                </label>
                {field.type === 'select' ? (
                  <select
                    id={inputId}
                    className={`input ${error ? ERROR_CLASS : ''}`}
                    value={specs[field.key] ?? ''}
                    onChange={(event) =>
                      handleSpecChange(field.key, event.target.value)
                    }
                    aria-invalid={Boolean(error)}
                    aria-describedby={error ? errorId : undefined}
                  >
                    <option value="">Select {field.label.toLowerCase()}</option>
                    {(field.options ?? []).map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    id={inputId}
                    type="text"
                    maxLength={field.maxLength}
                    placeholder={field.placeholder}
                    className={`input ${error ? ERROR_CLASS : ''}`}
                    value={specs[field.key] ?? ''}
                    onChange={(event) =>
                      handleSpecChange(field.key, event.target.value)
                    }
                    aria-invalid={Boolean(error)}
                    aria-describedby={error ? errorId : undefined}
                  />
                )}
                <FieldError id={errorId} message={error} />
              </div>
            );
          })}
        </div>

        <FieldError id="specs-error" message={fieldErrors.specs} />
      </section>

      <div className="flex flex-wrap items-center justify-end gap-3 border-t border-stone-200 pt-5">
        <Link href="/admin/products" className="btn btn-outline">
          Cancel
        </Link>
        <button type="submit" disabled={isSaving} className="btn btn-primary">
          {isSaving
            ? 'Saving...'
            : product
              ? 'Save changes'
              : 'Create product'}
        </button>
      </div>
    </form>
  );
}
