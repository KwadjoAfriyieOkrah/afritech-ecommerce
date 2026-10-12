import { Prisma, Role } from "@prisma/client";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

import { env } from "../lib/env";
import { prisma } from "../lib/prisma";

const BCRYPT_COST = 12;
const TOKEN_TTL = "7d";

const DUMMY_PASSWORD_HASH =
  "$2b$12$SBM2WKfUUE1tKFXf.vE9Y.1md5KAPBaPb3BLHlmTeTcvOrMH9EasC";

export const EMAIL_ALREADY_REGISTERED = "Email already registered";
export const INVALID_CREDENTIALS = "Invalid email or password";

export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
    Object.setPrototypeOf(this, ConflictError.prototype);
  }
}

export class InvalidCredentialsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidCredentialsError";
    Object.setPrototypeOf(this, InvalidCredentialsError.prototype);
  }
}

export interface PublicUser {
  id: string;
  email: string;
  phone: string;
  name: string;
}

export interface AuthResult {
  token: string;
  user: PublicUser;
}

export interface RegisterInput {
  name: string;
  email: string;
  phone: string;
  password: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

interface UserRecord {
  id: string;
  email: string;
  phone: string | null;
  name: string;
}

interface AuthTokenPayload {
  sub: string;
  role: Role;
}

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function publicUser(user: UserRecord): PublicUser {
  return {
    id: user.id,
    email: user.email,
    phone: user.phone ?? "",
    name: user.name,
  };
}

function signToken(userId: string, role: Role): string {
  return jwt.sign({ sub: userId, role }, env.JWT_SECRET, {
    expiresIn: TOKEN_TTL,
  });
}

function isRole(value: unknown): value is Role {
  return (
    value === Role.CUSTOMER || value === Role.ADMIN || value === Role.DELIVERY
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readTokenPayload(decoded: unknown): AuthTokenPayload | null {
  if (!isRecord(decoded)) return null;

  const { sub, role } = decoded;
  if (typeof sub !== "string") return null;
  if (!isRole(role)) return null;

  return { sub, role };
}

export function verifyToken(token: string): AuthTokenPayload | null {
  try {
    return readTokenPayload(jwt.verify(token, env.JWT_SECRET));
  } catch {
    return null;
  }
}

export async function register(input: RegisterInput): Promise<AuthResult> {
  const email = normaliseEmail(input.email);

  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });

  if (existing) throw new ConflictError(EMAIL_ALREADY_REGISTERED);

  const passwordHash = await bcrypt.hash(input.password, BCRYPT_COST);

  try {
    const user = await prisma.user.create({
      data: {
        name: input.name.trim(),
        email,
        phone: input.phone.trim(),
        passwordHash,
        role: Role.CUSTOMER,
      },
    });

    return { token: signToken(user.id, user.role), user: publicUser(user) };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new ConflictError(EMAIL_ALREADY_REGISTERED);
    }
    throw error;
  }
}

export async function login(input: LoginInput): Promise<AuthResult> {
  const email = normaliseEmail(input.email);
  const user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    await bcrypt.compare(input.password, DUMMY_PASSWORD_HASH);
    throw new InvalidCredentialsError(INVALID_CREDENTIALS);
  }

  const passwordMatches = await bcrypt.compare(input.password, user.passwordHash);
  if (!passwordMatches) throw new InvalidCredentialsError(INVALID_CREDENTIALS);

  return { token: signToken(user.id, user.role), user: publicUser(user) };
}

export async function getCurrentUser(userId: string): Promise<PublicUser | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, phone: true, name: true },
  });

  return user ? publicUser(user) : null;
}
