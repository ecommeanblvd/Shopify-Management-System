# Plan — Carrier Rate Calculator

> Spec: [2026-05-25-carrier-rates-design.md](../specs/2026-05-25-carrier-rates-design.md)
> Status: Draft, awaiting sign-off

## Phase 1 — Foundation (skeleton + auth)

**Goal:** All routes exist behind feature flag, RBAC wired, DB ready. No business logic.

| Task | File(s) | Tests |
|---|---|---|
| 1.1 Drizzle schema for all `carrier_*` tables + `market_carrier_links` | `db/schema.ts` | — |
| 1.2 Migration generated + reviewed | `db/migrations/00NN_*.sql` | — |
| 1.3 Seed `carriers` with `dhl`, `fedex` | `db/seed.ts` (or migration data block) | — |
| 1.4 New RBAC permissions `manage_carrier_rates`, `view_carrier_rates` + role bindings | `lib/auth/rbac.ts` | `lib/auth/rbac.test.ts` |
| 1.5 Feature flag manifest `carrier-rates` | `features/carrier-rates/manifest.ts` | — |
| 1.6 Nav item with `Truck` icon | `lib/nav.ts` | — |
| 1.7 `/f/carrier-rates` home with editorial empty state + list accounts | `app/(dashboard)/f/carrier-rates/page.tsx` | — |
| 1.8 `/f/carrier-rates/new` wizard (carrier picker, name, currencies, FX) | `app/(dashboard)/f/carrier-rates/new/page.tsx` | — |
| 1.9 `/f/carrier-rates/[id]` overview shell with sub-section tiles | `app/(dashboard)/f/carrier-rates/[id]/page.tsx` | — |
| 1.10 Server actions: `createAccount`, `updateAccount`, `deleteAccount` | `features/carrier-rates/actions.ts` | `features/carrier-rates/actions.test.ts` |

**Exit criteria**
- `npm run typecheck` clean.
- `npm test` all green (no regressions).
- Migration applied, seed inserts 2 carriers.
- Authenticated admin sees nav item; viewer sees read-only.
- Empty state + create-account wizard work end-to-end on local DB.

## Phase 2 — Rate authoring + quote engine

**Goal:** Operator can fully author a DHL contract and run quotes against it.

| Task | File(s) | Tests |
|---|---|---|
| 2.1 Zones page UI with country chip input | `app/(dashboard)/f/carrier-rates/[id]/zones/page.tsx`, `components/carrier-rates/ZoneEditor.tsx` | — |
| 2.2 Weight tiers page UI (add/remove with reorder) | `app/(dashboard)/f/carrier-rates/[id]/weight-tiers/page.tsx` | — |
| 2.3 Matrix editor — inline-edit cell, debounced upsert | `app/(dashboard)/f/carrier-rates/[id]/matrix/page.tsx`, `components/carrier-rates/RateMatrix.tsx` | — |
| 2.4 CSV import for matrix (parse + preview diff + commit) | `features/carrier-rates/import/matrix-csv.ts`, page section in matrix UI | `features/carrier-rates/import/matrix-csv.test.ts` |
| 2.5 Surcharges page (list + per-kind edit form) | `app/(dashboard)/f/carrier-rates/[id]/surcharges/page.tsx` | — |
| 2.6 Remote postcodes page + CSV upload | `app/(dashboard)/f/carrier-rates/[id]/remote-postcodes/page.tsx`, `features/carrier-rates/import/remote-postcodes-csv.ts` | `features/carrier-rates/import/remote-postcodes-csv.test.ts` |
| 2.7 Quote engine — pure module | `features/carrier-rates/engine/quote.ts` | `features/carrier-rates/engine/quote.test.ts` — table-driven cases: simple base, +fuel, +peak, +remote, +residential, +markup, tier-capped, missing-zone, missing-cell |
| 2.8 Account snapshot loader (DB → engine input) | `features/carrier-rates/engine/load.ts` | `features/carrier-rates/engine/load.test.ts` |
| 2.9 Calculator page — form + breakdown card | `app/(dashboard)/f/carrier-rates/[id]/calculator/page.tsx`, `components/carrier-rates/QuoteBreakdown.tsx` | — |
| 2.10 Log quote on calculator submit | `features/carrier-rates/actions.ts` (extend) | covered by actions.test.ts |

**Exit criteria**
- Unit-test coverage for quote engine ≥ 95% (it's a pure module with a clear contract).
- Calculator returns the same breakdown as the spec's worked example (see §14 below).
- CSV imports are idempotent (running the same CSV twice doesn't duplicate).

## Phase 3 — Push to Markets

**Goal:** "Recalculate & Push" produces a per-store override diff that the existing Markets apply flow can push to Shopify.

| Task | File(s) | Tests |
|---|---|---|
| 3.1 `market_carrier_links` editor — section on existing market detail page | `app/(dashboard)/f/markets/[handle]/page.tsx` (extend), `components/markets/CarrierLinks.tsx` | — |
| 3.2 Recalc engine — for one market+store, produce shipping override object | `features/carrier-rates/push/recalc.ts` | `features/carrier-rates/push/recalc.test.ts` |
| 3.3 Push preview page — list of (market, store, rate name, old, new) | `app/(dashboard)/f/carrier-rates/[id]/push/page.tsx` | — |
| 3.4 Commit action — write to `market_store_overrides.shipping` | `features/carrier-rates/actions.ts` (extend) | covered |
| 3.5 Audit log entry on commit | `lib/logging/audit.ts` (call site) | — |
| 3.6 FX staleness warning banner on account overview | `app/(dashboard)/f/carrier-rates/[id]/page.tsx` | — |

**Exit criteria**
- Push preview shows expected rate names + prices for a representative cici-mean × Middle East scenario.
- Commit writes overrides; subsequent Markets apply on cici-mean dry-runs with the new shipping rates.
- No direct Shopify API calls from this module — verified by grep.

## §14 Worked example (used as engine test fixture)

DHL Express Vietnam 2026, USD display, VND cost, FX 26 000 VND / 1 USD.

- Zone 1 — countries: SG, MY, TH, ID, PH, KH, LA, MM, BN
- Weight tier 1.0 kg, Zone 1 base = 280 000 VND
- Surcharges active: fuel 30 %, peak 0, markup 12 %, remote-fixed 150 000 VND
- Destination: TH (in Zone 1), postcode 99999 (not in remote list)

Compute:
- base = 280 000
- fuel = 280 000 × 0.30 = 84 000
- peak = 0
- remote = 0
- residential = 0
- subtotal = 364 000
- markup = 364 000 × 0.12 = 43 680
- final_cost = 407 680 VND
- final_display = 407 680 / 26 000 = 15.6800 → rounded **15.68 USD**

Same quote but destination postcode IS in the remote list:
- remote = 150 000
- subtotal = 514 000
- markup = 61 680
- final_cost = 575 680 VND
- final_display = **22.14 USD**

## Risks for the plan

- **Migration churn**: Phase 1 ships an empty schema. If Phase 2 reveals a shape we want to change, we need a follow-up migration. Mitigation: spec out schema thoroughly in Phase 1 (done above) and resist the urge to evolve mid-phase.
- **Markets coupling timing**: Phase 3 writes into `market_store_overrides.shipping`. If a Markets refactor lands between Phases 2 and 3, this will conflict. Mitigation: hold the Phase 3 PR until Phase 2 is merged and rebase on whatever Markets state exists then.
- **Quote engine perf**: A push run for 30 markets × 5 stores × 12 weight tiers = 1 800 quotes. Each is in-memory lookup, no I/O — should be < 50 ms. Worth a benchmark in Phase 2.
