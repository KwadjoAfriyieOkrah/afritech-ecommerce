import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { Prisma } from "../src/generated/prisma/client";
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

let activeProductId: string;
let inStockColor = "Black";
let zeroStockColor = "White";
let inactiveProductId: string;
let inactiveColor = "Grey";

const createdProductIds: string[] = [];

const RESULT_KEYS = [
  "productId",
  "color",
  "quantity",
  "unitPrice",
  "available",
  "status",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

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

function linesOf(body: unknown): unknown[] {
  if (!Array.isArray(body)) {
    throw new Error("Response body is not an array");
  }
  return body;
}

function lineAt(body: unknown, index: number): unknown {
  return linesOf(body)[index];
}

async function postAvailability(payload: unknown): Promise<Response> {
  return fetch(`${baseUrl}/products/availability`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

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

  const suffix = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;

  const active = await prisma.product.create({
    data: {
      name: `Availability Active ${suffix}`,
      brand: "TestBrand",
      category: "IPHONE",
      basePrice: new Prisma.Decimal("100.00"),
      isActive: true,
      images: [],
      colors: {
        create: [
          { name: inStockColor, stock: 5 },
          { name: zeroStockColor, stock: 0 },
        ],
      },
    },
    select: { id: true },
  });
  activeProductId = active.id;
  createdProductIds.push(active.id);

  const inactive = await prisma.product.create({
    data: {
      name: `Availability Inactive ${suffix}`,
      brand: "TestBrand",
      category: "IPHONE",
      basePrice: new Prisma.Decimal("50.00"),
      isActive: false,
      images: [],
      colors: {
        create: [{ name: inactiveColor, stock: 5 }],
      },
    },
    select: { id: true },
  });
  inactiveProductId = inactive.id;
  createdProductIds.push(inactive.id);
});

after(async () => {
  if (!prisma) return;

  if (createdProductIds.length > 0) {
    await prisma.color.deleteMany({
      where: { productId: { in: createdProductIds } },
    });
    await prisma.product.deleteMany({
      where: { id: { in: createdProductIds } },
    });
  }

  if (server) {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }
  await prisma.$disconnect();
});

test("quantity within stock returns ok with unitPrice equal to basePrice", async () => {
  const response = await postAvailability({
    items: [{ productId: activeProductId, color: inStockColor, quantity: 2 }],
  });
  assert.equal(response.status, 200);

  const body = await response.json();
  const line = lineAt(body, 0);

  assert.equal(stringField(line, "status"), "ok");
  assert.equal(numberField(line, "available"), 5);
  assert.equal(numberField(line, "quantity"), 2);
  assert.equal(stringField(line, "unitPrice"), "100.00");
  assert.equal(stringField(line, "productId"), activeProductId);
  assert.equal(stringField(line, "color"), inStockColor);
});

test("quantity above stock returns insufficient", async () => {
  const response = await postAvailability({
    items: [{ productId: activeProductId, color: inStockColor, quantity: 6 }],
  });
  assert.equal(response.status, 200);

  const line = lineAt(await response.json(), 0);
  assert.equal(stringField(line, "status"), "insufficient");
  assert.equal(numberField(line, "available"), 5);
});

test("zero-stock colour returns unavailable", async () => {
  const response = await postAvailability({
    items: [{ productId: activeProductId, color: zeroStockColor, quantity: 1 }],
  });
  assert.equal(response.status, 200);

  const line = lineAt(await response.json(), 0);
  assert.equal(stringField(line, "status"), "unavailable");
  assert.equal(numberField(line, "available"), 0);
});

test("inactive product returns unavailable", async () => {
  const response = await postAvailability({
    items: [{ productId: inactiveProductId, color: inactiveColor, quantity: 1 }],
  });
  assert.equal(response.status, 200);

  const line = lineAt(await response.json(), 0);
  assert.equal(stringField(line, "status"), "unavailable");
  assert.equal(numberField(line, "available"), 0);
});

test("unknown colour and unknown product return the same status and shape", async () => {
  const unknownColour = await postAvailability({
    items: [{ productId: activeProductId, color: "Purple", quantity: 1 }],
  });
  const unknownProduct = await postAvailability({
    items: [{ productId: randomUUID(), color: inStockColor, quantity: 1 }],
  });

  assert.equal(unknownColour.status, 200);
  assert.equal(unknownProduct.status, 200);

  const colourLine = lineAt(await unknownColour.json(), 0);
  const productLine = lineAt(await unknownProduct.json(), 0);

  assert.equal(stringField(colourLine, "status"), "unavailable");
  assert.equal(stringField(productLine, "status"), "unavailable");
  if (!isRecord(colourLine) || !isRecord(productLine)) {
    throw new Error("Expected availability result lines to be objects");
  }
  assert.deepEqual(
    Object.keys(colourLine).sort(),
    Object.keys(productLine).sort(),
  );
});

test("every result line has exactly the documented keys", async () => {
  const response = await postAvailability({
    items: [
      { productId: activeProductId, color: inStockColor, quantity: 1 },
      { productId: activeProductId, color: zeroStockColor, quantity: 1 },
      { productId: inactiveProductId, color: inactiveColor, quantity: 1 },
      { productId: randomUUID(), color: "Purple", quantity: 1 },
    ],
  });
  assert.equal(response.status, 200);

  const body = await response.json();
  const lines = linesOf(body);
  assert.equal(lines.length, 4);

  for (const line of lines) {
    if (!isRecord(line)) {
      throw new Error("Expected an availability result line to be an object");
    }
    assert.deepEqual(Object.keys(line).sort(), [...RESULT_KEYS].sort());
  }
});

test("quantity 0, 1.5 and 11 return 400 naming the field", async () => {
  for (const quantity of [0, 1.5, 11]) {
    const response = await postAvailability({
      items: [{ productId: activeProductId, color: inStockColor, quantity }],
    });
    assert.equal(response.status, 400);

    const body = await response.json();
    const details = field(body, "details");
    assert.ok(Array.isArray(details) && details.length > 0);
    const first = details[0];
    const detailField = stringField(first, "field");
    assert.ok(detailField && detailField.includes("quantity"));
  }
});

test("51 lines return 400", async () => {
  const items = Array.from({ length: 51 }, () => ({
    productId: activeProductId,
    color: inStockColor,
    quantity: 1,
  }));

  const response = await postAvailability({ items });
  assert.equal(response.status, 400);

  const body = await response.json();
  const details = field(body, "details");
  assert.ok(Array.isArray(details) && details.length > 0);
  assert.ok(stringField(details[0], "field")?.includes("items"));
});
