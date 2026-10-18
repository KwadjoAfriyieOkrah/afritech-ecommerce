import { NextResponse, type NextRequest } from 'next/server';
import api, { ApiError } from '@/services/api';
import type { PaymentVerification } from '@/types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function badRequest(message: string, code: string, status: number) {
  return NextResponse.json({ message, code }, { status });
}

/**
 * Forwards a payment verification to the backend, which is the only authority
 * on whether a payment is genuinely paid. The caller's credentials are passed
 * through so the backend can enforce order ownership; this handler never
 * upgrades an unverified result into a verified one.
 *
 * Mock mode is handled client-side in `verifyOrderPayment` (the mock order
 * store lives in the browser), so this route only ever talks to the backend.
 */
export async function POST(request: NextRequest) {
  let parsed: unknown;

  try {
    parsed = await request.json();
  } catch {
    return badRequest('Send a JSON body containing the payment reference.', 'INVALID_BODY', 400);
  }

  const body = isRecord(parsed) ? parsed : {};
  const reference = typeof body.reference === 'string' ? body.reference.trim() : '';

  if (!reference) {
    return badRequest('The payment reference is required.', 'MISSING_REFERENCE', 400);
  }

  if (reference.length > 100) {
    return badRequest('That payment reference is not valid.', 'INVALID_REFERENCE', 400);
  }

  const orderId = typeof body.orderId === 'string' ? body.orderId.trim() : '';

  try {
    const { data } = await api.get<PaymentVerification>(
      `/payments/verify/${encodeURIComponent(reference)}`,
      {
        retry: true,
        headers: { Authorization: request.headers.get('authorization') ?? '' }
      }
    );

    if (!data?.verified) {
      return NextResponse.json<PaymentVerification>(
        {
          verified: false,
          reference,
          orderId: orderId || data?.orderId || undefined,
          status: data?.status,
          message: data?.message || 'We could not confirm this payment yet.'
        },
        { status: 402 }
      );
    }

    return NextResponse.json<PaymentVerification>(
      {
        verified: true,
        reference,
        orderId: data.orderId || orderId || undefined,
        status: data.status,
        amount: data.amount,
        message: data.message || 'Payment confirmed.'
      },
      { status: 200 }
    );
  } catch (caught) {
    const error = ApiError.from(caught);
    const status = error.status >= 400 && error.status < 600 ? error.status : 502;

    return NextResponse.json(
      { message: error.message, code: error.code ?? 'PAYMENT_VERIFICATION_FAILED' },
      { status }
    );
  }
}
