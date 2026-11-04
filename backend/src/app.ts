import express from "express";
import cors from "cors";

import { env } from "./lib/env";
import productsRouter from "./routes/products";
import authRouter from "./routes/auth.routes";
import ordersRouter from "./routes/orders.routes";
import deliveryZonesRouter from "./routes/delivery-zones.routes";
import paymentsRouter from "./routes/payments.routes";
import adminRouter from "./routes/admin.routes";
import { handlePaystackWebhook } from "./controllers/paystack-webhook.controller";
import { rejectUntrustedOrigin } from "./middleware/rejectUntrustedOrigin";

const app = express();
app.set("trust proxy", env.TRUST_PROXY_HOPS);
app.use(cors({ origin: env.FRONTEND_URL, credentials: true }));

// Paystack signs the exact bytes it sends, so this route parses its own raw
// body and verifies the HMAC before express.json() (registered below) can
// touch it. No other route sees a raw body.
app.use(
  "/webhooks/paystack",
  express.raw({ type: "application/json" }),
  handlePaystackWebhook,
);

app.use(rejectUntrustedOrigin);

app.use(express.json());

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

app.use("/products", productsRouter);
app.use("/auth", authRouter);
app.use("/orders", ordersRouter);
app.use("/delivery-zones", deliveryZonesRouter);
app.use("/payments", paymentsRouter);
app.use("/admin", adminRouter);

export default app;
