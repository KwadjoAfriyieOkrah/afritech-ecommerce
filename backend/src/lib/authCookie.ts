import type { CookieOptions, Request, Response } from "express";

import { env } from "./env";

const COOKIE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const AUTH_COOKIE_NAME =
  env.NODE_ENV === "production" ? "__Host-afritech_session" : "afritech_session";

function cookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  };
}

function readCookieValues(req: Request): string[] {
  const header = req.headers.cookie;
  if (!header) return [];

  return header
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${AUTH_COOKIE_NAME}=`))
    .map((part) => part.slice(AUTH_COOKIE_NAME.length + 1));
}

export function hasAuthCookie(req: Request): boolean {
  return readCookieValues(req).length > 0;
}

export function readAuthCookie(req: Request): string | null {
  const values = readCookieValues(req);
  if (values.length !== 1) return null;

  const token = values[0];
  if (typeof token !== "string") return null;

  return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)
    ? token
    : null;
}

export function setAuthCookie(res: Response, token: string): void {
  res.cookie(AUTH_COOKIE_NAME, token, {
    ...cookieOptions(),
    maxAge: COOKIE_TTL_MS,
  });
}

export function clearAuthCookie(res: Response): void {
  res.clearCookie(AUTH_COOKIE_NAME, cookieOptions());
}
