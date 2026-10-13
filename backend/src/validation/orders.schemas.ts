import { z } from "zod";

const GHANA_PHONE_REGEX = /^0\d{9}$/;

// These fields may be sent by the client for backwards compatibility, but the
// server always computes pricing itself and ignores them. They are declared so
// .strict() does not reject them while every other unknown field is rejected.
const ignoredMoneyFields = {
  price: z.unknown().optional(),
  deliveryFee: z.unknown().optional(),
  subtotal: z.unknown().optional(),
  total: z.unknown().optional(),
};

const orderItemSchema = z
  .object({
    productId: z.string().trim().min(1, "Product is required"),
    color: z.string().trim().min(1, "Colour is required"),
    quantity: z
      .number()
      .int("Quantity must be a whole number")
      .min(1, "Quantity must be at least 1")
      .max(10, "Quantity must be at most 10"),
    ...ignoredMoneyFields,
  })
  .strict();

export const createOrderSchema = z
  .object({
    customerName: z
      .string()
      .trim()
      .min(2, "Name must be at least 2 characters")
      .max(100, "Name must be at most 100 characters"),
    customerEmail: z
      .string()
      .trim()
      .toLowerCase()
      .email("Enter a valid email address"),
    customerPhone: z
      .string()
      .trim()
      .regex(GHANA_PHONE_REGEX, "Enter a valid Ghana number, e.g. 0241234567"),
    deliveryArea: z.string().trim().min(1, "Choose a delivery area"),
    deliveryAddress: z
      .string()
      .trim()
      .min(5, "Address must be at least 5 characters")
      .max(200, "Address must be at most 200 characters"),
    items: z
      .array(orderItemSchema)
      .min(1, "Add at least one item")
      .max(20, "You can order at most 20 items"),
    ...ignoredMoneyFields,
  })
  .strict();

export type CreateOrderPayload = z.infer<typeof createOrderSchema>;

export interface ValidationDetail {
  field: string;
  message: string;
}

export function toOrderValidationDetails(error: z.ZodError): ValidationDetail[] {
  const details: ValidationDetail[] = [];

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
