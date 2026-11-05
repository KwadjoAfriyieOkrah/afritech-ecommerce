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

const adminEmailSchema = z
  .string()
  .trim()
  .email("Enter a valid admin email address")
  .max(254, "Admin email must be at most 254 characters")
  .transform((email) => email.toLowerCase());

async function main(): Promise<void> {
  const target = readDatabaseTarget(env.DATABASE_URL);
  await confirmDatabaseTarget("RESET ADMIN PASSWORD ON", target);

  const configuredEmail = process.env.ADMIN_EMAIL;
  if (!configuredEmail) {
    throw new AdminScriptError("ADMIN_EMAIL is required");
  }

  const emailResult = adminEmailSchema.safeParse(configuredEmail);
  if (!emailResult.success) {
    throw new AdminScriptError(
      emailResult.error.issues[0]?.message ?? "Invalid admin email",
    );
  }

  const emailConfirmation = (
    await promptLine("Type the admin email to confirm the account: ")
  )
    .trim()
    .toLowerCase();
  if (emailConfirmation !== emailResult.data) {
    throw new AdminScriptError("Admin email did not match; no changes made");
  }

  const password = await promptNewPassword();
  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);

  const result = await prisma.user.updateMany({
    where: { email: emailResult.data, role: Role.ADMIN },
    data: { passwordHash },
  });
  if (result.count !== 1) {
    throw new AdminScriptError(
      "Exactly one matching admin account is required; no account was changed",
    );
  }

  console.log("Admin password updated.");
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
