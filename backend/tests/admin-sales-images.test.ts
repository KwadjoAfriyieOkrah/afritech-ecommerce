import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { after, before, test } from "node:test";

import type { CloudinaryClient } from "../src/lib/cloudinary";
import { createCredentialVersion } from "../src/lib/credentialVersion";

// ---------------------------------------------------------------------------
// DATABASE_URL_TEST guard
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

process.env.DATABASE_URL = testDatabaseUrl;
console.log(`Test database: ${testDatabaseName}`);

// Required after override
const prismaModule: typeof import("../src/lib/prisma") = require("../src/lib/prisma");
const envModule: typeof import("../src/lib/env") = require("../src/lib/env");
const clientModule: typeof import("../src/generated/prisma/client") = require("../src/generated/prisma/client");
const jwt: typeof import("jsonwebtoken") = require("jsonwebtoken");
const express: typeof import("express") = require("express");
const adminRoutes: typeof import("../src/routes/admin.routes") = require("../src/routes/admin.routes");
const cloudinaryLib: typeof import("../src/lib/cloudinary") = require("../src/lib/cloudinary");

const { prisma } = prismaModule;
const { env } = envModule;
const { Prisma, Role } = clientModule;

const stubUploads: Array<{ publicId: string }> = [];
const stubDeletes: string[] = [];
let uploadSequence = 0;

const stubClient: CloudinaryClient = {
  async upload(buffer, folder) {
    uploadSequence += 1;
    const publicId = `${folder}/stub-${uploadSequence}`;
    stubUploads.push({ publicId });
    return {
      secureUrl: `https://res.cloudinary.com/afritech-unit-test/image/upload/${publicId}.png`,
      publicId,
    };
  },
  async destroy(publicId) {
    stubDeletes.push(publicId);
  },
};

const app = express();
app.use(express.json());
app.use("/admin", adminRoutes.default);

let server: Server;
let baseUrl: string;

before(async () => {
  cloudinaryLib.setCloudinaryClientForTests(stubClient);
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
  cloudinaryLib.setCloudinaryClientForTests(null);
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
  await prisma.$disconnect();
});

function field(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  return Reflect.get(value, key);
}

function arrayField(value: unknown, key: string): unknown[] | null {
  const raw = field(value, key);
  return Array.isArray(raw) ? raw : null;
}

function numberField(value: unknown, key: string): number | null {
  const raw = field(value, key);
  return typeof raw === "number" ? raw : null;
}

function stringField(value: unknown, key: string): string | null {
  const raw = field(value, key);
  return typeof raw === "string" ? raw : null;
}

function nextSuffix(): string {
  return `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
}

const TEST_PASSWORD_HASH = "test-only-not-a-real-hash";

function signToken(userId: string, role: string): string {
  return jwt.sign(
    {
      sub: userId,
      role,
      credentialVersion: createCredentialVersion(
        TEST_PASSWORD_HASH,
        env.JWT_SECRET,
      ),
    },
    env.JWT_SECRET,
    { expiresIn: "7d" },
  );
}

async function createAdmin(suffix: string): Promise<string> {
  const user = await prisma.user.create({
    data: {
      name: "Admin Sales Images Test",
      email: `admin-sales-${suffix}@test.local`,
      passwordHash: TEST_PASSWORD_HASH,
      role: Role.ADMIN,
    },
    select: { id: true },
  });
  return user.id;
}

async function createCustomer(suffix: string): Promise<string> {
  const user = await prisma.user.create({
    data: {
      name: "Customer Sales Images Test",
      email: `customer-sales-${suffix}@test.local`,
      passwordHash: TEST_PASSWORD_HASH,
      role: Role.CUSTOMER,
    },
    select: { id: true },
  });
  return user.id;
}

async function createProduct(
  suffix: string,
  images: string[] = [],
): Promise<string> {
  const product = await prisma.product.create({
    data: {
      name: `Sales Images Fixture ${suffix}`,
      brand: "TestBrand",
      category: "IPHONE",
      description: "Fixture for admin sales/images tests",
      basePrice: new Prisma.Decimal("250.00"),
      images,
      colors: { create: [{ name: "Black", stock: 5 }] },
    },
    select: { id: true },
  });
  return product.id;
}

interface CleanupIds {
  userIds: string[];
  productIds: string[];
  orderIds: string[];
}

async function deleteTestData(ids: CleanupIds): Promise<void> {
  if (ids.orderIds.length > 0) {
    await prisma.dailySale.deleteMany({ where: { orderId: { in: ids.orderIds } } });
    await prisma.inventoryLog.deleteMany({
      where: { order: { id: { in: ids.orderIds } } },
    });
    await prisma.orderItem.deleteMany({ where: { orderId: { in: ids.orderIds } } });
    await prisma.order.deleteMany({ where: { id: { in: ids.orderIds } } });
  }

  const colors = ids.productIds.length > 0
    ? await prisma.color.findMany({
        where: { productId: { in: ids.productIds } },
        select: { id: true },
      })
    : [];
  const colorIds = colors.map((color) => color.id);
  if (colorIds.length > 0) {
    await prisma.inventoryLog.deleteMany({ where: { colorId: { in: colorIds } } });
  }
  if (ids.productIds.length > 0) {
    await prisma.adminLog.deleteMany({ where: { entityId: { in: ids.productIds } } });
    await prisma.orderItem.deleteMany({ where: { productId: { in: ids.productIds } } });
    await prisma.dailySale.deleteMany({ where: { productId: { in: ids.productIds } } });
    await prisma.product.deleteMany({ where: { id: { in: ids.productIds } } });
  }
  if (ids.userIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: ids.userIds } } });
  }
}

async function deleteImage(
  productId: string,
  index: number,
  token: string,
): Promise<Response> {
  return fetch(
    `${baseUrl}/admin/products/${encodeURIComponent(productId)}/images/${index}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
}

async function getSales(days?: number, token?: string): Promise<Response> {
  const url = new URL(`${baseUrl}/admin/sales`);
  if (days !== undefined) {
    url.searchParams.set("days", String(days));
  }
  return fetch(url.toString(), {
    method: "GET",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

async function readProductImages(productId: string): Promise<string[]> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { images: true },
  });
  return product?.images ?? [];
}

test("delete removes only that index and leaves the others in order", async () => {
  const suffix = nextSuffix();
  const cleanup: CleanupIds = { userIds: [], productIds: [], orderIds: [] };
  try {
    const adminId = await createAdmin(suffix);
    cleanup.userIds.push(adminId);
    const images = [
      "https://res.cloudinary.com/afritech-unit-test/image/upload/v123/afritech/products/a.jpg",
      "https://res.cloudinary.com/afritech-unit-test/image/upload/v123/afritech/products/b.png",
      "https://res.cloudinary.com/afritech-unit-test/image/upload/v123/afritech/products/c.webp",
    ];
    const productId = await createProduct(suffix, images);
    cleanup.productIds.push(productId);
    const deletesBefore = stubDeletes.length;

    const response = await deleteImage(productId, 1, signToken(adminId, Role.ADMIN));
    assert.equal(response.status, 200);
    const body: unknown = await response.json();
    const remaining = arrayField(body, "images");
    assert.ok(remaining !== null);
    assert.deepEqual(remaining, [images[0], images[2]]);
    assert.equal(stubDeletes.length, deletesBefore + 1);
    assert.equal(stubDeletes[stubDeletes.length - 1], "afritech/products/b");
    assert.deepEqual(await readProductImages(productId), [images[0], images[2]]);

    const log = await prisma.adminLog.findFirst({
      where: { entityId: productId, action: "PRODUCT_IMAGE_REMOVE" },
      select: { meta: true },
    });
    assert.ok(log !== null);
    assert.equal(field(log.meta, "imageUrl"), images[1]);
  } finally {
    await deleteTestData(cleanup);
  }
});

test("index out of range returns 404", async () => {
  const suffix = nextSuffix();
  const cleanup: CleanupIds = { userIds: [], productIds: [], orderIds: [] };
  try {
    const adminId = await createAdmin(suffix);
    cleanup.userIds.push(adminId);
    const productId = await createProduct(suffix, [
      "https://res.cloudinary.com/afritech-unit-test/image/upload/v1/afritech/products/x.png",
    ]);
    cleanup.productIds.push(productId);
    const deletesBefore = stubDeletes.length;

    const response = await deleteImage(productId, 5, signToken(adminId, Role.ADMIN));
    assert.equal(response.status, 404);
    assert.equal(stubDeletes.length, deletesBefore);
    assert.equal((await readProductImages(productId)).length, 1);
  } finally {
    await deleteTestData(cleanup);
  }
});

test("a CUSTOMER token gets 403 on both routes", async () => {
  const suffix = nextSuffix();
  const cleanup: CleanupIds = { userIds: [], productIds: [], orderIds: [] };
  try {
    const customerId = await createCustomer(suffix);
    cleanup.userIds.push(customerId);
    const productId = await createProduct(suffix, [
      "https://res.cloudinary.com/afritech-unit-test/image/upload/v1/afritech/products/y.png",
    ]);
    cleanup.productIds.push(productId);
    const token = signToken(customerId, Role.CUSTOMER);

    const deleteRes = await deleteImage(productId, 0, token);
    assert.equal(deleteRes.status, 403);

    const salesRes = await getSales(30, token);
    assert.equal(salesRes.status, 403);
  } finally {
    await deleteTestData(cleanup);
  }
});

test("sales returns zero totals on an empty window, and counts a seeded DailySale row in today and byDay", async () => {
  const suffix = nextSuffix();
  const cleanup: CleanupIds = { userIds: [], productIds: [], orderIds: [] };
  try {
    const adminId = await createAdmin(suffix);
    cleanup.userIds.push(adminId);
    const productId = await createProduct(suffix);
    cleanup.productIds.push(productId);

    const empty = await getSales(30, signToken(adminId, Role.ADMIN));
    assert.equal(empty.status, 200);
    const emptyBody: unknown = await empty.json();
    const emptyTotals = field(emptyBody, "totals");
    assert.equal(numberField(emptyTotals, "orders"), 0);
    assert.equal(numberField(emptyTotals, "quantity"), 0);
    assert.equal(numberField(emptyTotals, "amount"), 0);
    const byDayEmpty = arrayField(emptyBody, "byDay");
    assert.ok(byDayEmpty !== null);
    assert.equal(byDayEmpty.length, 30);

    const order = await prisma.order.create({
      data: {
        reference: `SALES-${suffix}`,
        userId: adminId,
        customerName: "Sales Test",
        customerEmail: `sales-${suffix}@test.local`,
        customerPhone: "0240000000",
        region: "Greater Accra",
        address: "1 Test Street",
        deliveryFee: new Prisma.Decimal("10.00"),
        total: new Prisma.Decimal("260.00"),
      },
      select: { id: true },
    });
    cleanup.orderIds.push(order.id);

    const today = new Date();
    const saleDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    await prisma.dailySale.create({
      data: {
        orderId: order.id,
        productId,
        saleDate,
        quantity: 2,
        amount: new Prisma.Decimal("500.00"),
      },
    });

    const filled = await getSales(30, signToken(adminId, Role.ADMIN));
    assert.equal(filled.status, 200);
    const filledBody: unknown = await filled.json();
    const totals = field(filledBody, "totals");
    assert.equal(numberField(totals, "orders"), 1);
    assert.equal(numberField(totals, "quantity"), 2);
    assert.equal(numberField(totals, "amount"), 500);
    const todayRes = field(filledBody, "today");
    assert.equal(numberField(todayRes, "orders"), 1);
    assert.equal(numberField(todayRes, "quantity"), 2);
    const byDay = arrayField(filledBody, "byDay");
    assert.ok(byDay !== null);
    const todayRow = byDay.find((row) => {
      const date = stringField(row, "date");
      return date === saleDate.toISOString().slice(0, 10);
    });
    assert.ok(todayRow !== undefined);
    assert.equal(numberField(todayRow, "orders"), 1);
    assert.equal(numberField(todayRow, "quantity"), 2);
  } finally {
    await deleteTestData(cleanup);
  }
});
