'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function Footer() {
  const pathname = usePathname();

  if (pathname === '/admin' || pathname.startsWith('/admin/')) {
    return null;
  }

  return (
    <footer className="mt-12 border-t border-white/10 bg-ink text-stone-300">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-8 sm:px-6 md:flex-row md:items-start md:justify-between">
        <div className="flex flex-col gap-2">
          <p className="text-lg font-bold tracking-tight text-white">
            AFri<span className="text-gold">Tech</span>
          </p>
          <p className="text-sm">
            Questions about an order?{' '}
            <a
              href="https://wa.me/233546215695"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-gold hover:text-light-gold"
            >
              WhatsApp +233 54 621 5695
            </a>{' '}
            or email{' '}
            <a
              href="mailto:kojoafriyie195@gmail.com"
              className="font-medium text-gold hover:text-light-gold"
            >
              kojoafriyie195@gmail.com
            </a>
            .
          </p>
        </div>

        <nav aria-label="Legal" className="flex items-center gap-5 text-sm">
          <Link href="/privacy" className="text-stone-300 hover:text-gold">
            Privacy Policy
          </Link>
          <Link href="/terms" className="text-stone-300 hover:text-gold">
            Terms of Service
          </Link>
        </nav>
      </div>
    </footer>
  );
}
