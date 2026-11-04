import type { Request } from "express";

import { hasAuthCookie, readAuthCookie } from "../lib/authCookie";

export interface RequestAuthToken {
  token: string | null;
  provided: boolean;
}

export function readRequestAuthToken(req: Request): RequestAuthToken {
  const authorization = req.headers.authorization;
  if (authorization !== undefined) {
    const parts = authorization.split(" ");
    if (parts.length !== 2 || parts[0] !== "Bearer" || !parts[1]) {
      return { token: null, provided: true };
    }

    return { token: parts[1], provided: true };
  }

  const cookieProvided = hasAuthCookie(req);
  return {
    token: readAuthCookie(req),
    provided: cookieProvided,
  };
}
