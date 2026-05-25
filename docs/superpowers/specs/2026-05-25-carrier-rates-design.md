# Spec — Carrier Rate Calculator (DHL + FedEx)

> Author: ECC · Date: 2026-05-25 · Status: Draft, awaiting sign-off

## 1. Problem

We negotiate freight contracts with DHL Express and FedEx (and likely more carriers later). Each contract has:

- A **zone scheme** — every country maps to one zone (DHL Zone 1–9, FedEx A–T).
- A **weight × zone rate matrix** in our cost currency (VND).
- **Surcharges** that change over time — fuel %, peak season fixed fee, remote-area fixed fee, residential fixed fee.
- A **markup %** the operator wants to add for the customer-facing price.

Today every store's shipping rates in Shopify are typed by hand. The math (cost lookup → surcharge stack → markup → FX) sits in spreadsheets and is rerun whenever fuel or contracts change. The carrier-rates module replaces that spreadsheet, owns the rate sheet as data, and pushes the computed customer-facing rates into Shopify via the existing Markets feature.

## 2. Goals

1. Operators author DHL and FedEx rate sheets once; the module computes every customer-facing rate.
2. Quote calculator: `quote(carrier_account, weight_kg, destination_country, destination_postcode) → { breakdown, final_vnd, final_usd }`.
3. **Recalculate & Push**: regenerate the per-(market × store × weight tier) shipping rate set and feed it into the Markets per-store override. From there the existing Markets apply flow pushes to Shopify.
4. Multi-account per carrier so different contracts (e.g. DHL Vietnam vs DHL Singapore) live side by side.
5. Audit log of every quote computed and every push run.

## 3. Non-goals

- Negotiating live rates from DHL/FedEx APIs. Rates are authored manually or imported from a CSV.
- Customs duties, taxes, insurance. Out of scope — those plug into a separate landed-cost feature later.
- Shopify carrier-calculated shipping (CCS API). We produce **flat rates per weight tier** that Shopify renders to the buyer.

## 4. Data model

All new tables prefixed `carrier_*`. Schema lives in `db/schema.ts`.

```ts
// One row per supported carrier brand (seed: dhl, fedex)
carriers (
  id uuid pk,
  key text unique,         // 'dhl' | 'fedex' | 'ups' | ...
  name text,               // 'DHL Express' | 'FedEx'
  created_at timestamp,
)

// A specific contract. Operator may have multiple per carrier.
carrier_accounts (
  id uuid pk,
  carrier_id fk → carriers,
  name text,                          // 'DHL Express Vietnam 2026'
  weight_unit enum('kg','lb'),        // default 'kg'
  cost_currency text,                 // ISO-4217, e.g. 'VND'
  display_currency text,              // 'USD'
  fx_cost_per_display numeric(14, 4), // 26000 means 1 USD = 26 000 VND
  enabled boolean default true,
  notes text,
  created_at, updated_at,
)

// Zone label per account (Zone 1, Zone A, …). Position drives display order.
carrier_zones (
  id uuid pk,
  carrier_account_id fk,
  label text,                         // 'Zone 1' | 'A'
  position int,
  unique (carrier_account_id, label)
)

// Country → zone mapping. One country lives in exactly one zone per account.
carrier_zone_countries (
  id uuid pk,
  carrier_account_id fk,              // denormalized for fast country→zone lookup
  carrier_zone_id fk,
  country_code text,                  // ISO-2
  unique (carrier_account_id, country_code)
)

// Weight tier breakpoints per account. Tier price covers weight (prev.upper, upper].
// Final tier (highest) is treated as upper = ∞.
carrier_weight_tiers (
  id uuid pk,
  carrier_account_id fk,
  upper_kg numeric(8, 3),             // 0.5, 1.0, 1.5, … 100
  position int,
  unique (carrier_account_id, upper_kg)
)

// Matrix cell: (zone × tier) → cost in account.cost_currency
carrier_rate_cells (
  id uuid pk,
  carrier_zone_id fk,
  carrier_weight_tier_id fk,
  cost_amount numeric(14, 2),         // VND, no decimals expected but type allows
  updated_by text,
  updated_at,
  unique (carrier_zone_id, carrier_weight_tier_id)
)

// Surcharge config — multiple rows per account, each a kind.
carrier_surcharges (
  id uuid pk,
  carrier_account_id fk,
  kind enum(
    'fuel_percent',      // value = %
    'peak_fixed',        // value = cost_currency amount
    'remote_fixed',      // value = cost_currency amount (triggered by postcode match)
    'residential_fixed', // value = cost_currency amount (triggered by Shopify flag)
    'markup_percent'     // value = % applied to subtotal
  ),
  value numeric(14, 4),
  active boolean default true,
  starts_at timestamp null,           // optional schedule window
  ends_at timestamp null,
  note text,
  created_at, updated_at,
)

// Remote postal codes uploaded from DHL/FedEx zone-modifier docs.
carrier_remote_postcodes (
  id uuid pk,
  carrier_account_id fk,
  country_code text,                  // ISO-2
  postcode_pattern text,              // literal exact-match for v1; wildcards in a follow-up
  source text,                        // 'dhl_2026q1' or filename of CSV upload
  uploaded_at,
  uploaded_by text,
  unique (carrier_account_id, country_code, postcode_pattern)
)

// Which carrier_account serves which market (and what label appears in Shopify).
market_carrier_links (
  id uuid pk,
  market_handle fk → market_templates.handle,
  carrier_account_id fk,
  service_label text,                 // 'DHL Express' — shown in Shopify checkout
  position int,                       // ordering when multiple services on one market
  enabled boolean default true,
  unique (market_handle, carrier_account_id)
)

// Audit log of every quote produced (calculator + push runs).
carrier_quote_logs (
  id uuid pk,
  carrier_account_id fk,
  destination_country text,
  destination_postcode text null,
  weight_kg numeric(8, 3),
  breakdown jsonb,                    // { base, fuel, peak, remote, residential, markup, subtotal, final_cost, final_display }
  context text,                       // 'calculator' | 'push_recalc'
  computed_at timestamp default now(),
)
```

### Index strategy

- `carrier_zone_countries (carrier_account_id, country_code)` — primary lookup path.
- `carrier_rate_cells (carrier_zone_id, carrier_weight_tier_id)` — already unique.
- `carrier_remote_postcodes (carrier_account_id, country_code, postcode_pattern)` — match on incoming order.
- `carrier_quote_logs (carrier_account_id, computed_at desc)` — recent quotes view.

## 5. Quote engine

Pure module — `features/carrier-rates/engine/quote.ts`. No DB calls; takes a denormalized account snapshot. Easy to unit test.

```ts
interface CarrierAccountSnapshot {
  id: string;
  costCurrency: string;
  displayCurrency: string;
  fxCostPerDisplay: number;          // e.g. 26000
  zonesByCountry: Map<string, ZoneSnap>;
  weightTiers: WeightTier[];          // sorted ascending by upper_kg
  surcharges: Surcharge[];            // only active ones at quote time
  remotePostcodes: Map<string, Set<string>>; // country → set of patterns
}

interface QuoteInput {
  weightKg: number;
  destinationCountry: string;
  destinationPostcode?: string;
  isResidential?: boolean;            // from Shopify line attribute when available
}

interface QuoteResult {
  zone: string;
  tier: { upperKg: number; index: number };
  breakdown: {
    base: number;            // cost currency
    fuel: number;
    peak: number;
    remote: number;
    residential: number;
    markup: number;
    subtotalBeforeMarkup: number;
    finalCost: number;       // cost currency
    finalDisplay: number;    // display currency
  };
  notes: string[];           // 'no remote', 'tier-capped to 100kg', …
}
```

### Algorithm

1. **Country → zone**. If country not in `zonesByCountry`, return `{ error: 'no_zone' }`.
2. **Weight → tier**. Find first tier where `weightKg ≤ upperKg`. If none, use the last tier and emit note `weight_exceeds_top_tier` (no extrapolation in v1 — operator must add a higher tier).
3. **Base** = matrix cell at `(zone, tier)`. If missing, return `{ error: 'rate_cell_missing' }`.
4. **Fuel** = `base * fuel_percent / 100`.
5. **Peak** = sum of all active `peak_fixed` surcharges.
6. **Remote** = if `(country, postcode)` matches `remotePostcodes` → `remote_fixed.value`, else 0.
7. **Residential** = if `input.isResidential` → `residential_fixed.value`, else 0.
8. `subtotalBeforeMarkup = base + fuel + peak + remote + residential`.
9. **Markup** = `subtotalBeforeMarkup * markup_percent / 100`.
10. `finalCost = subtotalBeforeMarkup + markup`.
11. `finalDisplay = finalCost / fxCostPerDisplay`.

Rounding policy:
- Cost currency: round to whole number (VND has no fractional unit).
- Display currency: round to 2 decimals.

## 6. CSV import

Two CSVs supported in v1:

### `rate_matrix.csv`

```
,Zone 1,Zone 2,Zone 3,...
0.5,180000,210000,260000,...
1.0,260000,310000,380000,...
...
```

Parser walks header row to discover zone labels, walks first column to discover weight tiers. Upserts zones, tiers, and cells. Missing cells = empty cell in CSV.

### `remote_postcodes.csv`

```
country,postcode
VN,710000
VN,711000
TH,10100
...
```

Idempotent upsert against `(carrier_account_id, country_code, postcode_pattern)`.

Parsers live in `features/carrier-rates/import/`. Each returns a list of operations + a list of validation warnings before committing.

## 7. UI surfaces

```
/f/carrier-rates                     # list accounts grouped by carrier
/f/carrier-rates/new                 # create account wizard (carrier, name, currencies, FX)
/f/carrier-rates/{accountId}         # account overview (stats + 5 sub-sections)
/f/carrier-rates/{accountId}/zones
/f/carrier-rates/{accountId}/matrix  # rate matrix editor + CSV import
/f/carrier-rates/{accountId}/surcharges
/f/carrier-rates/{accountId}/remote-postcodes
/f/carrier-rates/{accountId}/calculator      # try a quote, see breakdown
/f/carrier-rates/{accountId}/push    # recalc preview + confirm push to Markets
```

Editorial layout reuses the patterns from PRs #17–25. Matrix editor is a sticky-header table with one row per weight tier and one column per zone; cells are inline-edit; CSV import sits next to the table as a side dropzone.

## 8. Markets integration ("Recalculate & Push")

For each `market_carrier_link` row:

1. Look up the market's countries.
2. For each linked store, for each weight tier:
   - Pick the lowest-priced zone among the market's countries (or the operator-chosen "representative country" — config knob to add later).
   - Run `quote()` for `(weightTier.upperKg, representativeCountry)` with `isResidential = false`, no postcode.
   - Build a Shopify rate method:
     ```ts
     { name: `${service_label} (${prevUpper}–${upperKg} kg)`,
       price: { amount: finalDisplay, currencyCode: market.primaryCurrency },
       weightConditions: [{ minWeight: prevUpper, maxWeight: upperKg }] }
     ```
3. Stage the result into `market_store_overrides.shipping.zones[market.handle].rates` for the linked store. This is the existing per-store override shape that `Markets apply` already pushes.
4. Show a preview screen: per market × store, list of rates that *would* change, including current vs new prices. Operator confirms → save the overrides → redirect to Markets apply.

The push action does **not** call Shopify directly. It only writes to per-store overrides; the Markets apply flow remains the single point that talks to Shopify. This keeps the Shopify call surface centralized.

## 9. Permissions

Two new RBAC permissions:

- `manage_carrier_rates` — admin + operator. Edit accounts/zones/matrix/surcharges/postcodes, run recalc & push preview.
- `view_carrier_rates` — admin + operator + viewer. Read-only access.

Existing `apply_markets` is still required to actually push the Markets run that ships rates to Shopify.

## 10. Audit + observability

- Every quote that backs a push is logged to `carrier_quote_logs` with `context = 'push_recalc'`.
- Calculator-tab quotes are logged with `context = 'calculator'` (sampled, not every keystroke — only on Calculate button click).
- Existing `audit_log` records the push-recalc action with target = market+store list.

## 11. Phasing

The spec is one feature but ships in three reviewable phases.

### Phase 1 — Foundation (1 PR pair)
- DB migration for all `carrier_*` tables + `market_carrier_links`.
- Drizzle schema in `db/schema.ts`.
- Seed `carriers` table with DHL + FedEx rows.
- RBAC permissions + nav item under "Features".
- `/f/carrier-rates` home (empty state + list accounts).
- `/f/carrier-rates/new` wizard.
- Account overview shell page.
- 0 working logic yet — just the skeleton.

### Phase 2 — Rate authoring + quote engine (1 PR pair)
- Zones page: create/edit zones + assign countries (chip input).
- Weight tiers page: add/remove tier breakpoints.
- Matrix editor: inline-editable cells; auto-save per cell change.
- CSV import for matrix + remote postcodes.
- Surcharges page: list + add/edit surcharges by kind.
- Remote postcodes page: list + CSV upload.
- Quote engine module with unit tests covering every surcharge combination.
- Calculator page: form (country + postcode + weight + residential flag) → breakdown card.

### Phase 3 — Push to Markets (1 PR pair)
- `market_carrier_links` UI on existing market detail page (link a carrier account to a market with a service label).
- Push page: recalc all linked stores, show diff preview vs current per-store override, confirm + save.
- Audit log integration.

Each phase merges independently. Phase 1 is shippable as a feature flag-gated empty shell; phases 2 and 3 light up the surfaces.

## 12. Open questions (defer)

1. **Multi-service per carrier** — DHL has Express, Express 9:00, Economy, etc. Today we model each as a separate `carrier_account` ("DHL Express", "DHL Economy"). Acceptable? Or do we need `carrier_services` table inside each account?
2. **Rate cards per quarter** — fuel surcharge changes weekly. Do we need historical rate cards / time-versioned cells? Today: edit-in-place, no history (besides `carrier_quote_logs`).
3. **Postal code wildcards** — DHL publishes ranges like `1000–1999`. v1 stores literal exact strings. v1.1 can extend `postcode_pattern` to support ranges.
4. **Volumetric weight** — DHL/FedEx charge `max(actual, volumetric)`. Out of scope for v1; quote engine takes `weightKg` as already-chargeable weight.
5. **Markets representative country** — current plan: pick lowest-rated country in the market. Alternative: configurable per link. Defer.

## 13. Risk

- **Coupling to Markets**: Phase 3 mutates per-store overrides. If we change overrides shape later, both features need to migrate together. Mitigation: write the overrides shape via a small typed helper in `features/markets/api.ts` so the producer side is the single source of truth.
- **FX rate staleness**: VND/USD rate drifts 1–2% monthly. If operator forgets to update `carrier_accounts.fx_cost_per_display`, store rates become stale. Mitigation: warning banner if FX rate is older than 30 days.
- **Matrix data loss on bad CSV**: a malformed import could blank zones. Mitigation: parser runs against a staged copy, emits diff preview, operator confirms before commit.
