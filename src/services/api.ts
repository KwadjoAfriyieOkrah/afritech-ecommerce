import axios, { AxiosError, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import type {
  AuthCredentials,
  AuthResponse,
  CreateOrderPayload,
  Order,
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
  mockLogin,
  mockRegister,
  mockVerifyPayment
} from './mockApi';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
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

export async function createOrder(data: CreateOrderPayload): Promise<Order> {
  if (isMockApiEnabled()) return mockCreateOrder(data);

  const { data: order } = await api.post<Order>('/orders', data);
  return order;
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