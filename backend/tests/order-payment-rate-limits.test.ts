import assert from "node:assert/strict";
import { request } from "node:http";
import { test } from "node:test";

import express from "express";
import type { RequestHandler } from "express";

import {
  orderCreationRateLimit,
  paymentInitializationRateLimit,
} from "../src/middleware/orderPaymentRateLimits";

function requestStatus(port: number, path: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request(
      { hostname: "127.0.0.1", method: "POST", path, port },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      },
    );

    req.on("error", reject);
    req.end();
  });
}

async function assertRateLimit(
  limiter: RequestHandler,
  allowedRequests: number,
): Promise<void> {
  const app = express();
  app.post("/", limiter, (_req, res) => res.sendStatus(204));

  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });

  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    for (let attempt = 0; attempt < allowedRequests; attempt += 1) {
      assert.equal(await requestStatus(address.port, "/"), 204);
    }
    assert.equal(await requestStatus(address.port, "/"), 429);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
}

test("order creation is limited to ten attempts per 15 minutes per IP", async () => {
  await assertRateLimit(orderCreationRateLimit, 10);
});

test("payment initialization is limited to ten attempts per 15 minutes per IP", async () => {
  await assertRateLimit(paymentInitializationRateLimit, 10);
});
