import { Role } from "../src/generated/prisma/client";
import bcrypt from "bcryptjs";
import { z } from "zod";

import { env } from "../src/lib/env";
import { prisma } from "../src/lib/prisma";
import {
  AdminScriptError,
  confirmDatabaseTarget,
  promptLine,
  promptNewPassword,
  readDatabaseTarget,
  redactDatabaseUrl,
} from "./admin-cli";

const BCRYPT_COST = 12;
const ADMIN_PROVISION_LOCK_ID = 7162026;

const adminNameSchema = z
  .string()
  .trim()
  .min(2, "Admin name must be at least 2 characters")
  .max(100, "Admin name must be at most 100 characters");

const adminEmailSchema = z
  .string()
  .trim()
  .email("Enter a valid admin email address")
  .max(254, "Admin email must be at most 254 characters")
  .transform((email) => email.toLowerCase());

async function main(): Promise<void> {
  const target = readDatabaseTarget(env.DATABASE_URL);
  await confirmDatabaseTarget("CREATE FIRST ADMIN ON", target);

  const nameResult = adminNameSchema.safeParse(
    await promptLine("Admin display name: "),
  );
  if (!nameResult.success) {
    throw new AdminScriptError(nameResult.error.issues[0]?.message ?? "Invalid name");
  }

  const emailResult = adminEmailSchema.safeParse(
    await promptLine("Admin email: "),
  );
  if (!emailResult.success) {
    throw new AdminScriptError(emailResult.error.issues[0]?.message ?? "Invalid email");
  }

  const password = await promptNewPassword();
  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);

  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw<unknown[]>`SELECT pg_advisory_xact_lock(${ADMIN_PROVISION_LOCK_ID})`;

    const existingAdmin = await tx.user.findFirst({
      where: { role: Role.ADMIN },
      select: { id: true },
    });
    if (existingAdmin) {
      throw new AdminScriptError(
        "An admin already exists; provisioning is limited to the first admin",
      );
    }

    const existingAccount = await tx.user.findUnique({
      where: { email: emailResult.data },
      select: { id: true },
    });
    if (existingAccount) {
      throw new AdminScriptError(
        "An account already uses this email; no changes were made",
      );
    }

    await tx.user.create({
      data: {
        name: nameResult.data,
        email: emailResult.data,
        passwordHash,
        role: Role.ADMIN,
      },
      select: { id: true },
    });
  });

  console.log("The first admin account was created.");
}

main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(redactDatabaseUrl(message));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
