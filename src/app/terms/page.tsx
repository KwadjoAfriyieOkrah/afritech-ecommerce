import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Terms of Service | AFriTech',
  description: 'The terms that apply when you place an order with AFriTech.'
};

export default function TermsPage() {
  return (
    <article className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-bold text-ink">Terms of Service</h1>

      <div className="mt-6 flex flex-col gap-6 text-sm leading-relaxed text-stone-600 sm:text-base">
        <p>
          Placing an order means you agree to pay the listed price plus the delivery fee shown at
          checkout for your area. Orders are reserved for 15 minutes while payment is completed;
          unpaid reservations are released automatically after that window. If payment arrives
          after a reservation has expired, we will contact you to sort it out &mdash; your money is
          never lost.
        </p>

        <p>
          Delivery timing depends on your area and is confirmed after your order is placed. You can
          track your order anytime at{' '}
          <Link href="/track" className="text-dark-gold underline">
            /track
          </Link>{' '}
          using your order reference and the phone number you checked out with.
        </p>

        <p>
          Products are described as accurately as possible, including stated specs (storage, colour,
          and so on). If an item turns out faulty on arrival, contact us within [X days &mdash;
          confirm with client] at{' '}
          <a href="mailto:kojoafriyie195@gmail.com" className="text-dark-gold underline">
            kojoafriyie195@gmail.com
          </a>{' '}
          or WhatsApp{' '}
          <a
            href="https://wa.me/233546215695"
            target="_blank"
            rel="noopener noreferrer"
            className="text-dark-gold underline"
          >
            +233 54 621 5695
          </a>{' '}
          and we&apos;ll sort a replacement or refund.
        </p>

        <p>
          We reserve the right to cancel an order (e.g. if a product goes out of stock before
          dispatch) and refund you in full.
        </p>

        <p>Last updated: [date of publish].</p>
      </div>
    </article>
  );
}
