import { rateLimit } from "express-rate-limit";

const RATE_LIMIT_MESSAGE = {
  error: "Too many requests. Please try again later.",
};

export const orderCreationRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: RATE_LIMIT_MESSAGE,
});

export const paymentInitializationRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: RATE_LIMIT_MESSAGE,
});
