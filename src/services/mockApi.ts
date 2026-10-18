import { MOCK_PRODUCTS } from '@/data/mockProducts';
import {
  OrderStatus,
  type AuthCredentials,
  type AuthResponse,
  type CreateOrderPayload,
  type Order,
  type PaymentAttempt,
  type PaymentVerification,
  type Product,
  type ProductFilters,
  type RegisterPayload,
  type User
} from '@/types';
import {
  calculateDeliveryFee,
  validateEmail,
  validatePassword,
  validatePhoneGH
} from '@/utils/validators';
import { generateReference } from '@/utils/orderReference';

/**
 * In-memory stand-in for the backend, enabled with `NEXT_PUBLIC_USE_MOCK_API=true`.
 * It exists so the storefront and the whole checkout flow can be exercised
 * without a running API. Orders advance through the tracking stages based on
 * how long ago they were created, so the tracking timeline is observable.
 */

const MOCK_LATENCY_MS = 350;

/** Stage thresholds in minutes since the order was created. */
const STAGE_MINUTES: Array<{ after: number; status: OrderStatus }> = [
  { after: 0, status: OrderStatus.PENDING },
  { after: 1, status: OrderStatus.PACKAGING },
  { after: 3, status: OrderStatus.DISPATCHED },
  { after: 6, status: OrderStatus.DELIVERED }
];

const MOCK_RIDER = {
  name: 'Yaw Boateng',
  phone: '024 555 0198',
  vehicle: 'TV3 motorcycle - GT 4321'
};

/**
 * Held on globalThis so the module survives dev-server hot reloads, otherwise
 * every reload would drop orders the user just created.
 */
const MOCK_STORE_KEY = '__afritech_mock_orders__';

interface MockUserRecord {
  id: string;
  name: string;
  email: string;
  phone: string;
  passwordDigest: string;
}

interface MockStore {
  orders: Map<string, Order>;
  users: Map<string, MockUserRecord>;
  tokens: Map<string, string>;
  seededAt: number;
}

function getStore(): MockStore {
  const globalRef = globalThis as typeof globalThis & { [MOCK_STORE_KEY]?: MockStore };

  let store = globalRef[MOCK_STORE_KEY];

  if (!store) {
    store = { orders: new Map(), users: new Map(), tokens: new Map(), seededAt: Date.now() };
    globalRef[MOCK_STORE_KEY] = store;
  }

  // Backfills a store left behind by a hot reload from before auth existed.
  if (!store.users) store.users = new Map();
  if (!store.tokens) store.tokens = new Map();

  return store;
}

function delay(ms: number = MOCK_LATENCY_MS): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mockError(message: string, status: number): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

/** Advances an order's status based on its age, so tracking is demonstrable. */
function withCurrentStage(order: Order): Order {
  const ageMinutes = (Date.now() - new Date(order.createdAt).getTime()) / 60000;

  const reached = STAGE_MINUTES.reduce<{ after: number; status: OrderStatus } | null>(
    (accumulator, stage) => {
      if (ageMinutes >= stage.after) return stage;
      return accumulator;
    },
    null
  );

  const status = reached?.status ?? OrderStatus.PENDING;

  if (order.status === status) return order;

  const advanced: Order = {
    ...order,
    status,
    isPaid: order.isPaid || status !== OrderStatus.PENDING,
    updatedAt: new Date().toISOString(),
    rider: status === OrderStatus.DISPATCHED ? MOCK_RIDER : order.rider
  };

  if (status === OrderStatus.DELIVERED) advanced.rider = null;

  getStore().orders.set(advanced.id, advanced);

  return advanced;
}

export function isMockApiEnabled(): boolean {
  return process.env.NEXT_PUBLIC_USE_MOCK_API === 'true';
}

export async function mockFetchProducts(filters?: ProductFilters): Promise<Product[]> {
  await delay();

  return MOCK_PRODUCTS.filter((product) => {
    if (filters?.category && product.category !== filters.category) return false;
    if (filters?.search && !product.name.toLowerCase().includes(filters.search.toLowerCase())) {
      return false;
    }
    if (filters?.inStock !== undefined && product.stock > 0 !== filters.inStock) return false;
    if (filters?.minPrice !== undefined && product.price < filters.minPrice) return false;
    if (filters?.maxPrice !== undefined && product.price > filters.maxPrice) return false;
    if (filters?.colors?.length && !filters.colors.some((color) => product.colors.includes(color))) {
      return false;
    }

    return true;
  });
}

export async function mockGetProduct(id: string): Promise<Product> {
  await delay();

  const product = MOCK_PRODUCTS.find((entry) => entry.id === id);

  if (!product) {
    throw mockError('We could not find that product.', 404);
  }

  return product;
}

export async function mockCreateOrder(payload: CreateOrderPayload): Promise<Order> {
  await delay(500);

  if (!payload.items?.length) {
    throw mockError('An order needs at least one item.', 400);
  }

  const now = new Date().toISOString();
  const subtotal =
    Math.round(payload.items.reduce((sum, item) => sum + item.price * item.quantity, 0) * 100) / 100;
  const deliveryFee = calculateDeliveryFee(payload.deliveryArea);

  const order: Order = {
    id: `mock-order-${Date.now().toString(36)}`,
    reference: generateReference(),
    userId: 'mock-user',
    items: payload.items.map((item, index) => ({
      id: `mock-order-item-${index}`,
      productId: item.productId,
      name: MOCK_PRODUCTS.find((product) => product.id === item.productId)?.name,
      image: undefined,
      quantity: item.quantity,
      color: item.color,
      price: item.price
    })),
    subtotal,
    deliveryFee,
    totalPrice: Math.round((subtotal + deliveryFee) * 100) / 100,
    status: OrderStatus.PENDING,
    customerName: payload.customerName,
    customerPhone: payload.customerPhone,
    customerEmail: payload.customerEmail,
    deliveryArea: payload.deliveryArea,
    deliveryAddress: payload.deliveryAddress,
    expectedDeliveryDate: payload.expectedDeliveryDate,
    isPaid: false,
    createdAt: now,
    updatedAt: now
  };

  getStore().orders.set(order.id, order);

  return order;
}

export async function mockGetOrder(id: string): Promise<Order> {
  await delay();

  const order = getStore().orders.get(id);

  if (!order) {
    throw mockError('We could not find that order.', 404);
  }

  return withCurrentStage(order);
}

/**
 * Mints a mock payment attempt for an in-memory order. The reference is the
 * order reference so `mockVerifyPayment` can resolve it. No backend is
 * contacted, so this is only reachable when `isMockApiEnabled()` is true.
 */
export async function mockInitializePayment(orderId: string): Promise<PaymentAttempt> {
  await delay();

  const order = getStore().orders.get(orderId);
  if (!order) {
    throw mockError('We could not find that order.', 404);
  }
  if (order.isPaid) {
    throw mockError('This order is already paid.', 409);
  }

  return {
    reference: order.reference,
    amount: Math.round(order.totalPrice * 100),
    currency: 'GHS',
    email: order.customerEmail
  };
}

/**
 * Simulates a successful verification against the in-memory mock order store.
 * It never contacts Paystack: mock mode must stay fully separate from the real
 * payment path, which is verified by the backend. Only reachable when
 * `isMockApiEnabled()` is true.
 */
export async function mockVerifyPayment(reference: string): Promise<PaymentVerification> {
  await delay();

  const order = Array.from(getStore().orders.values()).find(
    (entry) => entry.reference === reference
  );

  if (!order) {
    return {
      verified: false,
      reference,
      message: 'We could not find a transaction for that reference.'
    };
  }

  const advanced = withCurrentStage(order);

  const paid: Order = { ...advanced, isPaid: true, paymentReference: reference };
  getStore().orders.set(paid.id, paid);

  return {
    verified: true,
    reference,
    orderId: paid.id,
    amount: paid.totalPrice,
    status: OrderStatus.PAID,
    message: 'Payment confirmed.'
  };
}

/** Test helper: resets the in-memory order store. */
export function resetMockOrders(): void {
  getStore().orders.clear();
}

/* -------------------------------------------------------------------------- *
 * Mock authentication
 *
 * Only what the storefront needs to exercise the UI. Passwords are digested,
 * never stored or logged in plaintext, but none of this replaces real server
 * side auth: the production backend owns credential checks and token issue.
 * -------------------------------------------------------------------------- */

const MOCK_TOKEN_PREFIX = 'mock';

function toPublicUser(record: MockUserRecord): User {
  const { id, name, email, phone } = record;
  return { id, name, email, phone };
}

/** Mock-only digest. The real backend must use a slow KDF such as bcrypt/argon2. */
async function digestPassword(password: string): Promise<string> {
  const material = new TextEncoder().encode(`afritech-mock:${password}`);
  const subtle = globalThis.crypto?.subtle;

  if (subtle) {
    const digest = await subtle.digest('SHA-256', material);
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  }

  // Non-cryptographic fallback for non-secure contexts. Mock data only.
  let hash = 5381;
  for (const byte of material) hash = ((hash * 33) ^ byte) >>> 0;
  return `fnv-${hash.toString(16)}`;
}

function randomNonce(): string {
  const bytes = new Uint8Array(16);

  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }

  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function issueMockToken(userId: string): string {
  const token = `${MOCK_TOKEN_PREFIX}.${userId}.${randomNonce()}`;
  getStore().tokens.set(token, userId);
  return token;
}

function readMockToken(token: string): string | null {
  if (!token.startsWith(`${MOCK_TOKEN_PREFIX}.`)) return null;
  return getStore().tokens.get(token) ?? null;
}

export async function mockRegister(payload: RegisterPayload): Promise<AuthResponse> {
  await delay(500);

  const name = payload.name.trim();
  const email = payload.email.trim().toLowerCase();
  const phone = payload.phone.trim();

  if (name.length < 2) throw mockError('Enter your full name.', 400);
  if (!validateEmail(email)) throw mockError('Enter a valid email address.', 400);
  if (!validatePhoneGH(phone)) {
    throw mockError('Enter a valid Ghana number, e.g. 0241234567.', 400);
  }
  if (!validatePassword(payload.password)) {
    throw mockError('Use at least 8 characters with both a letter and a number.', 400);
  }
  if (getStore().users.has(email)) {
    throw mockError('An account already exists for that email. Try signing in instead.', 409);
  }

  const record: MockUserRecord = {
    id: `mock-user-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name,
    email,
    phone,
    passwordDigest: await digestPassword(payload.password)
  };

  getStore().users.set(email, record);

  return { token: issueMockToken(record.id), user: toPublicUser(record) };
}

export async function mockLogin(credentials: AuthCredentials): Promise<AuthResponse> {
  await delay(500);

  const record = getStore().users.get(credentials.email.trim().toLowerCase());

  // One message for "no such user" and "wrong password", so the form cannot be
  // used to discover which emails have accounts.
  const rejected = () => mockError('Email or password is incorrect.', 401);
  const digest = await digestPassword(credentials.password);

  if (!record || digest !== record.passwordDigest) throw rejected();

  return { token: issueMockToken(record.id), user: toPublicUser(record) };
}

export async function mockCurrentUser(token: string): Promise<User> {
  await delay(200);

  const userId = token ? readMockToken(token) : null;
  const record = userId
    ? Array.from(getStore().users.values()).find((entry) => entry.id === userId)
    : undefined;

  if (!record) {
    throw mockError('Your session has expired. Please sign in again.', 401);
  }

  return toPublicUser(record);
}

export async function mockFetchUserOrders(user: User): Promise<Order[]> {
  await delay();

  const email = user.email.trim().toLowerCase();

  return Array.from(getStore().orders.values())
    .filter(
      (order) => order.userId === user.id || order.customerEmail.trim().toLowerCase() === email
    )
    .map(withCurrentStage)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
