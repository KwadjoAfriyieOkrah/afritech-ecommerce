import { ProductCategory } from "../src/generated/prisma/client";
import { prisma } from "../src/lib/prisma";

// Product.name is not unique in the schema, so a true upsert has no natural
// key to target. Find-or-create keeps the seed idempotent by name.
async function upsertProduct(input: {
  name: string;
  brand: string;
  category: ProductCategory;
  basePrice: string;
  description: string;
}): Promise<{ id: string }> {
  const existing = await prisma.product.findFirst({
    where: { name: input.name },
    select: { id: true },
  });

  if (existing) {
    return existing;
  }

  return prisma.product.create({
    data: {
      name: input.name,
      brand: input.brand,
      category: input.category,
      description: input.description,
      basePrice: input.basePrice,
      images: [],
    },
    select: { id: true },
  });
}

async function upsertColor(input: {
  productId: string;
  name: string;
  hex: string;
  stock: number;
}): Promise<void> {
  await prisma.color.upsert({
    where: {
      productId_name: { productId: input.productId, name: input.name },
    },
    update: { stock: input.stock, hex: input.hex },
    create: input,
  });
}

async function upsertDeliveryZone(input: {
  name: string;
  fee: string;
  expectedDays: number;
  isActive: boolean;
}): Promise<void> {
  await prisma.deliveryZone.upsert({
    where: { name: input.name },
    update: {
      fee: input.fee,
      expectedDays: input.expectedDays,
      isActive: input.isActive,
    },
    create: input,
  });
}

async function main(): Promise<void> {
  await upsertDeliveryZone({ name: "Accra", fee: "20.00", expectedDays: 1, isActive: true });
  await upsertDeliveryZone({ name: "Tema", fee: "30.00", expectedDays: 1, isActive: true });
  await upsertDeliveryZone({ name: "Kumasi", fee: "50.00", expectedDays: 3, isActive: true });
  await upsertDeliveryZone({ name: "Cape Coast", fee: "50.00", expectedDays: 3, isActive: true });
  await upsertDeliveryZone({ name: "Tamale", fee: "80.00", expectedDays: 3, isActive: true });
  await upsertDeliveryZone({
    name: "Other regions",
    fee: "80.00",
    expectedDays: 3,
    isActive: true,
  });

  const iphone = await upsertProduct({
    name: "iPhone 15 Pro",
    brand: "Apple",
    category: ProductCategory.IPHONE,
    basePrice: "14299.00",
    description: "Apple flagship iPhone with titanium frame and A17 Pro chip.",
  });

  await upsertColor({
    productId: iphone.id,
    name: "Natural Titanium",
    hex: "#e3e1dc",
    stock: 12,
  });
  await upsertColor({
    productId: iphone.id,
    name: "Black Titanium",
    hex: "#42414d",
    stock: 15,
  });

  const samsung = await upsertProduct({
    name: "Samsung Galaxy S24",
    brand: "Samsung",
    category: ProductCategory.SAMSUNG,
    basePrice: "8499.00",
    description: "Samsung flagship with Galaxy AI and a 6.2in flat display.",
  });

  await upsertColor({
    productId: samsung.id,
    name: "Onyx Black",
    hex: "#1f2022",
    stock: 18,
  });
  await upsertColor({
    productId: samsung.id,
    name: "Cobalt Violet",
    hex: "#8e8cd8",
    stock: 10,
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    // eslint-disable-next-line no-console
    console.error("Seeding failed:", error);
    await prisma.$disconnect();
    process.exit(1);
  });