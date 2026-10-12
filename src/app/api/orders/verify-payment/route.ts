import { NextResponse, type NextRequest } from 'next/server';
import api, { ApiError } from '@/services/api';
import { isMockApiEnabled, mockGetOrder, mockVerifyPayment } from '@/services/mockApi';
import type { Order, PaymentVerification } from '@/types';

interface VerifyPaymentBody {
  reference?: unknown;
  orderId?: unknown;
}

function badRequest(message: string, code: string, status: number) {
  return NextResponse.json({ message, code }, { status });
}

export async function POST(request: NextRequest) {
  let body: VerifyPaymentBody;

  try {
    body = (await request.json()) as VerifyPaymentBody;
  } catch {
    return badRequest('Send a JSON body containing the payment reference.', 'INVALID_BODY', 400);
  }

  const reference = typeof body.reference === 'string' ? body.reference.trim() : '';

  if (!reference) {
    return badRequest('The payment reference is required.', 'MISSING_REFERENCE', 400);
  }

  if (reference.length > 100) {
    return badRequest('That payment reference is not valid.', 'INVALID_REFERENCE', 400);
  }

  const orderId = typeof body.orderId === 'string' ? body.orderId.trim() : '';

  try {
    const verification = isMockApiEnabled()
      ? await mockVerifyPayment(reference)
      : (
          await api.get<PaymentVerification>(
            `/payments/verify/${encodeURIComponent(reference)}`,
            { retry: true, headers: { Authorization: request.headers.get('authorization') ?? '' } }
          )
        ).data;

    if (!verification?.verified) {
      return NextResponse.json<PaymentVerification>(
        {
          verified: false,
          reference,
          orderId: orderId || undefined,
          message: verification?.message || 'We could not confirm this payment yet.'
        },
        { status: 402 }
      );
    }

    if (orderId) {
      try {
        const order = isMockApiEnabled()
          ? await mockGetOrder(orderId)
          : (
              await api.get<Order>(`/orders/${encodeURIComponent(orderId)}`, {
                headers: { Authorization: request.headers.get('authorization') ?? '' }
              })
            ).data;

        if (order?.status && order.status !== verification.status) {
          return NextResponse.json<PaymentVerification>(
            {
              verified: true,
              reference,
              orderId,
              status: order.status,
              amount: verification.amount,
              updatedStatus: order.status
            },
            { status: 200 }
          );
        }
      } catch {
        // The payment is verified; a failed order lookup must not fail the request.
      }
    }

    return NextResponse.json<PaymentVerification>(
      {
        verified: true,
        reference,
        orderId: orderId || undefined,
        status: verification.status,
        amount: verification.amount,
        message: 'Payment confirmed.'
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
