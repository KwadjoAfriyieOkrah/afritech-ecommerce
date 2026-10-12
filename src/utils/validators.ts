const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const GH_PHONE_PATTERN = /^(?:\+233|0)\d{9}$/;

const FORMATTING_CHARS = /[\s()-]/g;

const ACCRA_AREA = 'Accra';

export const ACCRA_DELIVERY_FEE = 5;
export const DEFAULT_DELIVERY_FEE = 10;
export const ACCRA_DELIVERY_DAYS = { min: 1, max: 1 } as const;
export const DEFAULT_DELIVERY_DAYS = { min: 2, max: 3 } as const;

export interface DeliveryDayRange {
  min: number;
  max: number;
}

export function validateEmail(email: string): boolean {
  if (typeof email !== 'string') return false;
  return EMAIL_PATTERN.test(email.trim());
}

export function validatePhoneGH(phone: string): boolean {
  if (typeof phone !== 'string') return false;
  const normalized = phone.trim().replace(FORMATTING_CHARS, '');
  return GH_PHONE_PATTERN.test(normalized);
}

export function validateAddress(address: string): boolean {
  if (typeof address !== 'string') return false;
  return address.trim().length >= 5;
}

export const PASSWORD_MIN_LENGTH = 8;

/**
 * Registration policy: at least 8 characters containing a letter and a number.
 * Enforced client-side for feedback only - the backend must re-check it.
 */
export function validatePassword(password: string): boolean {
  if (typeof password !== 'string') return false;
  return (
    password.length >= PASSWORD_MIN_LENGTH && /[A-Za-z]/.test(password) && /\d/.test(password)
  );
}

export function passwordPolicyHint(): string {
  return `At least ${PASSWORD_MIN_LENGTH} characters, including a letter and a number.`;
}

export function calculateDeliveryFee(area: string): number {
  return isAccra(area) ? ACCRA_DELIVERY_FEE : DEFAULT_DELIVERY_FEE;
}

export function calculateDeliveryDays(area: string): DeliveryDayRange {
  return isAccra(area) ? { ...ACCRA_DELIVERY_DAYS } : { ...DEFAULT_DELIVERY_DAYS };
}

function isAccra(area: string): boolean {
  return typeof area === 'string' && area.trim().toLowerCase() === ACCRA_AREA.toLowerCase();
}