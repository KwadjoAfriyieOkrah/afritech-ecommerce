import { createHmac, timingSafeEqual } from "node:crypto";

export function createCredentialVersion(
  passwordHash: string,
  signingSecret: string,
): string {
  return createHmac("sha256", signingSecret).update(passwordHash).digest("hex");
}

export function matchesCredentialVersion(
  passwordHash: string,
  signingSecret: string,
  version: string,
): boolean {
  if (!/^[\da-f]{64}$/i.test(version)) return false;

  const expected = Buffer.from(
    createCredentialVersion(passwordHash, signingSecret),
    "hex",
  );
  const provided = Buffer.from(version, "hex");
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}
