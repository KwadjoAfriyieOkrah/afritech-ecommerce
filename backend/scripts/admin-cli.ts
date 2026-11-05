import { createInterface } from "node:readline/promises";

export class AdminScriptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdminScriptError";
    Object.setPrototypeOf(this, AdminScriptError.prototype);
  }
}

export interface DatabaseTarget {
  name: string;
  confirmation: string;
}

export function readDatabaseTarget(databaseUrl: string): DatabaseTarget {
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new AdminScriptError("DATABASE_URL is not a valid URL");
  }

  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new AdminScriptError("DATABASE_URL must use PostgreSQL");
  }

  let databaseName: string;
  try {
    databaseName = decodeURIComponent(url.pathname.replace(/^\//, ""));
  } catch {
    throw new AdminScriptError("DATABASE_URL has an invalid database name");
  }

  if (!url.hostname || !databaseName) {
    throw new AdminScriptError(
      "DATABASE_URL must include a database host and name",
    );
  }

  const host = `${url.hostname}:${url.port || "5432"}`;
  return {
    name: databaseName,
    confirmation: `${host}/${databaseName}`,
  };
}

export async function promptLine(question: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stderr.isTTY) {
    throw new AdminScriptError("An interactive terminal is required");
  }

  const terminal = createInterface({
    input: process.stdin,
    output: process.stderr,
  });
  try {
    return await terminal.question(question);
  } finally {
    terminal.close();
  }
}

export function promptHidden(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    if (!stdin.isTTY || !process.stderr.isTTY) {
      reject(new AdminScriptError("An interactive terminal is required"));
      return;
    }

    const wasRaw = stdin.isRaw;
    let value = "";
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
          reject(new AdminScriptError("Cancelled"));
          return;
        }
        if (char === "\r" || char === "\n") {
          cleanup();
          resolve(value);
          return;
        }
        if (char === "\u007f" || char === "\b") {
          if (value.length > 0) value = value.slice(0, -1);
          continue;
        }
        if (char >= " ") value += char;
      }
    }

    process.stderr.write(question);
    stdin.setEncoding("utf8");
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", onData);
  });
}

export async function confirmDatabaseTarget(
  action: string,
  target: DatabaseTarget,
): Promise<void> {
  console.log(`Target database: ${target.confirmation}`);
  const confirmation = await promptLine(
    `Type "${action} ${target.confirmation}" to continue: `,
  );
  if (confirmation !== `${action} ${target.confirmation}`) {
    throw new AdminScriptError("Database confirmation did not match; no changes made");
  }
}

export async function promptNewPassword(): Promise<string> {
  const password = await promptHidden("New admin password: ");
  const confirmation = await promptHidden("Confirm new admin password: ");

  if (password !== confirmation) {
    throw new AdminScriptError("Passwords do not match");
  }
  if (password.trim().length < 14) {
    throw new AdminScriptError(
      "Admin password must be at least 14 characters",
    );
  }
  if (Buffer.byteLength(password, "utf8") > 72) {
    throw new AdminScriptError(
      "Admin password must be at most 72 UTF-8 bytes",
    );
  }

  return password;
}

export function redactDatabaseUrl(message: string): string {
  return message.replace(/postgres(?:ql)?:\/\/\S+/gi, "[redacted]");
}
