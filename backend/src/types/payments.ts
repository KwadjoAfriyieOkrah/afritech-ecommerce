export interface InitializePaymentResponse {
  reference: string;
  amount: number;
  currency: string;
  email: string;
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
