import type { AxiosResponse } from 'axios';
import api, { ApiError } from './api';

export type AdminFulfillmentStatus = 'PENDING' | 'PACKAGING' | 'DISPATCHED' | 'DELIVERED';

export type AdminPaymentStatus = 'PENDING' | 'PAID' | 'FAILED';

export interface AdminOrderListItem {
  id: string;
  reference: string;
  paymentStatus: AdminPaymentStatus;
  fulfillment: AdminFulfillmentStatus;
  customerName: string;
  customerPhone: string;
  deliveryArea: string;
  deliveryAddress: string;
  total: number;
  riderId: string | null;
  createdAt: string;
}

export interface AdminOrderItem {
  id: string;
  productId: string;
  name: string;
  image: string | null;
  quantity: number;
  color: string;
  price: number;
}

export interface AdminRider {
  id: string;
  name: string;
  phone: string;
  isActive: boolean;
  createdAt: string;
}

export interface AdminOrderDetail extends AdminOrderListItem {
  userId: string | null;
  deliveryFee: number;
  updatedAt: string;
  paidAt: string | null;
  deliveredAt: string | null;
  items: AdminOrderItem[];
  rider: AdminRider | null;
}

export interface AdminMutationResult {
  status: string;
}

export type AdminProductCategory = 'IPHONE' | 'SAMSUNG' | 'LAPTOP';

export type ProductSpecs = Record<string, string>;

export interface AdminProductColor {
  id: string;
  name: string;
  stock: number;
}

export interface AdminProduct {
  id: string;
  name: string;
  brand: string;
  category: AdminProductCategory;
  description: string | null;
  specs: ProductSpecs | null;
  basePrice: string;
  isActive: boolean;
  images: string[];
  colors: AdminProductColor[];
}

export interface AdminProductInput {
  name: string;
  brand: string;
  category: AdminProductCategory;
  description: string;
  basePrice: string;
  isActive: boolean;
  specs: ProductSpecs | null;
}

async function unwrap<T>(request: () => Promise<AxiosResponse<T>>): Promise<T> {
  try {
    const { data } = await request();
    return data;
  } catch (error) {
    throw ApiError.from(error);
  }
}

export async function listAdminOrders(
  fulfillment?: AdminFulfillmentStatus
): Promise<AdminOrderListItem[]> {
  return unwrap(() =>
    api.get<AdminOrderListItem[]>('/admin/orders', {
      params: fulfillment ? { fulfillment } : undefined
    })
  );
}

export async function getAdminOrder(id: string): Promise<AdminOrderDetail> {
  return unwrap(() => api.get<AdminOrderDetail>(`/admin/orders/${encodeURIComponent(id)}`));
}

export async function listRiders(): Promise<AdminRider[]> {
  return unwrap(() => api.get<AdminRider[]>('/admin/riders'));
}

export async function createRider(name: string, phone: string): Promise<AdminRider> {
  return unwrap(() =>
    api.post<AdminRider>('/admin/riders', { name, phone }, { retry: false })
  );
}

export async function assignRider(
  orderId: string,
  riderId: string
): Promise<AdminMutationResult> {
  return unwrap(() =>
    api.post<AdminMutationResult>(
      `/admin/orders/${encodeURIComponent(orderId)}/rider`,
      { riderId },
      { retry: false }
    )
  );
}

export async function packageOrder(orderId: string): Promise<AdminMutationResult> {
  return unwrap(() =>
    api.post<AdminMutationResult>(
      `/admin/orders/${encodeURIComponent(orderId)}/packaging`,
      undefined,
      { retry: false }
    )
  );
}

export async function dispatchOrder(orderId: string): Promise<AdminMutationResult> {
  return unwrap(() =>
    api.post<AdminMutationResult>(
      `/admin/orders/${encodeURIComponent(orderId)}/dispatch`,
      undefined,
      { retry: false }
    )
  );
}

export async function deliverOrder(orderId: string): Promise<AdminMutationResult> {
  return unwrap(() =>
    api.post<AdminMutationResult>(
      `/admin/orders/${encodeURIComponent(orderId)}/delivered`,
      undefined,
      { retry: false }
    )
  );
}

export async function listAdminProducts(): Promise<AdminProduct[]> {
  return unwrap(() => api.get<AdminProduct[]>('/admin/products'));
}

export async function createAdminProduct(
  input: AdminProductInput
): Promise<AdminProduct> {
  return unwrap(() =>
    api.post<AdminProduct>('/admin/products', input, { retry: false })
  );
}

export async function updateAdminProduct(
  id: string,
  input: AdminProductInput
): Promise<AdminProduct> {
  return unwrap(() =>
    api.patch<AdminProduct>(
      `/admin/products/${encodeURIComponent(id)}`,
      input,
      { retry: false }
    )
  );
}

export async function uploadProductImage(
  productId: string,
  file: File
): Promise<string[]> {
  const formData = new FormData();
  formData.append('image', file);

  const result = await unwrap(() =>
    api.post<{ images: string[] }>(
      `/admin/products/${encodeURIComponent(productId)}/images`,
      formData,
      {
        headers: { 'Content-Type': undefined },
        retry: false
      }
    )
  );

  return result.images;
}

export async function deleteProductImage(
  productId: string,
  index: number
): Promise<string[]> {
  const result = await unwrap(() =>
    api.delete<{ images: string[] }>(
      `/admin/products/${encodeURIComponent(productId)}/images/${index}`,
      { retry: false }
    )
  );

  return result.images;
}

export interface RestockResult {
  productId: string;
  color: AdminProductColor;
}

export async function restockColor(
  productId: string,
  colorId: string,
  quantity: number
): Promise<RestockResult> {
  return unwrap(() =>
    api.post<RestockResult>(
      `/admin/products/${encodeURIComponent(productId)}/colors/${encodeURIComponent(colorId)}/restock`,
      { quantity },
      { retry: false }
    )
  );
}

export interface CreateColorResult {
  productId: string;
  color: AdminProductColor;
}

export async function createColor(
  productId: string,
  name: string,
  stock: number
): Promise<CreateColorResult> {
  return unwrap(() =>
    api.post<CreateColorResult>(
      `/admin/products/${encodeURIComponent(productId)}/colors`,
      { name, stock },
      { retry: false }
    )
  );
}

export interface BulkRowError {
  row: number;
  errors: Array<{ field: string; message: string }>;
}

export interface BulkSummary {
  totalRows: number;
  validRows: number;
  invalidRows: number;
  creates: number;
  updates: number;
  stockAdjustments: number;
}

export interface BulkImportResult {
  mode: 'dry-run' | 'commit';
  committed: boolean;
  summary: BulkSummary;
  errors: BulkRowError[];
  error?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isBulkSummary(value: unknown): value is BulkSummary {
  return (
    isRecord(value) &&
    typeof value.totalRows === 'number' &&
    typeof value.validRows === 'number' &&
    typeof value.invalidRows === 'number' &&
    typeof value.creates === 'number' &&
    typeof value.updates === 'number' &&
    typeof value.stockAdjustments === 'number'
  );
}

function isBulkRowError(value: unknown): value is BulkRowError {
  if (!isRecord(value) || typeof value.row !== 'number' || !Array.isArray(value.errors)) {
    return false;
  }
  return value.errors.every(
    (detail) =>
      isRecord(detail) &&
      typeof detail.field === 'string' &&
      typeof detail.message === 'string'
  );
}

function isBulkImportResult(value: unknown): value is BulkImportResult {
  return (
    isRecord(value) &&
    (value.mode === 'dry-run' || value.mode === 'commit') &&
    typeof value.committed === 'boolean' &&
    isBulkSummary(value.summary) &&
    Array.isArray(value.errors) &&
    value.errors.every(isBulkRowError) &&
    (value.error === undefined || typeof value.error === 'string')
  );
}

export async function bulkImportProducts(
  file: File,
  confirm: boolean
): Promise<BulkImportResult> {
  const formData = new FormData();
  formData.append('file', file);
  if (confirm) {
    formData.append('confirm', 'true');
  }

  try {
    return await unwrap(() =>
      api.post<BulkImportResult>('/admin/products/bulk', formData, {
        headers: { 'Content-Type': undefined },
        retry: false
      })
    );
  } catch (error) {
    const apiError = ApiError.from(error);
    if (apiError.status === 400 && isBulkImportResult(apiError.details)) {
      return apiError.details;
    }
    throw apiError;
  }
}

export interface SalesTotals {
  orders: number;
  quantity: number;
  amount: number;
}

export interface DailySalesRow extends SalesTotals {
  date: string;
}

export interface TopProductSales {
  productId: string;
  name: string;
  quantity: number;
  amount: number;
}

export interface AdminSalesSummary {
  totals: SalesTotals;
  today: SalesTotals;
  last7Days: SalesTotals;
  last30Days: SalesTotals;
  byDay: DailySalesRow[];
  topProducts: TopProductSales[];
}

export async function getSalesSummary(days = 30): Promise<AdminSalesSummary> {
  return unwrap(() => api.get<AdminSalesSummary>('/admin/sales', { params: { days } }));
}
