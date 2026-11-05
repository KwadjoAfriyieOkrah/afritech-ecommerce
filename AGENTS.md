# AGENTS.md: AFriTech standard

Read before any feature, fix, or debug task. If a task conflicts with this
file, stop and ask.

## Setup
- Frontend: Next.js + TypeScript at repo root. Config: `.env.local` (public only).
- Backend: Express + TypeScript (strict) + Prisma + PostgreSQL in `backend/`.
  Config: `backend/.env`, read only via `backend/src/lib/env.ts`. Port 4000.
- Database: container `afritech-backend-pg`, port 5433, DB `afritech_backend`.
  Never reset it without printing DATABASE_URL and confirming port 5433.

## Rules
- Money: Prisma Decimal or integer pesewas. Never JS floats. Number only at the response.
- Server computes all prices, fees, totals. Ignore client money fields.
- Ownership in the query: `where: { id, userId }`, never compare in code.
- Not found, not yours, and malformed id return the same 404 body (one constant).
- Stock is a ledger: every stock change has an InventoryLog row in the same transaction.
  Use conditional `updateMany` with `gte`. Never set stock by hand.
- Payment status changes only in `markOrderPaid`. Webhook signature (HMAC-SHA512,
  timingSafeEqual) is checked before parsing.
- Cleanup: reverse stock first, then delete. Never delete an order before its stock is restored.
- No `any`, no `as` casts. Use type guards.
- Errors: log full details server-side; send generic messages. Never send stack
  traces, Prisma errors, or provider bodies.
- Never log tokens, passwords, hashes, secrets, or full customer contact details.

## Working method
- Read the files you will change first. Stop and ask on unresolved decisions.
- Every "passed" needs the command and its output. Mark unrun checks UNVERIFIED.
- Start or stop a process only when the task says so. Print its CommandLine first.
  Never kill by name or hard-coded PID. Never start a second backend on port 4000.
- PowerShell: bodies from files (`Set-Content -Encoding ascii`, `--data-binary "@file"`).
  No inline JSON. No PowerShell inside psql. Delete temp files you created.
- Destructive actions: list rows and counts, act, verify.
- Schema: one migration per change. Never edit an applied migration.
- Scope: only the files the task lists.
- Git: no commit or push unless asked. Never commit `.env`. Check `git status --short`.

## Done means
- `tsc --noEmit` and `npm run build` exit 0 (backend); build and lint (frontend).
- Layers: routes declare only; controllers handle HTTP; services hold logic;
  zod validation in `src/validation/`; types in `src/types/`.
- Real requests with status and body: happy path, no auth (401), another user's
  resource (404), malformed input (400, field names only).
- Stock, reservation, counter, and payment code: parallel-request test with outcome counts.
- Retries with the same idempotency key produce no second effect.
- Stock and log sums checked before and after; cleanup restores the starting state.

## Production bar
- Secrets only in git-ignored `.env`. Separate dev, test, and production secrets.
  Rotate any secret seen in chat or a screenshot.
- `JWT_SECRET` at least 32 random characters; startup fails if missing or short.
- bcrypt cost 12. Identical login error for unknown email and wrong password.
- CORS origin from `FRONTEND_URL`, never `*`.
- Live Paystack keys in production only. Use `prisma migrate deploy` in production.
- Before launch, still required: httpOnly cookies, rate limiting on auth and orders,
  `npm audit` clean of high/critical, health check that pings the database,
  generic error handler, daily backups with one tested restore, HTTPS only,
  Ghana Data Protection Act (Act 843) review.

## Known gaps (not finished)
- Guest orders not linked to accounts (after email verification).
- No email or SMS notifications. No admin dashboard yet.
- Frontend checkout must show the server fee from `GET /delivery-zones`.
- Reservation sweeper runs in one instance only; move to a scheduler before scaling.

## Debugging
1. Reproduce with the smallest failing request, from a file.
2. Check the process (right server, one watcher) and the data (stock and log sums, status).
3. Read the full server log.
4. Fix the cause. Never change expected results to pass a test.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
