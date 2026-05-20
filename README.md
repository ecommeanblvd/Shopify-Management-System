# Shopify Management System

[![CI](https://github.com/ecommeanblvd/Shopify-Management-System/actions/workflows/ci.yml/badge.svg)](https://github.com/ecommeanblvd/Shopify-Management-System/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

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

## Branch protection

`main` is protected by the `protect-main` ruleset: pull request required, 1 approval, the `verify` CI check must pass, linear history, no force pushes, no direct deletions. `.github/CODEOWNERS` routes review of `lib/shopify/`, `lib/crypto/`, `lib/auth/`, and `db/schema.ts` to `@ecommeanblvd`.

## Contributing

Open an issue first for non-trivial changes. PRs should be focused, include tests, and pass the CI gate. Features live in `features/<key>/` folders; they may not touch `lib/` or another feature's folder. The `lib/shopify` connector is read-only by design in spec #1 — do not introduce write paths until spec #2.

## Roadmap

This is sub-project #1 of 6. See `docs/superpowers/specs/` for the full design and the roadmap (settings write, theme control, feature-module framework, debug/monitoring, customer service).
