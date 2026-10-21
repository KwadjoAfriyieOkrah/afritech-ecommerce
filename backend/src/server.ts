import { env } from "./lib/env";
import { prisma } from "./lib/prisma";
import app from "./app";
import { releaseExpiredReservations } from "./services/reservations.service";

const RESERVATION_SWEEP_INTERVAL_MS = 60_000;

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