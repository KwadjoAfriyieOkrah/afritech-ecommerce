import { rateLimit } from "express-rate-limit";

import { createRateLimitStore } from "./rateLimitStore";

const RATE_LIMIT_MESSAGE = {
  error: "Too many requests. Please try again later.",
};

export const loginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: RATE_LIMIT_MESSAGE,
  passOnStoreError: false,
  store: createRateLimitStore("login"),
});

export const registrationRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: RATE_LIMIT_MESSAGE,
  passOnStoreError: false,
  store: createRateLimitStore("registration"),
});

export const orderTrackingRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: RATE_LIMIT_MESSAGE,
  passOnStoreError: false,
  store: createRateLimitStore("order-tracking"),
});
