'use client';

import { useState } from 'react';
import type { Product } from '@/types';
import { useCartStore } from '@/store';
import { formatCedis } from '@/utils/format';
import { Modal } from '@/components/shared/Modal';

interface ProductCardProps {
  product: Product;
}

const MAX_QUANTITY = 10;

function stockLabel(stock: number): { text: string; className: string } {
  if (stock <= 0) return { text: 'Out of stock', className: 'bg-stone-100 text-stone-500' };
  if (stock <= 5) return { text: `Only ${stock} left`, className: 'bg-red-50 text-red-700' };
  return { text: 'In stock', className: 'bg-emerald-50 text-emerald-700' };
}

export function ProductCard({ product }: ProductCardProps) {
  const addToCart = useCartStore((state) => state.addToCart);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [color, setColor] = useState<string | undefined>(product.colors?.[0]);
  const [quantity, setQuantity] = useState(1);
  const [added, setAdded] = useState(false);

  const maxQuantity = Math.max(1, Math.min(MAX_QUANTITY, product.stock));
  const isOutOfStock = product.stock <= 0;
  const soldOut = product.soldOut;
  const stock = stockLabel(product.stock);
  const cannotBuy = isOutOfStock || soldOut;

  const openModal = () => {
    if (cannotBuy) return;

    setColor(product.colors?.[0]);
    setQuantity(1);
    setIsModalOpen(true);
  };

  const handleSubmit = () => {
    if (cannotBuy) return;

    addToCart({
      productId: product.id,
      name: product.name,
      price: product.price,
      color,
      quantity,
      image: product.image,
      soldOut
    });
    setIsModalOpen(false);
    setAdded(true);
    setTimeout(() => setAdded(false), 2000);
  };

  return (
    <article className="card flex flex-col overflow-hidden">
      <div className="relative aspect-square w-full bg-stone-50">
        {product.image ? (
          <img
            src={product.image}
            alt={product.name}
            loading="lazy"
            className="h-full w-full object-contain p-4"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-sm text-stone-400">
            No image
          </div>
        )}

        {soldOut && (
          <span className="badge absolute left-2 top-2 bg-stone-900 text-white">Sold out</span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-4">
        <span className="badge w-fit bg-light-gold text-dark-gold">{product.category}</span>

        <h3 className="font-semibold text-ink">{product.name}</h3>

        <p className="text-lg font-bold text-dark-gold">{formatCedis(product.price)}</p>

        <span className={`badge w-fit ${stock.className}`}>{stock.text}</span>

        <div className="mt-auto pt-2">
          <button
            type="button"
            onClick={openModal}
            disabled={cannotBuy}
            className="btn btn-primary w-full"
          >
            {soldOut ? 'Sold out' : isOutOfStock ? 'Unavailable' : 'Add to Cart'}
          </button>
          <p aria-live="polite" className="mt-2 text-center text-xs font-medium text-emerald-700">
            {added ? 'Added to cart' : ''}
          </p>
        </div>
      </div>

      <Modal isOpen={isModalOpen} title={product.name} onClose={() => setIsModalOpen(false)}>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            handleSubmit();
          }}
          className="flex flex-col gap-5"
        >
          {product.colors?.length > 0 && (
            <fieldset>
              <legend className="label">Colour</legend>
              <div className="flex flex-wrap gap-2">
                {product.colors.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setColor(option)}
                    aria-pressed={color === option}
                    className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                      color === option
                        ? 'border-dark-gold bg-light-gold text-dark-gold'
                        : 'border-stone-300 text-stone-600 hover:border-dark-gold'
                    }`}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </fieldset>
          )}

          <div>
            <span className="label">Quantity</span>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setQuantity((value) => Math.max(1, value - 1))}
                disabled={quantity <= 1}
                aria-label="Decrease quantity"
                className="btn btn-outline h-10 w-10 px-0 py-0"
              >
                <span aria-hidden="true">&minus;</span>
              </button>

              <output
                aria-live="polite"
                className="w-12 text-center text-base font-semibold text-ink"
              >
                {quantity}
              </output>

              <button
                type="button"
                onClick={() => setQuantity((value) => Math.min(maxQuantity, value + 1))}
                disabled={quantity >= maxQuantity}
                aria-label="Increase quantity"
                className="btn btn-outline h-10 w-10 px-0 py-0"
              >
                <span aria-hidden="true">+</span>
              </button>

              <span className="text-xs text-stone-500">Max {maxQuantity}</span>
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-stone-200 pt-4">
            <span className="text-sm text-stone-600">Total</span>
            <span className="font-bold text-dark-gold">
              {formatCedis(product.price * quantity)}
            </span>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setIsModalOpen(false)}
              className="btn btn-outline flex-1"
            >
              Cancel
            </button>
            <button type="submit" className="btn btn-primary flex-1">
              Add to Cart
            </button>
          </div>
        </form>
      </Modal>
    </article>
  );
}