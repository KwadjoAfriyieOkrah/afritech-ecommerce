import { Prisma, ProductCategory } from "../generated/prisma/client";

import { prisma } from "../lib/prisma";
import type {
  AvailabilityStatus,
  ProductAvailabilityLine,
  ProductResponse,
} from "../types/products";
import type { AvailabilityLineInput } from "../validation/products.schemas";

// Storefront catalogue. Only public fields are selected; no sensitive data is
// included.
const CATEGORY_LABELS: Record<ProductCategory, string> = {
  IPHONE: "iPhone",
  SAMSUNG: "Samsung",
  LAPTOP: "Laptop",
};

function isProductCategory(value: string): value is ProductCategory {
  return Object.prototype.hasOwnProperty.call(CATEGORY_LABELS, value);
}

function productSpecs(value: Prisma.JsonValue | null): Record<string, string> | null {
  if (value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Stored product specs are not an object");
  }

  const specs: Record<string, string> = {};
  for (const [key, specValue] of Object.entries(value)) {
    if (typeof specValue !== "string") {
      throw new Error("Stored product specs contain a non-string value");
    }
    specs[key] = specValue;
  }
  return specs;
}

export async function listActiveProducts(): Promise<ProductResponse[]> {
  const products = await prisma.product.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      category: true,
      description: true,
      specs: true,
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
      images: product.images,
      soldOut: stock === 0,
      description: product.description,
      specs: productSpecs(product.specs),
    };
  });
}

function availabilityStatus(
  available: number,
  quantity: number,
  productMissingOrInactive: boolean,
  colorMissing: boolean,
): AvailabilityStatus {
  if (productMissingOrInactive || colorMissing || available === 0) {
    return "unavailable";
  }
  return available >= quantity ? "ok" : "insufficient";
}

/**
 * Advisory only, POST /orders is the authority. This never writes or reserves
 * stock. Each requested line is answered in request order, and the response
 * carries no data about any other product or colour.
 */
export async function checkProductAvailability(
  items: AvailabilityLineInput[],
): Promise<ProductAvailabilityLine[]> {
  const productIds = [...new Set(items.map((item) => item.productId))];

  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, basePrice: true, isActive: true },
  });
  const productById = new Map(products.map((product) => [product.id, product]));

  const colors = await prisma.color.findMany({
    where: {
      OR: items.map((item) => ({
        productId: item.productId,
        name: item.color,
      })),
    },
    select: { productId: true, name: true, stock: true },
  });
  const colorByKey = new Map(
    colors.map((color) => [`${color.productId}::${color.name}`, color]),
  );

  return items.map((item) => {
    const product = productById.get(item.productId);
    const productMissingOrInactive = !product || !product.isActive;
    const color = colorByKey.get(`${item.productId}::${item.color}`);
    const colorMissing = !color;

    // A missing product has no price to report, so the line falls back to
    // "0.00" and keeps the exact same shape as every other result.
    const unitPrice = new Prisma.Decimal(
      product ? product.basePrice : 0,
    ).toFixed(2);
    const available = productMissingOrInactive || colorMissing ? 0 : color.stock;

    return {
      productId: item.productId,
      color: item.color,
      quantity: item.quantity,
      unitPrice,
      available,
      status: availabilityStatus(
        available,
        item.quantity,
        productMissingOrInactive,
        colorMissing,
      ),
    };
  });
}