This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

### Same-origin API and authentication cookies

For Vercel + Railway deployments, set `NEXT_PUBLIC_API_URL=/api` in the frontend and set the server-only `BACKEND_API_URL` to the Railway backend origin. The Next.js rewrite proxies `/api/*` to that backend so browser requests and the login cookie remain on the Vercel origin. Set backend `FRONTEND_URL` to the exact Vercel origin; do not use `*`.

Login and registration set an HttpOnly, SameSite=Lax cookie. Production uses a Secure, host-only `__Host-` cookie; the JWT is not returned in the JSON response or stored in browser localStorage. Local mock mode remains browser-local.

Login and registration are limited to five attempts per IP (15 minutes and one hour, respectively). Public order tracking is limited to 10 attempts per 15 minutes; order creation and payment initialization are also limited to 10 attempts per 15 minutes. Limits use Redis, shared across backend instances. The backend waits for Redis before listening and does not fall back to per-process limits if Redis is unavailable. Behind a proxy, set `TRUST_PROXY_HOPS` only after verifying the exact forwarded-header chain, or client IPs may be grouped incorrectly.

For local Redis, run `docker compose up -d redis` from the repository root. The service binds only to localhost, persists Redis data in the `redis_data` volume, and exposes a healthcheck. The backend defaults to `redis://127.0.0.1:6379`; override `REDIS_URL` for other environments. Run `npm run test:redis` from `backend/` to verify that separate limiter instances share counters through Redis.
