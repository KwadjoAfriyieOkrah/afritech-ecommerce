import assert from "node:assert/strict";
import { request } from "node:http";
import { test } from "node:test";

import express from "express";
import type { RequestHandler } from "express";

import {
  loginRateLimit,
  orderTrackingRateLimit,
  registrationRateLimit,
} from "../src/middleware/rateLimits";

function requestStatus(
  port: number,
  path: string,
  method: "GET" | "POST",
): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request(
      { hostname: "127.0.0.1", method, path, port },
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
  path: string,
  method: "GET" | "POST",
  allowedRequests: number,
): Promise<void> {
  const app = express();
  const respond = (_req: express.Request, res: express.Response): void => {
    res.sendStatus(204);
  };
  if (method === "GET") app.get(path, limiter, respond);
  else app.post(path, limiter, respond);

  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });

  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const port = address.port;

    for (let attempt = 0; attempt < allowedRequests; attempt += 1) {
      assert.equal(await requestStatus(port, path, method), 204);
    }

    const limitedResponse = await requestStatus(port, path, method);
    assert.equal(limitedResponse, 429);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
}

test("login is limited to five attempts per 15 minutes per IP", async () => {
  await assertRateLimit(loginRateLimit, "/login", "POST", 5);
});

test("registration is limited to five attempts per hour per IP", async () => {
  await assertRateLimit(registrationRateLimit, "/register", "POST", 5);
});

test("public order tracking is limited to ten attempts per 15 minutes per IP", async () => {
  await assertRateLimit(orderTrackingRateLimit, "/track", "GET", 10);
});
