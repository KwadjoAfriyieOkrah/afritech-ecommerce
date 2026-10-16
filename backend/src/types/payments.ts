export interface InitializePaymentResponse {
  authorizationUrl: string;
  reference: string;
}

export type PaymentStatusResponse = "paid" | "pending" | "failed";

export interface VerifyPaymentResponse {
  status: PaymentStatusResponse;
  orderId: string;
}

export interface ErrorBody {
  error: string;
}
