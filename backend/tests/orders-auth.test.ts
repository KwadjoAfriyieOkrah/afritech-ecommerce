import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { after, before, test } from "node:test";

// ---------------------------------------------------------------------------
// DATABASE_URL_TEST guard. Runs at module load, before any test executes and
// before any project module (and therefore any Prisma client) is loaded.
// ---------------------------------------------------------------------------
const testDatabaseUrl = process.env.DATABASE_URL_TEST;
if (!testDatabaseUrl) {
  console.error("DATABASE_URL_TEST is not set. Refusing to run.");
  process.exit(1);
}

let testDatabaseName: string;
try {
  testDatabaseName = decodeURIComponent(
    new URL(testDatabaseUrl).pathname.replace(/^\//, ""),
  );
} catch {
  console.error("DATABASE_URL_TEST is not a valid URL. Refusing to run.");
  process.exit(1);
}

if (testDatabaseName.length === 0) {
  console.error("DATABASE_URL_TEST has no database name. Refusing to run.");
  process.exit(1);
}

const FORBIDDEN_DATABASES = new Set([
  "afritech_backend",
  "afritech_migration_rehearsal",
]);
if (FORBIDDEN_DATABASES.has(testDatabaseName)) {
  console.error(
    `Refusing to run: DATABASE_URL_TEST points at "${testDatabaseName}".`,
  );
  process.exit(1);
}

// Every connection this process makes must target the test database. dotenv
// (loaded by lib/env) never overrides variables that are already set, so this
// wins over whatever backend/.env contains.
process.env.DATABASE_URL = testDatabaseUrl;
console.log(`Test database: ${testDatabaseName}`);

// Required after the override so lib/env and PrismaClient bind to the test DB.
const { prisma } = require("../src/lib/prisma") as typeof import("../src/lib/prisma");
const { env } = require("../src/lib/env") as typeof import("../src/lib/env");
const { Prisma, Role } = require("@prisma/client") as typeof import("@prisma/client");
const jwt = require("jsonwebtoken") as typeof import("jsonwebtoken");
const express = require("express") as typeof import("express");
const ordersRoutes = require("../src/routes/orders.routes") as typeof import("../src/routes/orders.routes");

// The real router, mounted on a throwaway Express app so an unauthenticated
// request exercises requireAuth exactly as it runs in production.
const app = express();
app.use(express.json());
app.use("/orders", ordersRoutes.default);

let server: Server;
let baseUrl: string;

before(async () => {
  server = app.listen(0);
  await new Promise<void>((resolve) => {
    server.once("listening", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Test server did not expose a port");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
  await prisma.$disconnect();
});

function nextSuffix(): string {
  return `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
}

function signToken(userId: string): string {
  return jwt.sign({ sub: userId, role: Role.CUSTOMER }, env.JWT_SECRET, {
    expiresIn: "7d",
  });
}

interface SeedCatalogue {
  productId: string;
  colorId: string;
  zoneId: string;
  zoneName: string;
}

function buildOrderBody(catalogue: SeedCatalogue, suffix: string) {
  return {
    customerName: "Orders Auth Test",
    customerEmail: `orders-auth-${suffix}@test.local`,
    customerPhone: "0241234567",
    deliveryArea: catalogue.zoneName,
    deliveryAddress: "12 Test Street",
    items: [{ productId: catalogue.productId, color: "Black", quantity: 1 }],
  };
}

interface CleanupIds {
  userIds?: string[];
  orderIds?: string[];
  productIds?: string[];
  colorIds?: string[];
  zoneIds?: string[];
}

// Reverse-dependency order: attempts and logs before orders, orders before
// users, logs and items before colors and products.
async function deleteTestData(ids: CleanupIds): Promise<void> {
  const orderIds = ids.orderIds ?? [];
  const userIds = ids.userIds ?? [];
  const productIds = ids.productIds ?? [];
  const colorIds = ids.colorIds ?? [];
  const zoneIds = ids.zoneIds ?? [];

  if (orderIds.length > 0) {
    await prisma.paymentAttempt.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.reconciliationEntry.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.dailySale.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.inventoryLog.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  }
  if (colorIds.length > 0) {
    await prisma.inventoryLog.deleteMany({ where: { colorId: { in: colorIds } } });
    await prisma.orderItem.deleteMany({ where: { colorId: { in: colorIds } } });
    await prisma.color.deleteMany({ where: { id: { in: colorIds } } });
  }
  if (productIds.length > 0) {
    await prisma.product.deleteMany({ where: { id: { in: productIds } } });
  }
  if (zoneIds.length > 0) {
    await prisma.deliveryZone.deleteMany({ where: { id: { in: zoneIds } } });
  }
  if (userIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
}

async function seedUser(suffix: string): Promise<string> {
  const user = await prisma.user.create({
    data: {
      name: "Orders Auth Test",
      email: `orders-auth-${suffix}@test.local`,
      passwordHash: "test-only-not-a-real-hash",
    },
    select: { id: true },
  });
  return user.id;
}

async function seedCatalogue(suffix: string): Promise<SeedCatalogue> {
  const product = await prisma.product.create({
    data: {
      name: `Auth Phone ${suffix}`,
      brand: "TestBrand",
      category: "IPHONE",
      basePrice: new Prisma.Decimal("100.00"),
      images: [],
    },
    select: { id: true },
  });
  const color = await prisma.color.create({
    data: { productId: product.id, name: "Black", stock: 10 },
    select: { id: true },
  });
  const zone = await prisma.deliveryZone.create({
    data: {
      name: `Auth Zone ${suffix}`,
      fee: new Prisma.Decimal("10.00"),
      expectedDays: 3,
    },
    select: { id: true, name: true },
  });
  return {
    productId: product.id,
    colorId: color.id,
    zoneId: zone.id,
    zoneName: zone.name,
  };
}

// ---------------------------------------------------------------------------
// A guest may check out without an account, so a missing token is no longer
// an error. A token that is present but invalid still has to be rejected, so
// a caller cannot silently fall back to guest checkout.
test("POST /orders with an invalid token returns 401 and creates no order or stock change", async () => {
  const suffix = nextSuffix();
  const cleanup: CleanupIds = {};
  try {
    const userId = await seedUser(suffix);
    cleanup.userIds = [userId];
    const catalogue = await seedCatalogue(suffix);
    cleanup.productIds = [catalogue.productId];
    cleanup.colorIds = [catalogue.colorId];
    cleanup.zoneIds = [catalogue.zoneId];

    const idempotencyKey = `orders-auth-no-${suffix}`;
    const beforeStock = await prisma.color.findUnique({
      where: { id: catalogue.colorId },
      select: { stock: true },
    });

    const response = await fetch(`${baseUrl}/orders`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
        Authorization: "Bearer not-a-valid-token",
      },
      body: JSON.stringify(buildOrderBody(catalogue, suffix)),
    });

    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "Unauthorized" });

    const orders = await prisma.order.findMany({ where: { idempotencyKey } });
    assert.equal(orders.length, 0);

    const afterStock = await prisma.color.findUnique({
      where: { id: catalogue.colorId },
      select: { stock: true },
    });
    assert.equal(afterStock?.stock, beforeStock?.stock);
    assert.equal(afterStock?.stock, 10);
  } finally {
    await deleteTestData(cleanup);
  }
});

// ---------------------------------------------------------------------------
test("POST /orders with a valid token returns 201 for an available product", async () => {
  const suffix = nextSuffix();
  const cleanup: CleanupIds = {};
  try {
    const userId = await seedUser(suffix);
    cleanup.userIds = [userId];
    const catalogue = await seedCatalogue(suffix);
    cleanup.productIds = [catalogue.productId];
    cleanup.colorIds = [catalogue.colorId];
    cleanup.zoneIds = [catalogue.zoneId];

    const idempotencyKey = `orders-auth-yes-${suffix}`;
    const token = signToken(userId);

    const response = await fetch(`${baseUrl}/orders`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(buildOrderBody(catalogue, suffix)),
    });

    assert.equal(response.status, 201);
    const order = await response.json();
    assert.ok(typeof order.id === "string" && order.id.length > 0);
    cleanup.orderIds = [order.id];
    assert.equal(order.userId, userId);

    const color = await prisma.color.findUnique({
      where: { id: catalogue.colorId },
      select: { stock: true },
    });
    assert.equal(color?.stock, 9);

    const logs = await prisma.inventoryLog.findMany({
      where: { orderId: order.id },
    });
    assert.equal(logs.length, 1);
  } finally {
    await deleteTestData(cleanup);
  }
});
