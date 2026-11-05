import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import type { Server } from "node:http";
import { after, before, test } from "node:test";
import { createCredentialVersion } from "../src/lib/credentialVersion";

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
const { Role } = require("../src/generated/prisma/client") as typeof import("../src/generated/prisma/client");
const jwt = require("jsonwebtoken") as typeof import("jsonwebtoken");
const express = require("express") as typeof import("express");
const adminRoutes = require("../src/routes/admin.routes") as typeof import("../src/routes/admin.routes");
const { requireRole } = require("../src/middleware/requireRole") as typeof import("../src/middleware/requireRole");

const UNAUTHORIZED_BODY = { error: "Unauthorized" };
const FORBIDDEN_BODY = { error: "Forbidden" };
const TEST_PASSWORD_HASH = "test-only-not-a-real-hash";

const app = express();
app.use(express.json());
app.use("/admin", adminRoutes.default);

// Test-only probe for the missing-user branch: requireAuth would reject an
// unknown id first, so the authUser is injected to reach requireRole directly.
let roleProbeUserId = "";

function injectAuthUser(req: Request, _res: Response, next: NextFunction): void {
  req.authUser = {
    id: roleProbeUserId,
    email: "probe@test.local",
    phone: "",
    name: "Role Probe",
    role: Role.CUSTOMER,
  };
  next();
}

app.get(
  "/role-probe",
  injectAuthUser,
  requireRole(Role.ADMIN),
  (_req, res) => {
    res.status(200).json({ status: "ok" });
  },
);

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

function signToken(
  sub: string,
  role: import("../src/generated/prisma/client").Role,
): string {
  return jwt.sign(
    {
      sub,
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

async function seedUser(
  suffix: string,
  role: import("../src/generated/prisma/client").Role,
): Promise<string> {
  const user = await prisma.user.create({
    data: {
      name: "Role Test",
      email: `require-role-${role.toLowerCase()}-${suffix}@test.local`,
      passwordHash: TEST_PASSWORD_HASH,
      role,
    },
    select: { id: true },
  });
  return user.id;
}

async function deleteUsers(ids: string[]): Promise<void> {
  if (ids.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  }
}

// ---------------------------------------------------------------------------
test("GET /admin/fulfillment/queue without a token returns 401", async () => {
  const response = await fetch(`${baseUrl}/admin/fulfillment/queue`);
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), UNAUTHORIZED_BODY);
});

// ---------------------------------------------------------------------------
test("GET /admin/fulfillment/queue with a CUSTOMER token returns 403", async () => {
  const suffix = nextSuffix();
  const created: string[] = [];
  try {
    const userId = await seedUser(suffix, Role.CUSTOMER);
    created.push(userId);

    const response = await fetch(`${baseUrl}/admin/fulfillment/queue`, {
      headers: { Authorization: `Bearer ${signToken(userId, Role.CUSTOMER)}` },
    });
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), FORBIDDEN_BODY);
  } finally {
    await deleteUsers(created);
  }
});

// ---------------------------------------------------------------------------
test("GET /admin/fulfillment/queue with an ADMIN token returns 200", async () => {
  const suffix = nextSuffix();
  const created: string[] = [];
  try {
    const userId = await seedUser(suffix, Role.ADMIN);
    created.push(userId);

    const response = await fetch(`${baseUrl}/admin/fulfillment/queue`, {
      headers: { Authorization: `Bearer ${signToken(userId, Role.ADMIN)}` },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "ok" });
  } finally {
    await deleteUsers(created);
  }
});

// ---------------------------------------------------------------------------
test("a validly signed token for an unknown user returns 401, same as no token", async () => {
  const ghostId = randomUUID();

  const response = await fetch(`${baseUrl}/admin/fulfillment/queue`, {
    headers: { Authorization: `Bearer ${signToken(ghostId, Role.ADMIN)}` },
  });
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), UNAUTHORIZED_BODY);
});

// ---------------------------------------------------------------------------
test("the 403 body is identical whether the user is missing or merely lacks the role", async () => {
  const suffix = nextSuffix();
  const created: string[] = [];
  try {
    const customerId = await seedUser(suffix, Role.CUSTOMER);
    created.push(customerId);

    roleProbeUserId = randomUUID();
    const missing = await fetch(`${baseUrl}/role-probe`);
    assert.equal(missing.status, 403);
    const missingBody = await missing.json();

    roleProbeUserId = customerId;
    const lacking = await fetch(`${baseUrl}/role-probe`);
    assert.equal(lacking.status, 403);
    const lackingBody = await lacking.json();

    assert.deepEqual(missingBody, FORBIDDEN_BODY);
    assert.deepEqual(lackingBody, FORBIDDEN_BODY);
    assert.deepEqual(missingBody, lackingBody);
  } finally {
    await deleteUsers(created);
  }
});
