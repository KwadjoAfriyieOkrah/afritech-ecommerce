import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { after, before, test } from "node:test";

import type {
  PaymentAttemptStatus as PaymentAttemptStatusType,
  PaymentStatus as PaymentStatusType,
  ReconciliationReason as ReconciliationReasonType,
} from "@prisma/client";

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

// Required after the override so lib/env and PrismaClient bind to the test DB.
const { prisma } = require("../src/lib/prisma") as typeof import("../src/lib/prisma");
const { releaseExpiredReservations } = require("../src/services/reservations.service") as typeof import("../src/services/reservations.service");
const { settleAttempt } = require("../src/services/payments.service") as typeof import("../src/services/payments.service");
const {
  PaymentAttemptStatus,
  PaymentStatus,
  Prisma,
  ReconciliationReason,
} = require("@prisma/client") as typeof import("@prisma/client");
const appModule = require("../src/app") as typeof import("../src/app");

const app = appModule.default;

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
  if (server) {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }
  await prisma.$disconnect();
});

function nextSuffix(): string {
  return `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
}

function field(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  return Reflect.get(value, key);
}

function stringField(value: unknown, key: string): string | null {
  const raw = field(value, key);
  return typeof raw === "string" ? raw : null;
}

interface CleanupIds {
  orderIds?: string[];
  productIds?: string[];
  colorIds?: string[];
  zoneIds?: string[];
}

// Reverse-dependency order: attempts and ledgers before orders, orders before
// colors and products.
async function deleteTestData(ids: CleanupIds): Promise<void> {
  const orderIds = ids.orderIds ?? [];
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
}

interface RaceFixture {
  orderId: string;
  reference: string;
  startingStock: number;
  quantity: number;
  providerAmount: string;
  providerTransactionId: string;
}

async function createRaceFixture(cleanup: CleanupIds): Promise<RaceFixture> {
  const suffix = nextSuffix();

  const zone = await prisma.deliveryZone.create({
    data: {
      name: `Race Zone ${suffix}`,
      fee: new Prisma.Decimal("10.00"),
      expectedDays: 3,
    },
    select: { id: true, name: true },
  });
  cleanup.zoneIds = [zone.id];

  const product = await prisma.product.create({
    data: {
      name: `Race Phone ${suffix}`,
      brand: "TestBrand",
      category: "IPHONE",
      basePrice: new Prisma.Decimal("100.00"),
      images: [],
    },
    select: { id: true },
  });
  cleanup.productIds = [product.id];

  const startingStock = 10;
  const quantity = 1;
  const color = await prisma.color.create({
    data: { productId: product.id, name: "Black", stock: startingStock },
    select: { id: true },
  });
  cleanup.colorIds = [color.id];

  const created = await fetch(`${baseUrl}/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": `reservation-race-${suffix}`,
    },
    body: JSON.stringify({
      customerName: "Race Guest",
      customerEmail: "race@test.local",
      customerPhone: "0244123456",
      deliveryArea: zone.name,
      deliveryAddress: "7 Race Street, Accra",
      items: [{ productId: product.id, color: "Black", quantity }],
    }),
  });
  assert.equal(created.status, 201);
  const createdBody = await created.json();
  const orderId = stringField(createdBody, "id");
  const accessToken = stringField(createdBody, "accessToken");
  assert.ok(orderId);
  assert.ok(accessToken);
  cleanup.orderIds = [orderId];

  const initialized = await fetch(`${baseUrl}/payments/initialize`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-order-access-token": accessToken,
    },
    body: JSON.stringify({ orderId }),
  });
  assert.equal(initialized.status, 200);
  const initializedBody = await initialized.json();
  const reference = stringField(initializedBody, "reference");
  assert.ok(reference);

  const attemptsBefore = await prisma.paymentAttempt.findMany({
    where: { orderId },
    select: { id: true, status: true },
  });
  assert.equal(attemptsBefore.length, 1);
  const attempt = attemptsBefore[0];
  assert.ok(attempt);
  assert.equal(attempt.status, PaymentAttemptStatus.INITIALIZED);

  // Expire the reservation after the attempt exists, so the sweep selects it.
  await prisma.order.update({
    where: { id: orderId },
    data: { reservedUntil: new Date(Date.now() - 60 * 1000) },
  });

  const orderRow = await prisma.order.findUnique({
    where: { id: orderId },
    select: { total: true },
  });
  assert.ok(orderRow);
  const providerAmount = new Prisma.Decimal(orderRow.total)
    .times(100)
    .toFixed(0);

  return {
    orderId,
    reference,
    startingStock,
    quantity,
    providerAmount,
    providerTransactionId: `race-${suffix}`,
  };
}

interface ReconciliationObservation {
  reason: ReconciliationReasonType;
  orderId: string | null;
}

interface RaceOutcome {
  paymentStatus: PaymentStatusType | null;
  stock: number | null;
  attemptStatuses: PaymentAttemptStatusType[];
  reconciliation: ReconciliationObservation[];
}

async function readOutcome(
  orderId: string,
  attemptReference: string,
): Promise<RaceOutcome> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      paymentStatus: true,
      items: {
        select: { colorId: true },
        orderBy: { id: "asc" },
      },
    },
  });

  const colorId = order?.items[0]?.colorId;
  const color = colorId
    ? await prisma.color.findUnique({
        where: { id: colorId },
        select: { stock: true },
      })
    : null;

  const attempts = await prisma.paymentAttempt.findMany({
    where: { orderId },
    select: { status: true },
    orderBy: { createdAt: "asc" },
  });

  const reconciliation = await prisma.reconciliationEntry.findMany({
    where: {
      OR: [
        { orderId },
        { attempt: { reference: attemptReference } },
      ],
    },
    select: { reason: true, orderId: true },
    orderBy: { createdAt: "asc" },
  });

  return {
    paymentStatus: order?.paymentStatus ?? null,
    stock: color?.stock ?? null,
    attemptStatuses: attempts.map((attempt) => attempt.status),
    reconciliation,
  };
}

function settle(fixture: RaceFixture) {
  return settleAttempt({
    reference: fixture.reference,
    providerAmount: fixture.providerAmount,
    providerCurrency: "GHS",
    paidAt: new Date(),
    providerTransactionId: fixture.providerTransactionId,
    source: "verify",
  });
}

function observedSummary(observed: RaceOutcome): string {
  const statuses =
    observed.attemptStatuses.length === 0
      ? "[]"
      : `[${observed.attemptStatuses.join(",")}]`;
  return [
    `paymentStatus=${observed.paymentStatus ?? "MISSING"}`,
    `stock=${observed.stock ?? "MISSING"}`,
    `attemptStatuses=${statuses}`,
    `reconciliationCount=${observed.reconciliation.length}`,
  ].join(" ");
}

function logRaceOutcome(
  mode: string,
  outcomeLabel: string | null,
  sweepReleased: number,
  settleOutcome: string,
  observed: RaceOutcome,
): void {
  const outcomePart = outcomeLabel ? ` outcome=${outcomeLabel}` : "";
  console.log(
    `RACE_OUTCOME mode=${mode}${outcomePart} sweep_released=${sweepReleased > 0} settle=${settleOutcome} final_status=${observed.paymentStatus ?? "PENDING"}`,
  );
}

interface ExpectedOutcome {
  paymentStatus: PaymentStatusType;
  stock: number;
  attemptStatuses: PaymentAttemptStatusType[];
  reconciliationCount: number;
  reconciliationReason?: ReconciliationReasonType;
  reconciliationOrderId?: string;
}

function sameStatuses(
  actual: PaymentAttemptStatusType[],
  expected: PaymentAttemptStatusType[],
): boolean {
  return (
    actual.length === expected.length &&
    actual.every((status, index) => status === expected[index])
  );
}

function assertExpectedOutcome(
  mode: string,
  observed: RaceOutcome,
  expected: ExpectedOutcome,
): void {
  const problems: string[] = [];

  if (observed.paymentStatus !== expected.paymentStatus) {
    problems.push(
      `paymentStatus expected ${expected.paymentStatus} got ${observed.paymentStatus ?? "MISSING"}`,
    );
  }
  if (observed.stock !== expected.stock) {
    problems.push(
      `stock expected ${expected.stock} got ${observed.stock ?? "MISSING"}`,
    );
  }
  if (!sameStatuses(observed.attemptStatuses, expected.attemptStatuses)) {
    problems.push(
      `attemptStatuses expected [${expected.attemptStatuses.join(",")}] got [${observed.attemptStatuses.join(",")}]`,
    );
  }
  if (observed.reconciliation.length !== expected.reconciliationCount) {
    problems.push(
      `reconciliationCount expected ${expected.reconciliationCount} got ${observed.reconciliation.length}`,
    );
  }
  if (expected.reconciliationReason !== undefined) {
    const row = observed.reconciliation[0];
    if (row === undefined) {
      problems.push(
        `reconciliation reason expected ${expected.reconciliationReason} got no row`,
      );
    } else {
      if (row.reason !== expected.reconciliationReason) {
        problems.push(
          `reconciliation reason expected ${expected.reconciliationReason} got ${row.reason}`,
        );
      }
      if (
        expected.reconciliationOrderId !== undefined &&
        row.orderId !== expected.reconciliationOrderId
      ) {
        problems.push(
          `reconciliation orderId expected ${expected.reconciliationOrderId} got ${row.orderId ?? "null"}`,
        );
      }
    }
  }

  if (problems.length > 0) {
    console.log(`RACE_OBSERVED mode=${mode} ${observedSummary(observed)}`);
    assert.fail(
      `${mode}: unexpected outcome (${problems.join("; ")}). Observed ${observedSummary(observed)}`,
    );
  }
}

function classifyOutcome(
  observed: RaceOutcome,
  fixture: RaceFixture,
): "A" | "B" | null {
  const attemptSucceeded =
    observed.attemptStatuses.length === 1 &&
    observed.attemptStatuses[0] === PaymentAttemptStatus.SUCCEEDED;
  const reconciliationRow = observed.reconciliation[0];

  if (
    observed.paymentStatus === PaymentStatus.PAID &&
    observed.stock === fixture.startingStock - fixture.quantity &&
    attemptSucceeded &&
    observed.reconciliation.length === 0
  ) {
    return "A";
  }

  if (
    observed.paymentStatus === PaymentStatus.FAILED &&
    observed.stock === fixture.startingStock &&
    attemptSucceeded &&
    observed.reconciliation.length === 1 &&
    reconciliationRow !== undefined &&
    reconciliationRow.reason === ReconciliationReason.PAYMENT_AFTER_EXPIRY &&
    reconciliationRow.orderId === fixture.orderId
  ) {
    return "B";
  }

  return null;
}

test("settle then sweep leaves the order paid with stock reserved", async () => {
  const cleanup: CleanupIds = {};

  try {
    const fixture = await createRaceFixture(cleanup);
    const settleOutcome = await settle(fixture);
    const sweepReleased = await releaseExpiredReservations(new Date());
    const observed = await readOutcome(fixture.orderId, fixture.reference);

    logRaceOutcome(
      "settle_then_sweep",
      null,
      sweepReleased,
      settleOutcome,
      observed,
    );
    assertExpectedOutcome("settle_then_sweep", observed, {
      paymentStatus: PaymentStatus.PAID,
      stock: fixture.startingStock - fixture.quantity,
      attemptStatuses: [PaymentAttemptStatus.SUCCEEDED],
      reconciliationCount: 0,
    });
  } finally {
    await deleteTestData(cleanup);
  }
});

test("sweep then settle leaves the order failed with stock restored", async () => {
  const cleanup: CleanupIds = {};

  try {
    const fixture = await createRaceFixture(cleanup);
    const sweepReleased = await releaseExpiredReservations(new Date());
    const settleOutcome = await settle(fixture);
    const observed = await readOutcome(fixture.orderId, fixture.reference);

    logRaceOutcome(
      "sweep_then_settle",
      null,
      sweepReleased,
      settleOutcome,
      observed,
    );
    assertExpectedOutcome("sweep_then_settle", observed, {
      paymentStatus: PaymentStatus.FAILED,
      stock: fixture.startingStock,
      attemptStatuses: [PaymentAttemptStatus.SUCCEEDED],
      reconciliationCount: 1,
      reconciliationReason: ReconciliationReason.PAYMENT_AFTER_EXPIRY,
      reconciliationOrderId: fixture.orderId,
    });
  } finally {
    await deleteTestData(cleanup);
  }
});

test("concurrent sweep and settlement ends in outcome A or B", async () => {
  const cleanup: CleanupIds = {};

  try {
    const fixture = await createRaceFixture(cleanup);
    const [settleOutcome, sweepReleased] = await Promise.all([
      settle(fixture),
      releaseExpiredReservations(new Date()),
    ]);
    const observed = await readOutcome(fixture.orderId, fixture.reference);
    const outcomeLabel = classifyOutcome(observed, fixture);

    logRaceOutcome(
      "concurrent",
      outcomeLabel ?? "OTHER",
      sweepReleased,
      settleOutcome,
      observed,
    );

    if (outcomeLabel === null) {
      console.log(`RACE_OBSERVED mode=concurrent ${observedSummary(observed)}`);
      assert.fail(
        `concurrent: expected outcome A or B, observed ${observedSummary(observed)}`,
      );
    }
  } finally {
    await deleteTestData(cleanup);
  }
});
