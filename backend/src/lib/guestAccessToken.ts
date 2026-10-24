import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Guest order access tokens.
 *
 * A guest order is not owned by an account, so the order row keeps the hash of
 * a random token and the raw token is handed to the customer exactly once, in
 * the order creation response. Only the hash is stored, so a leaked database
 * row cannot be turned back into a usable token.
 */

const TOKEN_BYTES = 32;

export interface GuestAccessToken {
  /** Raw token, base64url. Returned to the caller once and never stored. */
  token: string;
  /** SHA-256 hex digest of the raw token. This is what gets stored. */
  hash: string;
}

/** Creates a new random access token and its hash. */
export function newGuestAccessToken(): GuestAccessToken {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  return { token, hash: hashGuestAccessToken(token) };
}

/** SHA-256 hex digest of a raw access token. */
export function hashGuestAccessToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Constant-time comparison of a presented token against a stored hash. The
 * digests are compared as equal-length buffers, so timingSafeEqual is never
 * called with mismatched lengths. A missing or malformed stored hash never
 * matches.
 */
export function matchesAccessTokenHash(
  token: string,
  expectedHash: string | null,
): boolean {
  if (!expectedHash) return false;

  const provided = Buffer.from(hashGuestAccessToken(token), "hex");
  const expected = Buffer.from(expectedHash, "hex");

  if (provided.length === 0) return false;
  if (provided.length !== expected.length) return false;

  return timingSafeEqual(provided, expected);
}
