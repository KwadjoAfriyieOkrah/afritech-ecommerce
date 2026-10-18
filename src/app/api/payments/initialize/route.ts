import { NextResponse, type NextRequest } from 'next/server';
import api, { ApiError } from '@/services/api';
import type { PaymentAttempt } from '@/types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Starts a payment attempt for an order the caller owns. The backend is the
 * only authority: it checks ownership, refuses an already-paid or expired
 * order, and mints a fresh reference. The caller's credentials are forwarded so
 * the backend can enforce that ownership; this handler never invents a
 * reference, amount or currency of its own.
 */
export async function POST(request: NextRequest) {
  let parsed: unknown;

  try {
    parsed = await request.json();
  } catch {
    return NextResponse.json(
      { message: 'Send a JSON body containing the order id.', code: 'INVALID_BODY' },
      { status: 400 }
    );
  }

  const body = isRecord(parsed) ? parsed : {};
  const orderId = typeof body.orderId === 'string' ? body.orderId.trim() : '';

  if (!orderId || orderId.length > 64) {
    return NextResponse.json(
      { message: 'A valid order id is required.', code: 'MISSING_ORDER_ID' },
      { status: 400 }
    );
  }

  const authorization = request.headers.get('authorization');

  try {
    const { data } = await api.post<PaymentAttempt>(
      '/payments/initialize',
      { orderId },
      authorization ? { headers: { Authorization: authorization } } : undefined
    );
    return NextResponse.json(data, { status: 200 });
  } catch (caught) {
    const error = ApiError.from(caught);
    const status = error.status >= 400 && error.status < 600 ? error.status : 502;

    return NextResponse.json(
      { message: error.message, code: error.code ?? 'PAYMENT_INITIALIZATION_FAILED' },
      { status }
    );
  }
}
