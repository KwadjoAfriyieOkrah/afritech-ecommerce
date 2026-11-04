import type { Request, Response } from "express";
import type { ZodError } from "zod";

import { UNAUTHORIZED_MESSAGE } from "../middleware/requireAuth";
import {
  ConflictError,
  EMAIL_ALREADY_REGISTERED,
  INVALID_CREDENTIALS,
  InvalidCredentialsError,
  login,
  register,
} from "../services/auth.service";
import {
  loginSchema,
  registerSchema,
  toValidationDetails,
} from "../validation/auth.schemas";
import { clearAuthCookie, setAuthCookie } from "../lib/authCookie";

function sendValidationError(error: ZodError, res: Response): void {
  res.status(400).json({
    error: "Validation failed",
    details: toValidationDetails(error),
  });
}

function sendUnexpectedError(error: unknown, res: Response): void {
  console.error("Unexpected auth error:", error);
  res.status(500).json({ error: "Something went wrong" });
}

export async function registerUser(req: Request, res: Response): Promise<void> {
  const body: unknown = req.body;
  const parsed = registerSchema.safeParse(body);

  if (!parsed.success) {
    sendValidationError(parsed.error, res);
    return;
  }

  try {
    const result = await register(parsed.data);
    setAuthCookie(res, result.token);
    res.status(201).json({ user: result.user });
  } catch (error) {
    if (error instanceof ConflictError) {
      res.status(409).json({ error: EMAIL_ALREADY_REGISTERED });
      return;
    }
    sendUnexpectedError(error, res);
  }
}

export async function loginUser(req: Request, res: Response): Promise<void> {
  const body: unknown = req.body;
  const parsed = loginSchema.safeParse(body);

  if (!parsed.success) {
    sendValidationError(parsed.error, res);
    return;
  }

  try {
    const result = await login(parsed.data);
    setAuthCookie(res, result.token);
    res.status(200).json({ user: result.user });
  } catch (error) {
    if (error instanceof InvalidCredentialsError) {
      res.status(401).json({ error: INVALID_CREDENTIALS });
      return;
    }
    sendUnexpectedError(error, res);
  }
}

export function getCurrentUserProfile(req: Request, res: Response): void {
  const user = req.authUser;
  if (!user) {
    res.status(401).json({ error: UNAUTHORIZED_MESSAGE });
    return;
  }

  res.status(200).json(user);
}

export function logoutUser(_req: Request, res: Response): void {
  clearAuthCookie(res);
  res.sendStatus(204);
}
