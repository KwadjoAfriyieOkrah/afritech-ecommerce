import { config } from "dotenv";
import { z } from "zod";

config();

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),
  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL is required (postgresql://...)"),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  PAYSTACK_SECRET_KEY: z.string().min(1, "PAYSTACK_SECRET_KEY is required"),
  GUEST_PAYMENT_EMAIL_DOMAIN: z
    .string()
    .min(1)
    .default("afritech.vercel.app"),
  FRONTEND_URL: z.string().url("FRONTEND_URL must be a valid URL"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const missing = parsed.error.issues.map((issue) => issue.path.join("."));
  // eslint-disable-next-line no-console
  console.error(
    `Invalid environment configuration. Missing or invalid variables: ${missing.join(
      ", ",
    )}`,
  );
  process.exit(1);
}

export const env = parsed.data;