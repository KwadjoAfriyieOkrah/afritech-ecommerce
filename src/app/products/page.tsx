import { ProductListing } from '@/components/products/ProductListing';

export default function ProductsPage() {
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-ink sm:text-3xl">Shop AFriTech</h1>
        <p className="mt-1 text-sm text-stone-500">
          Quality electronics, delivered anywhere in Ghana.
        </p>
      </header>

      <ProductListing />
    </div>
  );
}