import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import bcrypt from "bcryptjs";
import { Prisma, Role } from "@prisma/client";
import { after, before, test } from "node:test";

// ---------------------------------------------------------------------------
// DATABASE_URL_TEST guard. Runs at module load, before the app and the
// Prisma client are imported (both are imported inside before()).
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

type AppModule = typeof import("../src/app");
type PrismaModule = typeof import("../src/lib/prisma");

let app: AppModule["default"];
let prisma: PrismaModule["prisma"];
let server: Server;
let baseUrl: string;

let adminId = "";
let customerId = "";
let adminToken = "";
let customerToken = "";
let loginPassword = "";
const suffix = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;

const createdProductIds: string[] = [];
const createdOrderIds: string[] = [];
let zeroStockProductId = "";
let zeroStockColorId = "";

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

  loginPassword = `Passw0rd-${suffix}`;
  const passwordHash = await bcrypt.hash(loginPassword, 12);

  const admin = await prisma.user.create({
    data: {
      name: "Admin HTTP Test",
      email: `admin-http-${suffix}@test.local`,
      phone: "0240000001",
      passwordHash,
      role: Role.ADMIN,
    },
    select: { id: true },
  });
  adminId = admin.id;

  const customer = await prisma.user.create({
    data: {
      name: "Customer HTTP Test",
      email: `customer-http-${suffix}@test.local`,
      phone: "0240000002",
      passwordHash,
      role: Role.CUSTOMER,
    },
    select: { id: true },
  });
  customerId = customer.id;

  adminToken = await signIn(`admin-http-${suffix}@test.local`);
  customerToken = await signIn(`customer-http-${suffix}@test.local`);
});

after(async () => {
  if (!prisma) return;

  const colors = createdProductIds.length > 0
    ? await prisma.color.findMany({
        where: { productId: { in: createdProductIds } },
        select: { id: true },
      })
    : [];
  const colorIds = colors.map((color) => color.id);

  if (colorIds.length > 0) {
    await prisma.inventoryLog.deleteMany({ where: { colorId: { in: colorIds } } });
  }
  if (createdOrderIds.length > 0) {
    await prisma.orderItem.deleteMany({
      where: { orderId: { in: createdOrderIds } },
    });
    await prisma.order.deleteMany({ where: { id: { in: createdOrderIds } } });
  }
  await prisma.adminLog.deleteMany({ where: { adminId } });
  if (createdProductIds.length > 0) {
    await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
  }
  await prisma.user.deleteMany({ where: { id: { in: [adminId, customerId] } } });

  if (server) {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------
// Helpers. No `as` casts: JSON fields are read through guards.
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

function booleanField(value: unknown, key: string): boolean | null {
  const raw = field(value, key);
  return typeof raw === "boolean" ? raw : null;
}

function arrayOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function firstColor(body: unknown): unknown {
  return arrayOf(field(body, "colors"))[0];
}

function idList(body: unknown): (string | null)[] {
  return arrayOf(body).map((item) => stringField(item, "id"));
}

interface HttpResult {
  status: number;
  body: unknown;
}

async function request(
  path: string,
  init: RequestInit,
  token?: string,
): Promise<HttpResult> {
  const headers = new Headers(init.headers);
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers });
  const body: unknown = await response.json();
  return { status: response.status, body };
}

async function requestJson(
  method: string,
  path: string,
  payload: unknown,
  token?: string,
): Promise<HttpResult> {
  return request(
    path,
    {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    token,
  );
}

async function signIn(email: string): Promise<string> {
  const result = await requestJson(
    "POST",
    "/auth/login",
    {
      email,
      password: loginPassword,
    },
  );
  if (result.status !== 200) {
    throw new Error(`Login failed with status ${result.status}`);
  }
  const token = stringField(result.body, "token");
  if (!token) {
    throw new Error("Login response has no token");
  }
  return token;
}

function trackProduct(id: string): void {
  createdProductIds.push(id);
}

function uniqueName(prefix: string): string {
  return `${prefix} ${suffix}`;
}

function baseProductBody(name: string): Record<string, unknown> {
  return {
    name,
    brand: "TestBrand",
    category: "IPHONE",
    description: "HTTP fixture product",
    basePrice: "100.00",
    colors: [{ name: "Black", stock: 1 }],
  };
}

async function createProductOverHttp(
  name: string,
  overrides: Record<string, unknown> = {},
): Promise<HttpResult> {
  const result = await requestJson(
    "POST",
    "/admin/products",
    { ...baseProductBody(name), ...overrides },
    adminToken,
  );
  const id = stringField(result.body, "id");
  if (result.status === 201 && id) {
    trackProduct(id);
  }
  return result;
}

// ---------------------------------------------------------------------------
test("a. GET /admin/products without a token returns 401", async () => {
  const result = await request("/admin/products", { method: "GET" });
  assert.equal(result.status, 401);
  assert.equal(stringField(result.body, "error"), "Unauthorized");
});

// ---------------------------------------------------------------------------
test("b. GET /admin/products with a CUSTOMER token returns 403", async () => {
  const result = await request("/admin/products", { method: "GET" }, customerToken);
  assert.equal(result.status, 403);
  assert.equal(stringField(result.body, "error"), "Forbidden");
});

// ---------------------------------------------------------------------------
test("c. GET /admin/products with an ADMIN token returns 200 and includes an inactive product", async () => {
  const created = await createProductOverHttp(uniqueName("Inactive Fixture"), {
    isActive: false,
  });
  assert.equal(created.status, 201);
  const inactiveId = stringField(created.body, "id");
  assert.ok(inactiveId !== null);

  const result = await request("/admin/products", { method: "GET" }, adminToken);
  assert.equal(result.status, 200);
  assert.ok(Array.isArray(result.body));

  const match = arrayOf(result.body).find(
    (item) => stringField(item, "id") === inactiveId,
  );
  assert.ok(match !== undefined, "inactive product must be listed");
  assert.equal(booleanField(match, "isActive"), false);
});

// ---------------------------------------------------------------------------
test("d. POST /admin/products 201, admin GET lists it, public GET /products shows it with soldOut true", async () => {
  const created = await createProductOverHttp(uniqueName("Zero Stock Fixture"), {
    colors: [{ name: "Black", stock: 0 }],
  });
  assert.equal(created.status, 201);
  const id = stringField(created.body, "id");
  assert.ok(id !== null);
  const price = stringField(created.body, "basePrice");
  assert.ok(price !== null);
  assert.equal(Number(price), 100);

  const colorId = stringField(firstColor(created.body), "id");
  assert.ok(colorId !== null);
  zeroStockProductId = id;
  zeroStockColorId = colorId;

  const adminList = await request("/admin/products", { method: "GET" }, adminToken);
  assert.equal(adminList.status, 200);
  assert.ok(idList(adminList.body).includes(id), "admin list must include it");

  const publicList = await request("/products", { method: "GET" });
  assert.equal(publicList.status, 200);
  const listed = arrayOf(publicList.body).find(
    (item) => stringField(item, "id") === id,
  );
  assert.ok(listed !== undefined, "public list must contain the product");
  assert.equal(numberField(listed, "stock"), 0);
  assert.equal(booleanField(listed, "soldOut"), true);
});

// ---------------------------------------------------------------------------
test("p. restock 3 on the zero-stock product makes GET /products report soldOut false", async () => {
  assert.ok(zeroStockProductId !== "", "test d must create the product");
  assert.ok(zeroStockColorId !== "", "test d must create the colour");

  const restocked = await requestJson(
    "POST",
    `/admin/products/${zeroStockProductId}/colors/${zeroStockColorId}/restock`,
    { quantity: 3 },
    adminToken,
  );
  assert.equal(restocked.status, 200);

  const publicList = await request("/products", { method: "GET" });
  assert.equal(publicList.status, 200);
  const listed = arrayOf(publicList.body).find(
    (item) => stringField(item, "id") === zeroStockProductId,
  );
  assert.ok(listed !== undefined, "product must still be listed after restock");
  assert.equal(numberField(listed, "stock"), 3);
  assert.equal(booleanField(listed, "soldOut"), false);
});

// ---------------------------------------------------------------------------
test("e. POST /admin/products with basePrice 12.345 returns 400", async () => {
  const result = await createProductOverHttp(uniqueName("Bad Price Fixture"), {
    basePrice: "12.345",
  });
  assert.equal(result.status, 400);
  const message = stringField(result.body, "error");
  assert.ok(message !== null, "400 body must carry an error message");
  assert.ok(message.startsWith("basePrice"), `unexpected message: ${message}`);
});

// ---------------------------------------------------------------------------
test("f. POST /admin/products with a duplicate colour name returns 400", async () => {
  const result = await createProductOverHttp(uniqueName("Duplicate Colour"), {
    colors: [
      { name: "Black", stock: 1 },
      { name: "black", stock: 2 },
    ],
  });
  assert.equal(result.status, 400);
  const message = stringField(result.body, "error");
  assert.ok(message !== null, "400 body must carry an error message");
  assert.ok(message.startsWith("colors"), `unexpected message: ${message}`);
});

// ---------------------------------------------------------------------------
test("g. PATCH changing basePrice returns 200, keeps OrderItem.unitPrice, logs old and new values", async () => {
  const created = await createProductOverHttp(uniqueName("Order Fixture"));
  assert.equal(created.status, 201);
  const productId = stringField(created.body, "id");
  assert.ok(productId !== null);
  const colorId = stringField(firstColor(created.body), "id");
  assert.ok(colorId !== null);

  const order = await prisma.order.create({
    data: {
      reference: `HTTP-${suffix}`,
      userId: customerId,
      customerName: "HTTP Test Customer",
      customerEmail: `customer-http-${suffix}@test.local`,
      customerPhone: "0240000002",
      region: "Greater Accra",
      address: "1 Test Street, Accra",
      deliveryFee: new Prisma.Decimal("10.00"),
      total: new Prisma.Decimal("110.00"),
    },
    select: { id: true },
  });
  createdOrderIds.push(order.id);

  const orderItem = await prisma.orderItem.create({
    data: {
      orderId: order.id,
      productId,
      colorId,
      quantity: 1,
      unitPrice: new Prisma.Decimal("100.00"),
    },
    select: { id: true },
  });

  const patched = await requestJson(
    "PATCH",
    `/admin/products/${productId}`,
    { basePrice: "200.00" },
    adminToken,
  );
  assert.equal(patched.status, 200);
  const newPrice = stringField(patched.body, "basePrice");
  assert.ok(newPrice !== null);
  assert.equal(Number(newPrice), 200);

  const item = await prisma.orderItem.findUnique({
    where: { id: orderItem.id },
    select: { unitPrice: true },
  });
  assert.ok(item !== null);
  assert.equal(item.unitPrice.toNumber(), 100);

  const log = await prisma.adminLog.findFirst({
    where: { entityId: productId, action: "PRODUCT_UPDATE" },
    select: { meta: true },
  });
  assert.ok(log !== null, "AdminLog row must exist for the price change");
  const beforeMeta = field(log.meta, "before");
  const afterMeta = field(log.meta, "after");
  const oldPrice = field(beforeMeta, "basePrice");
  const loggedPrice = field(afterMeta, "basePrice");
  assert.equal(typeof oldPrice, "string");
  assert.equal(typeof loggedPrice, "string");
  assert.equal(Number(oldPrice), 100);
  assert.equal(Number(loggedPrice), 200);
});

// ---------------------------------------------------------------------------
test("h. PATCH /admin/products with an unknown id returns 404", async () => {
  const unknownId = `missing-product-${suffix}`;
  const result = await requestJson(
    "PATCH",
    `/admin/products/${unknownId}`,
    { basePrice: "50.00" },
    adminToken,
  );
  assert.equal(result.status, 404);
  assert.equal(stringField(result.body, "error"), "Product not found");
});

// ---------------------------------------------------------------------------
test("i. PATCH with an empty body returns 400", async () => {
  const created = await createProductOverHttp(uniqueName("Empty Patch"));
  assert.equal(created.status, 201);
  const productId = stringField(created.body, "id");
  assert.ok(productId !== null);

  const result = await request(
    `/admin/products/${productId}`,
    { method: "PATCH" },
    adminToken,
  );
  assert.equal(result.status, 400);
  const message = stringField(result.body, "error");
  assert.ok(message !== null, "400 body must carry an error message");
});

// ---------------------------------------------------------------------------
test("j. POST restock 5 returns 200, stock grows by 5, InventoryLog records RESTOCK 5", async () => {
  const created = await createProductOverHttp(uniqueName("Restock Fixture"));
  assert.equal(created.status, 201);
  const productId = stringField(created.body, "id");
  assert.ok(productId !== null);
  const colorId = stringField(firstColor(created.body), "id");
  assert.ok(colorId !== null);
  assert.equal(numberField(firstColor(created.body), "stock"), 1);

  const result = await requestJson(
    "POST",
    `/admin/products/${productId}/colors/${colorId}/restock`,
    { quantity: 5 },
    adminToken,
  );
  assert.equal(result.status, 200);
  const color = field(result.body, "color");
  assert.equal(numberField(color, "stock"), 6);
  assert.equal(field(color, "id"), colorId);

  const stored = await prisma.color.findUnique({
    where: { id: colorId },
    select: { stock: true },
  });
  assert.equal(stored?.stock, 6);

  const log = await prisma.inventoryLog.findFirst({
    where: { colorId, reason: "RESTOCK" },
    select: { change: true, orderId: true },
  });
  assert.ok(log !== null, "RESTOCK InventoryLog row must exist");
  assert.equal(log.change, 5);
  assert.equal(log.orderId, null);
});

// ---------------------------------------------------------------------------
test("k. restock with a colour that belongs to another product returns 404 and stock is unchanged", async () => {
  const first = await createProductOverHttp(uniqueName("Wrong Colour A"));
  assert.equal(first.status, 201);
  const firstId = stringField(first.body, "id");
  assert.ok(firstId !== null);
  const firstColorId = stringField(firstColor(first.body), "id");
  assert.ok(firstColorId !== null);

  const second = await createProductOverHttp(uniqueName("Wrong Colour B"));
  assert.equal(second.status, 201);
  const secondId = stringField(second.body, "id");
  assert.ok(secondId !== null);

  const result = await requestJson(
    "POST",
    `/admin/products/${secondId}/colors/${firstColorId}/restock`,
    { quantity: 5 },
    adminToken,
  );
  assert.equal(result.status, 404);
  assert.equal(stringField(result.body, "error"), "Product not found");

  const stored = await prisma.color.findUnique({
    where: { id: firstColorId },
    select: { stock: true },
  });
  assert.equal(stored?.stock, 1);
});

// ---------------------------------------------------------------------------
test("l. POST restock with quantity 0, -1 or 1.5 returns 400", async () => {
  const created = await createProductOverHttp(uniqueName("Bad Quantity"));
  assert.equal(created.status, 201);
  const productId = stringField(created.body, "id");
  assert.ok(productId !== null);
  const colorId = stringField(firstColor(created.body), "id");
  assert.ok(colorId !== null);

  for (const quantity of [0, -1, 1.5]) {
    const result = await requestJson(
      "POST",
      `/admin/products/${productId}/colors/${colorId}/restock`,
      { quantity },
      adminToken,
    );
    assert.equal(result.status, 400, `quantity ${quantity} must be rejected`);
    const message = stringField(result.body, "error");
    assert.ok(message !== null, "400 body must carry an error message");
    assert.ok(message.startsWith("quantity"), `unexpected message: ${message}`);
  }

  const stored = await prisma.color.findUnique({
    where: { id: colorId },
    select: { stock: true },
  });
  assert.equal(stored?.stock, 1);
});

// ---------------------------------------------------------------------------
test("m. PATCH isActive false removes the product from GET /products", async () => {
  const created = await createProductOverHttp(uniqueName("Deactivate Me"));
  assert.equal(created.status, 201);
  const productId = stringField(created.body, "id");
  assert.ok(productId !== null);

  const beforeList = await request("/products", { method: "GET" });
  assert.equal(beforeList.status, 200);
  assert.ok(
    idList(beforeList.body).includes(productId),
    "active product must be listed before the patch",
  );

  const patched = await requestJson(
    "PATCH",
    `/admin/products/${productId}`,
    { isActive: false },
    adminToken,
  );
  assert.equal(patched.status, 200);
  assert.equal(booleanField(patched.body, "isActive"), false);

  const afterList = await request("/products", { method: "GET" });
  assert.equal(afterList.status, 200);
  assert.ok(
    !idList(afterList.body).includes(productId),
    "inactive product must disappear from the public list",
  );
});

// ---------------------------------------------------------------------------
test("n. GET /admin/fulfillment/queue with an ADMIN token returns 200", async () => {
  const result = await request(
    "/admin/fulfillment/queue",
    { method: "GET" },
    adminToken,
  );
  assert.equal(result.status, 200);
  assert.equal(stringField(result.body, "status"), "ok");
});

// ---------------------------------------------------------------------------
test("o. POST /admin/products/bulk dry run returns 200 and writes nothing", async () => {
  const name = uniqueName("Bulk Dry Run");
  const csv = [
    "id,name,brand,category,description,basePrice,isActive,colors",
    `,${name},TestBrand,IPHONE,Dry run row,99.00,true,Black:4`,
  ].join("\r\n");

  const form = new FormData();
  form.append("file", new Blob([csv], { type: "text/csv" }), "products.csv");

  const result = await request(
    "/admin/products/bulk",
    { method: "POST", body: form },
    adminToken,
  );
  assert.equal(result.status, 200);
  assert.equal(stringField(result.body, "mode"), "dry-run");
  assert.equal(booleanField(result.body, "committed"), false);
  assert.deepEqual(arrayOf(field(result.body, "errors")), []);

  const stored = await prisma.product.findFirst({ where: { name } });
  assert.equal(stored, null, "dry run must not write any product");
});

// ---------------------------------------------------------------------------
test("q. POST /admin/products stores validated iPhone specs exactly as sent", async () => {
  const specs = {
    storage: "256GB",
    colour: "Deep Purple",
    chip: "A17 Pro",
    camera: "48MP wide",
    screenSize: "6.1 inch",
    battery: "Up to 23 hours",
  };

  const created = await createProductOverHttp(uniqueName("iPhone Specs"), {
    specs,
  });
  assert.equal(created.status, 201);
  assert.deepEqual(field(created.body, "specs"), specs);

  const id = stringField(created.body, "id");
  assert.ok(id !== null);
  const stored = await prisma.product.findUnique({
    where: { id },
    select: { specs: true },
  });
  assert.deepEqual(stored?.specs, specs);
});

// ---------------------------------------------------------------------------
test("r. POST /admin/products with an iPhone RAM field returns 400 naming ram", async () => {
  const result = await createProductOverHttp(uniqueName("iPhone RAM"), {
    specs: {
      storage: "128GB",
      colour: "Black",
      chip: "A16",
      camera: "12MP",
      screenSize: "6.1 inch",
      battery: "Up to 20 hours",
      ram: "8GB",
    },
  });
  assert.equal(result.status, 400);
  const message = stringField(result.body, "error");
  assert.ok(message !== null, "400 body must carry an error message");
  assert.ok(message.startsWith("ram"), `unexpected message: ${message}`);
});

// ---------------------------------------------------------------------------
test("s. POST /admin/products with a laptop missing processor returns 400 naming processor", async () => {
  const result = await createProductOverHttp(uniqueName("Laptop No Processor"), {
    category: "LAPTOP",
    specs: {
      ram: "16GB",
      storage: "1TB",
      screenSize: "14 inch",
      graphics: "Integrated",
      batteryLife: "Up to 12 hours",
    },
  });
  assert.equal(result.status, 400);
  const message = stringField(result.body, "error");
  assert.ok(message !== null, "400 body must carry an error message");
  assert.ok(
    message.startsWith("processor"),
    `unexpected message: ${message}`,
  );
});

// ---------------------------------------------------------------------------
test("t. POST /admin/products with a Samsung storage of 64GB returns 400", async () => {
  const result = await createProductOverHttp(uniqueName("Samsung 64GB"), {
    category: "SAMSUNG",
    specs: {
      storage: "64GB",
      colour: "Phantom Black",
      ram: "8GB",
      camera: "50MP",
      screenSize: "6.2 inch",
      battery: "5000mAh",
    },
  });
  assert.equal(result.status, 400);
  const message = stringField(result.body, "error");
  assert.ok(message !== null, "400 body must carry an error message");
  assert.ok(message.startsWith("storage"), `unexpected message: ${message}`);
});

// ---------------------------------------------------------------------------
test("u. PATCH changing category without specs returns 400 and changes nothing", async () => {
  const specs = {
    storage: "128GB",
    colour: "Blue",
    chip: "A15",
    camera: "12MP",
    screenSize: "6.1 inch",
    battery: "Up to 19 hours",
  };
  const created = await createProductOverHttp(uniqueName("Category Change"), {
    specs,
  });
  assert.equal(created.status, 201);
  const id = stringField(created.body, "id");
  assert.ok(id !== null);

  const patched = await requestJson(
    "PATCH",
    `/admin/products/${id}`,
    { category: "SAMSUNG" },
    adminToken,
  );
  assert.equal(patched.status, 400);
  const message = stringField(patched.body, "error");
  assert.ok(message !== null, "400 body must carry an error message");
  assert.ok(message.startsWith("specs"), `unexpected message: ${message}`);

  const stored = await prisma.product.findUnique({
    where: { id },
    select: { category: true, specs: true },
  });
  assert.equal(stored?.category, "IPHONE");
  assert.deepEqual(stored?.specs, specs);
});

// ---------------------------------------------------------------------------
test("v. specs null is accepted only when explicitly sent", async () => {
  const specs = {
    storage: "512GB",
    colour: "Titanium",
    chip: "A17 Pro",
    camera: "48MP",
    screenSize: "6.7 inch",
    battery: "Up to 29 hours",
  };
  const created = await createProductOverHttp(uniqueName("Null Specs"), {
    specs,
  });
  assert.equal(created.status, 201);
  const id = stringField(created.body, "id");
  assert.ok(id !== null);

  const renamed = await requestJson(
    "PATCH",
    `/admin/products/${id}`,
    { name: uniqueName("Null Specs Renamed") },
    adminToken,
  );
  assert.equal(renamed.status, 200);
  assert.deepEqual(field(renamed.body, "specs"), specs);

  const cleared = await requestJson(
    "PATCH",
    `/admin/products/${id}`,
    { specs: null },
    adminToken,
  );
  assert.equal(cleared.status, 200);
  assert.equal(field(cleared.body, "specs"), null);

  const explicitNull = await createProductOverHttp(
    uniqueName("Explicit Null Specs"),
    { specs: null },
  );
  assert.equal(explicitNull.status, 201);
  assert.equal(field(explicitNull.body, "specs"), null);
});

// ---------------------------------------------------------------------------
test("w. POST /admin/products accepts a laptop with RAM 64GB", async () => {
  const specs = {
    processor: "Intel Core i9",
    ram: "64GB",
    storage: "2TB",
    screenSize: "16 inch",
    graphics: "Dedicated",
    batteryLife: "Up to 10 hours",
  };

  const created = await createProductOverHttp(uniqueName("Laptop 64GB"), {
    category: "LAPTOP",
    specs,
  });
  assert.equal(created.status, 201);
  assert.deepEqual(field(created.body, "specs"), specs);

  const id = stringField(created.body, "id");
  assert.ok(id !== null);
  const stored = await prisma.product.findUnique({
    where: { id },
    select: { specs: true },
  });
  assert.deepEqual(stored?.specs, specs);
});

// ---------------------------------------------------------------------------
test("x. POST /admin/products with a Samsung RAM of 32GB returns 400 naming ram", async () => {
  const result = await createProductOverHttp(uniqueName("Samsung 32GB RAM"), {
    category: "SAMSUNG",
    specs: {
      storage: "128GB",
      colour: "Phantom Black",
      ram: "32GB",
      camera: "50MP",
      screenSize: "6.2 inch",
      battery: "5000mAh",
    },
  });
  assert.equal(result.status, 400);
  const message = stringField(result.body, "error");
  assert.ok(message !== null, "400 body must carry an error message");
  assert.ok(message.startsWith("ram"), `unexpected message: ${message}`);
});

// ---------------------------------------------------------------------------
test("y. POST /admin/products with a laptop RAM of 48GB returns 400 naming ram", async () => {
  const result = await createProductOverHttp(uniqueName("Laptop 48GB RAM"), {
    category: "LAPTOP",
    specs: {
      processor: "Intel Core i7",
      ram: "48GB",
      storage: "1TB",
      screenSize: "14 inch",
      graphics: "Integrated",
      batteryLife: "Up to 12 hours",
    },
  });
  assert.equal(result.status, 400);
  const message = stringField(result.body, "error");
  assert.ok(message !== null, "400 body must carry an error message");
  assert.ok(message.startsWith("ram"), `unexpected message: ${message}`);
});
