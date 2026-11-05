import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";

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
const { initializePayment } = require("../src/services/payments.service") as typeof import("../src/services/payments.service");
const { createOrder } = require("../src/services/orders.service") as typeof import("../src/services/orders.service");
const { PaymentStatus, Prisma } = require("../src/generated/prisma/client") as typeof import("../src/generated/prisma/client");

const RESERVATION_MS = 15 * 60 * 1000;

function nextSuffix(): string {
  return `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
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
    await prisma.paymentAttempt.deleteMany({
      where: { orderId: { in: orderIds } },
    });
    await prisma.reconciliationEntry.deleteMany({
      where: { orderId: { in: orderIds } },
    });
    await prisma.dailySale.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.inventoryLog.deleteMany({
      where: { orderId: { in: orderIds } },
    });
    await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  }
  if (colorIds.length > 0) {
    await prisma.inventoryLog.deleteMany({
      where: { colorId: { in: colorIds } },
    });
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
      name: "Payment Init Test",
      email: `pay-init-${suffix}@test.local`,
      passwordHash: "test-only-not-a-real-hash",
    },
    select: { id: true },
  });
  return user.id;
}

interface SeedOrderOptions {
  paymentStatus?: (typeof PaymentStatus)[keyof typeof PaymentStatus];
  reservedUntil?: Date;
}

async function seedOrder(
  userId: string,
  suffix: string,
  options: SeedOrderOptions = {},
): Promise<{ id: string; reference: string }> {
  const order = await prisma.order.create({
    data: {
      reference: `TEST-INIT-${suffix}`,
      userId,
      customerName: "Payment Init Test",
      customerEmail: `pay-init-${suffix}@test.local`,
      customerPhone: "0000000000",
      region: "Greater Accra",
      address: "Test address",
      deliveryFee: new Prisma.Decimal("10.00"),
      total: new Prisma.Decimal("110.00"),
      paymentStatus: options.paymentStatus ?? PaymentStatus.PENDING,
      reservedUntil:
        options.reservedUntil ?? new Date(Date.now() + RESERVATION_MS),
    },
    select: { id: true, reference: true },
  });
  return order;
}

async function seedCatalogue(
  suffix: string,
): Promise<{ productId: string; colorId: string; zoneName: string }> {
  const product = await prisma.product.create({
    data: {
      name: `Test Phone ${suffix}`,
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
      name: `Test Zone ${suffix}`,
      fee: new Prisma.Decimal("10.00"),
      expectedDays: 3,
    },
    select: { name: true },
  });
  return { productId: product.id, colorId: color.id, zoneName: zone.name };
}

// ---------------------------------------------------------------------------
test("initializePayment on a PENDING order creates one attempt whose reference the order records", async () => {
  const suffix = nextSuffix();
  const cleanup: CleanupIds = {};
  try {
    const userId = await seedUser(suffix);
    cleanup.userIds = [userId];
    const order = await seedOrder(userId, suffix);
    cleanup.orderIds = [order.id];

    const outcome = await initializePayment(order.id, userId);
    assert.equal(outcome.kind, "ok");
    if (outcome.kind !== "ok") return;

    const attempts = await prisma.paymentAttempt.findMany({
      where: { orderId: order.id },
    });
    assert.equal(attempts.length, 1);
    const attempt = attempts[0];
    assert.ok(attempt);
    assert.equal(attempt.reference, outcome.reference);
    assert.equal(attempt.status, "INITIALIZED");
    assert.equal(attempt.currency, "GHS");
    assert.equal(attempt.amountPesewas, BigInt(11_000));

    const row = await prisma.order.findUnique({
      where: { id: order.id },
      select: { paystackRef: true },
    });
    assert.equal(row?.paystackRef, attempt.reference);
  } finally {
    await deleteTestData(cleanup);
  }
});

// ---------------------------------------------------------------------------
test("a checkout-created order has paystackRef null", async () => {
  const suffix = nextSuffix();
  const cleanup: CleanupIds = {};
  try {
    const userId = await seedUser(suffix);
    cleanup.userIds = [userId];
    const catalogue = await seedCatalogue(suffix);
    cleanup.productIds = [catalogue.productId];
    cleanup.colorIds = [catalogue.colorId];
    cleanup.zoneIds = [];
    const zone = await prisma.deliveryZone.findFirst({
      where: { name: catalogue.zoneName },
      select: { id: true },
    });
    assert.ok(zone);
    cleanup.zoneIds = [zone.id];

    const result = await createOrder({
      customerName: "Payment Init Test",
      customerEmail: `pay-init-${suffix}@test.local`,
      customerPhone: "0000000000",
      deliveryArea: catalogue.zoneName,
      deliveryAddress: "Test address",
      items: [{ productId: catalogue.productId, color: "Black", quantity: 1 }],
      idempotencyKey: `checkout-${suffix}`,
      userId,
    });
    assert.equal(result.status, 201);
    assert.equal(result.order.paymentReference, null);
    cleanup.orderIds = [result.order.id];

    const row = await prisma.order.findUnique({
      where: { id: result.order.id },
      select: { paystackRef: true },
    });
    assert.equal(row?.paystackRef, null);

    const attempts = await prisma.paymentAttempt.findMany({
      where: { orderId: result.order.id },
    });
    assert.equal(attempts.length, 0);
  } finally {
    await deleteTestData(cleanup);
  }
});

// ---------------------------------------------------------------------------
test("initializePayment on a PAID order returns already_paid and creates no attempt", async () => {
  const suffix = nextSuffix();
  const cleanup: CleanupIds = {};
  try {
    const userId = await seedUser(suffix);
    cleanup.userIds = [userId];
    const order = await seedOrder(userId, suffix, {
      paymentStatus: PaymentStatus.PAID,
    });
    cleanup.orderIds = [order.id];

    const outcome = await initializePayment(order.id, userId);
    assert.equal(outcome.kind, "already_paid");

    const attempts = await prisma.paymentAttempt.findMany({
      where: { orderId: order.id },
    });
    assert.equal(attempts.length, 0);
  } finally {
    await deleteTestData(cleanup);
  }
});

// ---------------------------------------------------------------------------
test("initializePayment on an expired reservation returns expired and creates no attempt", async () => {
  const suffix = nextSuffix();
  const cleanup: CleanupIds = {};
  try {
    const userId = await seedUser(suffix);
    cleanup.userIds = [userId];
    const order = await seedOrder(userId, suffix, {
      paymentStatus: PaymentStatus.PENDING,
      reservedUntil: new Date(Date.now() - 60 * 1000),
    });
    cleanup.orderIds = [order.id];

    const outcome = await initializePayment(order.id, userId);
    assert.equal(outcome.kind, "expired");

    const attempts = await prisma.paymentAttempt.findMany({
      where: { orderId: order.id },
    });
    assert.equal(attempts.length, 0);
  } finally {
    await deleteTestData(cleanup);
  }
});

// ---------------------------------------------------------------------------
test("two concurrent initializePayment calls both succeed with different references and both attempts exist", async () => {
  const suffix = nextSuffix();
  const cleanup: CleanupIds = {};
  try {
    const userId = await seedUser(suffix);
    cleanup.userIds = [userId];
    const order = await seedOrder(userId, suffix);
    cleanup.orderIds = [order.id];

    const [first, second] = await Promise.all([
      initializePayment(order.id, userId),
      initializePayment(order.id, userId),
    ]);
    assert.equal(first.kind, "ok");
    assert.equal(second.kind, "ok");
    if (first.kind !== "ok" || second.kind !== "ok") return;
    assert.notEqual(first.reference, second.reference);

    const attempts = await prisma.paymentAttempt.findMany({
      where: { orderId: order.id },
      select: { reference: true, status: true },
    });
    assert.equal(attempts.length, 2);
    const references = new Set(attempts.map((a) => a.reference));
    assert.equal(references.size, 2);
    assert.ok(references.has(first.reference));
    assert.ok(references.has(second.reference));
    for (const attempt of attempts) {
      assert.equal(attempt.status, "INITIALIZED");
    }

    const row = await prisma.order.findUnique({
      where: { id: order.id },
      select: { paystackRef: true },
    });
    assert.ok(row);
    assert.ok(
      row.paystackRef === first.reference || row.paystackRef === second.reference,
      "paystackRef must record one of the two minted references",
    );
  } finally {
    await deleteTestData(cleanup);
  }
});

// ---------------------------------------------------------------------------
test("a forced failure inside the transaction rolls back paystackRef and creates no attempt", async () => {
  const suffix = nextSuffix();
  const cleanup: CleanupIds = {};
  // esbuild getters on the settlement module are non-writable, so the forced
  // failure is injected by wrapping prisma.$transaction: the real transaction
  // runs, paymentAttempt.create always rejects, and the callback's throw must
  // roll back the paystackRef update that already ran inside it.
  const realTransaction = prisma.$transaction.bind(prisma);
  const forcedTransaction = ((
    arg: Parameters<typeof prisma.$transaction>[0],
    options?: Parameters<typeof prisma.$transaction>[1],
  ) => {
    if (typeof arg !== "function") return realTransaction(arg, options);
    return realTransaction(async (tx) => {
      const wrapped = new Proxy(tx, {
        get(target, prop, receiver) {
          if (prop === "paymentAttempt") {
            return new Proxy(target.paymentAttempt, {
              get(modelTarget, modelProp) {
                if (modelProp === "create") {
                  return () =>
                    Promise.reject(
                      new Error("forced failure inside transaction"),
                    );
                }
                const value = Reflect.get(modelTarget, modelProp);
                return typeof value === "function"
                  ? value.bind(modelTarget)
                  : value;
              },
            });
          }
          const value = Reflect.get(target, prop, receiver);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      return arg(wrapped);
    }, options);
  }) as typeof prisma.$transaction;

  try {
    const userId = await seedUser(suffix);
    cleanup.userIds = [userId];
    const target = await seedOrder(userId, `${suffix}-target`);
    cleanup.orderIds = [target.id];

    prisma.$transaction = forcedTransaction;
    try {
      await assert.rejects(
        initializePayment(target.id, userId),
        /forced failure inside transaction/,
      );
    } finally {
      prisma.$transaction = realTransaction;
    }

    // The transaction rolled back: the paystackRef claim must be gone and no
    // attempt row may survive.
    const row = await prisma.order.findUnique({
      where: { id: target.id },
      select: { paystackRef: true },
    });
    assert.equal(row?.paystackRef, null);

    const attempts = await prisma.paymentAttempt.findMany({
      where: { orderId: target.id },
    });
    assert.equal(attempts.length, 0);
  } finally {
    prisma.$transaction = realTransaction;
    await deleteTestData(cleanup);
  }
});

after(async () => {
  await prisma.$disconnect();
});
