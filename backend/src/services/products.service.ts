import { ProductCategory } from "@prisma/client";

import { prisma } from "../lib/prisma";
import type { ProductResponse } from "../types/products";

// Storefront catalogue. Only public fields are selected: never description,
// specs, timestamps, or any sensitive data.
const CATEGORY_LABELS: Record<ProductCategory, string> = {
  IPHONE: "iPhone",
  SAMSUNG: "Samsung",
  LAPTOP: "Laptop",
};

function isProductCategory(value: string): value is ProductCategory {
  return Object.prototype.hasOwnProperty.call(CATEGORY_LABELS, value);
}

export async function listActiveProducts(): Promise<ProductResponse[]> {
  const products = await prisma.product.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      category: true,
      basePrice: true,
      images: true,
      colors: {
        select: { name: true, stock: true },
        orderBy: { name: "asc" },
      },
    },
  });

  return products.map((product) => {
    const { category } = product;

    if (!isProductCategory(category)) {
      throw new Error(`Unknown product category: ${String(category)}`);
    }

    const stock = product.colors.reduce((total, color) => total + color.stock, 0);

    return {
      id: product.id,
      name: product.name,
      category: CATEGORY_LABELS[category],
      price: Number(product.basePrice),
      stock,
      colors: product.colors.map((color) => color.name),
      image: product.images[0] ?? null,
      soldOut: stock === 0,
    };
  });
}