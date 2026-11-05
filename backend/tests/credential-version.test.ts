import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createCredentialVersion,
  matchesCredentialVersion,
} from "../src/lib/credentialVersion";

test("credential version matches the password hash used to issue it", () => {
  const version = createCredentialVersion(
    "$2b$12$old-password-hash",
    "test-signing-secret",
  );

  assert.equal(
    matchesCredentialVersion(
      "$2b$12$old-password-hash",
      "test-signing-secret",
      version,
    ),
    true,
  );
});

test("credential version is invalidated as soon as the password hash changes", () => {
  const oldVersion = createCredentialVersion(
    "$2b$12$old-password-hash",
    "test-signing-secret",
  );

  assert.equal(
    matchesCredentialVersion(
      "$2b$12$new-password-hash",
      "test-signing-secret",
      oldVersion,
    ),
    false,
  );
});

test("credential version rejects malformed claims", () => {
  assert.equal(
    matchesCredentialVersion(
      "$2b$12$password-hash",
      "test-signing-secret",
      "not-a-version",
    ),
    false,
  );
});
