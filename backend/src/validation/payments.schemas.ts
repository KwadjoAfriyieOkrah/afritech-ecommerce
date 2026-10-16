import { z } from "zod";

export const initializePaymentSchema = z
  .object({
    orderId: z.string().trim().min(1, "Order id is required"),
  })
  .strict();

export type InitializePaymentPayload = z.infer<typeof initializePaymentSchema>;

export interface PaymentValidationDetail {
  field: string;
  message: string;
}

export function toPaymentValidationDetails(
  error: z.ZodError,
): PaymentValidationDetail[] {
  const details: PaymentValidationDetail[] = [];

  for (const issue of error.issues) {
    if (issue.code === "unrecognized_keys") {
      for (const key of issue.keys) {
        details.push({ field: key, message: "Unrecognized field" });
      }
      continue;
    }

    const field =
      issue.path.length > 0 ? issue.path.map(String).join(".") : "body";
    details.push({ field, message: issue.message });
  }

  return details;
}
