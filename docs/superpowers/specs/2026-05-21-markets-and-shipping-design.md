# Markets & Per-Market Shipping — Design Spec

**Date:** 2026-05-21
**Status:** Approved for implementation planning
**Depends on:** Spec #2 (settings-sync), Spec #1 (foundation)
**Module:** `features/markets/` (new, independent from `features/settings-sync/`)

---

## 1. Overview & Scope

Quản lý đa thị trường (Shopify Markets) cho từng store, với per-market shipping. Tạo `features/markets/` mới, độc lập với spec #2.

### In scope

- CRUD markets (tạo, sửa, xóa, bật/tắt) + gán countries
- Currencies per market (primary + alternatives)
- Languages per market (primary + alternatives) — chỉ assign language, không dịch content
- Price adjustments per market (markup/discount %)
- Per-market shipping (mỗi market có delivery profile riêng với zones + flat rates)
- Template + override pattern (hybrid):
  - Template owns: market definitions, countries, currencies, languages
  - Per-store override owns: price adjustment %, shipping rates

### Out of scope (future specs)

- Per-market product catalog
- Per-market domain/subfolder routing (`/eu`, `/asia`)
- Per-market checkout extensions
- B2B markets
- Content translation
- Currency exchange rate management (Shopify auto)
- Cross-border duty/tax (DDP/DDU)

### Seed template

11 default markets:

1. Middle East
2. United States
3. Greater China (HK + CN + Macau)
4. South East Asia (ASEAN)
5. Japan
6. Korea
7. Oceania (AU + NZ)
8. Canada
9. Europe (single market, multi-language)
10. Vietnam (Domestic)
11. International (catch-all)

### Relationship to Spec #2

- Spec #2's `domain/shipping.ts` continues managing default delivery profile (Shopify "General shipping rates").
- Markets feature creates **new** delivery profiles tagged `${marketName} – ${storeIdPrefix}`.
- Reconciliation filters by tag to avoid mixing with default profile.

---

## 2. Domain Model

```typescript
interface Market {
  handle: string;                    // unique key, e.g. "us", "europe", "vietnam-domestic"
  name: string;                      // display "United States"
  type: 'regional' | 'international'; // international = catch-all
  countries: string[];               // ISO-2 codes; empty for international
  primaryCurrency: string;           // ISO-4217 "USD"
  alternativeCurrencies: string[];   // ["EUR"] — optional multi-currency display
  primaryLanguage: string;           // ISO locale "en"
  alternativeLanguages: string[];    // ["fr","de","it"]
  enabled: boolean;
}

interface MarketPriceAdjustment {
  marketHandle: string;
  type: 'percentage';
  value: number;                     // +10 = +10%, -5 = -5%; bounds [-50, +200]
}

interface MarketShipping {
  marketHandle: string;
  zones: Record<string, ShippingZone>; // reuses Spec #2's ShippingZone shape
}

interface ShippingZone {
  countries: string[];               // subset of market.countries
  rates: Record<string, ShippingRate>;
}

interface ShippingRate {
  type: 'flat';
  price: number;
  currency: string;                  // must be in market.primaryCurrency or alternatives
}
```

Template stores: `markets[]` (definitions, countries, currencies, languages).
Per-store override stores: `priceAdjustments{}` and `shippingByMarket{}`.

### Invariants

- One country belongs to exactly one market (Shopify rejects overlap)
- At least one market with `type: 'international'` OR a Shopify primary market exists
- `handle` unique within template
- `countries[]` non-empty for regional; empty for international
- Shipping zone countries ⊆ market countries
- Rate currency ∈ {primaryCurrency, ...alternativeCurrencies}
- Price adjustment value ∈ [-50, +200]
- Exactly one `type: 'international'` market

---

## 3. Module Structure

```
features/markets/
├── manifest.ts                    # requiredScopes, hasWriteOperations, flagKey
├── actions.ts                     # server actions: applyMarkets, reconcileMarkets, dryRun
├── domain/
│   ├── markets.ts                 # Market CRUD + GraphQL queries/mutations
│   ├── currencies.ts              # Currency settings per market
│   ├── languages.ts               # Language assignment per market
│   ├── price-adjustments.ts       # Markup/discount per market
│   └── market-shipping.ts         # Delivery profile per market
├── diff.ts                        # Compute diff: effective vs live
├── merge.ts                       # Template + per-store override → effective
├── apply.ts                       # Orchestrate writes via 4-gate writer
├── reconciliation.ts              # Snapshot live state before apply
├── seed.ts                        # 11 default markets seed data
└── *.test.ts                      # Vitest unit + integration tests

app/(dashboard)/f/markets/
├── page.tsx                       # Markets list
├── [handle]/page.tsx              # Market detail/edit (template + per-store table)
├── [handle]/stores/[storeId]/page.tsx  # Per-store override editor
├── apply/page.tsx                 # Apply diff modal
├── history/page.tsx               # Apply history
└── new/page.tsx                   # Create new market

db/schema.ts additions:
- marketTemplates
- marketStoreOverrides
- marketApplyHistory
```

### Reused infrastructure

- `lib/shopify/writer.ts` — 4-gate writer (feature flag, manifest, snapshot, audit)
- `lib/shopify/client.ts` — Admin GraphQL client + token decryption
- `lib/auth/rbac.ts` — permissions
- `lib/logging/audit.ts` — audit log

### New RBAC permissions

- `manage_markets_template` → admin only
- `apply_markets` → admin
- `view_markets_history` → admin + viewer

---

## 4. Shopify API Mapping

Shopify Admin GraphQL 2025-01 (pinned in env).

### Markets CRUD

- `marketCreate(input: { name, regions: [{countryCode}], enabled })` → returns `market.id`
- `marketUpdate(id, input: { name, enabled })`
- `marketDelete(id)` — Shopify blocks primary market deletion
- `marketRegionsCreate(marketId, regions[])` — add countries
- `marketRegionDelete(id)` — remove country from market

### Currencies

- `marketCurrencySettingsUpdate(marketId, input: { baseCurrency, localCurrencies, exchangeRules })`
- Shopify auto-handles exchange rates

### Languages (Web Presence)

- `marketWebPresenceCreate` / `marketWebPresenceUpdate`:
  - `defaultLocale`, `alternateLocales[]`
- Uses **subfolder** as default (no DNS config required, domain routing is out of scope)

### Price adjustments

- `priceListCreate(input: { name, currency, parent: { adjustment: { type: PERCENTAGE_INCREASE | PERCENTAGE_DECREASE, value } }, contextRule: { marketId } })`
- `priceListUpdate(id, input)` for changing markup

### Shipping per market

- `deliveryProfileCreate(profile: { name, profileLocationGroups, ...marketsToAssociate })`
- `deliveryProfileUpdate(id, profile)`
- Profile tagged `${marketName} – ${storeIdPrefix}` for ownership identification
- Zones + rates reuse Spec #2's `domain/shipping.ts` shape

### Read (reconciliation snapshot)

```graphql
query Markets {
  markets(first: 25) {
    edges { node {
      id name handle enabled primary
      regions(first: 250) { edges { node { ... on MarketRegionCountry { code } } } }
      currencySettings { baseCurrency { currencyCode } localCurrencies }
      webPresence { defaultLocale alternateLocales { locale } }
      priceList { id parent { adjustment { type value } } }
    }}
  }
  deliveryProfiles(first: 25) {
    edges { node { id name profileLocationGroups { ... } } }
  }
}
```

### API verification task

First implementation task is a read-only probe script run against `cici-mean.myshopify.com` to confirm field names and shapes for the pinned API version. Field names like `marketsToAssociate` may need adjustment based on the live API.

---

## 5. Template + Override + Apply Flow

### Template row (global)

```typescript
{
  handle: "europe",
  name: "Europe",
  type: "regional",
  countries: ["DE","FR","IT","ES","NL","BE","AT","PT","IE","FI","SE","DK","PL","CZ","GR","HU","RO","SK","SI","LU","EE","LV","LT","BG","HR","MT","CY"],
  primaryCurrency: "EUR",
  alternativeCurrencies: [],
  primaryLanguage: "en",
  alternativeLanguages: ["de","fr","it","es"],
  enabled: true,
  version: 3,
  updatedBy: "admin@...",
  updatedAt: "2026-05-21T..."
}
```

### Per-store override row

```typescript
{
  storeId: "uuid",
  marketHandle: "europe",
  priceAdjustment: { type: "percentage", value: 12 },
  shipping: {
    zones: {
      "EU Standard": {
        countries: ["DE","FR","IT","ES","NL","BE","AT","PT","IE"],
        rates: { "Standard": { type: "flat", price: 8, currency: "EUR" } }
      },
      "EU Extended": {
        countries: ["FI","SE","DK","PL","CZ","GR","HU","RO","SK","SI","LU","EE","LV","LT","BG","HR","MT","CY"],
        rates: { "Standard": { type: "flat", price: 14, currency: "EUR" } }
      }
    }
  },
  version: 1
}
```

### Merge

```
effective[handle] = {
  ...template[handle],
  priceAdjustment: override.priceAdjustment ?? null,
  shipping: override.shipping ?? null  // missing override → no delivery profile created
}
```

### Diff

Compare effective vs live snapshot:
- Markets: missing/extra/renamed/countries-changed/currency-changed/language-changed/enabled-changed
- Price adjustment: missing/value-changed/removed
- Shipping: per zone — missing/extra/countries-changed; per rate — missing/extra/price-changed/currency-changed

### Apply (4-gate)

1. **Gate 1** — `MARKETS_WRITER_ENABLED=true` env, else reject
2. **Gate 2** — manifest `hasWriteOperations=true`, else reject
3. **Gate 3** — reconciliation snapshot live state immediately before apply; if differs from snapshot user saw in dry-run → reject with "store changed since dry-run, please re-check"
4. **Gate 4** — after apply, save post-snapshot + audit row (`marketApplyHistory`)

### Apply ordering (Shopify dependencies)

Create/update order:
1. Markets + regions
2. Currency settings (requires market)
3. Web presence + locales (requires market)
4. Price lists (requires market + currency)
5. Delivery profiles + zones (requires market)

Delete order (reverse):
6. Delivery profiles → price lists → web presence → regions → markets

### Dry-run

Compute diff + show preview; no write mutations called. User confirms then applies.

---

## 6. UI/UX Flow

### Routes

- `/f/markets` — markets list
- `/f/markets/[handle]` — market detail (edit template + view per-store overrides)
- `/f/markets/[handle]/stores/[storeId]` — per-store override editor
- `/f/markets/apply` — apply diff modal
- `/f/markets/history` — apply history
- `/f/markets/new` — create new market

### Markets list page

- Header: title "Markets" + buttons "New market" + "Apply to stores..."
- Card grid (3 cols desktop, 1 col mobile):
  - Name + handle
  - Countries count badge ("27 countries")
  - Currency badge ("EUR + 0 alt")
  - Languages badge ("EN + 4 alt")
  - Status: enabled/disabled
  - Stores applied: "3 of 5 stores"
- Empty state: "Seed default markets" button → creates 11 markets from `seed.ts`

### Market detail page

Section 1 — Template (read-only for viewer, editable for admin):
- Name, handle, type (regional/international)
- Countries multi-select (search by name, group by region)
- Primary currency dropdown + alternative currencies multi-select
- Primary language + alternative languages
- Enabled toggle

Section 2 — Stores override table:
- Each row: store name, price adjustment %, shipping zones count, "Edit" link
- Status indicator: "No override" / "Configured" / "Out of sync"

### Per-store override editor

- Price adjustment input: type (percentage), value (-50 to +200)
- Shipping section:
  - Collapsible zone cards
  - Each zone: name, countries multi-select (limited to market countries), rates table (name, price, currency)
  - Validation: zone countries ⊆ market countries; rate currency ∈ market currencies
  - "Add zone" / "Delete zone" buttons

### Apply modal

- Step 1 — Select store(s) (checkbox list, "select all")
- Step 2 — Dry-run preview (action call, shows diff cards: green = create, yellow = update, red = delete)
- Step 3 — Confirm box: "Apply <N> changes to <store> ..." — type store domain to confirm (matches Spec #2 pattern)
- Step 4 — Result: success/error per store, link to history

### History page

- Filter by store/market/action/status
- Each row: timestamp, user, store, market, changes count, status, "View snapshot" + "View diff" links

### Design tokens

Reuse Stripe-light + Vercel-dark tokens from Spec #1.7. Card style + badge colors follow existing system.

---

## 7. Edge Cases & Errors

### Country exclusivity

- Pre-apply validation: union of all `market.countries` in template has no duplicates. Block with explicit error: `Country DE assigned to both 'Europe' and 'EU Premium'`.
- Live state may have a country in a different market (manual edit on Shopify Admin). Reconciliation surfaces conflict; never auto-moves.

### Primary market protection

- Diff calculator detects "delete market X": checks live snapshot for `primary=true`. If yes → block: `Cannot delete primary market. Set another market as primary first.`
- If Shopify rejects despite check → catch error and surface clearly.

### Delivery profile name conflicts

- Shopify allows duplicate profile names. Profile tagged `${market.name} – ${storeId.slice(0,8)}` for ownership.
- Reconciliation matches by tag, not by fuzzy name.

### Currency mismatch in shipping rates

- Server-side validate: `rate.currency` ∈ {`market.primaryCurrency`, ...`market.alternativeCurrencies`}. Block save if user inputs unrelated currency.

### Country in zone not in market

- UI multi-select restricted to market countries (Section 6).
- Server-side re-validates on save.

### Partial apply failure

- Apply follows ordering (Section 5). If mid-flow failure (market created, price list failed), Shopify state is partially changed.
- **No auto-rollback** — saves partial-success snapshot with status `partial_error`. UI shows: `3/7 changes applied, 4 failed. View details.`
- User retries apply; diff re-computes from live state (idempotent).

### Idempotency

- All mutations idempotent. `marketCreate` failing on handle conflict → catch, treat as success, re-fetch ID.
- Price list lookup by `market+name` before create.

### Race condition (concurrent apply)

- Optimistic concurrency: template + override have `version` field. Apply gate-3 verifies version match. Mismatch → block with `Template was updated by another user, please reload.`

### Disabled market

- `enabled: false` in template: sync metadata to Shopify with `enabled=false`. Delivery profile is **not** deleted, only disabled.
- Re-enable: re-apply rates from override.

### International (catch-all) market

- Type `international`: Shopify auto-fills remaining countries. Template `countries[]` is empty.
- Validate: exactly one international market allowed.

### Empty override

- Store has no price adjustment + no shipping config for market X → sync market metadata (countries/currency/language/enabled), skip price list + delivery profile creation.

### Scope errors

- Connector pre-checks `write_markets`, `write_shipping`, `write_shop_settings` scopes. Missing → return: `Missing scope: write_markets. Re-install app.`

---

## 8. Testing Strategy

### Unit tests (Vitest)

- `domain/markets.test.ts`: parse GraphQL → normalized Market; build mutation input; ISO-2 validation; international market logic
- `domain/currencies.test.ts`: primary + alternatives → currencySettings input; rate currency mismatch detection
- `domain/languages.test.ts`: default + alternates → webPresence input; locale code validation
- `domain/price-adjustments.test.ts`: percentage → priceListCreate input; bounds [-50, +200]
- `domain/market-shipping.test.ts`: shipping shape; zone countries ⊆ market countries; profile name tagging
- `diff.test.ts`: template + override + live → diff; missing/extra/changed cases; idempotency (apply diff twice → empty second diff)
- `merge.test.ts`: template + override → effective; missing override → null fields
- `apply.test.ts` (mocked client): 4-gate enforcement; ordering; partial failure → `partial_error`, no rollback
- `reconciliation.test.ts`: snapshot parsing; country conflict detection; primary market detection
- `seed.test.ts`: 11 default markets validate (no country overlap, all ISO-2 valid, exactly 1 international)

### Integration tests (Vitest + mock connector)

- Full flow: seed → diff (empty live) → apply → verify mutations called in correct order
- Apply with existing live state → diff only deltas
- Concurrent apply: version conflict path

### E2E tests (Playwright)

- `markets-list.spec.ts`: load `/f/markets`, see seeded markets, create new
- `market-detail.spec.ts`: edit Europe market (add language), save, verify version bump
- `override-edit.spec.ts`: open store override, add price adjustment + 2 zones, save, verify validation
- `apply-flow.spec.ts`: select store, dry-run, see diff cards, type-confirm, apply, verify success + history row

### Manual smoke test (`cici-mean.myshopify.com`)

1. Seed 11 default markets (template only) → verify Shopify shows 11 markets
2. Add Europe price adjustment +12% for cici-mean → apply → verify price list created
3. Add Europe shipping zone "EU Standard" with €8 flat rate → apply → verify delivery profile + zone + rate
4. Disable Vietnam Domestic market → apply → verify market disabled (not deleted)
5. Re-run apply → diff empty (idempotency)

### Coverage target

≥80% per `common/testing.md`. New module gets full coverage; reused modules (writer, client) keep existing coverage.

---

## 9. Data Migration, Rollout & Done Criteria

### Data migration

New tables only; no schema changes to existing tables.

- `market_templates` (handle PK, name, type, countries jsonb, primary_currency, alternative_currencies jsonb, primary_language, alternative_languages jsonb, enabled, version, updated_by, updated_at)
- `market_store_overrides` (store_id + market_handle composite PK, price_adjustment jsonb, shipping jsonb, version, updated_by, updated_at)
- `market_apply_history` (id, store_id, market_handle nullable, user_id, action, status, diff jsonb, pre_snapshot jsonb, post_snapshot jsonb, error_detail text, created_at)

Drizzle migration: `db/migrations/00XX_markets.sql` (auto-generated via `npm run db:generate`).
Seed runs once via admin UI "Seed default markets" button — not auto-run on migrate.

### Coexistence with Spec #2

- Spec #2's default profile = Shopify "General shipping rates" (no market association)
- Markets feature profiles tagged `${marketName} – ${storeIdPrefix}`
- Reconciliation filters by tag — ignores default profile
- Document in both feature READMEs

### Rollout plan

**Phase 1 — Read-only deploy** (`MARKETS_WRITER_ENABLED=false`):
- Deploy code + migration + seed UI
- Admin seeds 11 markets into template
- Admin runs dry-run on live store
- No writes to Shopify

**Phase 2 — Single-store write canary** (flag `true` on Railway):
- Enable flag, apply markets for `cici-mean.myshopify.com`
- Manual smoke test 5 steps (Section 8)
- Verify audit history + snapshots

**Phase 3 — Per-store override rollout:**
- Admin configures price adjustment + shipping per market on cici-mean
- Apply, verify Shopify Admin reflects changes
- Measure apply time, optimize if >30s

**Phase 4 — Multi-store** (when additional stores connect):
- "Apply to all stores" flow
- Monitor partial failures

### Feature flag

- `MARKETS_WRITER_ENABLED=true` on Railway production
- Default `false` on local dev (dry-run only)

### Audit events

- `market_template_created`, `market_template_updated`, `market_template_deleted`
- `market_override_updated`
- `market_apply_started`, `market_apply_completed`, `market_apply_failed`, `market_apply_partial`

### Done criteria

- [ ] 11 default markets seeded successfully on cici-mean.myshopify.com
- [ ] Per-store override saves for price adjustment + shipping
- [ ] Dry-run shows accurate diff (verified against manual diff)
- [ ] Apply runs in correct order, idempotent (re-run = empty diff)
- [ ] Partial failure doesn't corrupt state; retry works
- [ ] Audit log + snapshot contain enough data for manual rollback
- [ ] Coverage ≥80%; all unit + integration + E2E tests pass
- [ ] Manual smoke 5 steps pass on live store
- [ ] Spec #2 still works (no regression)
