import { FulfillmentStatus } from "../generated/prisma/client";
import { z } from "zod";

const GHANA_PHONE_REGEX = /^0\d{9}$/;

export const adminFulfillmentQuerySchema = z.enum(FulfillmentStatus, {
  error: "Fulfillment must be PENDING, PACKAGING, DISPATCHED or DELIVERED",
});

export const adminOrderIdSchema = z
  .string()
  .min(1, "Order not found")
  .max(64, "Order not found");

export const adminRiderCreateSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Name is required")
      .max(60, "Name must be at most 60 characters"),
    phone: z
      .string()
      .trim()
      .regex(GHANA_PHONE_REGEX, "Enter a valid Ghana number, e.g. 0241234567"),
  })
  .strict();

export const adminRiderAssignSchema = z
  .object({
    riderId: z.string().trim().min(1, "Rider is required"),
  })
  .strict();

export type AdminRiderCreateInput = z.infer<typeof adminRiderCreateSchema>;
export type AdminRiderAssignInput = z.infer<typeof adminRiderAssignSchema>;

export interface ValidationDetail {
  field: string;
  message: string;
}

export function toAdminValidationDetails(
  error: z.ZodError,
): ValidationDetail[] {
  return error.issues.map((issue) => ({
    field: issue.path.length > 0 ? issue.path.map(String).join(".") : "body",
    message: issue.message,
  }));
}
