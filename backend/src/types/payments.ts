export interface InitializePaymentResponse {
  reference: string;
  amount: number;
  currency: string;
  /** The customer's own address, or null when they did not leave one. */
  email: string | null;
}

export type PaymentStatusResponse = "paid" | "pending" | "failed";

export interface VerifyPaymentResponse {
  verified: boolean;
  reference: string;
  status: PaymentStatusResponse;
  orderId: string;
}

export interface ErrorBody {
  error: string;
}
