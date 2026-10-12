const REFERENCE_PREFIX = 'AFT';
const DATE_PATTERN = /^\d{8}$/;
const RANDOM_DIGITS = 6;
const MAX_RANDOM = 10 ** RANDOM_DIGITS;
const REFERENCE_PATTERN = /^AFT-\d{8}-\d{6}$/;

function pad(value: number, length: number): string {
  return String(value).padStart(length, '0');
}

function dateStamp(date: Date): string {
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1, 2),
    pad(date.getDate(), 2)
  ].join('');
}

function randomDigits(): string {
  const cryptoApi = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;

  if (cryptoApi?.getRandomValues) {
    const buffer = new Uint32Array(1);
    cryptoApi.getRandomValues(buffer);
    return pad(buffer[0] % MAX_RANDOM, RANDOM_DIGITS);
  }

  return pad(Math.floor(Math.random() * MAX_RANDOM), RANDOM_DIGITS);
}

/**
 * Builds an order reference in the `AFT-YYYYMMDD-######` format,
 * e.g. `AFT-20240315-001234`.
 */
export function generateReference(now: Date = new Date()): string {
  const timestamp = Number.isNaN(now.getTime()) ? new Date() : now;
  return `${REFERENCE_PREFIX}-${dateStamp(timestamp)}-${randomDigits()}`;
}

export function isValidReference(reference: unknown): reference is string {
  return typeof reference === 'string' && REFERENCE_PATTERN.test(reference.trim());
}

export function parseReferenceDate(reference: string): Date | null {
  if (!isValidReference(reference)) return null;

  const [, datePart] = reference.trim().split('-');
  if (!datePart || !DATE_PATTERN.test(datePart)) return null;

  const year = Number(datePart.slice(0, 4));
  const month = Number(datePart.slice(4, 6));
  const day = Number(datePart.slice(6, 8));

  const parsed = new Date(year, month - 1, day);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Prefers the reference issued by the API, since the backend can only verify
 * a transaction against the reference it stored. Falls back to a locally
 * generated reference when the backend did not return one.
 */
export function resolveReference(candidate: string | null | undefined): string {
  const trimmed = typeof candidate === 'string' ? candidate.trim() : '';
  return trimmed.length > 0 ? trimmed : generateReference();
}
