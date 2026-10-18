import axios, { AxiosError, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import type {
  AuthCredentials,
  AuthResponse,
  CreateOrderRequestBody,
  Order,
  PaymentAttempt,
  PaymentVerification,
  Product,
  ProductFilters,
  RegisterPayload,
  User
} from '@/types';
import { useUserStore } from '@/store/userStore';
import {
  isMockApiEnabled,
  mockCreateOrder,
  mockCurrentUser,
  mockFetchProducts,
  mockFetchUserOrders,
  mockGetOrder,
  mockGetProduct,
  mockInitializePayment,
  mockLogin,
  mockRegister,
  mockVerifyPayment
} from './mockApi';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
const AUTH_TOKEN_KEY = 'afritech_token';
const REQUEST_TIMEOUT_MS = 15000;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;
const RETRYABLE_STATUS_CODES = [408, 425, 429, 500, 502, 503, 504];
const IDEMPOTENT_METHODS = new Set(['get', 'head', 'options', 'put', 'delete']);

declare module 'axios' {
  interface AxiosRequestConfig {
    retry?: boolean;
    _retryCount?: number;
  }
}

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly details?: unknown;

  constructor(message: string, status: number, code?: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, ApiError.prototype);
  }

  static isApiError(error: unknown): error is ApiError {
    return error instanceof ApiError;
  }

  static from(error: unknown): ApiError {
    if (error instanceof ApiError) return error;

    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError<{ message?: string; error?: string; code?: string }>;
      const { response, code } = axiosError;

      if (!response) {
        return new ApiError(
          'Unable to reach the server. Check your connection and try again.',
          0,
          code || 'NETWORK_ERROR'
        );
      }

      const payload = response.data;
      const message =
        payload?.message || payload?.error || axiosError.message || 'Request failed';

      return new ApiError(message, response.status, payload?.code || code, payload);
    }

    if (error instanceof Error) {
      return new ApiError(error.message, 0);
    }

    return new ApiError('An unexpected error occurred', 0);
  }
}

export function getAuthToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(AUTH_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setAuthToken(token: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(AUTH_TOKEN_KEY, token);
  } catch {
    return;
  }
}

export function clearAuthToken(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(AUTH_TOKEN_KEY);
  } catch {
    return;
  }
}

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: REQUEST_TIMEOUT_MS,
  headers: { 'Content-Type': 'application/json' }
});

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = getAuthToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response: AxiosResponse) => response,
  async (error: unknown) => {
    if (!axios.isAxiosError(error)) {
      throw ApiError.from(error);
    }

    const config = error.config as (InternalAxiosRequestConfig & { _retryCount?: number }) | undefined;

    if (config && isRetryable(error) && shouldRetry(config)) {
      config._retryCount = (config._retryCount ?? 0) + 1;
      await delay(RETRY_DELAY_MS);
      return api.request(config);
    }

    if (error.response?.status === 401) {
      // Token is unusable: drop it and reflect that in the UI immediately.
      clearAuthToken();
      useUserStore.getState().setUser(null);
    }

    throw ApiError.from(error);
  }
);

function isRetryable(error: AxiosError): boolean {
  if (!error.response) return error.code !== 'ERR_CANCELED';
  return RETRYABLE_STATUS_CODES.includes(error.response.status);
}

function shouldRetry(config: InternalAxiosRequestConfig & { _retryCount?: number }): boolean {
  const attempts = config._retryCount ?? 0;
  if (attempts >= MAX_RETRIES) return false;
  if (config.retry === true) return true;
  return IDEMPOTENT_METHODS.has((config.method ?? 'get').toLowerCase());
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchProducts(filters?: ProductFilters): Promise<Product[]> {
  if (isMockApiEnabled()) return mockFetchProducts(filters);

  const { data } = await api.get<Product[]>('/products', { params: filters });
  return data;
}

export async function getProduct(id: string): Promise<Product> {
  if (isMockApiEnabled()) return mockGetProduct(id);

  const { data } = await api.get<Product>(`/products/${encodeURIComponent(id)}`);
  return data;
}

/**
 * Idempotency key for a single checkout attempt. The backend requires 16-64
 * characters and replays the existing order when a key is reused, so callers
 * must keep this value for every retry of one attempt and mint a fresh one only
 * for a genuinely new purchase. `getCheckoutIdempotencyKey` in
 * `./checkoutAttempt` owns that lifecycle; do not call this directly from a
 * component. Throws rather than falling back to a predictable key when secure
 * random generation is unavailable.
 */
export function createIdempotencyKey(): string {
  const cryptoApi = globalThis.crypto;

  if (!cryptoApi) {
    throw new Error(
      'Secure random generation is unavailable in this browser, so checkout cannot start safely.'
    );
  }

  if (typeof cryptoApi.randomUUID === 'function') {
    return cryptoApi.randomUUID();
  }

  if (typeof cryptoApi.getRandomValues !== 'function') {
    throw new Error(
      'Secure random generation is unavailable in this browser, so checkout cannot start safely.'
    );
  }

  const buffer = new Uint8Array(16);
  cryptoApi.getRandomValues(buffer);
  return Array.from(buffer, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function createOrder(
  data: CreateOrderRequestBody,
  idempotencyKey: string
): Promise<Order> {
  if (isMockApiEnabled()) {
    // The mock only echoes a display value; the real request omits this field.
    return mockCreateOrder({ ...data, expectedDeliveryDate: '' });
  }

  const { data: order } = await api.post<Order>('/orders', data, {
    headers: { 'Idempotency-Key': idempotencyKey }
  });
  return order;
}

/**
 * Authorizes a fresh payment attempt for an existing, unpaid order the caller
 * owns and returns the backend-issued reference (plus the server-authoritative
 * amount, currency and email) to open Paystack with. Calling it again for the
 * same order issues a new reference without creating another order.
 */
export async function initializePayment(orderId: string): Promise<PaymentAttempt> {
  // Mock mode keeps the whole order in the browser and never reaches the
  // backend, so the attempt is minted client-side there only.
  if (isMockApiEnabled()) return mockInitializePayment(orderId);

  // `baseURL: ''` routes this through the Next.js route handler, which forwards
  // the caller's credentials to the secured backend. Deliberately not retried:
  // each successful call issues a new, independent attempt reference.
  const { data } = await api.post<PaymentAttempt>(
    '/api/payments/initialize',
    { orderId },
    { baseURL: '' }
  );
  return data;
}

export async function getOrder(id: string): Promise<Order> {
  if (isMockApiEnabled()) return mockGetOrder(id);

  const { data } = await api.get<Order>(`/orders/${encodeURIComponent(id)}`);
  return data;
}

export async function registerUser(payload: RegisterPayload): Promise<AuthResponse> {
  if (isMockApiEnabled()) return mockRegister(payload);

  const { data } = await api.post<AuthResponse>('/auth/register', payload, { retry: false });
  return data;
}

export async function loginUser(credentials: AuthCredentials): Promise<AuthResponse> {
  if (isMockApiEnabled()) return mockLogin(credentials);

  const { data } = await api.post<AuthResponse>('/auth/login', credentials, { retry: false });
  return data;
}

/**
 * Resolves the stored token into a user on app load. Throws when there is no
 * token or the API rejects it, so callers treat the visitor as signed out.
 */
export async function fetchCurrentUser(): Promise<User> {
  const token = getAuthToken();

  if (!token) {
    throw new ApiError('You are not signed in.', 401, 'NO_SESSION');
  }

  if (isMockApiEnabled()) return mockCurrentUser(token);

  const { data } = await api.get<User>('/auth/me');
  return data;
}

/** Orders for the signed-in user. Scope comes from the bearer token server-side. */
export async function fetchUserOrders(user: User): Promise<Order[]> {
  if (isMockApiEnabled()) return mockFetchUserOrders(user);

  const { data } = await api.get<Order[]>('/orders', { retry: true });
  return data;
}

export async function verifyPayment(reference: string): Promise<PaymentVerification> {
  if (isMockApiEnabled()) return mockVerifyPayment(reference);

  const { data } = await api.get<PaymentVerification>(
    `/payments/verify/${encodeURIComponent(reference)}`
  );
  return data;
}

export async function verifyOrderPayment(
  reference: string,
  orderId?: string
): Promise<PaymentVerification> {
  // In mock mode the order only ever exists in this browser's in-memory store,
  // so verification has to run client-side too. It is isolated from the real
  // path, which always goes through the route handler to the backend.
  if (isMockApiEnabled()) return mockVerifyPayment(reference);

  // `baseURL: ''` routes this through the Next.js route handler rather than the backend.
  const { data } = await api.post<PaymentVerification>(
    '/api/orders/verify-payment',
    { reference, orderId },
    { baseURL: '', retry: true }
  );
  return data;
}

export async function getOrderTracking(id: string): Promise<Order> {
  if (isMockApiEnabled()) return mockGetOrder(id);

  const { data } = await api.get<Order>(`/orders/${encodeURIComponent(id)}`, { retry: true });
  return data;
}

export default api;