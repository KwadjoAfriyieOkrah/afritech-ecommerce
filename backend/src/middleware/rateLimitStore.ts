import { MemoryStore, type Store } from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";

import { env } from "../lib/env";
import { redisClient } from "../lib/redis";

type RedisReplyValue = boolean | number | string;
type RedisReply = RedisReplyValue | RedisReplyValue[];

function isRedisReply(value: unknown): value is RedisReply {
  if (
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return true;
  }

  return (
    Array.isArray(value) &&
    value.every(
      (item: unknown) =>
        typeof item === "boolean" ||
        typeof item === "number" ||
        typeof item === "string",
    )
  );
}

export function createRedisRateLimitStore(name: string): Store {
  return new RedisStore({
    prefix: `afritech:${env.NODE_ENV}:rate-limit:${name}:`,
    sendCommand: async (...args: string[]): Promise<RedisReply> => {
      const reply: unknown = await redisClient.sendCommand(args);
      if (!isRedisReply(reply)) {
        throw new TypeError("Unexpected Redis reply for rate-limit command");
      }
      return reply;
    },
  });
}

export function createRateLimitStore(name: string): Store {
  if (process.env.NODE_TEST_CONTEXT !== undefined) {
    return new MemoryStore();
  }
  return createRedisRateLimitStore(name);
}
