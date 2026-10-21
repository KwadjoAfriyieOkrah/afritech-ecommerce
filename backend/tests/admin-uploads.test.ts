import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { after, before, test } from "node:test";

import type { CloudinaryClient } from "../src/lib/cloudinary";

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

process.env.DATABASE_URL = testDatabaseUrl;
console.log(`Test database: ${testDatabaseName}`);

// Required after the override so lib/env and PrismaClient bind to the test DB.
const { prisma } = require("../src/lib/prisma") as typeof import("../src/lib/prisma");
const { env } = require("../src/lib/env") as typeof import("../src/lib/env");
const { Prisma, Role } = require("@prisma/client") as typeof import("@prisma/client");
const jwt = require("jsonwebtoken") as typeof import("jsonwebtoken");
const express = require("express") as typeof import("express");
const adminRoutes = require("../src/routes/admin.routes") as typeof import("../src/routes/admin.routes");
const cloudinaryLib = require("../src/lib/cloudinary") as typeof import("../src/lib/cloudinary");

// ---------------------------------------------------------------------------
// Cloudinary stub. No test ever talks to the real API.
// ---------------------------------------------------------------------------
interface StubUpload {
  folder: string;
  publicId: string;
  bytes: number;
}

const stubUploads: StubUpload[] = [];
const stubDeletes: string[] = [];
let uploadSequence = 0;
let uploadHook: (() => Promise<void>) | null = null;

const stubClient: CloudinaryClient = {
  async upload(buffer, folder) {
    uploadSequence += 1;
    const publicId = `${folder}/stub-${uploadSequence}`;
    stubUploads.push({ folder, publicId, bytes: buffer.length });
    if (uploadHook) {
      const hook = uploadHook;
      uploadHook = null;
      await hook();
    }
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
  uploadHook = null;
  cloudinaryLib.setCloudinaryClientForTests(null);
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------
// Small helpers. No `as` casts: every JSON field is read through a guard.
// ---------------------------------------------------------------------------
function field(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  return Reflect.get(value, key);
}

function stringField(value: unknown, key: string): string | null {
  const raw = field(value, key);
  return typeof raw === "string" ? raw : null;
}

function numberField(value: unknown, key: string): number | null {
  const raw = field(value, key);
  return typeof raw === "number" ? raw : null;
}

function arrayField(value: unknown, key: string): unknown[] | null {
  const raw = field(value, key);
  return Array.isArray(raw) ? raw : null;
}

const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const NOT_AN_IMAGE = Buffer.from(
  "this file only claims to be an image through its filename\n",
  "utf8",
);

function nextSuffix(): string {
  return `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
}

function signToken(userId: string, role: string): string {
  return jwt.sign({ sub: userId, role }, env.JWT_SECRET, { expiresIn: "7d" });
}

async function createAdmin(suffix: string): Promise<string> {
  const user = await prisma.user.create({
    data: {
      name: "Admin Uploads Test",
      email: `admin-uploads-${suffix}@test.local`,
      passwordHash: "test-only-not-a-real-hash",
      role: Role.ADMIN,
    },
    select: { id: true },
  });
  return user.id;
}

async function createCustomer(suffix: string): Promise<string> {
  const user = await prisma.user.create({
    data: {
      name: "Customer Uploads Test",
      email: `customer-uploads-${suffix}@test.local`,
      passwordHash: "test-only-not-a-real-hash",
      role: Role.CUSTOMER,
    },
    select: { id: true },
  });
  return user.id;
}

interface SeededProduct {
  id: string;
  name: string;
}

async function createProduct(
  suffix: string,
  images: string[] = [],
): Promise<SeededProduct> {
  const product = await prisma.product.create({
    data: {
      name: `Upload Fixture ${suffix}`,
      brand: "TestBrand",
      category: "IPHONE",
      description: "Fixture for admin upload tests",
      basePrice: new Prisma.Decimal("250.00"),
      images,
      colors: { create: [{ name: "Black", stock: 5 }] },
    },
    select: { id: true, name: true },
  });
  return { id: product.id, name: product.name };
}

interface CleanupIds {
  userIds: string[];
  productIds: string[];
}

async function deleteTestData(ids: CleanupIds): Promise<void> {
  const colors = await prisma.color.findMany({
    where: { productId: { in: ids.productIds } },
    select: { id: true },
  });
  const colorIds = colors.map((color) => color.id);

  if (colorIds.length > 0) {
    await prisma.inventoryLog.deleteMany({ where: { colorId: { in: colorIds } } });
  }
  if (ids.productIds.length > 0) {
    await prisma.adminLog.deleteMany({
      where: { entityId: { in: ids.productIds } },
    });
    await prisma.orderItem.deleteMany({
      where: { productId: { in: ids.productIds } },
    });
    await prisma.product.deleteMany({ where: { id: { in: ids.productIds } } });
  }
  if (ids.userIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: ids.userIds } } });
  }
}

async function postImage(
  productId: string,
  token: string,
  bytes: Buffer,
  filename: string,
  mimetype: string,
): Promise<Response> {
  const form = new FormData();
  form.append(
    "image",
    new Blob([new Uint8Array(bytes)], { type: mimetype }),
    filename,
  );
  return fetch(`${baseUrl}/admin/products/${productId}/images`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
}

async function postCsv(
  token: string,
  csv: string,
  confirm?: string,
): Promise<Response> {
  const form = new FormData();
  form.append("file", new Blob([csv], { type: "text/csv" }), "products.csv");
  if (confirm !== undefined) {
    form.append("confirm", confirm);
  }
  return fetch(`${baseUrl}/admin/products/bulk`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
}

async function readImages(productId: string): Promise<string[]> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { images: true },
  });
  return product?.images ?? [];
}

// ---------------------------------------------------------------------------
test("a CUSTOMER token gets 403 on the image route", async () => {
  const suffix = nextSuffix();
  const cleanup: CleanupIds = { userIds: [], productIds: [] };
  try {
    const customerId = await createCustomer(suffix);
    cleanup.userIds.push(customerId);
    const product = await createProduct(suffix);
    cleanup.productIds.push(product.id);

    const uploadsBefore = stubUploads.length;
    const response = await postImage(
      product.id,
      signToken(customerId, Role.CUSTOMER),
      PNG_BYTES,
      "photo.png",
      "image/png",
    );

    assert.equal(response.status, 403);
    assert.equal(stubUploads.length, uploadsBefore);
    assert.deepEqual(await readImages(product.id), []);
  } finally {
    await deleteTestData(cleanup);
  }
});

// ---------------------------------------------------------------------------
test("a .jpg filename holding plain text is rejected with 400", async () => {
  const suffix = nextSuffix();
  const cleanup: CleanupIds = { userIds: [], productIds: [] };
  try {
    const adminId = await createAdmin(suffix);
    cleanup.userIds.push(adminId);
    const product = await createProduct(suffix);
    cleanup.productIds.push(product.id);

    const uploadsBefore = stubUploads.length;
    const response = await postImage(
      product.id,
      signToken(adminId, Role.ADMIN),
      NOT_AN_IMAGE,
      "definitely-a-photo.jpg",
      "image/jpeg",
    );

    assert.equal(response.status, 400);
    const body: unknown = await response.json();
    assert.equal(
      stringField(body, "error"),
      "Only JPEG, PNG or WebP images are allowed",
    );
    assert.equal(stubUploads.length, uploadsBefore);
    assert.deepEqual(await readImages(product.id), []);
  } finally {
    await deleteTestData(cleanup);
  }
});

// ---------------------------------------------------------------------------
test("a valid PNG is stored in Product.images with its public id logged", async () => {
  const suffix = nextSuffix();
  const cleanup: CleanupIds = { userIds: [], productIds: [] };
  try {
    const adminId = await createAdmin(suffix);
    cleanup.userIds.push(adminId);
    const product = await createProduct(suffix);
    cleanup.productIds.push(product.id);

    const response = await postImage(
      product.id,
      signToken(adminId, Role.ADMIN),
      PNG_BYTES,
      "photo.png",
      "image/png",
    );

    assert.equal(response.status, 201);
    const body: unknown = await response.json();
    const image = field(body, "image");
    const url = stringField(image, "url");
    const publicId = stringField(image, "publicId");
    assert.ok(url !== null);
    assert.ok(publicId !== null);

    const images = await readImages(product.id);
    assert.ok(images.includes(url), "stored URL must be in Product.images");

    const upload = stubUploads[stubUploads.length - 1];
    assert.ok(upload !== undefined);
    assert.equal(upload.folder, "afritech/products");
    assert.equal(publicId, upload.publicId);

    const log = await prisma.adminLog.findFirst({
      where: { entityId: product.id, action: "PRODUCT_IMAGE_ADD" },
      select: { meta: true },
    });
    assert.ok(log !== null);
    assert.equal(field(log.meta, "publicId"), publicId);
  } finally {
    await deleteTestData(cleanup);
  }
});

// ---------------------------------------------------------------------------
test("a seventh image is rejected with 400", async () => {
  const suffix = nextSuffix();
  const cleanup: CleanupIds = { userIds: [], productIds: [] };
  try {
    const adminId = await createAdmin(suffix);
    cleanup.userIds.push(adminId);
    const existingImages = Array.from(
      { length: 6 },
      (_, index) =>
        `https://res.cloudinary.com/afritech-unit-test/image/upload/existing-${index}.png`,
    );
    const product = await createProduct(suffix, existingImages);
    cleanup.productIds.push(product.id);

    const uploadsBefore = stubUploads.length;
    const response = await postImage(
      product.id,
      signToken(adminId, Role.ADMIN),
      PNG_BYTES,
      "seventh.png",
      "image/png",
    );

    assert.equal(response.status, 400);
    const body: unknown = await response.json();
    assert.equal(
      stringField(body, "error"),
      "A product can have at most 6 images",
    );
    assert.equal(stubUploads.length, uploadsBefore);
    assert.equal((await readImages(product.id)).length, 6);
  } finally {
    await deleteTestData(cleanup);
  }
});

// ---------------------------------------------------------------------------
test("a failed database write deletes the uploaded asset from the stub", async () => {
  const suffix = nextSuffix();
  const cleanup: CleanupIds = { userIds: [], productIds: [] };
  try {
    const adminId = await createAdmin(suffix);
    cleanup.userIds.push(adminId);
    const product = await createProduct(suffix);
    cleanup.productIds.push(product.id);

    const uploadsBefore = stubUploads.length;
    const deletesBefore = stubDeletes.length;
    uploadHook = async () => {
      // Simulates the database refusing the write after Cloudinary accepted
      // the file: the AdminLog insert loses its admin row and the FK fails.
      await prisma.user.delete({ where: { id: adminId } });
    };

    const response = await postImage(
      product.id,
      signToken(adminId, Role.ADMIN),
      PNG_BYTES,
      "photo.png",
      "image/png",
    );

    assert.equal(response.status, 500);
    uploadHook = null;
    assert.equal(stubUploads.length, uploadsBefore + 1);
    assert.equal(stubDeletes.length, deletesBefore + 1);

    const upload = stubUploads[stubUploads.length - 1];
    assert.equal(stubDeletes[stubDeletes.length - 1], upload?.publicId);
    assert.deepEqual(await readImages(product.id), []);
  } finally {
    uploadHook = null;
    await deleteTestData(cleanup);
  }
});

// ---------------------------------------------------------------------------
test("a CSV with one invalid row commits nothing and names the row number", async () => {
  const suffix = nextSuffix();
  const cleanup: CleanupIds = { userIds: [], productIds: [] };
  try {
    const adminId = await createAdmin(suffix);
    cleanup.userIds.push(adminId);

    const validName = `Bulk Invalid Valid ${suffix}`;
    const invalidName = `Bulk Invalid Broken ${suffix}`;
    const csv = [
      "id,name,brand,category,description,basePrice,isActive,colors",
      `,${validName},TestBrand,IPHONE,Row one,100.00,true,Black:5`,
      `,${invalidName},TestBrand,IPHONE,Row two,banana,true,Black:5`,
    ].join("\r\n");

    const response = await postCsv(signToken(adminId, Role.ADMIN), csv, "true");
    assert.equal(response.status, 400);

    const body: unknown = await response.json();
    assert.equal(stringField(body, "error"), "Validation failed");
    assert.equal(field(body, "committed"), false);

    const errors = arrayField(body, "errors");
    assert.ok(errors !== null);
    assert.equal(errors.length, 1);
    assert.equal(numberField(errors[0], "row"), 2);

    const details = arrayField(errors[0], "errors");
    assert.ok(details !== null);
    assert.equal(stringField(details[0], "field"), "basePrice");

    assert.equal(
      await prisma.product.findFirst({ where: { name: validName } }),
      null,
    );
    assert.equal(
      await prisma.product.findFirst({ where: { name: invalidName } }),
      null,
    );
  } finally {
    await deleteTestData(cleanup);
  }
});

// ---------------------------------------------------------------------------
test("a valid CSV writes nothing without confirm and commits with confirm true", async () => {
  const suffix = nextSuffix();
  const cleanup: CleanupIds = { userIds: [], productIds: [] };
  try {
    const adminId = await createAdmin(suffix);
    cleanup.userIds.push(adminId);
    const existing = await createProduct(suffix);
    cleanup.productIds.push(existing.id);

    const createdName = `Bulk Commit New ${suffix}`;
    const editedName = `Bulk Commit Edited ${suffix}`;
    const csv = [
      "id,name,brand,category,description,basePrice,isActive,colors",
      `,${createdName},TestBrand,IPHONE,Fresh import,299.50,true,Black:3`,
      `${existing.id},${editedName},TestBrand,IPHONE,Edited by bulk,400.00,true,Black:8`,
    ].join("\r\n");
    const token = signToken(adminId, Role.ADMIN);

    const dryRun = await postCsv(token, csv);
    assert.equal(dryRun.status, 200);
    const dryBody: unknown = await dryRun.json();
    assert.equal(stringField(dryBody, "mode"), "dry-run");
    assert.equal(field(dryBody, "committed"), false);
    assert.deepEqual(arrayField(dryBody, "errors"), []);
    const drySummary = field(dryBody, "summary");
    assert.equal(numberField(drySummary, "totalRows"), 2);
    assert.equal(numberField(drySummary, "creates"), 1);
    assert.equal(numberField(drySummary, "updates"), 1);
    assert.equal(numberField(drySummary, "stockAdjustments"), 2);

    assert.equal(
      await prisma.product.findFirst({ where: { name: createdName } }),
      null,
    );
    const untouched = await prisma.product.findUnique({
      where: { id: existing.id },
      select: {
        name: true,
        basePrice: true,
        colors: { select: { stock: true } },
      },
    });
    assert.ok(untouched !== null);
    assert.equal(untouched.name, existing.name);
    assert.equal(untouched.basePrice.toNumber(), 250);
    assert.equal(untouched.colors[0]?.stock, 5);

    const commit = await postCsv(token, csv, "true");
    assert.equal(commit.status, 200);
    const commitBody: unknown = await commit.json();
    assert.equal(stringField(commitBody, "mode"), "commit");
    assert.equal(field(commitBody, "committed"), true);
    assert.deepEqual(arrayField(commitBody, "errors"), []);

    const created = await prisma.product.findFirst({
      where: { name: createdName },
      select: {
        id: true,
        basePrice: true,
        isActive: true,
        colors: { select: { id: true, name: true, stock: true } },
      },
    });
    assert.ok(created !== null);
    cleanup.productIds.push(created.id);
    assert.equal(created.basePrice.toNumber(), 299.5);
    assert.equal(created.isActive, true);
    assert.equal(created.colors.length, 1);
    assert.equal(created.colors[0]?.stock, 3);

    const updated = await prisma.product.findUnique({
      where: { id: existing.id },
      select: {
        name: true,
        basePrice: true,
        colors: { select: { id: true, stock: true } },
      },
    });
    assert.ok(updated !== null);
    assert.equal(updated.name, editedName);
    assert.equal(updated.basePrice.toNumber(), 400);
    assert.equal(updated.colors[0]?.stock, 8);

    const colorId = updated.colors[0]?.id;
    assert.ok(colorId !== undefined);
    const adjustment = await prisma.inventoryLog.findMany({
      where: { colorId, reason: "ADJUSTMENT" },
      select: { change: true },
    });
    assert.equal(adjustment.length, 1);
    assert.equal(adjustment[0]?.change, 3);

    const createdColorId = created.colors[0]?.id;
    assert.ok(createdColorId !== undefined);
    const creationLog = await prisma.inventoryLog.findMany({
      where: { colorId: createdColorId, reason: "ADJUSTMENT" },
      select: { change: true },
    });
    assert.equal(creationLog.length, 1);
    assert.equal(creationLog[0]?.change, 3);

    const adminLogs = await prisma.adminLog.findMany({
      where: { entityId: { in: [existing.id, created.id] } },
      select: { action: true },
    });
    assert.equal(adminLogs.length, 2);
    assert.ok(
      adminLogs.some((log) => log.action === "PRODUCT_BULK_CREATE"),
    );
    assert.ok(
      adminLogs.some((log) => log.action === "PRODUCT_BULK_UPDATE"),
    );
  } finally {
    await deleteTestData(cleanup);
  }
});
