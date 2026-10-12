'use client';

import { Toaster as SonnerToaster } from 'sonner';

/**
 * Themed wrapper around sonner's `<Toaster />`. Colours come from the same
 * Tailwind design tokens the rest of the app uses.
 */
export function Toaster() {
  return (
    <SonnerToaster
      position="top-center"
      closeButton
      richColors
      duration={5000}
      toastOptions={{
        classNames: {
          toast: 'font-sans text-sm rounded-xl shadow-lg',
          title: 'font-semibold',
          description: 'text-sm',
          success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
          error: 'border-red-200 bg-red-50 text-red-900',
          info: 'border-stone-200 bg-white text-ink'
        }
      }}
    />
  );
}
