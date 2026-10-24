import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import bcrypt from "bcryptjs";
import { Prisma, Role } from "@prisma/client";
import { after, before, test } from "node:test";

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

process.env.DATABASE_URL = testDatabaseUrl;
console.log(`Test database: ${testDatabaseName}`);

type AppModule = typeof import("../src/app");
type PrismaModule = typeof import("../src/lib/prisma");

let app: AppModule["default"];
let prisma: PrismaModule["prisma"];
let server: Server;
let baseUrl: string;

const createdUserIds: string[] = [];
const createdOrderIds: string[] = [];
const createdProductIds: string[] = [];
const createdColorIds: string[] = [];
const createdZoneIds: string[] = [];

before(async () => {
  const prismaModule: PrismaModule = await import("../src/lib/prisma");
  const appModule: AppModule = await import("../src/app");
  prisma = prismaModule.prisma;
  app = appModule.default;

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
  if (!prisma) return;

  if (createdOrderIds.length > 0) {
    await prisma.paymentAttempt.deleteMany({ where: { orderId: { in: createdOrderIds } } });
    await prisma.reconciliationEntry.deleteMany({ where: { orderId: { in: createdOrderIds } } });
    await prisma.dailySale.deleteMany({ where: { orderId: { in: createdOrderIds } } });
    await prisma.inventoryLog.deleteMany({ where: { orderId: { in: createdOrderIds } } });
    await prisma.orderItem.deleteMany({ where: { orderId: { in: createdOrderIds } } });
    await prisma.order.deleteMany({ where: { id: { in: createdOrderIds } } });
  }
  if (createdColorIds.length > 0) {
    await prisma.inventoryLog.deleteMany({ where: { colorId: { in: createdColorIds } } });
    await prisma.orderItem.deleteMany({ where: { colorId: { in: createdColorIds } } });
    await prisma.color.deleteMany({ where: { id: { in: createdColorIds } } });
  }
  if (createdProductIds.length > 0) {
    await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
  }
  if (createdZoneIds.length > 0) {
    await prisma.deliveryZone.deleteMany({ where: { id: { in: createdZoneIds } } });
  }
  if (createdUserIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }

  if (server) {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }
  await prisma.$disconnect();
});

function field(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  return Reflect.get(value, key);
}

function stringField(value: unknown, key: string): string | null {
  const raw = field(value, key);
  return typeof raw === "string" ? raw : null;
}

function newSuffix() {
  return `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
}

async function seedFixture() {
  const suffix = newSuffix();
  const zone = await prisma.deliveryZone.create({
    data: {
      name: `Guest Zone ${suffix}`,
      fee: new Prisma.Decimal("10.00"),
      expectedDays: 3,
    },
    select: { id: true, name: true },
  });
  createdZoneIds.push(zone.id);

  const product = await prisma.product.create({
    data: {
      name: `Guest Phone ${suffix}`,
      brand: "TestBrand",
      category: "IPHONE",
      basePrice: new Prisma.Decimal("100.00"),
      images: [],
    },
    select: { id: true },
  });
  createdProductIds.push(product.id);

  const color = await prisma.color.create({
    data: { productId: product.id, name: "Black", stock: 20 },
    select: { id: true },
  });
  createdColorIds.push(color.id);

  const user = await prisma.user.create({
    data: {
      name: "Guest User",
      email: `guest-${suffix}@test.local`,
      passwordHash: await bcrypt.hash("Passw0rd-123", 12),
      role: Role.CUSTOMER,
      phone: "0241111111",
    },
    select: { id: true },
  });
  createdUserIds.push(user.id);

  const rider = await prisma.rider.create({
    data: {
      name: `Rider ${suffix}`,
      phone: "0242222222",
      isActive: true,
    },
    select: { id: true },
  });

  return { zone, product, color, user, rider, suffix };
}

test("guest checkout creates order with access token, hash stored, no raw token persisted; blank email becomes null; replay gives 200 with accessToken null", async () => {
  const fixture = await seedFixture();
  const idempotencyKey = `guest-checkout-${fixture.suffix}-${randomUUID().slice(0, 8)}`;

  const response = await fetch(`${baseUrl}/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify({
      customerName: "Guest Customer",
      customerEmail: "   ",
      customerPhone: "0244123456",
      deliveryArea: fixture.zone.name,
      deliveryAddress: "1 Guest Street, Accra",
      items: [{ productId: fixture.product.id, color: "Black", quantity: 2 }],
    }),
  });

  assert.equal(response.status, 201);
  const body = await response.json();
  const orderId = stringField(body, "id");
  assert.ok(orderId && orderId.length > 0);
  if (orderId) createdOrderIds.push(orderId);

  const accessToken = stringField(body, "accessToken");
  assert.ok(accessToken && accessToken.length > 0);

  assert.equal(stringField(body, "customerEmail"), null);
  assert.equal(field(body, "userId"), null);

  const order = await prisma.order.findUnique({
    where: { id: orderId! },
    select: {
      customerEmail: true,
      accessTokenHash: true,
      userId: true,
    },
  });
  assert.equal(order?.customerEmail, null);
  assert.equal(order?.userId, null);
  assert.ok(typeof order?.accessTokenHash === "string" && order.accessTokenHash.length > 0);
  assert.notEqual(order?.accessTokenHash, accessToken);

  const replay = await fetch(`${baseUrl}/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify({
      customerName: "Guest Customer",
      customerEmail: "   ",
      customerPhone: "0244123456",
      deliveryArea: fixture.zone.name,
      deliveryAddress: "1 Guest Street, Accra",
      items: [{ productId: fixture.product.id, color: "Black", quantity: 2 }],
    }),
  });
  assert.equal(replay.status, 200);
  const replayBody = await replay.json();
  assert.equal(stringField(replayBody, "accessToken"), null);
  assert.equal(stringField(replayBody, "id"), orderId);

  const color = await prisma.color.findUnique({ where: { id: fixture.color.id }, select: { stock: true } });
  assert.equal(color?.stock, 18);
});

test("track order happy path, phone formats, wrong/missing identical 404, rider appears after dispatched", async () => {
  const fixture = await seedFixture();
  const idempotencyKey = `guest-track-${fixture.suffix}-${randomUUID().slice(0, 8)}`;

  const response = await fetch(`${baseUrl}/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify({
      customerName: "Track Guest",
      customerEmail: "track@example.com",
      customerPhone: "0244123456",
      deliveryArea: fixture.zone.name,
      deliveryAddress: "2 Track Street",
      items: [{ productId: fixture.product.id, color: "Black", quantity: 1 }],
    }),
  });
  assert.equal(response.status, 201);
  const body = await response.json();
  const orderId = stringField(body, "id");
  const reference = stringField(body, "reference");
  const accessToken = stringField(body, "accessToken");
  if (orderId) createdOrderIds.push(orderId);
  assert.ok(reference);

  const track1 = await fetch(`${baseUrl}/orders/track?reference=${encodeURIComponent(reference!)}&phone=${encodeURIComponent("0244123456")}`);
  assert.equal(track1.status, 200);
  const t1 = await track1.json();
  assert.equal(stringField(t1, "reference"), reference);
  assert.ok(Array.isArray(field(t1, "items")));
  assert.equal(field(t1, "rider"), undefined);

  const track2 = await fetch(`${baseUrl}/orders/track?reference=${encodeURIComponent(reference!)}&phone=${encodeURIComponent("+233244123456")}`);
  assert.equal(track2.status, 200);

  const trackBad = await fetch(`${baseUrl}/orders/track?reference=${encodeURIComponent(reference!)}&phone=${encodeURIComponent("0200000000")}`);
  assert.equal(trackBad.status, 404);
  assert.deepEqual(await trackBad.json(), { error: "Order not found" });

  const trackMissing = await fetch(`${baseUrl}/orders/track?reference=${encodeURIComponent(reference!)}`);
  assert.equal(trackMissing.status, 404);
  assert.deepEqual(await trackMissing.json(), { error: "Order not found" });

  const trackMissing2 = await fetch(`${baseUrl}/orders/track?phone=${encodeURIComponent("0244123456")}`);
  assert.equal(trackMissing2.status, 404);
  assert.deepEqual(await trackMissing2.json(), { error: "Order not found" });

  // payments initialize unknown-order parity
  const unknown = await fetch(`${baseUrl}/payments/initialize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orderId: "does-not-exist" }),
  });
  assert.equal(unknown.status, 404);
  assert.deepEqual(await unknown.json(), { error: "Order not found" });

  // initialize with token succeeds (Paystack not called here)
  const init = await fetch(`${baseUrl}/payments/initialize`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-order-access-token": accessToken!,
    },
    body: JSON.stringify({ orderId: orderId! }),
  });
  assert.equal(init.status, 200);
  const initBody = await init.json();
  assert.ok(typeof stringField(initBody, "reference") === "string");
  assert.equal(field(initBody, "email"), "track@example.com"); // customer had email

  await prisma.order.update({
    where: { id: orderId! },
    data: {
      paymentStatus: "PAID",
      fulfillment: "DISPATCHED",
      riderId: fixture.rider.id,
    },
  });

  const trackDispatched = await fetch(`${baseUrl}/orders/track?reference=${encodeURIComponent(reference!)}&phone=${encodeURIComponent("0244123456")}`);
  assert.equal(trackDispatched.status, 200);
  const t3 = await trackDispatched.json();
  const rider = field(t3, "rider") as any;
  assert.ok(rider && typeof rider.name === "string" && typeof rider.phone === "string");
});
