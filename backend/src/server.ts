import express from "express";
import cors from "cors";

import { env } from "./lib/env";
import { prisma } from "./lib/prisma";
import productsRouter from "./routes/products";
import authRouter from "./routes/auth.routes";
import ordersRouter from "./routes/orders.routes";
import deliveryZonesRouter from "./routes/delivery-zones.routes";
import paymentsRouter from "./routes/payments.routes";
import adminRouter from "./routes/admin.routes";
import { handlePaystackWebhook } from "./controllers/paystack-webhook.controller";
import { releaseExpiredReservations } from "./services/reservations.service";

const RESERVATION_SWEEP_INTERVAL_MS = 60_000;

const app = express();
app.use(cors({ origin: env.FRONTEND_URL }));

// Paystack signs the exact bytes it sends, so this route parses its own raw
// body and verifies the HMAC before express.json() (registered below) can
// touch it. No other route sees a raw body.
app.use(
  "/webhooks/paystack",
  express.raw({ type: "application/json" }),
  handlePaystackWebhook,
);

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

const server = app.listen(env.PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`AFriTech backend listening on http://localhost:${env.PORT}`);
});

// Frees stock from unpaid reservations that have timed out. Single-process
// only; a multi-instance deployment would need a shared scheduler instead.
const reservationSweep = setInterval(() => {
  void releaseExpiredReservations(new Date())
    .then((count) => {
      if (count > 0) {
        // eslint-disable-next-line no-console
        console.log(`Released ${count} expired reservation(s)`);
      }
    })
    .catch((error) => {
      // eslint-disable-next-line no-console
      console.error("Reservation sweep failed:", error);
    });
}, RESERVATION_SWEEP_INTERVAL_MS);

async function shutdown(signal: string): Promise<void> {
  // eslint-disable-next-line no-console
  console.log(`${signal} received, shutting down`);
  clearInterval(reservationSweep);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));