import assert from "node:assert/strict";
import { request, type IncomingHttpHeaders } from "node:http";
import { test } from "node:test";

import express from "express";

import {
  AUTH_COOKIE_NAME,
  clearAuthCookie,
  readAuthCookie,
  setAuthCookie,
} from "../src/lib/authCookie";
import { env } from "../src/lib/env";

const TOKEN = "header.payload.signature";

test("auth cookie is HttpOnly, same-site, path-scoped, and readable by the backend", async () => {
  const app = express();
  app.get("/set", (_req, res) => {
    setAuthCookie(res, TOKEN);
    res.sendStatus(204);
  });
  app.get("/read", (req, res) => {
    res.status(200).send(readAuthCookie(req) ?? "invalid");
  });
  app.get("/clear", (_req, res) => {
    clearAuthCookie(res);
    res.sendStatus(204);
  });

  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });

  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");

    const setCookie = await requestResponse(address.port, "/set");
    assert.equal(setCookie.status, 204);
    const cookieHeader = setCookie.headers["set-cookie"];
    assert.ok(cookieHeader && cookieHeader.length > 0);
    const cookie = cookieHeader[0];
    assert.ok(cookie.startsWith(`${AUTH_COOKIE_NAME}=${TOKEN};`));
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Lax/i);
    assert.match(cookie, /Path=\//i);
    assert.match(cookie, /Max-Age=604800/i);
    assert.equal(/;\s*Domain=/i.test(cookie), false);
    assert.equal(/;\s*Secure/i.test(cookie), env.NODE_ENV === "production");

    const readResponse = await requestResponse(address.port, "/read", {
      Cookie: `${AUTH_COOKIE_NAME}=${TOKEN}`,
    });
    assert.equal(readResponse.body, TOKEN);

    const duplicateCookieResponse = await requestResponse(address.port, "/read", {
      Cookie: `${AUTH_COOKIE_NAME}=${TOKEN}; ${AUTH_COOKIE_NAME}=other.payload.signature`,
    });
    assert.equal(duplicateCookieResponse.body, "invalid");

    const clearResponse = await requestResponse(address.port, "/clear");
    assert.equal(clearResponse.status, 204);
    const clearCookie = clearResponse.headers["set-cookie"];
    assert.ok(clearCookie && clearCookie.length > 0);
    assert.match(clearCookie[0], /Expires=Thu, 01 Jan 1970/i);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
});

function requestResponse(
  port: number,
  path: string,
  headers?: Record<string, string>,
): Promise<{ status: number; body: string; headers: IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const req = request(
      { hostname: "127.0.0.1", method: "GET", path, port, headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
            headers: res.headers,
          });
        });
      },
    );

    req.on("error", reject);
    req.end();
  });
}
