import express from "express";
import cors from "cors";

import { env } from "./lib/env";
import { prisma } from "./lib/prisma";
import productsRouter from "./routes/products";
import authRouter from "./routes/auth.routes";
import ordersRouter from "./routes/orders.routes";

const app = express();
app.use(cors({ origin: env.FRONTEND_URL }));
app.use(express.json());

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

app.use("/products", productsRouter);
app.use("/auth", authRouter);
app.use("/orders", ordersRouter);

const server = app.listen(env.PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`AFriTech backend listening on http://localhost:${env.PORT}`);
});

async function shutdown(signal: string): Promise<void> {
  // eslint-disable-next-line no-console
  console.log(`${signal} received, shutting down`);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));