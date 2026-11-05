import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { request } from "node:http";
import { test } from "node:test";

import express from "express";
import { rateLimit } from "express-rate-limit";

import { env } from "../src/lib/env";
import {
  connectRedis,
  disconnectRedis,
  redisClient,
} from "../src/lib/redis";
import { createRedisRateLimitStore } from "../src/middleware/rateLimitStore";

const CLIENT_KEY = "shared-client";

function requestStatus(port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request(
      { hostname: "127.0.0.1", method: "GET", path: "/", port },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      },
    );

    req.on("error", reject);
    req.end();
  });
}

async function startLimiterServer(storeName: string): Promise<{
  port: number;
  close: () => Promise<void>;
}> {
  const app = express();
  app.get(
    "/",
    rateLimit({
      windowMs: 60_000,
      limit: 1,
      keyGenerator: () => CLIENT_KEY,
      store: createRedisRateLimitStore(storeName),
    }),
    (_req, res) => res.sendStatus(204),
  );

  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });

  const address = server.address();
  assert.ok(address && typeof address !== "string");

  return {
    port: address.port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      }),
  };
}

test("independent limiter instances share counters through Redis", async () => {
  await connectRedis();

  const storeName = `integration-${randomUUID()}`;
  const redisKey = `afritech:${env.NODE_ENV}:rate-limit:${storeName}:${CLIENT_KEY}`;
  let firstServer: Awaited<ReturnType<typeof startLimiterServer>> | undefined;
  let secondServer: Awaited<ReturnType<typeof startLimiterServer>> | undefined;

  try {
    firstServer = await startLimiterServer(storeName);
    secondServer = await startLimiterServer(storeName);

    assert.equal(await requestStatus(firstServer.port), 204);
    assert.equal(await requestStatus(secondServer.port), 429);
  } finally {
    if (firstServer) await firstServer.close();
    if (secondServer) await secondServer.close();
    await redisClient.del(redisKey);
    await disconnectRedis();
  }
});
