import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy Policy | AFriTech',
  description: 'How AFriTech collects, uses, and protects your personal information.'
};

export default function PrivacyPage() {
  return (
    <article className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-bold text-ink">Privacy Policy</h1>

      <div className="mt-6 flex flex-col gap-6 text-sm leading-relaxed text-stone-600 sm:text-base">
        <p>
          We collect only what&apos;s needed to process your order: your name, phone number,
          delivery area and address, and &mdash; only when you pay by card or choose to give it
          &mdash; an email address. If you check out without an email, our payment provider is
          given a placeholder address derived from your phone number so your payment can be
          processed; this is never used to contact you.
        </p>

        <p>
          We use Paystack to process MoMo and card payments. We do not see or store your card or
          mobile money PIN &mdash; Paystack handles that directly. We use Cloudinary to host product
          images; no personal data is stored there.
        </p>

        <p>
          Your order details are kept so you can track your delivery by order reference and phone
          number, and so we can handle any delivery issues or returns. We do not sell or share your
          information with third parties for marketing.
        </p>

        <p>
          You can ask us to tell you what we hold about you, or to delete it, by emailing{' '}
          <a href="mailto:kojoafriyie195@gmail.com" className="text-dark-gold underline">
            kojoafriyie195@gmail.com
          </a>{' '}
          or messaging us on WhatsApp at{' '}
          <a
            href="https://wa.me/233546215695"
            target="_blank"
            rel="noopener noreferrer"
            className="text-dark-gold underline"
          >
            +233 54 621 5695
          </a>
          . We&apos;ll respond as soon as we can.
        </p>

        <p>
          This policy may be updated as the shop grows; the latest version is always on this page.
          Last updated: [date of publish].
        </p>
      </div>
    </article>
  );
}
