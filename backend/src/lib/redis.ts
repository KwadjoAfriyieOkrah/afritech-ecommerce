import { createClient } from "redis";

import { env } from "./env";

export const redisClient = createClient({
  url: env.REDIS_URL,
  socket: {
    connectTimeout: 5_000,
    reconnectStrategy: (retries) => Math.min(retries * 200, 3_000),
  },
});

let redisErrorReported = false;

redisClient.on("error", (error) => {
  if (!redisErrorReported) {
    // Avoid logging the configured URL, which may contain credentials.
    console.error("Redis client error:", error.message);
    redisErrorReported = true;
  }
});

redisClient.on("ready", () => {
  redisErrorReported = false;
});

let connectionPromise: Promise<void> | null = null;

export function connectRedis(): Promise<void> {
  if (redisClient.isReady) return Promise.resolve();
  if (connectionPromise) return connectionPromise;
  if (redisClient.isOpen) {
    return Promise.reject(new Error("Redis client is already connecting"));
  }

  const connectionAttempt = redisClient.connect().then(() => undefined);
  let connectionTimeout: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    connectionTimeout = setTimeout(
      () => reject(new Error("Timed out connecting to Redis")),
      15_000,
    );
  });

  connectionPromise = Promise.race([connectionAttempt, timeout])
    .catch((error: unknown) => {
      if (redisClient.isOpen) redisClient.destroy();
      throw error;
    })
    .finally(() => {
      if (connectionTimeout) clearTimeout(connectionTimeout);
      connectionPromise = null;
    });

  return connectionPromise;
}

export async function disconnectRedis(): Promise<void> {
  if (!redisClient.isOpen) return;
  if (!redisClient.isReady) {
    redisClient.destroy();
    return;
  }
  await redisClient.quit();
}
