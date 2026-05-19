# Shopify Management System

Central management for multiple Shopify stores. Spec #1: foundation + read-only settings viewer.

## Stack

Next.js (App Router) · TypeScript · Drizzle ORM + Postgres · Better-Auth · `@shopify/shopify-api` · Vitest + Playwright · Railway.

## Local setup

1. `cp .env.example .env` and fill in values. Generate keys with `openssl rand -hex 32`.
2. Start a local Postgres (or use a Railway dev database) and set `DATABASE_URL`.
3. `npm install && npm run db:migrate && npm run dev`

## Deploy (Railway)

- One service for the Next.js app + an attached Postgres plugin.
- Set every variable from `.env.example` in the Railway service. `DATABASE_URL` is provided automatically by the Postgres plugin.
- `SHOPIFY_APP_URL` and `BETTER_AUTH_URL` must be the Railway public URL.
- The deploy `startCommand` runs migrations then starts the server (see `railway.json`).

## Shopify Dev Dashboard app

- Create one app, unlisted. Set the OAuth redirect URL to `<APP_URL>/api/auth/shopify/callback`.
- Scopes: `read_shipping,read_checkout_branding,read_products`.
- Install the app into each store via the in-app "Connect a store" flow.

## Testing

- `npm run test` — unit + integration tests (Vitest).
- `npm run test -- --coverage` — coverage; the 80% gate applies to the pure-logic core (crypto, registry, rbac, connector). DB-bound modules, route handlers, and UI are integration/E2E surface.
- `npm run test:e2e` — Playwright E2E. Requires a running app with a provisioned `DATABASE_URL`.

## GitHub branch protection (set once, manually)

On `main`: require a PR, 1 approval, and the `verify` CI check. Replace `@REPLACE_WITH_GITHUB_OWNER` in `.github/CODEOWNERS` with the repo owner's handle after the repo is pushed.

## Roadmap

This is sub-project #1 of 6. See `docs/superpowers/specs/` for the full design and the roadmap (settings write, theme control, feature-module framework, debug/monitoring, customer service).
