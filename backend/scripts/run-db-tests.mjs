import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { config } from "dotenv";

const backendDirectory = fileURLToPath(new URL("../", import.meta.url));
const envTestPath = fileURLToPath(new URL("../.env.test", import.meta.url));
const envResult = config({ path: envTestPath, override: false });

if (envResult.error && envResult.error.code !== "ENOENT") {
  console.error("Could not load backend/.env.test.");
  process.exit(1);
}

const testDatabaseUrl = process.env.DATABASE_URL_TEST;
if (!testDatabaseUrl) {
  console.error(
    "Set DATABASE_URL_TEST in backend/.env.test or in the process environment.",
  );
  process.exit(1);
}

const testJwtSecret = process.env.JWT_SECRET_TEST;
if (!testJwtSecret || testJwtSecret.length < 32) {
  console.error("Set a test-only JWT_SECRET_TEST of at least 32 characters.");
  process.exit(1);
}

const testPaystackKey = process.env.PAYSTACK_SECRET_KEY_TEST;
if (!testPaystackKey?.startsWith("sk_test_")) {
  console.error(
    "Set PAYSTACK_SECRET_KEY_TEST to a Paystack test key (never a live key).",
  );
  process.exit(1);
}

let testDatabaseName;
try {
  const parsedUrl = new URL(testDatabaseUrl);
  if (
    (parsedUrl.protocol !== "postgres:" &&
      parsedUrl.protocol !== "postgresql:") ||
    !parsedUrl.hostname
  ) {
    throw new Error("Invalid PostgreSQL connection URL");
  }
  testDatabaseName = decodeURIComponent(parsedUrl.pathname.replace(/^\//, ""));
} catch {
  console.error("DATABASE_URL_TEST must be a valid PostgreSQL connection URL.");
  process.exit(1);
}

if (testDatabaseName !== "afritech_backend_test") {
  console.error(
    'Refusing to run: DATABASE_URL_TEST must target "afritech_backend_test".',
  );
  process.exit(1);
}

console.log(`Integration test database: ${testDatabaseName}`);

const testFiles = [
  "tests/admin-products-http.test.ts",
  "tests/admin-fulfilment.test.ts",
  "tests/guest-orders.test.ts",
  "tests/availability-http.test.ts",
  "tests/admin-uploads.test.ts",
  "tests/admin-sales-images.test.ts",
  "tests/payment-initialize.test.ts",
  "tests/orders-auth.test.ts",
  "tests/require-role.test.ts",
  "tests/reservations-race.test.ts",
];

const result = spawnSync(
  process.execPath,
  [
    "--import",
    "tsx",
    "--test",
    "--test-concurrency=1",
    ...testFiles,
  ],
  {
    cwd: backendDirectory,
    env: {
      ...process.env,
      DATABASE_URL: testDatabaseUrl,
      JWT_SECRET: testJwtSecret,
      PAYSTACK_SECRET_KEY: testPaystackKey,
      FRONTEND_URL: "http://localhost:3000",
      NODE_ENV: "test",
    },
    stdio: "inherit",
  },
);

if (result.error) {
  console.error("Could not start the database-backed tests.");
  console.error(result.error.message);
  process.exit(1);
}

process.exitCode = result.status ?? 1;
