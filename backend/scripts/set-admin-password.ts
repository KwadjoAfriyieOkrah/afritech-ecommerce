import { Role } from "@prisma/client";
import bcrypt from "bcryptjs";

import { env } from "../src/lib/env";
import { prisma } from "../src/lib/prisma";

const BCRYPT_COST = 12;
const TEST_DATABASE = "afritech_backend_test";
const RESET_CONFIRM_VALUE = "afritech_backend";

class ScriptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScriptError";
    Object.setPrototypeOf(this, ScriptError.prototype);
  }
}

function readDatabaseName(databaseUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new ScriptError("DATABASE_URL is not a valid URL");
  }

  let name: string;
  try {
    name = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  } catch {
    throw new ScriptError("DATABASE_URL does not include a valid database name");
  }

  if (!name) {
    throw new ScriptError("DATABASE_URL does not include a database name");
  }

  return name;
}

function redact(message: string): string {
  return message.replace(/postgres(?:ql)?:\/\/\S+/gi, "[redacted]");
}

function promptHidden(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) {
      reject(new ScriptError("A TTY is required for the hidden password prompt"));
      return;
    }

    const wasRaw = stdin.isRaw;
    let password = "";
    let finished = false;

    function cleanup(): void {
      if (finished) return;
      finished = true;
      stdin.removeListener("data", onData);
      stdin.setRawMode(wasRaw === true);
      stdin.pause();
      process.stderr.write("\n");
    }

    function onData(chunk: string): void {
      for (const char of chunk) {
        if (char === "\u0003" || char === "\u0004") {
          cleanup();
          reject(new ScriptError("Cancelled"));
          return;
        }
        if (char === "\r" || char === "\n") {
          cleanup();
          resolve(password);
          return;
        }
        if (char === "\u007f" || char === "\b") {
          if (password.length > 0) password = password.slice(0, -1);
          continue;
        }
        if (char >= " ") password += char;
      }
    }

    process.stderr.write(prompt);
    stdin.setEncoding("utf8");
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", onData);
  });
}

async function main(): Promise<void> {
  const adminEmail = process.env.ADMIN_EMAIL?.trim();
  if (!adminEmail) throw new ScriptError("ADMIN_EMAIL is required");

  const databaseName = readDatabaseName(env.DATABASE_URL);
  const confirmed =
    process.env.ADMIN_PASSWORD_RESET_CONFIRM === RESET_CONFIRM_VALUE;

  if (databaseName !== TEST_DATABASE && !confirmed) {
    throw new ScriptError(
      `Refusing to run: DATABASE_URL must point at ${TEST_DATABASE}. Set ADMIN_PASSWORD_RESET_CONFIRM=${RESET_CONFIRM_VALUE} to override.`,
    );
  }

  console.log(`Database: ${databaseName}`);

  try {
    const password = await promptHidden("New admin password: ");
    if (password.length === 0) {
      throw new ScriptError("Password must not be empty");
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_COST);

    const result = await prisma.user.updateMany({
      where: { email: adminEmail, role: Role.ADMIN },
      data: { passwordHash },
    });

    if (result.count === 0) {
      throw new ScriptError(
        "No admin user found for ADMIN_EMAIL; nothing was changed.",
      );
    }

    console.log("Admin password updated");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error(redact(message));
  process.exitCode = 1;
});
