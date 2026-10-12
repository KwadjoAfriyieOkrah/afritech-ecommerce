import { z } from "zod";

const GHANA_PHONE_REGEX = /^0\d{9}$/;

export const registerSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Name must be at least 2 characters")
    .max(100, "Name must be at most 100 characters"),
  email: z.string().trim().email("Enter a valid email address"),
  phone: z
    .string()
    .trim()
    .regex(GHANA_PHONE_REGEX, "Enter a valid Ghana number, e.g. 0241234567"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .regex(/[A-Za-z]/, "Password must contain a letter")
    .regex(/\d/, "Password must contain a digit"),
});

export const loginSchema = z.object({
  email: z.string().trim().email("Enter a valid email address"),
  password: z.string().min(1, "Enter your password"),
});

export interface ValidationDetail {
  field: string;
  message: string;
}

export function toValidationDetails(error: z.ZodError): ValidationDetail[] {
  return error.issues.map((issue) => ({
    field: issue.path.length > 0 ? String(issue.path[0]) : "form",
    message: issue.message,
  }));
}
