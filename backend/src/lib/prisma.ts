import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../generated/prisma/client";
import { env } from "./env";

// Single shared client for the whole process. Creating a client per request
// exhausts database connections and is a common source of prod outages.
const adapter = new PrismaPg({
  connectionString: env.DATABASE_URL,
  max: 10,
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 300_000,
});

export const prisma = new PrismaClient({ adapter });