import { PrismaClient } from "@prisma/client";

// Single shared client for the whole process. Creating a client per request
// exhausts database connections and is a common source of prod outages.
export const prisma = new PrismaClient();