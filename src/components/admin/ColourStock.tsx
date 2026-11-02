'use client';

import { useState, type ChangeEvent } from 'react';
import { ApiError } from '@/services/api';
import {
  restockColor,
  type AdminProductColor
} from '@/services/adminApi';

interface ColourStockProps {
  productId: string;
  colors: AdminProductColor[];
  onColorsChange: (colors: AdminProductColor[]) => void;
}

export function ColourStock({
  productId,
  colors,
  onColorsChange
}: ColourStockProps) {
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [busyColorId, setBusyColorId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleQuantityChange = (
    colorId: string,
    event: ChangeEvent<HTMLInputElement>
  ): void => {
    const value = event.target.value;
    setQuantities((current) => ({ ...current, [colorId]: value }));
  };

  const handleSetStock = async (color: AdminProductColor): Promise<void> => {
    if (busyColorId !== null) return;

    const raw = (quantities[color.id] ?? '').trim();
    const quantity = Number(raw);
    if (raw === '' || !Number.isInteger(quantity) || quantity < 1) {
      setError('Enter a whole number greater than 0.');
      return;
    }

    setError(null);
    setBusyColorId(color.id);

    try {
      const result = await restockColor(productId, color.id, quantity);
      onColorsChange(
        colors.map((item) =>
          item.id === result.color.id ? result.color : item
        )
      );
      setQuantities((current) => ({ ...current, [color.id]: '' }));
    } catch (caught) {
      setError(ApiError.from(caught).message);
    } finally {
      setBusyColorId(null);
    }
  };

  return (
    <section className="card flex flex-col gap-4 p-5 sm:p-6">
      <div>
        <h2 className="text-xl font-bold text-ink">Colour stock</h2>
        <p className="text-sm text-stone-500">
          Add stock to a colour. Every change is recorded through the restock route.
        </p>
      </div>

      {error && (
        <div role="alert" className="alert-error">
          <p>{error}</p>
        </div>
      )}

      {colors.length === 0 ? (
        <p className="text-sm text-stone-500">
          No colours yet. Add a colour before this product can sell.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-stone-100">
          {colors.map((color) => (
            <li
              key={color.id}
              className="flex flex-wrap items-end justify-between gap-3 py-3 first:pt-0 last:pb-0"
            >
              <div>
                <p className="font-medium text-ink">{color.name}</p>
                <p className="text-sm text-stone-500">
                  Current stock: {color.stock}
                </p>
              </div>

              <div className="flex items-end gap-2">
                <div>
                  <label htmlFor={`stock-${color.id}`} className="label">
                    Quantity to add
                  </label>
                  <input
                    id={`stock-${color.id}`}
                    type="number"
                    min="1"
                    step="1"
                    value={quantities[color.id] ?? ''}
                    onChange={(event) =>
                      handleQuantityChange(color.id, event)
                    }
                    disabled={busyColorId !== null}
                    className="input w-28"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => void handleSetStock(color)}
                  disabled={busyColorId !== null}
                  className="btn btn-outline px-3 py-2 text-sm"
                >
                  {busyColorId === color.id ? 'Saving...' : 'Set stock'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
