import { rateLimit } from "express-rate-limit";

import { createRateLimitStore } from "./rateLimitStore";

const RATE_LIMIT_MESSAGE = {
  error: "Too many requests. Please try again later.",
};

export const orderCreationRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: RATE_LIMIT_MESSAGE,
  passOnStoreError: false,
  store: createRateLimitStore("order-creation"),
});

export const paymentInitializationRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: RATE_LIMIT_MESSAGE,
  passOnStoreError: false,
  store: createRateLimitStore("payment-initialization"),
});
