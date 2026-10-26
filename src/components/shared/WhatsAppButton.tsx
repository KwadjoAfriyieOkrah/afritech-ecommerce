'use client';

import { FaWhatsapp } from 'react-icons/fa';

export function WhatsAppButton() {
  const whatsapp = process.env.NEXT_PUBLIC_ADMIN_WHATSAPP;
  if (!whatsapp) {
    return null;
  }
  return (
    <a
      href={`https://wa.me/${whatsapp}`}
      target="_blank"
      rel="noopener noreferrer"
      className="fixed bottom-4 right-4 z-50 flex h-12 w-12 items-center justify-center rounded-full bg-green-500 text-white shadow-lg hover:bg-green-600"
      aria-label="Contact us on WhatsApp"
    >
      <FaWhatsapp className="h-6 w-6" />
    </a>
  );
}
