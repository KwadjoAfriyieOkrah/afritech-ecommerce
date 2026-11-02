'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { useUserStore } from '@/store';

const ADMIN_LINKS = [
  { href: '/admin', label: 'Dashboard' },
  { href: '/admin/orders', label: 'Orders' },
  { href: '/admin/products', label: 'Products' },
  { href: '/admin/products/bulk', label: 'Bulk upload' },
  { href: '/admin/riders', label: 'Riders' }
];

function isActiveLink(href: string, pathname: string): boolean {
  if (href === '/admin') return pathname === '/admin';
  if (href === '/admin/products') {
    return (
      pathname === '/admin/products' ||
      (pathname.startsWith('/admin/products/') &&
        !pathname.startsWith('/admin/products/bulk'))
    );
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function AdminLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const user = useUserStore((state) => state.user);
  const sessionReady = useUserStore((state) => state.sessionReady);

  useEffect(() => {
    if (sessionReady && !user) {
      router.replace('/login?next=/admin');
    }
  }, [router, sessionReady, user]);

  if (!sessionReady) {
    return (
      <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
        <p className="text-sm text-stone-500">Checking access...</p>
      </div>
    );
  }

  if (!user) return null;

  if (user.role !== 'ADMIN') {
    return (
      <div className="mx-auto w-full max-w-md px-4 py-12 sm:px-6">
        <div className="card flex flex-col items-start gap-4 p-6">
          <h1 className="text-lg font-semibold text-ink">This area is for the shop owner.</h1>
          <p className="text-sm text-stone-500">
            Your account does not have access to the shop admin.
          </p>
          <Link href="/" className="btn btn-primary">
            Back to shop
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-stone-200 pb-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-dark-gold">Shop admin</p>
          <h1 className="text-2xl font-bold text-ink">Admin</h1>
        </div>

        <nav aria-label="Admin" className="flex items-center gap-2">
          {ADMIN_LINKS.map((link) => {
            const isActive = isActiveLink(link.href, pathname);

            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={isActive ? 'page' : undefined}
                className={`btn px-3 py-2 text-sm ${
                  isActive ? 'btn-primary' : 'btn-outline'
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
      </div>

      {children}
    </div>
  );
}
