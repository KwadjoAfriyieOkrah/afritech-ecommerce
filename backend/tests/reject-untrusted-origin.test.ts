import assert from "node:assert/strict";
import { request } from "node:http";
import { test } from "node:test";

import express from "express";

import { env } from "../src/lib/env";
import { rejectUntrustedOrigin } from "../src/middleware/rejectUntrustedOrigin";

function requestStatus(
  port: number,
  origin?: string,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {};
    if (origin !== undefined) headers.Origin = origin;

    const req = request(
      { hostname: "127.0.0.1", method: "POST", path: "/", port, headers },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      },
    );

    req.on("error", reject);
    req.end();
  });
}

test("mutation origin guard allows the frontend and rejects other or invalid origins", async () => {
  const app = express();
  app.use(rejectUntrustedOrigin);
  app.post("/", (_req, res) => res.sendStatus(204));

  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });

  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    assert.equal(await requestStatus(address.port, env.FRONTEND_URL), 204);
    assert.equal(await requestStatus(address.port, "https://attacker.example"), 403);
    assert.equal(await requestStatus(address.port, "null"), 403);
    assert.equal(await requestStatus(address.port), 204);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
});
