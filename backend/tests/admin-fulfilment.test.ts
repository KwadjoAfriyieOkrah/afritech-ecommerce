import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { after, before, test } from "node:test";

import bcrypt from "bcryptjs";
import {
  FulfillmentStatus,
  PaymentStatus,
  Prisma,
  Role,
} from "../src/generated/prisma/client";

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

const suffix = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
const createdUserIds: string[] = [];
const createdOrderIds: string[] = [];
const createdRiderIds: string[] = [];
const createdProductIds: string[] = [];
const createdColorIds: string[] = [];
const createdZoneIds: string[] = [];

let adminId = "";
let customerId = "";
let adminToken = "";
let customerToken = "";
let loginPassword = "";
let zoneName = "";
let productId = "";

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

  const zone = await prisma.deliveryZone.create({
    data: {
      name: `Admin Fulfilment Zone ${suffix}`,
      fee: new Prisma.Decimal("10.00"),
      expectedDays: 3,
    },
    select: { id: true, name: true },
  });
  createdZoneIds.push(zone.id);
  zoneName = zone.name;

  const product = await prisma.product.create({
    data: {
      name: `Admin Fulfilment Phone ${suffix}`,
      brand: "TestBrand",
      category: "IPHONE",
      basePrice: new Prisma.Decimal("100.00"),
      images: [],
    },
    select: { id: true },
  });
  createdProductIds.push(product.id);
  productId = product.id;

  const color = await prisma.color.create({
    data: { productId: product.id, name: "Black", stock: 100 },
    select: { id: true },
  });
  createdColorIds.push(color.id);

  loginPassword = `Passw0rd-${suffix}`;
  const passwordHash = await bcrypt.hash(loginPassword, 12);

  const admin = await prisma.user.create({
    data: {
      name: "Admin Fulfilment",
      email: `admin-fulfilment-${suffix}@test.local`,
      phone: "0240000011",
      passwordHash,
      role: Role.ADMIN,
    },
    select: { id: true },
  });
  adminId = admin.id;
  createdUserIds.push(admin.id);

  const customer = await prisma.user.create({
    data: {
      name: "Customer Fulfilment",
      email: `customer-fulfilment-${suffix}@test.local`,
      phone: "0240000012",
      passwordHash,
      role: Role.CUSTOMER,
    },
    select: { id: true },
  });
  customerId = customer.id;
  createdUserIds.push(customer.id);

  adminToken = await signIn(`admin-fulfilment-${suffix}@test.local`);
  customerToken = await signIn(`customer-fulfilment-${suffix}@test.local`);
});

after(async () => {
  if (!prisma) return;

  if (createdOrderIds.length > 0) {
    await prisma.paymentAttempt.deleteMany({
      where: { orderId: { in: createdOrderIds } },
    });
    await prisma.reconciliationEntry.deleteMany({
      where: { orderId: { in: createdOrderIds } },
    });
    await prisma.dailySale.deleteMany({
      where: { orderId: { in: createdOrderIds } },
    });
    await prisma.inventoryLog.deleteMany({
      where: { orderId: { in: createdOrderIds } },
    });
    await prisma.orderItem.deleteMany({
      where: { orderId: { in: createdOrderIds } },
    });
    await prisma.order.deleteMany({
      where: { id: { in: createdOrderIds } },
    });
  }

  if (createdRiderIds.length > 0) {
    await prisma.rider.deleteMany({
      where: { id: { in: createdRiderIds } },
    });
  }

  await prisma.adminLog.deleteMany({ where: { adminId } });

  if (createdColorIds.length > 0) {
    await prisma.inventoryLog.deleteMany({
      where: { colorId: { in: createdColorIds } },
    });
    await prisma.orderItem.deleteMany({
      where: { colorId: { in: createdColorIds } },
    });
    await prisma.color.deleteMany({
      where: { id: { in: createdColorIds } },
    });
  }

  if (createdProductIds.length > 0) {
    await prisma.product.deleteMany({
      where: { id: { in: createdProductIds } },
    });
  }

  if (createdZoneIds.length > 0) {
    await prisma.deliveryZone.deleteMany({
      where: { id: { in: createdZoneIds } },
    });
  }

  if (createdUserIds.length > 0) {
    await prisma.user.deleteMany({
      where: { id: { in: createdUserIds } },
    });
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

function hasKey(value: unknown, key: string): boolean {
  return typeof value === "object" && value !== null && Reflect.has(value, key);
}

function assertNoSensitiveFields(value: unknown): void {
  assert.equal(hasKey(value, "accessTokenHash"), false);
  assert.equal(hasKey(value, "idempotencyKey"), false);
  assert.equal(hasKey(value, "customerEmail"), false);
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
  const result = await requestJson("POST", "/auth/login", {
    email,
    password: loginPassword,
  });
  if (result.status !== 200) {
    throw new Error(`Login failed with status ${result.status}`);
  }
  const token = stringField(result.body, "token");
  if (!token) {
    throw new Error("Login response has no token");
  }
  return token;
}

function nextId(): string {
  return `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
}

function riderPhone(): string {
  const digits = Math.floor(Math.random() * 10_000_000)
    .toString()
    .padStart(7, "0");
  return `024${digits}`;
}

interface GuestOrder {
  orderId: string;
  reference: string;
  phone: string;
}

async function createGuestOrder(paid: boolean): Promise<GuestOrder> {
  const id = nextId();
  const phone = "0244123456";
  const response = await fetch(`${baseUrl}/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": `admin-fulfilment-${id}-${randomUUID().slice(0, 8)}`,
    },
    body: JSON.stringify({
      customerName: "Admin Fulfilment Guest",
      customerEmail: `admin-fulfilment-${id}@test.local`,
      customerPhone: phone,
      deliveryArea: zoneName,
      deliveryAddress: "12 Admin Street, Accra",
      items: [{ productId, color: "Black", quantity: 1 }],
    }),
  });

  assert.equal(response.status, 201);
  const body: unknown = await response.json();
  const orderId = stringField(body, "id");
  const reference = stringField(body, "reference");
  assert.ok(orderId);
  assert.ok(reference);
  createdOrderIds.push(orderId);

  if (paid) {
    await prisma.order.update({
      where: { id: orderId },
      data: {
        paymentStatus: PaymentStatus.PAID,
        reservedUntil: null,
      },
    });
  }

  return { orderId, reference, phone };
}

interface RiderFixture {
  id: string;
  name: string;
  phone: string;
}

async function createRider(label: string): Promise<RiderFixture> {
  const name = `Rider ${label} ${suffix}`;
  const phone = riderPhone();
  const result = await requestJson(
    "POST",
    "/admin/riders",
    { name, phone },
    adminToken,
  );
  assert.equal(result.status, 201);
  const id = stringField(result.body, "id");
  assert.ok(id);
  assert.equal(stringField(result.body, "name"), name);
  assert.equal(stringField(result.body, "phone"), phone);
  assert.equal(booleanField(result.body, "isActive"), true);
  createdRiderIds.push(id);
  return { id, name, phone };
}

async function getOrderState(orderId: string) {
  return prisma.order.findUnique({
    where: { id: orderId },
    select: {
      paymentStatus: true,
      fulfillment: true,
      riderId: true,
      deliveredAt: true,
    },
  });
}

async function countOrderLog(orderId: string, action: string): Promise<number> {
  return prisma.adminLog.count({
    where: { entityId: orderId, entity: "Order", action },
  });
}

async function trackOrder(
  reference: string,
  phone: string,
): Promise<HttpResult> {
  const query = new URLSearchParams({ reference, phone });
  return request(`/orders/track?${query.toString()}`, { method: "GET" });
}

test("a CUSTOMER token gets 403 on every new admin route", async () => {
  const routes: Array<{
    method: string;
    path: string;
    payload?: unknown;
  }> = [
    { method: "GET", path: "/admin/orders" },
    { method: "GET", path: "/admin/orders/missing-order" },
    { method: "GET", path: "/admin/riders" },
    {
      method: "POST",
      path: "/admin/riders",
      payload: { name: "Blocked Rider", phone: "0244123456" },
    },
    {
      method: "POST",
      path: "/admin/orders/missing-order/rider",
      payload: { riderId: "missing-rider" },
    },
    { method: "POST", path: "/admin/orders/missing-order/packaging" },
    { method: "POST", path: "/admin/orders/missing-order/dispatch" },
    { method: "POST", path: "/admin/orders/missing-order/delivered" },
  ];

  for (const route of routes) {
    const result =
      route.payload === undefined
        ? await request(route.path, { method: route.method }, customerToken)
        : await requestJson(
            route.method,
            route.path,
            route.payload,
            customerToken,
          );
    assert.equal(result.status, 403, `${route.method} ${route.path}`);
    assert.equal(stringField(result.body, "error"), "Forbidden");
  }
});

test("packaging an unpaid order returns 409 and changes nothing", async () => {
  const order = await createGuestOrder(false);
  const result = await request(
    `/admin/orders/${order.orderId}/packaging`,
    { method: "POST" },
    adminToken,
  );

  assert.equal(result.status, 409);
  assert.equal(
    stringField(result.body, "error"),
    "Order changed, reload and try again",
  );

  const stored = await getOrderState(order.orderId);
  assert.equal(stored?.paymentStatus, PaymentStatus.PENDING);
  assert.equal(stored?.fulfillment, FulfillmentStatus.PENDING);
  assert.equal(stored?.deliveredAt, null);
  assert.equal(await countOrderLog(order.orderId, "ORDER_PACKAGING"), 0);
});

test("dispatch without a rider returns 409 and changes nothing", async () => {
  const order = await createGuestOrder(true);
  const packaged = await request(
    `/admin/orders/${order.orderId}/packaging`,
    { method: "POST" },
    adminToken,
  );
  assert.equal(packaged.status, 200);

  const result = await request(
    `/admin/orders/${order.orderId}/dispatch`,
    { method: "POST" },
    adminToken,
  );
  assert.equal(result.status, 409);
  assert.equal(stringField(result.body, "error"), "Assign a rider before dispatch");

  const stored = await getOrderState(order.orderId);
  assert.equal(stored?.fulfillment, FulfillmentStatus.PACKAGING);
  assert.equal(stored?.riderId, null);
  assert.equal(stored?.deliveredAt, null);
  assert.equal(await countOrderLog(order.orderId, "ORDER_DISPATCH"), 0);
});

test("the full path succeeds, audits each step and sets deliveredAt last", async () => {
  const order = await createGuestOrder(true);
  const rider = await createRider("full-path");

  const assigned = await requestJson(
    "POST",
    `/admin/orders/${order.orderId}/rider`,
    { riderId: rider.id },
    adminToken,
  );
  assert.equal(assigned.status, 200);

  const afterAssign = await getOrderState(order.orderId);
  assert.equal(afterAssign?.fulfillment, FulfillmentStatus.PENDING);
  assert.equal(afterAssign?.riderId, rider.id);
  assert.equal(afterAssign?.deliveredAt, null);
  assert.equal(
    await countOrderLog(order.orderId, "ORDER_RIDER_ASSIGN"),
    1,
  );

  const packaged = await request(
    `/admin/orders/${order.orderId}/packaging`,
    { method: "POST" },
    adminToken,
  );
  assert.equal(packaged.status, 200);

  const afterPackaging = await getOrderState(order.orderId);
  assert.equal(afterPackaging?.fulfillment, FulfillmentStatus.PACKAGING);
  assert.equal(afterPackaging?.deliveredAt, null);

  const trackedBeforeDispatch = await trackOrder(
    order.reference,
    order.phone,
  );
  assert.equal(trackedBeforeDispatch.status, 200);
  assert.equal(stringField(trackedBeforeDispatch.body, "status"), "packaging");
  assert.equal(field(trackedBeforeDispatch.body, "rider"), undefined);

  const dispatched = await request(
    `/admin/orders/${order.orderId}/dispatch`,
    { method: "POST" },
    adminToken,
  );
  assert.equal(dispatched.status, 200);

  const afterDispatch = await getOrderState(order.orderId);
  assert.equal(afterDispatch?.fulfillment, FulfillmentStatus.DISPATCHED);
  assert.equal(afterDispatch?.deliveredAt, null);

  const trackedAfterDispatch = await trackOrder(order.reference, order.phone);
  assert.equal(trackedAfterDispatch.status, 200);
  assert.equal(stringField(trackedAfterDispatch.body, "status"), "dispatched");
  const trackedRider = field(trackedAfterDispatch.body, "rider");
  assert.equal(stringField(trackedRider, "name"), rider.name);
  assert.equal(stringField(trackedRider, "phone"), rider.phone);

  const delivered = await request(
    `/admin/orders/${order.orderId}/delivered`,
    { method: "POST" },
    adminToken,
  );
  assert.equal(delivered.status, 200);

  const afterDelivered = await getOrderState(order.orderId);
  assert.equal(afterDelivered?.fulfillment, FulfillmentStatus.DELIVERED);
  assert.ok(afterDelivered?.deliveredAt instanceof Date);

  const logs = await prisma.adminLog.findMany({
    where: { entityId: order.orderId, entity: "Order" },
    select: { action: true, adminId: true, meta: true },
  });
  assert.equal(logs.length, 4);
  assert.ok(logs.every((log) => log.adminId === adminId));

  const byAction = new Map(logs.map((log) => [log.action, log]));
  const assignLog = byAction.get("ORDER_RIDER_ASSIGN");
  const packagingLog = byAction.get("ORDER_PACKAGING");
  const dispatchLog = byAction.get("ORDER_DISPATCH");
  const deliveredLog = byAction.get("ORDER_DELIVERED");
  assert.ok(assignLog);
  assert.ok(packagingLog);
  assert.ok(dispatchLog);
  assert.ok(deliveredLog);

  assert.equal(field(field(assignLog.meta, "before"), "riderId"), null);
  assert.equal(field(field(assignLog.meta, "after"), "riderId"), rider.id);
  assert.equal(
    field(field(packagingLog.meta, "before"), "fulfillment"),
    FulfillmentStatus.PENDING,
  );
  assert.equal(
    field(field(packagingLog.meta, "after"), "fulfillment"),
    FulfillmentStatus.PACKAGING,
  );
  assert.equal(
    field(field(dispatchLog.meta, "before"), "fulfillment"),
    FulfillmentStatus.PACKAGING,
  );
  assert.equal(
    field(field(dispatchLog.meta, "after"), "fulfillment"),
    FulfillmentStatus.DISPATCHED,
  );
  assert.equal(
    field(field(deliveredLog.meta, "after"), "fulfillment"),
    FulfillmentStatus.DELIVERED,
  );
  assert.equal(
    typeof field(field(deliveredLog.meta, "after"), "deliveredAt"),
    "string",
  );
});

test("skipping a stage returns 409 and leaves the order unchanged", async () => {
  const order = await createGuestOrder(true);
  const rider = await createRider("skip-stage");
  const assigned = await requestJson(
    "POST",
    `/admin/orders/${order.orderId}/rider`,
    { riderId: rider.id },
    adminToken,
  );
  assert.equal(assigned.status, 200);

  const result = await request(
    `/admin/orders/${order.orderId}/dispatch`,
    { method: "POST" },
    adminToken,
  );
  assert.equal(result.status, 409);
  assert.equal(
    stringField(result.body, "error"),
    "Order changed, reload and try again",
  );

  const stored = await getOrderState(order.orderId);
  assert.equal(stored?.fulfillment, FulfillmentStatus.PENDING);
  assert.equal(stored?.riderId, rider.id);
  assert.equal(await countOrderLog(order.orderId, "ORDER_DISPATCH"), 0);
});

test("two concurrent packaging requests produce one success and one audit row", async () => {
  const order = await createGuestOrder(true);
  const path = `/admin/orders/${order.orderId}/packaging`;

  const [first, second] = await Promise.all([
    request(path, { method: "POST" }, adminToken),
    request(path, { method: "POST" }, adminToken),
  ]);

  const statuses = [first.status, second.status].sort((a, b) => a - b);
  assert.deepEqual(statuses, [200, 409]);

  const conflict = first.status === 409 ? first : second;
  assert.equal(
    stringField(conflict.body, "error"),
    "Order changed, reload and try again",
  );

  const stored = await getOrderState(order.orderId);
  assert.equal(stored?.fulfillment, FulfillmentStatus.PACKAGING);
  assert.equal(await countOrderLog(order.orderId, "ORDER_PACKAGING"), 1);
});

test("rider assignment after dispatch returns 409 and keeps the rider", async () => {
  const order = await createGuestOrder(true);
  const firstRider = await createRider("first-rider");
  const secondRider = await createRider("second-rider");

  const assigned = await requestJson(
    "POST",
    `/admin/orders/${order.orderId}/rider`,
    { riderId: firstRider.id },
    adminToken,
  );
  assert.equal(assigned.status, 200);

  const packaged = await request(
    `/admin/orders/${order.orderId}/packaging`,
    { method: "POST" },
    adminToken,
  );
  assert.equal(packaged.status, 200);

  const dispatched = await request(
    `/admin/orders/${order.orderId}/dispatch`,
    { method: "POST" },
    adminToken,
  );
  assert.equal(dispatched.status, 200);

  const reassigned = await requestJson(
    "POST",
    `/admin/orders/${order.orderId}/rider`,
    { riderId: secondRider.id },
    adminToken,
  );
  assert.equal(reassigned.status, 409);
  assert.equal(
    stringField(reassigned.body, "error"),
    "Order changed, reload and try again",
  );

  const stored = await getOrderState(order.orderId);
  assert.equal(stored?.fulfillment, FulfillmentStatus.DISPATCHED);
  assert.equal(stored?.riderId, firstRider.id);
  assert.equal(
    await countOrderLog(order.orderId, "ORDER_RIDER_ASSIGN"),
    1,
  );
});

test("track shows the rider only after DISPATCHED", async () => {
  const order = await createGuestOrder(true);
  const rider = await createRider("track-rider");

  const assigned = await requestJson(
    "POST",
    `/admin/orders/${order.orderId}/rider`,
    { riderId: rider.id },
    adminToken,
  );
  assert.equal(assigned.status, 200);

  const packaged = await request(
    `/admin/orders/${order.orderId}/packaging`,
    { method: "POST" },
    adminToken,
  );
  assert.equal(packaged.status, 200);

  const beforeDispatch = await trackOrder(order.reference, order.phone);
  assert.equal(beforeDispatch.status, 200);
  assert.equal(field(beforeDispatch.body, "rider"), undefined);

  const dispatched = await request(
    `/admin/orders/${order.orderId}/dispatch`,
    { method: "POST" },
    adminToken,
  );
  assert.equal(dispatched.status, 200);

  const afterDispatch = await trackOrder(order.reference, order.phone);
  assert.equal(afterDispatch.status, 200);
  const trackedRider = field(afterDispatch.body, "rider");
  assert.equal(stringField(trackedRider, "name"), rider.name);
  assert.equal(stringField(trackedRider, "phone"), rider.phone);
});

test("creating a rider writes one Rider AdminLog row", async () => {
  const rider = await createRider("audit-rider");
  const logs = await prisma.adminLog.findMany({
    where: { entityId: rider.id, entity: "Rider" },
    select: { action: true, adminId: true, meta: true },
  });

  assert.equal(logs.length, 1);
  const log = logs[0];
  assert.ok(log);
  assert.equal(log.action, "RIDER_CREATE");
  assert.equal(log.adminId, adminId);
  assert.equal(field(field(log.meta, "after"), "name"), rider.name);
  assert.equal(field(field(log.meta, "after"), "phone"), rider.phone);
});

test("admin list, filter, detail and active riders return the expected shape", async () => {
  const order = await createGuestOrder(true);
  const rider = await createRider("list-rider");

  const assigned = await requestJson(
    "POST",
    `/admin/orders/${order.orderId}/rider`,
    { riderId: rider.id },
    adminToken,
  );
  assert.equal(assigned.status, 200);

  const packaged = await request(
    `/admin/orders/${order.orderId}/packaging`,
    { method: "POST" },
    adminToken,
  );
  assert.equal(packaged.status, 200);

  const list = await request("/admin/orders", { method: "GET" }, adminToken);
  assert.equal(list.status, 200);
  const listItems = arrayOf(list.body);
  const listed = listItems.find(
    (item) => stringField(item, "id") === order.orderId,
  );
  assert.ok(listed);
  assert.equal(stringField(listed, "reference"), order.reference);
  assert.equal(stringField(listed, "paymentStatus"), "PAID");
  assert.equal(stringField(listed, "fulfillment"), "PACKAGING");
  assert.equal(stringField(listed, "customerName"), "Admin Fulfilment Guest");
  assert.equal(stringField(listed, "customerPhone"), order.phone);
  assert.equal(stringField(listed, "deliveryArea"), zoneName);
  assert.equal(
    stringField(listed, "deliveryAddress"),
    "12 Admin Street, Accra",
  );
  assert.ok((numberField(listed, "total") ?? 0) > 0);
  assert.equal(stringField(listed, "riderId"), rider.id);
  assert.ok(stringField(listed, "createdAt") !== null);
  assertNoSensitiveFields(listed);

  const timestamps = listItems.map((item) => {
    const value = stringField(item, "createdAt");
    assert.ok(value !== null);
    return Date.parse(value);
  });
  for (let index = 1; index < timestamps.length; index += 1) {
    assert.ok(
      (timestamps[index - 1] ?? 0) >= (timestamps[index] ?? 0),
      "orders must be newest first",
    );
  }

  const filtered = await request(
    "/admin/orders?fulfillment=PACKAGING",
    { method: "GET" },
    adminToken,
  );
  assert.equal(filtered.status, 200);
  const filteredItems = arrayOf(filtered.body);
  assert.ok(
    filteredItems.some(
      (item) => stringField(item, "id") === order.orderId,
    ),
  );
  assert.ok(
    filteredItems.every(
      (item) => stringField(item, "fulfillment") === "PACKAGING",
    ),
  );

  const badFilter = await request(
    "/admin/orders?fulfillment=BOGUS",
    { method: "GET" },
    adminToken,
  );
  assert.equal(badFilter.status, 400);
  assert.ok(
    (stringField(badFilter.body, "error") ?? "").startsWith("fulfillment"),
  );

  const detail = await request(
    `/admin/orders/${order.orderId}`,
    { method: "GET" },
    adminToken,
  );
  assert.equal(detail.status, 200);
  assert.equal(stringField(detail.body, "id"), order.orderId);
  assert.equal(stringField(detail.body, "paymentStatus"), "PAID");
  assert.equal(stringField(detail.body, "fulfillment"), "PACKAGING");
  assert.equal(stringField(detail.body, "riderId"), rider.id);
  assert.equal(field(detail.body, "deliveredAt"), null);
  assertNoSensitiveFields(detail.body);

  const items = arrayOf(field(detail.body, "items"));
  assert.equal(items.length, 1);
  const item = items[0];
  assert.ok(item);
  assert.equal(field(item, "productId"), productId);
  assert.equal(stringField(item, "color"), "Black");
  assert.equal(numberField(item, "quantity"), 1);
  assert.equal(numberField(item, "price"), 100);

  const detailRider = field(detail.body, "rider");
  assert.equal(stringField(detailRider, "name"), rider.name);
  assert.equal(stringField(detailRider, "phone"), rider.phone);

  const missing = await request(
    `/admin/orders/${nextId()}`,
    { method: "GET" },
    adminToken,
  );
  assert.equal(missing.status, 404);
  assert.equal(stringField(missing.body, "error"), "Order not found");

  const inactive = await prisma.rider.create({
    data: {
      name: `Inactive Rider ${suffix}`,
      phone: riderPhone(),
      isActive: false,
    },
    select: { id: true },
  });
  createdRiderIds.push(inactive.id);

  const riders = await request("/admin/riders", { method: "GET" }, adminToken);
  assert.equal(riders.status, 200);
  const riderItems = arrayOf(riders.body);
  assert.ok(
    riderItems.some((item) => stringField(item, "id") === rider.id),
  );
  assert.ok(
    !riderItems.some((item) => stringField(item, "id") === inactive.id),
  );
  assert.ok(
    riderItems.every((item) => booleanField(item, "isActive") === true),
  );
});
