'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { HiOutlineClipboardList, HiOutlineLogout, HiOutlineUser } from 'react-icons/hi';
import { toast } from 'sonner';
import { ApiError, clearAuthToken, fetchUserOrders } from '@/services/api';
import { useOrderStore, useUserStore } from '@/store';
import { OrderStatus, type Order } from '@/types';
import { ErrorBoundary } from '@/components/shared/ErrorBoundary';
import { formatCedis, formatDateTime } from '@/utils/format';

const STATUS_LABELS: Record<OrderStatus, string> = {
  [OrderStatus.PENDING]: 'Order received',
  [OrderStatus.PAID]: 'Payment confirmed',
  [OrderStatus.PACKAGING]: 'Being packaged',
  [OrderStatus.DISPATCHED]: 'Out for delivery',
  [OrderStatus.DELIVERED]: 'Delivered'
};

const STATUS_BADGES: Record<OrderStatus, string> = {
  [OrderStatus.PENDING]: 'bg-stone-100 text-stone-600',
  [OrderStatus.PAID]: 'bg-light-gold text-dark-gold',
  [OrderStatus.PACKAGING]: 'bg-amber-100 text-amber-800',
  [OrderStatus.DISPATCHED]: 'bg-sky-100 text-sky-800',
  [OrderStatus.DELIVERED]: 'bg-green-100 text-green-800'
};

function AccountSkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-8 sm:px-6">
      <div className="skeleton h-8 w-40" />
      <div className="card flex flex-col gap-3 p-6">
        <div className="skeleton h-4 w-32" />
        <div className="skeleton h-4 w-56" />
        <div className="skeleton h-4 w-40" />
      </div>
      <div className="card flex flex-col gap-4 p-6">
        <div className="skeleton h-5 w-40" />
        <div className="skeleton h-20 w-full" />
        <div className="skeleton h-20 w-full" />
      </div>
    </div>
  );
}

function SignInGate() {
  return (
    <div className="mx-auto w-full max-w-md px-4 py-12 sm:px-6">
      <div className="card flex flex-col items-start gap-4 p-6">
        <HiOutlineUser className="h-8 w-8 text-dark-gold" aria-hidden="true" />
        <div>
          <h1 className="text-lg font-semibold text-ink">Sign in to see your orders</h1>
          <p className="mt-1 text-sm text-stone-500">
            Your order history is tied to your account. Sign in or create a free account to pick up
            where you left off.
          </p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:flex-row">
          <Link href="/login" className="btn btn-primary flex-1">
            Sign in
          </Link>
          <Link href="/register" className="btn btn-outline flex-1">
            Create account
          </Link>
        </div>
      </div>
    </div>
  );
}

function OrderRow({ order }: { order: Order }) {
  const itemCount = order.items.reduce((total, item) => total + item.quantity, 0);
  const summary = order.items
    .slice(0, 2)
    .map((item) => item.name || item.productId)
    .join(', ');
  const remainder = order.items.length - 2;

  return (
    <li className="flex flex-col gap-3 rounded-lg border border-stone-200 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-mono text-sm font-semibold tracking-wide text-dark-gold">
            {order.reference}
          </p>
          <p className="text-xs text-stone-500">{formatDateTime(order.createdAt)}</p>
        </div>

        <div className="flex flex-wrap gap-2">
          <span className={`badge ${STATUS_BADGES[order.status] ?? 'bg-stone-100 text-stone-600'}`}>
            {STATUS_LABELS[order.status] ?? order.status}
          </span>
          <span
            className={`badge ${order.isPaid ? 'bg-green-100 text-green-700' : 'bg-stone-100 text-stone-500'}`}
          >
            {order.isPaid ? 'Paid' : 'Unpaid'}
          </span>
        </div>
      </div>

      <p className="text-sm text-stone-600">
        {itemCount} item{itemCount === 1 ? '' : 's'}
        {summary && (
          <>
            {' - '}
            {summary}
            {remainder > 0 && ` and ${remainder} more`}
          </>
        )}
      </p>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-stone-100 pt-3">
        <span className="text-sm font-semibold text-ink">{formatCedis(order.totalPrice)}</span>

        <div className="flex gap-2">
          <Link href={`/tracking/${order.id}`} className="btn btn-outline px-3 py-1.5 text-xs">
            Track order
          </Link>
          <Link href={`/confirmation/${order.id}`} className="btn btn-ghost px-2 py-1.5 text-xs">
            View receipt
          </Link>
        </div>
      </div>
    </li>
  );
}

export default function AccountPage() {
  const router = useRouter();

  const user = useUserStore((state) => state.user);
  const sessionReady = useUserStore((state) => state.sessionReady);
  const logout = useUserStore((state) => state.logout);
  const clearOrders = useOrderStore((state) => state.clearOrders);
  const localHistory = useOrderStore((state) => state.orderHistory);

  const [orders, setOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;

    setIsLoading(true);
    setError(null);

    try {
      setOrders(await fetchUserOrders(user));
    } catch (caught) {
      setError(ApiError.from(caught).message);
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (sessionReady && user) void load();
  }, [sessionReady, user, load]);

  // Local orders from this session are merged in, so an order placed minutes
  // ago shows up even if the API has not caught up yet. Server data wins on
  // clash, and local entries are filtered to this account so a previous
  // visitor's guest orders never surface here.
  const visibleOrders = useMemo(() => {
    const email = user ? user.email.trim().toLowerCase() : '';
    const isOwn = (order: Order) =>
      user !== null &&
      (order.userId === user.id || order.customerEmail.trim().toLowerCase() === email);

    const byId = new Map<string, Order>();

    for (const order of localHistory) {
      if (isOwn(order)) byId.set(order.id, order);
    }
    for (const order of orders) byId.set(order.id, order);

    return Array.from(byId.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [localHistory, orders, user]);

  const handleLogout = () => {
    // Clear the token, the user, and everything the next person on this
    // device could use to read this account.
    clearAuthToken();
    clearOrders();
    logout();
    toast.success('You have been signed out.');
    router.replace('/');
  };

  if (!sessionReady) return <AccountSkeleton />;
  if (!user) return <SignInGate />;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <ErrorBoundary title="Account failed to load">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-ink sm:text-3xl">My account</h1>
            <p className="mt-1 text-sm text-stone-500">
              Signed in as {user.email}
            </p>
          </div>

          <button type="button" onClick={handleLogout} className="btn btn-outline">
            <HiOutlineLogout className="h-4 w-4" aria-hidden="true" />
            Sign out
          </button>
        </header>

        <section className="card mt-6 p-5 sm:p-6">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-light-gold text-base font-bold text-dark-gold">
              {user.name.trim().charAt(0).toUpperCase() || '?'}
            </span>
            <div className="min-w-0">
              <p className="truncate text-base font-semibold text-ink">{user.name}</p>
              <p className="truncate text-sm text-stone-500">{user.email}</p>
              <p className="text-sm text-stone-500">{user.phone}</p>
            </div>
          </div>

          <p className="mt-4 border-t border-stone-200 pt-4 text-xs text-stone-500">
            These details are filled in automatically at checkout. They are only shown to you.
          </p>
        </section>

        <section className="card mt-4 p-5 sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
              <HiOutlineClipboardList className="h-5 w-5 text-dark-gold" aria-hidden="true" />
              Order history
            </h2>

            <button
              type="button"
              onClick={() => void load()}
              disabled={isLoading}
              className="btn btn-ghost px-1 text-xs"
            >
              {isLoading ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>

          {error && (
            <div role="alert" className="alert-error mt-4 flex items-center justify-between gap-3">
              <p>{error}</p>
              <button type="button" onClick={() => void load()} className="btn btn-outline text-xs">
                Retry
              </button>
            </div>
          )}

          {isLoading && visibleOrders.length === 0 ? (
            <div className="mt-4 flex flex-col gap-3">
              <div className="skeleton h-24 w-full" />
              <div className="skeleton h-24 w-full" />
              <div className="skeleton h-24 w-full" />
            </div>
          ) : visibleOrders.length === 0 ? (
            <div className="mt-4 flex flex-col items-start gap-3 rounded-lg border border-dashed border-stone-300 p-5">
              <p className="text-sm font-medium text-ink">No orders yet</p>
              <p className="text-sm text-stone-500">
                When you place an order it will show up here with its live status.
              </p>
              <Link href="/products" className="btn btn-primary">
                Start shopping
              </Link>
            </div>
          ) : (
            <ol className="mt-4 flex flex-col gap-3">
              {visibleOrders.map((order) => (
                <OrderRow key={order.id} order={order} />
              ))}
            </ol>
          )}
        </section>
      </ErrorBoundary>
    </div>
  );
}
