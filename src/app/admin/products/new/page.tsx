'use client';

import Link from 'next/link';
import { ProductForm } from '@/components/admin/ProductForm';

export default function NewAdminProductPage() {
  return (
    <div className="flex flex-col gap-4">
      <Link href="/admin/products" className="btn btn-ghost w-fit px-0 text-sm">
        Back to products
      </Link>
      <ProductForm />
    </div>
  );
}
