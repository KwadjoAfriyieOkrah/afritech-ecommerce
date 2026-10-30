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
