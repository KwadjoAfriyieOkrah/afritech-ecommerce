import { createIdempotencyKey } from './api';

/**
 * Keeps one idempotency key for a checkout attempt across PaymentForm
 * unmount/remount and browser reload. Without this, an ambiguous order-creation
 * timeout would mint a fresh key on the next remount and let the server create
 * a second order (and decrement stock twice).
 *
 * Storage: browser sessionStorage, namespaced to AFriTech checkout. Only the
 * idempotency key and the opaque owner user id are stored - never customer
 * contact details, addresses, auth tokens, or payment data. The user id keeps
 * an abandoned key from a previous account from blocking or replaying into a
 * different one on a shared device.
 *
 * Cleared when an attempt is definitively finished: the payment is confirmed.
 * It is deliberately NOT cleared on a timeout, network error, HTTP failure,
 * or when the cart is emptied, because the order may already have committed
 * and reusing the key is what makes the retry safe.
 */

const STORAGE_KEY = 'afritech:checkout:attempt';
const MIN_KEY_LENGTH = 16;
const MAX_KEY_LENGTH = 64;

interface CheckoutAttempt {
  key: string;
  userId: string;
}

// Covers remounts when sessionStorage cannot be written (private mode, quota).
let memoryAttempt: CheckoutAttempt | null = null;

function isUsableKey(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= MIN_KEY_LENGTH &&
    value.length <= MAX_KEY_LENGTH
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isCheckoutAttempt(value: unknown): value is CheckoutAttempt {
  if (!isRecord(value)) return false;
  return isUsableKey(value.key) && typeof value.userId === 'string';
}

function readStored(): CheckoutAttempt | null {
  if (typeof window === 'undefined') return null;

  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;

    const parsed: unknown = JSON.parse(raw);
    return isCheckoutAttempt(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeStored(attempt: CheckoutAttempt): void {
  memoryAttempt = attempt;

  if (typeof window === 'undefined') return;

  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(attempt));
  } catch {
    // Storage unavailable: the in-memory copy still holds the key for the
    // life of this page session, so remounts keep reusing it.
  }
}

/**
 * Returns the idempotency key for the current user's checkout attempt,
 * creating and persisting one only when there is no usable key for this user.
 */
export function getCheckoutIdempotencyKey(userId: string): string {
  const stored = memoryAttempt ?? readStored();
  if (stored && stored.userId === userId) {
    memoryAttempt = stored;
    return stored.key;
  }

  const attempt: CheckoutAttempt = { key: createIdempotencyKey(), userId };
  writeStored(attempt);
  return attempt.key;
}

/**
 * Forgets the current attempt. Call only when the attempt is definitively
 * over (payment confirmed) or the user deliberately starts a new checkout.
 */
export function clearCheckoutIdempotencyKey(): void {
  memoryAttempt = null;

  if (typeof window === 'undefined') return;

  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to remove when storage is unavailable.
  }
}
