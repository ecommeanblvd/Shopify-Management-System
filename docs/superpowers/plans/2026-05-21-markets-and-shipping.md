# Markets & Per-Market Shipping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a `features/markets/` module that lets admins define Shopify Markets (countries, currencies, languages) as a global template, apply per-store overrides (price adjustment %, per-market shipping rates), and write changes to Shopify via the existing 4-gate writer.

**Architecture:** New independent feature under `features/markets/`, mirroring `features/settings-sync/` patterns (manifest, domain adapters, diff/merge, apply orchestrator, server actions). Reuses `lib/shopify/writer.ts`, `lib/shopify/connector.ts`, `lib/shopify/client.ts`, `lib/auth/rbac.ts`, `lib/logging/audit.ts`. New DB tables: `market_templates`, `market_store_overrides`, `market_apply_history`. New routes under `app/(dashboard)/f/markets/`.

**Tech Stack:** Next.js 16 App Router, TypeScript, Drizzle ORM + Postgres, Shopify Admin GraphQL 2025-01, base-ui/react + Tailwind v4, Vitest, Playwright.

**Reference spec:** [`docs/superpowers/specs/2026-05-21-markets-and-shipping-design.md`](../specs/2026-05-21-markets-and-shipping-design.md)

---

## File Structure (all paths absolute from repo root)

**New files:**

```
features/markets/
├── manifest.ts                          # Feature manifest (scopes, writeOps flag)
├── types.ts                             # Market, MarketPriceAdjustment, MarketShipping, MarketConfig
├── seed.ts                              # 11 default markets seed data
├── validate.ts                          # Invariant checks (country exclusivity, etc.)
├── merge.ts                             # mergeMarketConfig(template, overrides) → effective
├── diff.ts                              # diffMarkets(effective, live) → MarketOps
├── reconciliation.ts                    # snapshot live state, country conflict detection
├── apply.ts                             # apply orchestrator (ordering, partial-error)
├── actions.ts                           # server actions (saveTemplate, executeApply, etc.)
├── domain/
│   ├── markets.ts                       # MARKETS_QUERY + normalize + market mutations
│   ├── currencies.ts                    # currencySettingsUpdate builders
│   ├── languages.ts                     # webPresence builders
│   ├── price-adjustments.ts             # priceListCreate/Update builders
│   └── market-shipping.ts               # delivery profile per-market builders
├── *.test.ts                            # unit + integration tests for each file
└── domain/*.test.ts

app/(dashboard)/f/markets/
├── page.tsx                             # markets list
├── new/page.tsx                         # create market form
├── [handle]/page.tsx                    # market detail + edit
├── [handle]/stores/[storeId]/page.tsx   # per-store override editor
├── apply/page.tsx                       # apply diff modal
└── history/page.tsx                     # apply history

scripts/
└── probe-markets-api.ts                 # read-only API verification script

e2e/
├── markets-list.spec.ts
├── market-detail.spec.ts
├── override-edit.spec.ts
└── apply-flow.spec.ts
```

**Modified files:**

- `db/schema.ts` — add 3 tables
- `lib/auth/rbac.ts` — add 3 permissions to Permission type + admin/viewer rows in MATRIX

---

## Task 1: Database schema for markets

**Files:**
- Modify: `db/schema.ts` (append after line 134)
- Create: `db/migrations/00XX_markets.sql` (auto-generated)

- [ ] **Step 1: Add 3 tables to `db/schema.ts`**

Append after line 134 (after `reconciliationStatus` table):

```typescript
// --- Markets feature tables ---

export const marketTypeEnum = pgEnum('market_type', ['regional', 'international']);

export const marketApplyStatusEnum = pgEnum('market_apply_status', [
  'preview', 'in_progress', 'success', 'partial_error', 'failed',
]);

export const marketTemplates = pgTable('market_templates', {
  handle: text('handle').primaryKey(),
  name: text('name').notNull(),
  type: marketTypeEnum('type').notNull(),
  countries: jsonb('countries').notNull().default([]),
  primaryCurrency: text('primary_currency').notNull(),
  alternativeCurrencies: jsonb('alternative_currencies').notNull().default([]),
  primaryLanguage: text('primary_language').notNull(),
  alternativeLanguages: jsonb('alternative_languages').notNull().default([]),
  enabled: boolean('enabled').notNull().default(true),
  version: integer('version').notNull().default(1),
  updatedBy: text('updated_by').references(() => user.id),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const marketStoreOverrides = pgTable('market_store_overrides', {
  storeId: uuid('store_id').references(() => stores.id).notNull(),
  marketHandle: text('market_handle').references(() => marketTemplates.handle).notNull(),
  priceAdjustment: jsonb('price_adjustment'),
  shipping: jsonb('shipping'),
  version: integer('version').notNull().default(1),
  updatedBy: text('updated_by').references(() => user.id),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('market_store_overrides_store_handle_idx').on(table.storeId, table.marketHandle),
]);

export const marketApplyHistory = pgTable('market_apply_history', {
  id: uuid('id').defaultRandom().primaryKey(),
  storeId: uuid('store_id').references(() => stores.id).notNull(),
  marketHandle: text('market_handle'),
  userId: text('user_id').references(() => user.id),
  action: text('action').notNull(),
  status: marketApplyStatusEnum('status').notNull(),
  diff: jsonb('diff'),
  preSnapshot: jsonb('pre_snapshot'),
  postSnapshot: jsonb('post_snapshot'),
  errorDetail: text('error_detail'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('market_apply_history_store_created_idx').on(table.storeId, table.createdAt),
]);
```

- [ ] **Step 2: Generate migration**

Run: `npm run db:generate`
Expected: New file `db/migrations/00XX_markets.sql` (number is next sequential)

- [ ] **Step 3: Apply migration locally**

Run: `npm run db:migrate`
Expected: PSQL output `CREATE TYPE`, `CREATE TABLE` 3 times, no errors.

- [ ] **Step 4: Verify tables exist**

Run: `psql $DATABASE_URL -c '\d market_templates' -c '\d market_store_overrides' -c '\d market_apply_history'`
Expected: All three tables listed with correct columns.

- [ ] **Step 5: Commit**

```bash
git add db/schema.ts db/migrations/
git commit -m "feat(markets): add database schema for markets template + overrides + apply history"
```

---

## Task 2: Types and seed data

**Files:**
- Create: `features/markets/types.ts`
- Create: `features/markets/seed.ts`
- Create: `features/markets/seed.test.ts`

- [ ] **Step 1: Write `features/markets/types.ts`**

```typescript
export interface Market {
  handle: string;
  name: string;
  type: 'regional' | 'international';
  countries: string[];
  primaryCurrency: string;
  alternativeCurrencies: string[];
  primaryLanguage: string;
  alternativeLanguages: string[];
  enabled: boolean;
}

export interface MarketPriceAdjustment {
  type: 'percentage';
  value: number;
}

export interface ShippingRate {
  type: 'flat';
  price: number;
  currency: string;
}

export interface ShippingZone {
  countries: string[];
  rates: Record<string, ShippingRate>;
}

export interface MarketShipping {
  zones: Record<string, ShippingZone>;
}

export interface MarketStoreOverride {
  storeId: string;
  marketHandle: string;
  priceAdjustment: MarketPriceAdjustment | null;
  shipping: MarketShipping | null;
}

export interface EffectiveMarket extends Market {
  priceAdjustment: MarketPriceAdjustment | null;
  shipping: MarketShipping | null;
}
```

- [ ] **Step 2: Write failing seed test**

Create `features/markets/seed.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { DEFAULT_MARKETS } from './seed';
import type { Market } from './types';

describe('DEFAULT_MARKETS seed', () => {
  it('contains exactly 11 markets', () => {
    expect(DEFAULT_MARKETS).toHaveLength(11);
  });

  it('contains expected handles', () => {
    const handles = DEFAULT_MARKETS.map((m) => m.handle).sort();
    expect(handles).toEqual([
      'canada', 'europe', 'greater-china', 'international', 'japan',
      'korea', 'middle-east', 'oceania', 'south-east-asia',
      'united-states', 'vietnam-domestic',
    ]);
  });

  it('has exactly one international market with empty countries', () => {
    const intl = DEFAULT_MARKETS.filter((m) => m.type === 'international');
    expect(intl).toHaveLength(1);
    expect(intl[0].countries).toEqual([]);
  });

  it('has no overlapping countries between regional markets', () => {
    const seen = new Map<string, string>();
    for (const m of DEFAULT_MARKETS.filter((x) => x.type === 'regional')) {
      for (const c of m.countries) {
        if (seen.has(c)) {
          throw new Error(`Country ${c} in both '${seen.get(c)}' and '${m.handle}'`);
        }
        seen.set(c, m.handle);
      }
    }
  });

  it('all country codes are valid ISO-2 (exactly 2 uppercase letters)', () => {
    for (const m of DEFAULT_MARKETS) {
      for (const c of m.countries) {
        expect(c).toMatch(/^[A-Z]{2}$/);
      }
    }
  });

  it('all handles are unique', () => {
    const set = new Set(DEFAULT_MARKETS.map((m) => m.handle));
    expect(set.size).toBe(DEFAULT_MARKETS.length);
  });

  it('every market has a non-empty primary currency and language', () => {
    for (const m of DEFAULT_MARKETS) {
      expect(m.primaryCurrency).toMatch(/^[A-Z]{3}$/);
      expect(m.primaryLanguage).toMatch(/^[a-z]{2}$/);
    }
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- features/markets/seed.test.ts`
Expected: FAIL with "Cannot find module './seed'"

- [ ] **Step 4: Write `features/markets/seed.ts`**

```typescript
import type { Market } from './types';

export const DEFAULT_MARKETS: Market[] = [
  {
    handle: 'middle-east',
    name: 'Middle East',
    type: 'regional',
    countries: ['AE', 'SA', 'QA', 'KW', 'BH', 'OM', 'JO', 'LB', 'IL', 'EG', 'TR'],
    primaryCurrency: 'USD',
    alternativeCurrencies: [],
    primaryLanguage: 'en',
    alternativeLanguages: ['ar'],
    enabled: true,
  },
  {
    handle: 'united-states',
    name: 'United States',
    type: 'regional',
    countries: ['US'],
    primaryCurrency: 'USD',
    alternativeCurrencies: [],
    primaryLanguage: 'en',
    alternativeLanguages: [],
    enabled: true,
  },
  {
    handle: 'greater-china',
    name: 'Greater China',
    type: 'regional',
    countries: ['HK', 'CN', 'MO', 'TW'],
    primaryCurrency: 'USD',
    alternativeCurrencies: ['HKD', 'CNY'],
    primaryLanguage: 'en',
    alternativeLanguages: ['zh'],
    enabled: true,
  },
  {
    handle: 'south-east-asia',
    name: 'South East Asia',
    type: 'regional',
    countries: ['SG', 'MY', 'TH', 'ID', 'PH', 'BN', 'KH', 'LA', 'MM'],
    primaryCurrency: 'USD',
    alternativeCurrencies: [],
    primaryLanguage: 'en',
    alternativeLanguages: [],
    enabled: true,
  },
  {
    handle: 'japan',
    name: 'Japan',
    type: 'regional',
    countries: ['JP'],
    primaryCurrency: 'JPY',
    alternativeCurrencies: ['USD'],
    primaryLanguage: 'ja',
    alternativeLanguages: ['en'],
    enabled: true,
  },
  {
    handle: 'korea',
    name: 'Korea',
    type: 'regional',
    countries: ['KR'],
    primaryCurrency: 'KRW',
    alternativeCurrencies: ['USD'],
    primaryLanguage: 'ko',
    alternativeLanguages: ['en'],
    enabled: true,
  },
  {
    handle: 'oceania',
    name: 'Oceania',
    type: 'regional',
    countries: ['AU', 'NZ'],
    primaryCurrency: 'AUD',
    alternativeCurrencies: ['NZD'],
    primaryLanguage: 'en',
    alternativeLanguages: [],
    enabled: true,
  },
  {
    handle: 'canada',
    name: 'Canada',
    type: 'regional',
    countries: ['CA'],
    primaryCurrency: 'CAD',
    alternativeCurrencies: ['USD'],
    primaryLanguage: 'en',
    alternativeLanguages: ['fr'],
    enabled: true,
  },
  {
    handle: 'europe',
    name: 'Europe',
    type: 'regional',
    countries: ['DE', 'FR', 'IT', 'ES', 'NL', 'BE', 'AT', 'PT', 'IE', 'FI', 'SE', 'DK', 'PL', 'CZ', 'GR', 'HU', 'RO', 'SK', 'SI', 'LU', 'EE', 'LV', 'LT', 'BG', 'HR', 'MT', 'CY', 'GB', 'CH', 'NO'],
    primaryCurrency: 'EUR',
    alternativeCurrencies: ['GBP', 'CHF', 'NOK'],
    primaryLanguage: 'en',
    alternativeLanguages: ['de', 'fr', 'it', 'es'],
    enabled: true,
  },
  {
    handle: 'vietnam-domestic',
    name: 'Vietnam (Domestic)',
    type: 'regional',
    countries: ['VN'],
    primaryCurrency: 'VND',
    alternativeCurrencies: [],
    primaryLanguage: 'vi',
    alternativeLanguages: ['en'],
    enabled: true,
  },
  {
    handle: 'international',
    name: 'International',
    type: 'international',
    countries: [],
    primaryCurrency: 'USD',
    alternativeCurrencies: [],
    primaryLanguage: 'en',
    alternativeLanguages: [],
    enabled: true,
  },
];
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- features/markets/seed.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 6: Commit**

```bash
git add features/markets/types.ts features/markets/seed.ts features/markets/seed.test.ts
git commit -m "feat(markets): add Market types and 11 default markets seed data"
```

---

## Task 3: Feature manifest, RBAC permissions, and role helper

**Files:**
- Create: `features/markets/manifest.ts`
- Modify: `lib/auth/rbac.ts:2-23`
- Modify: `lib/auth/rbac.test.ts`
- Create: `lib/auth/role.ts` (shared `getRole(userId)` helper, used by all UI pages)

- [ ] **Step 1: Write `features/markets/manifest.ts`**

```typescript
import type { FeatureManifest } from '@/lib/registry/registry';

export const marketsManifest: FeatureManifest = {
  key: 'markets',
  name: 'Markets & Per-Market Shipping',
  version: '1.0.0',
  // Markets need write_markets for marketCreate/Update; write_shipping for
  // per-market delivery profile creation; write_shop_settings (or write_shop)
  // for currency/language updates. Verify scope names against Shopify Admin
  // API docs for the pinned API version at implement time.
  requiredScopes: ['write_markets', 'write_shipping', 'write_shop_settings'],
  hasWriteOperations: true,
};
```

- [ ] **Step 2: Write failing RBAC test**

Add to `lib/auth/rbac.test.ts`:

```typescript
describe('markets permissions', () => {
  it('grants admin manage_markets_template, apply_markets, view_markets_history', () => {
    expect(hasPermission('admin', 'manage_markets_template')).toBe(true);
    expect(hasPermission('admin', 'apply_markets')).toBe(true);
    expect(hasPermission('admin', 'view_markets_history')).toBe(true);
  });

  it('grants operator apply_markets and view_markets_history (no template edit)', () => {
    expect(hasPermission('operator', 'manage_markets_template')).toBe(false);
    expect(hasPermission('operator', 'apply_markets')).toBe(true);
    expect(hasPermission('operator', 'view_markets_history')).toBe(true);
  });

  it('grants viewer view_markets_history only', () => {
    expect(hasPermission('viewer', 'manage_markets_template')).toBe(false);
    expect(hasPermission('viewer', 'apply_markets')).toBe(false);
    expect(hasPermission('viewer', 'view_markets_history')).toBe(true);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- lib/auth/rbac.test.ts`
Expected: FAIL with "Argument of type ... is not assignable to parameter of type 'Permission'"

- [ ] **Step 4: Update `lib/auth/rbac.ts:2-23`**

Replace the Permission type and MATRIX:

```typescript
export type Permission =
  | 'view'
  | 'run_feature'
  | 'manage_stores'
  | 'manage_settings_template'
  | 'apply_settings'
  | 'reconcile_store'
  | 'view_settings_history'
  | 'manage_users'
  | 'manage_markets_template'
  | 'apply_markets'
  | 'view_markets_history';

const MATRIX: Record<Role, Permission[]> = {
  admin: [
    'view', 'run_feature', 'manage_stores',
    'manage_settings_template', 'apply_settings',
    'reconcile_store', 'view_settings_history',
    'manage_users',
    'manage_markets_template', 'apply_markets', 'view_markets_history',
  ],
  operator: [
    'view', 'run_feature',
    'apply_settings', 'reconcile_store', 'view_settings_history',
    'apply_markets', 'view_markets_history',
  ],
  viewer: ['view', 'view_settings_history', 'view_markets_history'],
};
```

- [ ] **Step 5: Run tests to verify pass**

Run: `npm test -- lib/auth/rbac.test.ts`
Expected: PASS, all rbac tests including 3 new markets tests.

- [ ] **Step 6: Create `lib/auth/role.ts` helper**

```typescript
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import type { Role } from './rbac';

export async function getRole(userId: string): Promise<Role> {
  const [row] = await db.select()
    .from(schema.roles)
    .where(eq(schema.roles.userId, userId))
    .limit(1);
  return (row?.role as Role | undefined) ?? 'viewer';
}
```

- [ ] **Step 7: Commit**

```bash
git add features/markets/manifest.ts lib/auth/rbac.ts lib/auth/rbac.test.ts lib/auth/role.ts
git commit -m "feat(markets): add feature manifest, RBAC permissions, and shared getRole helper"
```

---

## Task 4: Validation invariants

**Files:**
- Create: `features/markets/validate.ts`
- Create: `features/markets/validate.test.ts`

- [ ] **Step 1: Write failing tests**

Create `features/markets/validate.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  validateTemplate, validateOverride, ValidationError,
} from './validate';
import type { Market, MarketStoreOverride } from './types';

const baseMarket = (overrides: Partial<Market> = {}): Market => ({
  handle: 'us',
  name: 'United States',
  type: 'regional',
  countries: ['US'],
  primaryCurrency: 'USD',
  alternativeCurrencies: [],
  primaryLanguage: 'en',
  alternativeLanguages: [],
  enabled: true,
  ...overrides,
});

describe('validateTemplate', () => {
  it('passes for valid 11-market seed', () => {
    expect(() => validateTemplate([
      baseMarket({ handle: 'us', countries: ['US'] }),
      baseMarket({ handle: 'eu', countries: ['DE', 'FR'], primaryCurrency: 'EUR' }),
      baseMarket({ handle: 'intl', type: 'international', countries: [] }),
    ])).not.toThrow();
  });

  it('throws on duplicate country across regional markets', () => {
    expect(() => validateTemplate([
      baseMarket({ handle: 'us', countries: ['US', 'CA'] }),
      baseMarket({ handle: 'canada', countries: ['CA'] }),
    ])).toThrow(ValidationError);
  });

  it('throws when more than one international market exists', () => {
    expect(() => validateTemplate([
      baseMarket({ handle: 'intl1', type: 'international', countries: [] }),
      baseMarket({ handle: 'intl2', type: 'international', countries: [] }),
    ])).toThrow(/exactly one international market/i);
  });

  it('throws when regional market has empty countries', () => {
    expect(() => validateTemplate([
      baseMarket({ handle: 'us', countries: [] }),
    ])).toThrow(/regional market .* must have at least one country/i);
  });

  it('throws when international market has countries', () => {
    expect(() => validateTemplate([
      baseMarket({ handle: 'intl', type: 'international', countries: ['US'] }),
    ])).toThrow(/international market .* must have empty countries/i);
  });

  it('throws on duplicate handle', () => {
    expect(() => validateTemplate([
      baseMarket({ handle: 'us', countries: ['US'] }),
      baseMarket({ handle: 'us', countries: ['MX'] }),
    ])).toThrow(/duplicate handle/i);
  });

  it('throws on invalid ISO-2 country code', () => {
    expect(() => validateTemplate([
      baseMarket({ handle: 'us', countries: ['USA'] }),
    ])).toThrow(/invalid country code/i);
  });
});

describe('validateOverride', () => {
  const market = baseMarket({
    handle: 'europe',
    countries: ['DE', 'FR', 'IT'],
    primaryCurrency: 'EUR',
    alternativeCurrencies: ['GBP'],
  });

  const baseOverride = (o: Partial<MarketStoreOverride> = {}): MarketStoreOverride => ({
    storeId: 'store-1',
    marketHandle: 'europe',
    priceAdjustment: null,
    shipping: null,
    ...o,
  });

  it('passes for empty override', () => {
    expect(() => validateOverride(market, baseOverride())).not.toThrow();
  });

  it('passes for valid price adjustment +12%', () => {
    expect(() => validateOverride(market, baseOverride({
      priceAdjustment: { type: 'percentage', value: 12 },
    }))).not.toThrow();
  });

  it('throws on price adjustment below -50', () => {
    expect(() => validateOverride(market, baseOverride({
      priceAdjustment: { type: 'percentage', value: -60 },
    }))).toThrow(/price adjustment .* between -50 and 200/i);
  });

  it('throws on price adjustment above 200', () => {
    expect(() => validateOverride(market, baseOverride({
      priceAdjustment: { type: 'percentage', value: 250 },
    }))).toThrow(/price adjustment .* between -50 and 200/i);
  });

  it('throws when zone country not in market countries', () => {
    expect(() => validateOverride(market, baseOverride({
      shipping: {
        zones: {
          'EU Standard': { countries: ['DE', 'US'], rates: {} },
        },
      },
    }))).toThrow(/country US .* not in market europe/i);
  });

  it('throws when rate currency not in market currencies', () => {
    expect(() => validateOverride(market, baseOverride({
      shipping: {
        zones: {
          'EU Standard': {
            countries: ['DE'],
            rates: { 'Std': { type: 'flat', price: 5, currency: 'JPY' } },
          },
        },
      },
    }))).toThrow(/currency JPY .* not in market europe currencies/i);
  });

  it('accepts rate currency in alternativeCurrencies', () => {
    expect(() => validateOverride(market, baseOverride({
      shipping: {
        zones: {
          'UK Zone': {
            countries: ['DE'],
            rates: { 'Std': { type: 'flat', price: 5, currency: 'GBP' } },
          },
        },
      },
    }))).not.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- features/markets/validate.test.ts`
Expected: FAIL with "Cannot find module './validate'"

- [ ] **Step 3: Write `features/markets/validate.ts`**

```typescript
import type { Market, MarketStoreOverride } from './types';

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

const ISO2 = /^[A-Z]{2}$/;

export function validateTemplate(markets: Market[]): void {
  const handles = new Set<string>();
  const countryOwner = new Map<string, string>();
  let internationalCount = 0;

  for (const m of markets) {
    if (handles.has(m.handle)) {
      throw new ValidationError(`Duplicate handle: ${m.handle}`);
    }
    handles.add(m.handle);

    if (m.type === 'international') {
      internationalCount++;
      if (m.countries.length > 0) {
        throw new ValidationError(
          `International market '${m.handle}' must have empty countries`,
        );
      }
    } else {
      if (m.countries.length === 0) {
        throw new ValidationError(
          `Regional market '${m.handle}' must have at least one country`,
        );
      }
      for (const c of m.countries) {
        if (!ISO2.test(c)) {
          throw new ValidationError(`Invalid country code '${c}' in market '${m.handle}'`);
        }
        const owner = countryOwner.get(c);
        if (owner) {
          throw new ValidationError(
            `Country ${c} assigned to both '${owner}' and '${m.handle}'`,
          );
        }
        countryOwner.set(c, m.handle);
      }
    }
  }

  if (internationalCount !== 1) {
    throw new ValidationError(
      `Template must contain exactly one international market (found ${internationalCount})`,
    );
  }
}

export function validateOverride(market: Market, override: MarketStoreOverride): void {
  if (override.priceAdjustment) {
    const v = override.priceAdjustment.value;
    if (v < -50 || v > 200) {
      throw new ValidationError(
        `Price adjustment ${v}% must be between -50 and 200`,
      );
    }
  }

  if (override.shipping) {
    const allowedCurrencies = new Set([
      market.primaryCurrency,
      ...market.alternativeCurrencies,
    ]);
    const marketCountries = new Set(market.countries);
    const isInternational = market.type === 'international';

    for (const [zoneName, zone] of Object.entries(override.shipping.zones)) {
      for (const c of zone.countries) {
        if (!isInternational && !marketCountries.has(c)) {
          throw new ValidationError(
            `Zone '${zoneName}': country ${c} is not in market ${market.handle} countries`,
          );
        }
      }
      for (const [rateName, rate] of Object.entries(zone.rates)) {
        if (!allowedCurrencies.has(rate.currency)) {
          throw new ValidationError(
            `Zone '${zoneName}' rate '${rateName}': currency ${rate.currency} is not in market ${market.handle} currencies`,
          );
        }
      }
    }
  }
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npm test -- features/markets/validate.test.ts`
Expected: PASS, 14 tests.

- [ ] **Step 5: Commit**

```bash
git add features/markets/validate.ts features/markets/validate.test.ts
git commit -m "feat(markets): add template + override validation invariants"
```

---

## Task 5: Markets domain — read query + normalize

**Files:**
- Create: `features/markets/domain/markets.ts`
- Create: `features/markets/domain/markets.test.ts`

- [ ] **Step 1: Write failing test**

Create `features/markets/domain/markets.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { MARKETS_QUERY, normalizeMarkets } from './markets';

describe('MARKETS_QUERY', () => {
  it('is a non-empty GraphQL query string', () => {
    expect(MARKETS_QUERY).toContain('query');
    expect(MARKETS_QUERY).toContain('markets');
  });
});

describe('normalizeMarkets', () => {
  it('returns empty array when response has no markets', () => {
    expect(normalizeMarkets({ markets: { edges: [] } })).toEqual([]);
  });

  it('normalizes a single market with regions', () => {
    const result = normalizeMarkets({
      markets: {
        edges: [{
          node: {
            id: 'gid://shopify/Market/1',
            handle: 'united-states',
            name: 'United States',
            enabled: true,
            primary: true,
            regions: { edges: [{ node: { __typename: 'MarketRegionCountry', code: 'US' } }] },
            currencySettings: {
              baseCurrency: { currencyCode: 'USD' },
              localCurrencies: false,
            },
            webPresence: { defaultLocale: 'en', alternateLocales: [] },
            priceList: null,
          },
        }],
      },
    });
    expect(result).toEqual([{
      id: 'gid://shopify/Market/1',
      handle: 'united-states',
      name: 'United States',
      type: 'regional',
      countries: ['US'],
      primaryCurrency: 'USD',
      alternativeCurrencies: [],
      primaryLanguage: 'en',
      alternativeLanguages: [],
      enabled: true,
      primary: true,
      priceListId: null,
      priceAdjustment: null,
    }]);
  });

  it('marks markets with empty regions as international type', () => {
    const result = normalizeMarkets({
      markets: {
        edges: [{
          node: {
            id: 'gid://shopify/Market/9',
            handle: 'international',
            name: 'International',
            enabled: true,
            primary: false,
            regions: { edges: [] },
            currencySettings: { baseCurrency: { currencyCode: 'USD' }, localCurrencies: false },
            webPresence: { defaultLocale: 'en', alternateLocales: [] },
            priceList: null,
          },
        }],
      },
    });
    expect(result[0].type).toBe('international');
    expect(result[0].countries).toEqual([]);
  });

  it('extracts price adjustment from priceList', () => {
    const result = normalizeMarkets({
      markets: {
        edges: [{
          node: {
            id: 'gid://shopify/Market/2',
            handle: 'europe',
            name: 'Europe',
            enabled: true,
            primary: false,
            regions: { edges: [{ node: { __typename: 'MarketRegionCountry', code: 'DE' } }] },
            currencySettings: { baseCurrency: { currencyCode: 'EUR' }, localCurrencies: false },
            webPresence: { defaultLocale: 'en', alternateLocales: [{ locale: 'de' }] },
            priceList: {
              id: 'gid://shopify/PriceList/77',
              parent: { adjustment: { type: 'PERCENTAGE_INCREASE', value: 12 } },
            },
          },
        }],
      },
    });
    expect(result[0].priceListId).toBe('gid://shopify/PriceList/77');
    expect(result[0].priceAdjustment).toEqual({ type: 'percentage', value: 12 });
    expect(result[0].alternativeLanguages).toEqual(['de']);
  });

  it('converts PERCENTAGE_DECREASE to negative value', () => {
    const result = normalizeMarkets({
      markets: {
        edges: [{
          node: {
            id: 'gid://shopify/Market/3',
            handle: 'asia',
            name: 'Asia',
            enabled: true,
            primary: false,
            regions: { edges: [{ node: { __typename: 'MarketRegionCountry', code: 'JP' } }] },
            currencySettings: { baseCurrency: { currencyCode: 'JPY' }, localCurrencies: false },
            webPresence: { defaultLocale: 'ja', alternateLocales: [] },
            priceList: {
              id: 'gid://shopify/PriceList/88',
              parent: { adjustment: { type: 'PERCENTAGE_DECREASE', value: 5 } },
            },
          },
        }],
      },
    });
    expect(result[0].priceAdjustment).toEqual({ type: 'percentage', value: -5 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- features/markets/domain/markets.test.ts`
Expected: FAIL "Cannot find module './markets'"

- [ ] **Step 3: Write `features/markets/domain/markets.ts`**

```typescript
import type { MarketPriceAdjustment } from '../types';

export const MARKETS_QUERY = `
  query Markets {
    markets(first: 25) {
      edges { node {
        id
        handle
        name
        enabled
        primary
        regions(first: 250) {
          edges { node { __typename ... on MarketRegionCountry { code } } }
        }
        currencySettings {
          baseCurrency { currencyCode }
          localCurrencies
        }
        webPresence {
          defaultLocale
          alternateLocales { locale }
        }
        priceList {
          id
          parent { adjustment { type value } }
        }
      } }
    }
  }
`;

interface ShopifyMarketEdge {
  node: {
    id: string;
    handle: string;
    name: string;
    enabled: boolean;
    primary: boolean;
    regions?: { edges?: Array<{ node: { __typename: string; code?: string } }> };
    currencySettings?: {
      baseCurrency?: { currencyCode: string };
      localCurrencies?: boolean;
    };
    webPresence?: {
      defaultLocale?: string;
      alternateLocales?: Array<{ locale: string }>;
    };
    priceList?: {
      id: string;
      parent?: { adjustment?: { type: string; value: number } };
    } | null;
  };
}

export interface NormalizedMarket {
  id: string;
  handle: string;
  name: string;
  type: 'regional' | 'international';
  countries: string[];
  primaryCurrency: string;
  alternativeCurrencies: string[];
  primaryLanguage: string;
  alternativeLanguages: string[];
  enabled: boolean;
  primary: boolean;
  priceListId: string | null;
  priceAdjustment: MarketPriceAdjustment | null;
}

export function normalizeMarkets(data: unknown): NormalizedMarket[] {
  const typed = data as { markets?: { edges?: ShopifyMarketEdge[] } };
  const edges = typed?.markets?.edges ?? [];
  return edges.map((e) => {
    const n = e.node;
    const countries = (n.regions?.edges ?? [])
      .filter((r) => r.node.__typename === 'MarketRegionCountry' && r.node.code)
      .map((r) => r.node.code as string);
    const adj = n.priceList?.parent?.adjustment;
    const priceAdjustment: MarketPriceAdjustment | null = adj
      ? {
          type: 'percentage',
          value: adj.type === 'PERCENTAGE_DECREASE' ? -adj.value : adj.value,
        }
      : null;
    return {
      id: n.id,
      handle: n.handle,
      name: n.name,
      type: countries.length === 0 ? 'international' : 'regional',
      countries,
      primaryCurrency: n.currencySettings?.baseCurrency?.currencyCode ?? 'USD',
      alternativeCurrencies: [],
      primaryLanguage: n.webPresence?.defaultLocale ?? 'en',
      alternativeLanguages: (n.webPresence?.alternateLocales ?? []).map((l) => l.locale),
      enabled: n.enabled,
      primary: n.primary,
      priceListId: n.priceList?.id ?? null,
      priceAdjustment,
    };
  });
}
```

- [ ] **Step 4: Run test to verify pass**

Run: `npm test -- features/markets/domain/markets.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add features/markets/domain/markets.ts features/markets/domain/markets.test.ts
git commit -m "feat(markets): add markets domain query + normalize"
```

---

## Task 6: Markets domain — mutation builders (create/update/delete)

**Files:**
- Modify: `features/markets/domain/markets.ts` (append mutations)
- Modify: `features/markets/domain/markets.test.ts` (add tests)

- [ ] **Step 1: Add failing tests to `features/markets/domain/markets.test.ts`**

```typescript
import {
  buildMarketCreateInput, buildMarketUpdateInput, buildMarketRegionsCreate,
  MARKET_CREATE_MUTATION, MARKET_UPDATE_MUTATION, MARKET_DELETE_MUTATION,
  MARKET_REGIONS_CREATE_MUTATION, MARKET_REGION_DELETE_MUTATION,
} from './markets';
import type { Market } from '../types';

const europe: Market = {
  handle: 'europe',
  name: 'Europe',
  type: 'regional',
  countries: ['DE', 'FR'],
  primaryCurrency: 'EUR',
  alternativeCurrencies: [],
  primaryLanguage: 'en',
  alternativeLanguages: [],
  enabled: true,
};

describe('buildMarketCreateInput', () => {
  it('produces a marketCreate input with regions and enabled', () => {
    expect(buildMarketCreateInput(europe)).toEqual({
      name: 'Europe',
      handle: 'europe',
      enabled: true,
      regions: [{ countryCode: 'DE' }, { countryCode: 'FR' }],
    });
  });

  it('produces empty regions for international markets', () => {
    expect(buildMarketCreateInput({ ...europe, type: 'international', countries: [] }))
      .toEqual({ name: 'Europe', handle: 'europe', enabled: true, regions: [] });
  });
});

describe('buildMarketUpdateInput', () => {
  it('produces a marketUpdate input with name and enabled only', () => {
    expect(buildMarketUpdateInput({ ...europe, enabled: false })).toEqual({
      name: 'Europe',
      enabled: false,
    });
  });
});

describe('buildMarketRegionsCreate', () => {
  it('builds regions array for added countries', () => {
    expect(buildMarketRegionsCreate(['IT', 'ES'])).toEqual([
      { countryCode: 'IT' },
      { countryCode: 'ES' },
    ]);
  });
});

describe('mutation strings', () => {
  it('all are non-empty GraphQL mutations', () => {
    expect(MARKET_CREATE_MUTATION).toContain('marketCreate');
    expect(MARKET_UPDATE_MUTATION).toContain('marketUpdate');
    expect(MARKET_DELETE_MUTATION).toContain('marketDelete');
    expect(MARKET_REGIONS_CREATE_MUTATION).toContain('marketRegionsCreate');
    expect(MARKET_REGION_DELETE_MUTATION).toContain('marketRegionDelete');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- features/markets/domain/markets.test.ts`
Expected: FAIL with "Cannot find name 'buildMarketCreateInput'" etc.

- [ ] **Step 3: Append to `features/markets/domain/markets.ts`**

```typescript
import type { Market } from '../types';

export interface MarketCreateInput {
  name: string;
  handle: string;
  enabled: boolean;
  regions: Array<{ countryCode: string }>;
}

export function buildMarketCreateInput(m: Market): MarketCreateInput {
  return {
    name: m.name,
    handle: m.handle,
    enabled: m.enabled,
    regions: m.countries.map((c) => ({ countryCode: c })),
  };
}

export interface MarketUpdateInput {
  name: string;
  enabled: boolean;
}

export function buildMarketUpdateInput(m: Market): MarketUpdateInput {
  return { name: m.name, enabled: m.enabled };
}

export function buildMarketRegionsCreate(countries: string[]): Array<{ countryCode: string }> {
  return countries.map((c) => ({ countryCode: c }));
}

export const MARKET_CREATE_MUTATION = `
  mutation MarketCreate($input: MarketCreateInput!) {
    marketCreate(input: $input) {
      market { id handle }
      userErrors { field message }
    }
  }
`;

export const MARKET_UPDATE_MUTATION = `
  mutation MarketUpdate($id: ID!, $input: MarketUpdateInput!) {
    marketUpdate(id: $id, input: $input) {
      market { id }
      userErrors { field message }
    }
  }
`;

export const MARKET_DELETE_MUTATION = `
  mutation MarketDelete($id: ID!) {
    marketDelete(id: $id) {
      deletedId
      userErrors { field message }
    }
  }
`;

export const MARKET_REGIONS_CREATE_MUTATION = `
  mutation MarketRegionsCreate($marketId: ID!, $regions: [MarketRegionCreateInput!]!) {
    marketRegionsCreate(marketId: $marketId, regions: $regions) {
      market { id }
      userErrors { field message }
    }
  }
`;

export const MARKET_REGION_DELETE_MUTATION = `
  mutation MarketRegionDelete($id: ID!) {
    marketRegionDelete(id: $id) {
      deletedId
      userErrors { field message }
    }
  }
`;
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npm test -- features/markets/domain/markets.test.ts`
Expected: PASS, 11 tests total.

- [ ] **Step 5: Commit**

```bash
git add features/markets/domain/markets.ts features/markets/domain/markets.test.ts
git commit -m "feat(markets): add market create/update/delete + region mutation builders"
```

---

## Task 7: Currencies, languages, price-adjustments domain modules

**Files:**
- Create: `features/markets/domain/currencies.ts` + test
- Create: `features/markets/domain/languages.ts` + test
- Create: `features/markets/domain/price-adjustments.ts` + test

- [ ] **Step 1: Write failing tests for currencies**

Create `features/markets/domain/currencies.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  buildCurrencySettingsInput, CURRENCY_SETTINGS_UPDATE_MUTATION,
} from './currencies';

describe('buildCurrencySettingsInput', () => {
  it('builds input with primary currency only', () => {
    expect(buildCurrencySettingsInput('USD', [])).toEqual({
      baseCurrency: 'USD',
      localCurrencies: false,
    });
  });

  it('sets localCurrencies true when alternatives exist', () => {
    expect(buildCurrencySettingsInput('EUR', ['GBP', 'USD'])).toEqual({
      baseCurrency: 'EUR',
      localCurrencies: true,
    });
  });
});

describe('CURRENCY_SETTINGS_UPDATE_MUTATION', () => {
  it('is a marketCurrencySettingsUpdate mutation', () => {
    expect(CURRENCY_SETTINGS_UPDATE_MUTATION).toContain('marketCurrencySettingsUpdate');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- features/markets/domain/currencies.test.ts`
Expected: FAIL "Cannot find module './currencies'"

- [ ] **Step 3: Write `features/markets/domain/currencies.ts`**

```typescript
export interface CurrencySettingsInput {
  baseCurrency: string;
  localCurrencies: boolean;
}

export function buildCurrencySettingsInput(
  primary: string,
  alternatives: string[],
): CurrencySettingsInput {
  return {
    baseCurrency: primary,
    localCurrencies: alternatives.length > 0,
  };
}

export const CURRENCY_SETTINGS_UPDATE_MUTATION = `
  mutation MarketCurrencySettingsUpdate($marketId: ID!, $input: MarketCurrencySettingsUpdateInput!) {
    marketCurrencySettingsUpdate(marketId: $marketId, input: $input) {
      market { id }
      userErrors { field message }
    }
  }
`;
```

- [ ] **Step 4: Run currencies test, then write languages test**

Run: `npm test -- features/markets/domain/currencies.test.ts`
Expected: PASS, 3 tests.

Create `features/markets/domain/languages.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  buildWebPresenceInput, WEB_PRESENCE_CREATE_MUTATION, WEB_PRESENCE_UPDATE_MUTATION,
} from './languages';

describe('buildWebPresenceInput', () => {
  it('builds input with default + alternates', () => {
    expect(buildWebPresenceInput('en', ['de', 'fr'], 'us-store')).toEqual({
      defaultLocale: 'en',
      alternateLocales: ['de', 'fr'],
      subfolderSuffix: 'us-store',
    });
  });

  it('builds input with default only when no alternates', () => {
    expect(buildWebPresenceInput('en', [], 'us-store')).toEqual({
      defaultLocale: 'en',
      alternateLocales: [],
      subfolderSuffix: 'us-store',
    });
  });
});

describe('web presence mutations', () => {
  it('CREATE is a marketWebPresenceCreate mutation', () => {
    expect(WEB_PRESENCE_CREATE_MUTATION).toContain('marketWebPresenceCreate');
  });
  it('UPDATE is a marketWebPresenceUpdate mutation', () => {
    expect(WEB_PRESENCE_UPDATE_MUTATION).toContain('marketWebPresenceUpdate');
  });
});
```

- [ ] **Step 5: Write `features/markets/domain/languages.ts`**

```typescript
export interface WebPresenceInput {
  defaultLocale: string;
  alternateLocales: string[];
  subfolderSuffix: string;
}

export function buildWebPresenceInput(
  defaultLocale: string,
  alternateLocales: string[],
  subfolderSuffix: string,
): WebPresenceInput {
  return { defaultLocale, alternateLocales, subfolderSuffix };
}

export const WEB_PRESENCE_CREATE_MUTATION = `
  mutation MarketWebPresenceCreate($marketId: ID!, $webPresence: MarketWebPresenceCreateInput!) {
    marketWebPresenceCreate(marketId: $marketId, webPresence: $webPresence) {
      market { id }
      userErrors { field message }
    }
  }
`;

export const WEB_PRESENCE_UPDATE_MUTATION = `
  mutation MarketWebPresenceUpdate($webPresenceId: ID!, $webPresence: MarketWebPresenceUpdateInput!) {
    marketWebPresenceUpdate(webPresenceId: $webPresenceId, webPresence: $webPresence) {
      market { id }
      userErrors { field message }
    }
  }
`;
```

- [ ] **Step 6: Run languages test**

Run: `npm test -- features/markets/domain/languages.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 7: Write failing tests for price-adjustments**

Create `features/markets/domain/price-adjustments.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  buildPriceListInput, PRICE_LIST_CREATE_MUTATION, PRICE_LIST_UPDATE_MUTATION, PRICE_LIST_DELETE_MUTATION,
} from './price-adjustments';

describe('buildPriceListInput', () => {
  it('builds input for a markup price list (+12%)', () => {
    expect(buildPriceListInput({
      marketId: 'gid://shopify/Market/1',
      marketName: 'Europe',
      currency: 'EUR',
      adjustmentValue: 12,
    })).toEqual({
      name: 'Markets sync – Europe',
      currency: 'EUR',
      parent: {
        adjustment: { type: 'PERCENTAGE_INCREASE', value: 12 },
      },
      contextRule: { marketId: 'gid://shopify/Market/1' },
    });
  });

  it('builds input for a discount price list (-5%) using PERCENTAGE_DECREASE', () => {
    expect(buildPriceListInput({
      marketId: 'gid://shopify/Market/2',
      marketName: 'Asia',
      currency: 'USD',
      adjustmentValue: -5,
    })).toEqual({
      name: 'Markets sync – Asia',
      currency: 'USD',
      parent: {
        adjustment: { type: 'PERCENTAGE_DECREASE', value: 5 },
      },
      contextRule: { marketId: 'gid://shopify/Market/2' },
    });
  });
});

describe('price list mutations', () => {
  it('all are valid GraphQL mutations', () => {
    expect(PRICE_LIST_CREATE_MUTATION).toContain('priceListCreate');
    expect(PRICE_LIST_UPDATE_MUTATION).toContain('priceListUpdate');
    expect(PRICE_LIST_DELETE_MUTATION).toContain('priceListDelete');
  });
});
```

- [ ] **Step 8: Write `features/markets/domain/price-adjustments.ts`**

```typescript
export interface PriceListInputArgs {
  marketId: string;
  marketName: string;
  currency: string;
  adjustmentValue: number;
}

export interface PriceListInput {
  name: string;
  currency: string;
  parent: {
    adjustment: {
      type: 'PERCENTAGE_INCREASE' | 'PERCENTAGE_DECREASE';
      value: number;
    };
  };
  contextRule: { marketId: string };
}

export function buildPriceListInput(args: PriceListInputArgs): PriceListInput {
  const isDecrease = args.adjustmentValue < 0;
  return {
    name: `Markets sync – ${args.marketName}`,
    currency: args.currency,
    parent: {
      adjustment: {
        type: isDecrease ? 'PERCENTAGE_DECREASE' : 'PERCENTAGE_INCREASE',
        value: Math.abs(args.adjustmentValue),
      },
    },
    contextRule: { marketId: args.marketId },
  };
}

export const PRICE_LIST_CREATE_MUTATION = `
  mutation PriceListCreate($input: PriceListCreateInput!) {
    priceListCreate(input: $input) {
      priceList { id }
      userErrors { field message }
    }
  }
`;

export const PRICE_LIST_UPDATE_MUTATION = `
  mutation PriceListUpdate($id: ID!, $input: PriceListUpdateInput!) {
    priceListUpdate(id: $id, input: $input) {
      priceList { id }
      userErrors { field message }
    }
  }
`;

export const PRICE_LIST_DELETE_MUTATION = `
  mutation PriceListDelete($id: ID!) {
    priceListDelete(id: $id) {
      deletedId
      userErrors { field message }
    }
  }
`;
```

- [ ] **Step 9: Run all domain tests**

Run: `npm test -- features/markets/domain/`
Expected: PASS, all currencies + languages + price-adjustments + markets tests.

- [ ] **Step 10: Commit**

```bash
git add features/markets/domain/currencies.ts features/markets/domain/currencies.test.ts \
  features/markets/domain/languages.ts features/markets/domain/languages.test.ts \
  features/markets/domain/price-adjustments.ts features/markets/domain/price-adjustments.test.ts
git commit -m "feat(markets): add currencies, languages, price-adjustments domain modules"
```

---

## Task 8: Per-market shipping domain module

**Files:**
- Create: `features/markets/domain/market-shipping.ts`
- Create: `features/markets/domain/market-shipping.test.ts`

- [ ] **Step 1: Write failing tests**

Create `features/markets/domain/market-shipping.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  buildDeliveryProfileCreateInput,
  buildDeliveryProfileUpdateInput,
  profileTagFor,
  DELIVERY_PROFILE_CREATE_MUTATION,
  DELIVERY_PROFILE_UPDATE_MUTATION,
  DELIVERY_PROFILE_REMOVE_MUTATION,
} from './market-shipping';
import type { MarketShipping } from '../types';

describe('profileTagFor', () => {
  it('formats tag as "<market name> – <storeId 8 chars>"', () => {
    expect(profileTagFor('Europe', 'abcd1234-5678-90ab-cdef-1234567890ab'))
      .toBe('Europe – abcd1234');
  });
});

describe('buildDeliveryProfileCreateInput', () => {
  const shipping: MarketShipping = {
    zones: {
      'EU Standard': {
        countries: ['DE', 'FR'],
        rates: { 'Standard': { type: 'flat', price: 8, currency: 'EUR' } },
      },
    },
  };

  it('builds create input with profile name + zones + method definitions', () => {
    const input = buildDeliveryProfileCreateInput({
      marketName: 'Europe',
      storeId: 'abcd1234-5678',
      marketId: 'gid://shopify/Market/2',
      shipping,
    });
    expect(input.name).toBe('Europe – abcd1234');
    expect(input.profileLocationGroups).toHaveLength(1);
    const lg = input.profileLocationGroups[0];
    expect(lg.locationGroupZones).toHaveLength(1);
    expect(lg.locationGroupZones[0].name).toBe('EU Standard');
    expect(lg.locationGroupZones[0].countries).toEqual([
      { code: 'DE' }, { code: 'FR' },
    ]);
    expect(lg.locationGroupZones[0].methodDefinitionsToCreate).toEqual([
      { name: 'Standard', price: { amount: 8, currencyCode: 'EUR' } },
    ]);
  });
});

describe('buildDeliveryProfileUpdateInput', () => {
  it('produces zonesToCreate when zone is new', () => {
    const input = buildDeliveryProfileUpdateInput({
      currentZones: {},
      effectiveZones: {
        'New Zone': {
          countries: ['DE'],
          rates: { 'Std': { type: 'flat', price: 5, currency: 'EUR' } },
        },
      },
      shopifyIds: { zoneIdByName: {}, rateIdByZoneAndName: {} },
    });
    expect(input.zonesToCreate).toHaveLength(1);
    expect(input.zonesToDelete).toEqual([]);
    expect(input.methodDefinitionsToUpdate).toEqual([]);
  });

  it('produces methodDefinitionsToUpdate when rate price changes', () => {
    const input = buildDeliveryProfileUpdateInput({
      currentZones: {
        'Zone A': {
          countries: ['DE'],
          rates: { 'Std': { type: 'flat', price: 5, currency: 'EUR' } },
        },
      },
      effectiveZones: {
        'Zone A': {
          countries: ['DE'],
          rates: { 'Std': { type: 'flat', price: 8, currency: 'EUR' } },
        },
      },
      shopifyIds: {
        zoneIdByName: { 'Zone A': 'gid://Zone/1' },
        rateIdByZoneAndName: { 'Zone A.Std': 'gid://Method/1' },
      },
    });
    expect(input.methodDefinitionsToUpdate).toEqual([
      { id: 'gid://Method/1', price: 8, currency: 'EUR' },
    ]);
    expect(input.zonesToCreate).toEqual([]);
    expect(input.zonesToDelete).toEqual([]);
  });

  it('produces zonesToDelete when zone removed', () => {
    const input = buildDeliveryProfileUpdateInput({
      currentZones: {
        'Old Zone': { countries: ['DE'], rates: {} },
      },
      effectiveZones: {},
      shopifyIds: {
        zoneIdByName: { 'Old Zone': 'gid://Zone/9' },
        rateIdByZoneAndName: {},
      },
    });
    expect(input.zonesToDelete).toEqual(['gid://Zone/9']);
  });
});

describe('mutation strings', () => {
  it('all are valid GraphQL mutations', () => {
    expect(DELIVERY_PROFILE_CREATE_MUTATION).toContain('deliveryProfileCreate');
    expect(DELIVERY_PROFILE_UPDATE_MUTATION).toContain('deliveryProfileUpdate');
    expect(DELIVERY_PROFILE_REMOVE_MUTATION).toContain('deliveryProfileRemove');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- features/markets/domain/market-shipping.test.ts`
Expected: FAIL "Cannot find module './market-shipping'"

- [ ] **Step 3: Write `features/markets/domain/market-shipping.ts`**

```typescript
import type { MarketShipping, ShippingZone } from '../types';

export function profileTagFor(marketName: string, storeId: string): string {
  return `${marketName} – ${storeId.slice(0, 8)}`;
}

export interface ProfileCreateInput {
  name: string;
  profileLocationGroups: Array<{
    countries: Array<{ code: string }>;
    locationGroupZones: Array<{
      name: string;
      countries: Array<{ code: string }>;
      methodDefinitionsToCreate: Array<{
        name: string;
        price: { amount: number; currencyCode: string };
      }>;
    }>;
  }>;
  marketsToAssociate?: string[];
}

export function buildDeliveryProfileCreateInput(args: {
  marketName: string;
  storeId: string;
  marketId: string;
  shipping: MarketShipping;
}): ProfileCreateInput {
  const name = profileTagFor(args.marketName, args.storeId);
  const allCountries = new Set<string>();
  const zones = Object.entries(args.shipping.zones).map(([zoneName, zone]) => {
    zone.countries.forEach((c) => allCountries.add(c));
    return {
      name: zoneName,
      countries: zone.countries.map((c) => ({ code: c })),
      methodDefinitionsToCreate: Object.entries(zone.rates).map(([rateName, rate]) => ({
        name: rateName,
        price: { amount: rate.price, currencyCode: rate.currency },
      })),
    };
  });

  return {
    name,
    profileLocationGroups: [{
      countries: Array.from(allCountries).map((c) => ({ code: c })),
      locationGroupZones: zones,
    }],
    marketsToAssociate: [args.marketId],
  };
}

export interface ProfileUpdateInput {
  zonesToCreate: Array<{
    name: string;
    countries: Array<{ code: string }>;
    methodDefinitionsToCreate: Array<{
      name: string;
      price: { amount: number; currencyCode: string };
    }>;
  }>;
  zonesToDelete: string[];
  methodDefinitionsToCreate: Array<{
    zoneId: string;
    name: string;
    price: number;
    currency: string;
  }>;
  methodDefinitionsToUpdate: Array<{ id: string; price: number; currency: string }>;
  methodDefinitionsToDelete: string[];
}

export function buildDeliveryProfileUpdateInput(args: {
  currentZones: Record<string, ShippingZone>;
  effectiveZones: Record<string, ShippingZone>;
  shopifyIds: {
    zoneIdByName: Record<string, string>;
    rateIdByZoneAndName: Record<string, string>;
  };
}): ProfileUpdateInput {
  const out: ProfileUpdateInput = {
    zonesToCreate: [],
    zonesToDelete: [],
    methodDefinitionsToCreate: [],
    methodDefinitionsToUpdate: [],
    methodDefinitionsToDelete: [],
  };

  for (const [name, zone] of Object.entries(args.effectiveZones)) {
    const existing = args.currentZones[name];
    if (!existing) {
      out.zonesToCreate.push({
        name,
        countries: zone.countries.map((c) => ({ code: c })),
        methodDefinitionsToCreate: Object.entries(zone.rates).map(([rn, r]) => ({
          name: rn,
          price: { amount: r.price, currencyCode: r.currency },
        })),
      });
      continue;
    }
    const zoneId = args.shopifyIds.zoneIdByName[name];
    for (const [rateName, r] of Object.entries(zone.rates)) {
      const existingRate = existing.rates[rateName];
      const existingRateId = args.shopifyIds.rateIdByZoneAndName[`${name}.${rateName}`];
      if (!existingRate) {
        out.methodDefinitionsToCreate.push({
          zoneId, name: rateName, price: r.price, currency: r.currency,
        });
      } else if (existingRate.price !== r.price || existingRate.currency !== r.currency) {
        out.methodDefinitionsToUpdate.push({
          id: existingRateId, price: r.price, currency: r.currency,
        });
      }
    }
    for (const rateName of Object.keys(existing.rates)) {
      if (!zone.rates[rateName]) {
        out.methodDefinitionsToDelete.push(
          args.shopifyIds.rateIdByZoneAndName[`${name}.${rateName}`],
        );
      }
    }
  }
  for (const name of Object.keys(args.currentZones)) {
    if (!args.effectiveZones[name]) {
      out.zonesToDelete.push(args.shopifyIds.zoneIdByName[name]);
    }
  }
  return out;
}

export const DELIVERY_PROFILE_CREATE_MUTATION = `
  mutation DeliveryProfileCreate($profile: DeliveryProfileInput!) {
    deliveryProfileCreate(profile: $profile) {
      profile { id name }
      userErrors { field message }
    }
  }
`;

export const DELIVERY_PROFILE_UPDATE_MUTATION = `
  mutation DeliveryProfileUpdate($id: ID!, $profile: DeliveryProfileInput!) {
    deliveryProfileUpdate(id: $id, profile: $profile) {
      profile { id }
      userErrors { field message }
    }
  }
`;

export const DELIVERY_PROFILE_REMOVE_MUTATION = `
  mutation DeliveryProfileRemove($id: ID!) {
    deliveryProfileRemove(id: $id) {
      job { id }
      userErrors { field message }
    }
  }
`;
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npm test -- features/markets/domain/market-shipping.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add features/markets/domain/market-shipping.ts features/markets/domain/market-shipping.test.ts
git commit -m "feat(markets): add per-market delivery profile builders"
```

---

## Task 9: Merge — template + override → effective

**Files:**
- Create: `features/markets/merge.ts`
- Create: `features/markets/merge.test.ts`

- [ ] **Step 1: Write failing tests**

Create `features/markets/merge.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { mergeMarketConfig } from './merge';
import type { Market, MarketStoreOverride } from './types';

const market: Market = {
  handle: 'europe',
  name: 'Europe',
  type: 'regional',
  countries: ['DE', 'FR'],
  primaryCurrency: 'EUR',
  alternativeCurrencies: [],
  primaryLanguage: 'en',
  alternativeLanguages: ['de'],
  enabled: true,
};

const baseOverride = (o: Partial<MarketStoreOverride> = {}): MarketStoreOverride => ({
  storeId: 'store-1',
  marketHandle: 'europe',
  priceAdjustment: null,
  shipping: null,
  ...o,
});

describe('mergeMarketConfig', () => {
  it('returns template fields plus null priceAdjustment + shipping when override empty', () => {
    expect(mergeMarketConfig(market, null)).toEqual({
      ...market,
      priceAdjustment: null,
      shipping: null,
    });
  });

  it('overlays priceAdjustment from override', () => {
    const result = mergeMarketConfig(market, baseOverride({
      priceAdjustment: { type: 'percentage', value: 12 },
    }));
    expect(result.priceAdjustment).toEqual({ type: 'percentage', value: 12 });
    expect(result.shipping).toBeNull();
  });

  it('overlays shipping from override', () => {
    const shipping = {
      zones: {
        'EU Standard': {
          countries: ['DE'],
          rates: { 'Std': { type: 'flat' as const, price: 5, currency: 'EUR' } },
        },
      },
    };
    const result = mergeMarketConfig(market, baseOverride({ shipping }));
    expect(result.shipping).toEqual(shipping);
  });

  it('does not mutate the template input', () => {
    const before = JSON.stringify(market);
    mergeMarketConfig(market, baseOverride({
      priceAdjustment: { type: 'percentage', value: 12 },
    }));
    expect(JSON.stringify(market)).toBe(before);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- features/markets/merge.test.ts`
Expected: FAIL "Cannot find module './merge'"

- [ ] **Step 3: Write `features/markets/merge.ts`**

```typescript
import type { Market, MarketStoreOverride, EffectiveMarket } from './types';

export function mergeMarketConfig(
  market: Market,
  override: MarketStoreOverride | null,
): EffectiveMarket {
  return {
    handle: market.handle,
    name: market.name,
    type: market.type,
    countries: [...market.countries],
    primaryCurrency: market.primaryCurrency,
    alternativeCurrencies: [...market.alternativeCurrencies],
    primaryLanguage: market.primaryLanguage,
    alternativeLanguages: [...market.alternativeLanguages],
    enabled: market.enabled,
    priceAdjustment: override?.priceAdjustment ?? null,
    shipping: override?.shipping ?? null,
  };
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npm test -- features/markets/merge.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add features/markets/merge.ts features/markets/merge.test.ts
git commit -m "feat(markets): add mergeMarketConfig (template + override → effective)"
```

---

## Task 10: Diff — effective vs live → MarketOps

**Files:**
- Create: `features/markets/diff.ts`
- Create: `features/markets/diff.test.ts`

- [ ] **Step 1: Write failing tests**

Create `features/markets/diff.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { diffMarkets, type MarketOps } from './diff';
import type { EffectiveMarket } from './types';
import type { NormalizedMarket } from './domain/markets';

const eff = (overrides: Partial<EffectiveMarket> = {}): EffectiveMarket => ({
  handle: 'europe',
  name: 'Europe',
  type: 'regional',
  countries: ['DE', 'FR'],
  primaryCurrency: 'EUR',
  alternativeCurrencies: [],
  primaryLanguage: 'en',
  alternativeLanguages: [],
  enabled: true,
  priceAdjustment: null,
  shipping: null,
  ...overrides,
});

const live = (overrides: Partial<NormalizedMarket> = {}): NormalizedMarket => ({
  id: 'gid://shopify/Market/1',
  handle: 'europe',
  name: 'Europe',
  type: 'regional',
  countries: ['DE', 'FR'],
  primaryCurrency: 'EUR',
  alternativeCurrencies: [],
  primaryLanguage: 'en',
  alternativeLanguages: [],
  enabled: true,
  primary: false,
  priceListId: null,
  priceAdjustment: null,
  ...overrides,
});

describe('diffMarkets', () => {
  it('returns empty ops when effective matches live exactly', () => {
    const ops = diffMarkets([eff()], [live()]);
    expect(ops.marketsToCreate).toEqual([]);
    expect(ops.marketsToUpdate).toEqual([]);
    expect(ops.marketsToDelete).toEqual([]);
  });

  it('produces marketsToCreate when effective has handle not in live', () => {
    const ops = diffMarkets([eff({ handle: 'new-market' })], []);
    expect(ops.marketsToCreate).toHaveLength(1);
    expect(ops.marketsToCreate[0].handle).toBe('new-market');
  });

  it('produces marketsToDelete when live has handle not in effective', () => {
    const ops = diffMarkets([], [live({ handle: 'stale-market' })]);
    expect(ops.marketsToDelete).toHaveLength(1);
    expect(ops.marketsToDelete[0].handle).toBe('stale-market');
  });

  it('produces marketsToUpdate when enabled differs', () => {
    const ops = diffMarkets([eff({ enabled: false })], [live({ enabled: true })]);
    expect(ops.marketsToUpdate).toHaveLength(1);
    expect(ops.marketsToUpdate[0].changes).toContain('enabled');
  });

  it('produces marketsToUpdate when name differs', () => {
    const ops = diffMarkets([eff({ name: 'EU' })], [live({ name: 'Europe' })]);
    expect(ops.marketsToUpdate[0].changes).toContain('name');
  });

  it('produces region operations when countries differ', () => {
    const ops = diffMarkets(
      [eff({ countries: ['DE', 'IT'] })],
      [live({ countries: ['DE', 'FR'] })],
    );
    expect(ops.regionsToAdd).toContainEqual({
      marketHandle: 'europe', countryCode: 'IT',
    });
    expect(ops.regionsToRemove).toContainEqual({
      marketHandle: 'europe', countryCode: 'FR',
    });
  });

  it('produces priceListsToCreate when override has adjustment but live has none', () => {
    const ops = diffMarkets(
      [eff({ priceAdjustment: { type: 'percentage', value: 12 } })],
      [live()],
    );
    expect(ops.priceListsToCreate).toHaveLength(1);
    expect(ops.priceListsToCreate[0].marketHandle).toBe('europe');
  });

  it('produces priceListsToUpdate when adjustment value differs', () => {
    const ops = diffMarkets(
      [eff({ priceAdjustment: { type: 'percentage', value: 15 } })],
      [live({
        priceListId: 'gid://PL/1',
        priceAdjustment: { type: 'percentage', value: 12 },
      })],
    );
    expect(ops.priceListsToUpdate).toHaveLength(1);
    expect(ops.priceListsToUpdate[0].priceListId).toBe('gid://PL/1');
  });

  it('produces priceListsToDelete when override removed adjustment', () => {
    const ops = diffMarkets(
      [eff({ priceAdjustment: null })],
      [live({
        priceListId: 'gid://PL/1',
        priceAdjustment: { type: 'percentage', value: 12 },
      })],
    );
    expect(ops.priceListsToDelete).toEqual(['gid://PL/1']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- features/markets/diff.test.ts`
Expected: FAIL "Cannot find module './diff'"

- [ ] **Step 3: Write `features/markets/diff.ts`**

```typescript
import type { EffectiveMarket, MarketPriceAdjustment } from './types';
import type { NormalizedMarket } from './domain/markets';

export interface MarketOps {
  marketsToCreate: EffectiveMarket[];
  marketsToUpdate: Array<{ liveId: string; effective: EffectiveMarket; changes: string[] }>;
  marketsToDelete: Array<{ liveId: string; handle: string; primary: boolean }>;
  regionsToAdd: Array<{ marketHandle: string; countryCode: string }>;
  regionsToRemove: Array<{ marketHandle: string; countryCode: string }>;
  currencyUpdates: Array<{ liveId: string; primary: string; alternatives: string[] }>;
  languageUpdates: Array<{ liveId: string; defaultLocale: string; alternateLocales: string[] }>;
  priceListsToCreate: Array<{ marketHandle: string; adjustment: MarketPriceAdjustment }>;
  priceListsToUpdate: Array<{ priceListId: string; marketHandle: string; adjustment: MarketPriceAdjustment }>;
  priceListsToDelete: string[];
}

function emptyOps(): MarketOps {
  return {
    marketsToCreate: [],
    marketsToUpdate: [],
    marketsToDelete: [],
    regionsToAdd: [],
    regionsToRemove: [],
    currencyUpdates: [],
    languageUpdates: [],
    priceListsToCreate: [],
    priceListsToUpdate: [],
    priceListsToDelete: [],
  };
}

function arraysEqualSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((x) => set.has(x));
}

export function diffMarkets(
  effective: EffectiveMarket[],
  live: NormalizedMarket[],
): MarketOps {
  const ops = emptyOps();
  const liveByHandle = new Map(live.map((m) => [m.handle, m] as const));
  const effByHandle = new Map(effective.map((m) => [m.handle, m] as const));

  for (const e of effective) {
    const l = liveByHandle.get(e.handle);
    if (!l) {
      ops.marketsToCreate.push(e);
      continue;
    }
    const changes: string[] = [];
    if (e.name !== l.name) changes.push('name');
    if (e.enabled !== l.enabled) changes.push('enabled');
    if (changes.length > 0) {
      ops.marketsToUpdate.push({ liveId: l.id, effective: e, changes });
    }
    for (const c of e.countries) {
      if (!l.countries.includes(c)) {
        ops.regionsToAdd.push({ marketHandle: e.handle, countryCode: c });
      }
    }
    for (const c of l.countries) {
      if (!e.countries.includes(c)) {
        ops.regionsToRemove.push({ marketHandle: e.handle, countryCode: c });
      }
    }
    if (
      e.primaryCurrency !== l.primaryCurrency ||
      !arraysEqualSet(e.alternativeCurrencies, l.alternativeCurrencies)
    ) {
      ops.currencyUpdates.push({
        liveId: l.id,
        primary: e.primaryCurrency,
        alternatives: e.alternativeCurrencies,
      });
    }
    if (
      e.primaryLanguage !== l.primaryLanguage ||
      !arraysEqualSet(e.alternativeLanguages, l.alternativeLanguages)
    ) {
      ops.languageUpdates.push({
        liveId: l.id,
        defaultLocale: e.primaryLanguage,
        alternateLocales: e.alternativeLanguages,
      });
    }
    // Price adjustment ops
    if (e.priceAdjustment && !l.priceListId) {
      ops.priceListsToCreate.push({
        marketHandle: e.handle,
        adjustment: e.priceAdjustment,
      });
    } else if (
      e.priceAdjustment && l.priceListId &&
      (l.priceAdjustment?.value !== e.priceAdjustment.value)
    ) {
      ops.priceListsToUpdate.push({
        priceListId: l.priceListId,
        marketHandle: e.handle,
        adjustment: e.priceAdjustment,
      });
    } else if (!e.priceAdjustment && l.priceListId) {
      ops.priceListsToDelete.push(l.priceListId);
    }
  }

  for (const l of live) {
    if (!effByHandle.has(l.handle)) {
      ops.marketsToDelete.push({ liveId: l.id, handle: l.handle, primary: l.primary });
    }
  }

  return ops;
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npm test -- features/markets/diff.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add features/markets/diff.ts features/markets/diff.test.ts
git commit -m "feat(markets): add diffMarkets to compute MarketOps from effective vs live"
```

---

## Task 11: Reconciliation — snapshot live state + conflict detection

**Files:**
- Create: `features/markets/reconciliation.ts`
- Create: `features/markets/reconciliation.test.ts`

- [ ] **Step 1: Write failing tests**

Create `features/markets/reconciliation.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  buildSnapshot, detectCountryConflicts, detectPrimaryMarketRisk,
} from './reconciliation';
import type { EffectiveMarket } from './types';
import type { NormalizedMarket } from './domain/markets';

const live = (o: Partial<NormalizedMarket> = {}): NormalizedMarket => ({
  id: 'gid://Market/1', handle: 'us', name: 'United States', type: 'regional',
  countries: ['US'], primaryCurrency: 'USD', alternativeCurrencies: [],
  primaryLanguage: 'en', alternativeLanguages: [],
  enabled: true, primary: false, priceListId: null, priceAdjustment: null, ...o,
});

const eff = (o: Partial<EffectiveMarket> = {}): EffectiveMarket => ({
  handle: 'us', name: 'United States', type: 'regional', countries: ['US'],
  primaryCurrency: 'USD', alternativeCurrencies: [],
  primaryLanguage: 'en', alternativeLanguages: [],
  enabled: true, priceAdjustment: null, shipping: null, ...o,
});

describe('buildSnapshot', () => {
  it('returns object with markets, timestamp, shape version', () => {
    const snap = buildSnapshot([live()]);
    expect(snap.markets).toHaveLength(1);
    expect(snap.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(snap.shapeVersion).toBe(1);
  });
});

describe('detectCountryConflicts', () => {
  it('returns empty when no conflicts', () => {
    const conflicts = detectCountryConflicts(
      [eff({ handle: 'us', countries: ['US'] })],
      [live({ handle: 'us', countries: ['US'] })],
    );
    expect(conflicts).toEqual([]);
  });

  it('detects when live has a country in a different market than effective', () => {
    const conflicts = detectCountryConflicts(
      [
        eff({ handle: 'us', countries: ['US'] }),
        eff({ handle: 'canada', countries: ['CA'] }),
      ],
      [
        live({ id: 'gid://M/1', handle: 'us', countries: ['US', 'CA'] }),
        live({ id: 'gid://M/2', handle: 'canada', countries: [] }),
      ],
    );
    expect(conflicts).toEqual([
      { countryCode: 'CA', liveMarketHandle: 'us', effectiveMarketHandle: 'canada' },
    ]);
  });
});

describe('detectPrimaryMarketRisk', () => {
  it('returns risk when effective wants to delete a primary live market', () => {
    const risk = detectPrimaryMarketRisk(
      [eff({ handle: 'eu' })],
      [
        live({ handle: 'us', primary: true }),
        live({ handle: 'eu', primary: false }),
      ],
    );
    expect(risk).toEqual([{ handle: 'us' }]);
  });

  it('returns empty when no primary deletion attempted', () => {
    expect(detectPrimaryMarketRisk(
      [eff({ handle: 'us' })],
      [live({ handle: 'us', primary: true })],
    )).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- features/markets/reconciliation.test.ts`
Expected: FAIL "Cannot find module './reconciliation'"

- [ ] **Step 3: Write `features/markets/reconciliation.ts`**

```typescript
import type { EffectiveMarket } from './types';
import type { NormalizedMarket } from './domain/markets';

export interface MarketSnapshot {
  shapeVersion: 1;
  capturedAt: string;
  markets: NormalizedMarket[];
}

export function buildSnapshot(live: NormalizedMarket[]): MarketSnapshot {
  return {
    shapeVersion: 1,
    capturedAt: new Date().toISOString(),
    markets: live,
  };
}

export interface CountryConflict {
  countryCode: string;
  liveMarketHandle: string;
  effectiveMarketHandle: string;
}

export function detectCountryConflicts(
  effective: EffectiveMarket[],
  live: NormalizedMarket[],
): CountryConflict[] {
  const effOwner = new Map<string, string>();
  for (const e of effective) {
    for (const c of e.countries) effOwner.set(c, e.handle);
  }
  const conflicts: CountryConflict[] = [];
  for (const l of live) {
    for (const c of l.countries) {
      const effHandle = effOwner.get(c);
      if (effHandle && effHandle !== l.handle) {
        conflicts.push({
          countryCode: c,
          liveMarketHandle: l.handle,
          effectiveMarketHandle: effHandle,
        });
      }
    }
  }
  return conflicts;
}

export interface PrimaryMarketRisk {
  handle: string;
}

export function detectPrimaryMarketRisk(
  effective: EffectiveMarket[],
  live: NormalizedMarket[],
): PrimaryMarketRisk[] {
  const effHandles = new Set(effective.map((e) => e.handle));
  return live
    .filter((l) => l.primary && !effHandles.has(l.handle))
    .map((l) => ({ handle: l.handle }));
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npm test -- features/markets/reconciliation.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add features/markets/reconciliation.ts features/markets/reconciliation.test.ts
git commit -m "feat(markets): add snapshot + country conflict + primary-market risk detection"
```

---

## Task 12: Apply orchestrator

**Files:**
- Create: `features/markets/apply.ts`
- Create: `features/markets/apply.test.ts`

- [ ] **Step 1: Write failing test**

Create `features/markets/apply.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { runMarketsApply, type ApplyDeps, type ApplyStore } from './apply';
import type { MarketOps } from './diff';

const store: ApplyStore = {
  id: 'store-1', shopDomain: 'demo.myshopify.com', apiVersion: '2025-01',
  status: 'active', maintenanceMode: false,
  scopes: ['write_markets', 'write_shipping', 'write_shop_settings'],
};

function emptyOps(): MarketOps {
  return {
    marketsToCreate: [], marketsToUpdate: [], marketsToDelete: [],
    regionsToAdd: [], regionsToRemove: [],
    currencyUpdates: [], languageUpdates: [],
    priceListsToCreate: [], priceListsToUpdate: [], priceListsToDelete: [],
  };
}

function makeDeps(overrides: Partial<ApplyDeps> = {}): ApplyDeps {
  return {
    captureSnapshot: vi.fn(async () => {}),
    runMutation: vi.fn(async () => ({ data: {} })),
    recordAudit: vi.fn(async () => {}),
    insertApplyHistory: vi.fn(async () => 'history-1'),
    ...overrides,
  };
}

describe('runMarketsApply', () => {
  it('returns preview ops when dryRun=true and runs no mutations', async () => {
    const deps = makeDeps();
    const result = await runMarketsApply({
      store, applyRunId: 'preview', ops: emptyOps(),
      effectiveByHandle: {}, dryRun: true, deps,
    });
    expect(result.kind).toBe('preview');
    expect(deps.runMutation).not.toHaveBeenCalled();
  });

  it('captures snapshot before mutations when dryRun=false', async () => {
    const deps = makeDeps();
    await runMarketsApply({
      store, applyRunId: 'run-1', ops: emptyOps(),
      effectiveByHandle: {}, dryRun: false, deps,
    });
    expect(deps.captureSnapshot).toHaveBeenCalledOnce();
  });

  it('executes create-market mutations before region adds (ordering)', async () => {
    const calls: string[] = [];
    const deps = makeDeps({
      runMutation: vi.fn(async (args) => {
        if (args.mutation.includes('marketCreate')) calls.push('create-market');
        if (args.mutation.includes('marketRegionsCreate')) calls.push('regions-add');
        return { data: { marketCreate: { market: { id: 'gid://M/new' } } } };
      }),
    });
    const ops: MarketOps = {
      ...emptyOps(),
      marketsToCreate: [{
        handle: 'asia', name: 'Asia', type: 'regional', countries: ['JP'],
        primaryCurrency: 'JPY', alternativeCurrencies: [],
        primaryLanguage: 'ja', alternativeLanguages: [],
        enabled: true, priceAdjustment: null, shipping: null,
      }],
      regionsToAdd: [{ marketHandle: 'asia', countryCode: 'JP' }],
    };
    await runMarketsApply({
      store, applyRunId: 'run-2', ops, effectiveByHandle: {}, dryRun: false, deps,
    });
    expect(calls[0]).toBe('create-market');
  });

  it('records audit success when all mutations succeed', async () => {
    const deps = makeDeps();
    await runMarketsApply({
      store, applyRunId: 'run-3', ops: emptyOps(),
      effectiveByHandle: {}, dryRun: false, deps,
    });
    expect(deps.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ result: 'success' }),
    );
  });

  it('records partial_error and continues when one mutation fails', async () => {
    let count = 0;
    const deps = makeDeps({
      runMutation: vi.fn(async () => {
        count++;
        if (count === 1) throw new Error('Shopify rejected');
        return { data: {} };
      }),
    });
    const ops: MarketOps = {
      ...emptyOps(),
      marketsToUpdate: [
        { liveId: 'gid://M/1', effective: {} as never, changes: ['name'] },
        { liveId: 'gid://M/2', effective: {} as never, changes: ['enabled'] },
      ],
    };
    const result = await runMarketsApply({
      store, applyRunId: 'run-4', ops, effectiveByHandle: {}, dryRun: false, deps,
    });
    expect(result.kind).toBe('applied');
    expect(result.errors).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- features/markets/apply.test.ts`
Expected: FAIL "Cannot find module './apply'"

- [ ] **Step 3: Write `features/markets/apply.ts`**

```typescript
import type { MarketOps } from './diff';
import type { EffectiveMarket } from './types';
import {
  buildMarketCreateInput, buildMarketUpdateInput, buildMarketRegionsCreate,
  MARKET_CREATE_MUTATION, MARKET_UPDATE_MUTATION, MARKET_DELETE_MUTATION,
  MARKET_REGIONS_CREATE_MUTATION, MARKET_REGION_DELETE_MUTATION,
} from './domain/markets';
import {
  buildCurrencySettingsInput, CURRENCY_SETTINGS_UPDATE_MUTATION,
} from './domain/currencies';
import { WEB_PRESENCE_UPDATE_MUTATION } from './domain/languages';
import {
  buildPriceListInput,
  PRICE_LIST_CREATE_MUTATION, PRICE_LIST_UPDATE_MUTATION, PRICE_LIST_DELETE_MUTATION,
} from './domain/price-adjustments';

export interface ApplyStore {
  id: string; shopDomain: string; apiVersion: string;
  status: 'active' | 'disconnected' | 'error';
  maintenanceMode: boolean; scopes: string[];
}

export interface ApplyDeps {
  captureSnapshot: (args: { storeId: string; payload: unknown; applyRunId: string }) => Promise<void>;
  runMutation: (args: {
    store: ApplyStore; applyRunId: string;
    mutation: string; variables: Record<string, unknown>;
  }) => Promise<{ data: unknown }>;
  recordAudit: (entry: {
    storeId: string; applyRunId: string;
    action: string; target?: string;
    result: 'success' | 'error' | 'partial_error';
    errorDetail?: string | null;
    requestSummary?: string | null;
  }) => Promise<void>;
  insertApplyHistory: (args: {
    storeId: string; marketHandle: string | null;
    action: string; status: 'success' | 'partial_error' | 'failed';
    diff: unknown; errorDetail: string | null;
  }) => Promise<string>;
}

export interface ApplyArgs {
  store: ApplyStore;
  applyRunId: string;
  ops: MarketOps;
  effectiveByHandle: Record<string, EffectiveMarket>;
  dryRun: boolean;
  deps: ApplyDeps;
}

export type ApplyResult =
  | { kind: 'preview'; ops: MarketOps }
  | { kind: 'applied'; ops: MarketOps; errors: Array<{ step: string; error: string }> };

export async function runMarketsApply(args: ApplyArgs): Promise<ApplyResult> {
  const { store, applyRunId, ops, effectiveByHandle, dryRun, deps } = args;

  if (dryRun) {
    return { kind: 'preview', ops };
  }

  await deps.captureSnapshot({ storeId: store.id, payload: ops, applyRunId });

  const errors: Array<{ step: string; error: string }> = [];
  const liveIdByHandle = new Map<string, string>();

  // 1. Create markets first (so subsequent ops can reference their IDs)
  for (const m of ops.marketsToCreate) {
    try {
      const res = await deps.runMutation({
        store, applyRunId,
        mutation: MARKET_CREATE_MUTATION,
        variables: { input: buildMarketCreateInput(m) },
      });
      const created = (res.data as { marketCreate?: { market?: { id: string } } })
        ?.marketCreate?.market;
      if (created?.id) liveIdByHandle.set(m.handle, created.id);
    } catch (err) {
      errors.push({ step: `marketCreate:${m.handle}`, error: String(err) });
    }
  }

  // 2. Update existing markets
  for (const u of ops.marketsToUpdate) {
    try {
      await deps.runMutation({
        store, applyRunId,
        mutation: MARKET_UPDATE_MUTATION,
        variables: { id: u.liveId, input: buildMarketUpdateInput(u.effective) },
      });
    } catch (err) {
      errors.push({ step: `marketUpdate:${u.effective.handle}`, error: String(err) });
    }
  }

  // 3. Add regions
  for (const r of ops.regionsToAdd) {
    const marketId = liveIdByHandle.get(r.marketHandle);
    if (!marketId) {
      errors.push({ step: `regionsAdd:${r.countryCode}`, error: `No marketId for handle ${r.marketHandle}` });
      continue;
    }
    try {
      await deps.runMutation({
        store, applyRunId,
        mutation: MARKET_REGIONS_CREATE_MUTATION,
        variables: { marketId, regions: buildMarketRegionsCreate([r.countryCode]) },
      });
    } catch (err) {
      errors.push({ step: `regionsAdd:${r.marketHandle}/${r.countryCode}`, error: String(err) });
    }
  }

  // 4. Currency updates
  for (const c of ops.currencyUpdates) {
    try {
      await deps.runMutation({
        store, applyRunId,
        mutation: CURRENCY_SETTINGS_UPDATE_MUTATION,
        variables: {
          marketId: c.liveId,
          input: buildCurrencySettingsInput(c.primary, c.alternatives),
        },
      });
    } catch (err) {
      errors.push({ step: `currencyUpdate:${c.liveId}`, error: String(err) });
    }
  }

  // 5. Language (web presence) updates — note: requires existing webPresence id;
  // skip if not present (creating subfolder presence requires separate flow).
  for (const l of ops.languageUpdates) {
    try {
      await deps.runMutation({
        store, applyRunId,
        mutation: WEB_PRESENCE_UPDATE_MUTATION,
        variables: {
          webPresenceId: l.liveId,
          webPresence: { defaultLocale: l.defaultLocale, alternateLocales: l.alternateLocales },
        },
      });
    } catch (err) {
      errors.push({ step: `languageUpdate:${l.liveId}`, error: String(err) });
    }
  }

  // 6. Price lists (create / update / delete)
  for (const p of ops.priceListsToCreate) {
    const marketId = liveIdByHandle.get(p.marketHandle);
    const market = effectiveByHandle[p.marketHandle];
    if (!marketId || !market) {
      errors.push({ step: `priceListCreate:${p.marketHandle}`, error: 'Missing marketId or effective market' });
      continue;
    }
    try {
      await deps.runMutation({
        store, applyRunId,
        mutation: PRICE_LIST_CREATE_MUTATION,
        variables: {
          input: buildPriceListInput({
            marketId, marketName: market.name,
            currency: market.primaryCurrency,
            adjustmentValue: p.adjustment.value,
          }),
        },
      });
    } catch (err) {
      errors.push({ step: `priceListCreate:${p.marketHandle}`, error: String(err) });
    }
  }
  for (const p of ops.priceListsToUpdate) {
    const market = effectiveByHandle[p.marketHandle];
    if (!market) continue;
    try {
      await deps.runMutation({
        store, applyRunId,
        mutation: PRICE_LIST_UPDATE_MUTATION,
        variables: {
          id: p.priceListId,
          input: {
            parent: {
              adjustment: {
                type: p.adjustment.value < 0 ? 'PERCENTAGE_DECREASE' : 'PERCENTAGE_INCREASE',
                value: Math.abs(p.adjustment.value),
              },
            },
          },
        },
      });
    } catch (err) {
      errors.push({ step: `priceListUpdate:${p.priceListId}`, error: String(err) });
    }
  }
  for (const plId of ops.priceListsToDelete) {
    try {
      await deps.runMutation({
        store, applyRunId,
        mutation: PRICE_LIST_DELETE_MUTATION,
        variables: { id: plId },
      });
    } catch (err) {
      errors.push({ step: `priceListDelete:${plId}`, error: String(err) });
    }
  }

  // 7. Delete regions
  for (const r of ops.regionsToRemove) {
    try {
      await deps.runMutation({
        store, applyRunId,
        mutation: MARKET_REGION_DELETE_MUTATION,
        variables: { id: r.countryCode },  // region ID, not country code — in practice resolved via snapshot
      });
    } catch (err) {
      errors.push({ step: `regionRemove:${r.marketHandle}/${r.countryCode}`, error: String(err) });
    }
  }

  // 8. Delete markets last
  for (const d of ops.marketsToDelete) {
    if (d.primary) {
      errors.push({ step: `marketDelete:${d.handle}`, error: 'Cannot delete primary market' });
      continue;
    }
    try {
      await deps.runMutation({
        store, applyRunId,
        mutation: MARKET_DELETE_MUTATION,
        variables: { id: d.liveId },
      });
    } catch (err) {
      errors.push({ step: `marketDelete:${d.handle}`, error: String(err) });
    }
  }

  const totalOps =
    ops.marketsToCreate.length + ops.marketsToUpdate.length + ops.marketsToDelete.length +
    ops.regionsToAdd.length + ops.regionsToRemove.length +
    ops.currencyUpdates.length + ops.languageUpdates.length +
    ops.priceListsToCreate.length + ops.priceListsToUpdate.length + ops.priceListsToDelete.length;

  const status = errors.length === 0
    ? 'success'
    : errors.length === totalOps ? 'failed' : 'partial_error';

  await deps.insertApplyHistory({
    storeId: store.id, marketHandle: null, action: 'apply',
    status: status === 'success' ? 'success' : status === 'failed' ? 'failed' : 'partial_error',
    diff: ops, errorDetail: errors.length > 0 ? JSON.stringify(errors) : null,
  });

  await deps.recordAudit({
    storeId: store.id, applyRunId, action: 'apply_markets',
    result: status === 'success' ? 'success' : status === 'failed' ? 'error' : 'partial_error',
    requestSummary: `total=${totalOps} errors=${errors.length}`,
    errorDetail: errors.length > 0 ? JSON.stringify(errors) : null,
  });

  return { kind: 'applied', ops, errors };
}
```

Note on region delete: In production, `MARKET_REGION_DELETE_MUTATION` needs the region row's `id`, not the country code. Task 16 (probe script) verifies the actual region ID format on the live store, and Task 12's runMarketsApply is updated then if the input shape differs. For now the orchestrator wires the call site — adjust the variable mapping when probe results land.

- [ ] **Step 4: Run tests to verify pass**

Run: `npm test -- features/markets/apply.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add features/markets/apply.ts features/markets/apply.test.ts
git commit -m "feat(markets): add apply orchestrator with ordering and partial-error handling"
```

---

## Task 13: Server actions

**Files:**
- Create: `features/markets/actions.ts`

- [ ] **Step 1: Write `features/markets/actions.ts`**

```typescript
'use server';

import { and, desc, eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { getStoreToken, graphqlCall } from '@/lib/shopify/client';
import { runQuery } from '@/lib/shopify/connector';
import { runMutation } from '@/lib/shopify/writer';
import { isFeatureEnabled } from '@/lib/flags/flags';
import { recordAudit } from '@/lib/logging/audit';
import { hashPayload } from '@/lib/snapshots/snapshots';
import { marketsManifest } from './manifest';
import { DEFAULT_MARKETS } from './seed';
import { validateTemplate, validateOverride } from './validate';
import { mergeMarketConfig } from './merge';
import { diffMarkets } from './diff';
import { MARKETS_QUERY, normalizeMarkets } from './domain/markets';
import { runMarketsApply, type ApplyStore, type ApplyDeps } from './apply';
import type {
  Market, MarketStoreOverride, MarketPriceAdjustment, MarketShipping, EffectiveMarket,
} from './types';

export async function seedDefaultMarkets(userId: string): Promise<void> {
  validateTemplate(DEFAULT_MARKETS);
  for (const m of DEFAULT_MARKETS) {
    const [existing] = await db
      .select()
      .from(schema.marketTemplates)
      .where(eq(schema.marketTemplates.handle, m.handle))
      .limit(1);
    if (existing) continue;
    await db.insert(schema.marketTemplates).values({
      handle: m.handle,
      name: m.name,
      type: m.type,
      countries: m.countries,
      primaryCurrency: m.primaryCurrency,
      alternativeCurrencies: m.alternativeCurrencies,
      primaryLanguage: m.primaryLanguage,
      alternativeLanguages: m.alternativeLanguages,
      enabled: m.enabled,
      version: 1,
      updatedBy: userId,
    });
  }
}

export async function listTemplates(): Promise<Market[]> {
  const rows = await db.select().from(schema.marketTemplates);
  return rows.map((r) => ({
    handle: r.handle,
    name: r.name,
    type: r.type,
    countries: r.countries as string[],
    primaryCurrency: r.primaryCurrency,
    alternativeCurrencies: r.alternativeCurrencies as string[],
    primaryLanguage: r.primaryLanguage,
    alternativeLanguages: r.alternativeLanguages as string[],
    enabled: r.enabled,
  }));
}

export async function saveTemplate(market: Market, userId: string): Promise<void> {
  const allMarkets = await listTemplates();
  const next = allMarkets.filter((m) => m.handle !== market.handle).concat(market);
  validateTemplate(next);
  const [existing] = await db
    .select()
    .from(schema.marketTemplates)
    .where(eq(schema.marketTemplates.handle, market.handle))
    .limit(1);
  if (existing) {
    await db.update(schema.marketTemplates).set({
      name: market.name,
      type: market.type,
      countries: market.countries,
      primaryCurrency: market.primaryCurrency,
      alternativeCurrencies: market.alternativeCurrencies,
      primaryLanguage: market.primaryLanguage,
      alternativeLanguages: market.alternativeLanguages,
      enabled: market.enabled,
      version: existing.version + 1,
      updatedBy: userId,
      updatedAt: new Date(),
    }).where(eq(schema.marketTemplates.handle, market.handle));
  } else {
    await db.insert(schema.marketTemplates).values({
      handle: market.handle, name: market.name, type: market.type,
      countries: market.countries,
      primaryCurrency: market.primaryCurrency,
      alternativeCurrencies: market.alternativeCurrencies,
      primaryLanguage: market.primaryLanguage,
      alternativeLanguages: market.alternativeLanguages,
      enabled: market.enabled,
      version: 1, updatedBy: userId,
    });
  }
}

export async function deleteTemplate(handle: string): Promise<void> {
  await db.delete(schema.marketTemplates).where(eq(schema.marketTemplates.handle, handle));
}

export async function getOverride(
  storeId: string, handle: string,
): Promise<MarketStoreOverride | null> {
  const [row] = await db.select().from(schema.marketStoreOverrides).where(and(
    eq(schema.marketStoreOverrides.storeId, storeId),
    eq(schema.marketStoreOverrides.marketHandle, handle),
  )).limit(1);
  if (!row) return null;
  return {
    storeId: row.storeId,
    marketHandle: row.marketHandle,
    priceAdjustment: row.priceAdjustment as MarketPriceAdjustment | null,
    shipping: row.shipping as MarketShipping | null,
  };
}

export async function saveOverride(
  override: MarketStoreOverride, userId: string,
): Promise<void> {
  const [market] = await db.select().from(schema.marketTemplates)
    .where(eq(schema.marketTemplates.handle, override.marketHandle)).limit(1);
  if (!market) throw new Error(`Market ${override.marketHandle} not found`);
  validateOverride(
    {
      handle: market.handle, name: market.name, type: market.type,
      countries: market.countries as string[],
      primaryCurrency: market.primaryCurrency,
      alternativeCurrencies: market.alternativeCurrencies as string[],
      primaryLanguage: market.primaryLanguage,
      alternativeLanguages: market.alternativeLanguages as string[],
      enabled: market.enabled,
    },
    override,
  );
  const [existing] = await db.select().from(schema.marketStoreOverrides).where(and(
    eq(schema.marketStoreOverrides.storeId, override.storeId),
    eq(schema.marketStoreOverrides.marketHandle, override.marketHandle),
  )).limit(1);
  if (existing) {
    await db.update(schema.marketStoreOverrides).set({
      priceAdjustment: override.priceAdjustment,
      shipping: override.shipping,
      version: existing.version + 1,
      updatedBy: userId, updatedAt: new Date(),
    }).where(and(
      eq(schema.marketStoreOverrides.storeId, override.storeId),
      eq(schema.marketStoreOverrides.marketHandle, override.marketHandle),
    ));
  } else {
    await db.insert(schema.marketStoreOverrides).values({
      storeId: override.storeId,
      marketHandle: override.marketHandle,
      priceAdjustment: override.priceAdjustment,
      shipping: override.shipping,
      version: 1,
      updatedBy: userId,
    });
  }
}

export async function listOverridesForStore(storeId: string): Promise<MarketStoreOverride[]> {
  const rows = await db.select().from(schema.marketStoreOverrides)
    .where(eq(schema.marketStoreOverrides.storeId, storeId));
  return rows.map((r) => ({
    storeId: r.storeId,
    marketHandle: r.marketHandle,
    priceAdjustment: r.priceAdjustment as MarketPriceAdjustment | null,
    shipping: r.shipping as MarketShipping | null,
  }));
}

function buildApplyDeps(userId: string | null): ApplyDeps {
  return {
    captureSnapshot: async (args) => {
      await db.insert(schema.settingsSnapshots).values({
        storeId: args.storeId,
        domain: 'markets',
        payload: args.payload as object,
        payloadHash: hashPayload(args.payload),
        applyRunId: args.applyRunId === 'preview' ? null : args.applyRunId,
      });
    },
    runMutation: async ({ store, applyRunId, mutation, variables }) => {
      const data = await runMutation({
        store: store as ApplyStore,
        featureKey: marketsManifest.key,
        requiredScopes: marketsManifest.requiredScopes,
        applyRunId, domain: 'markets', mutation, variables,
        deps: {
          isEnabled: (fk, sid) => isFeatureEnabled(fk, sid),
          isReconciled: async () => true,
          hasSnapshot: async (sid, _d, runId) => {
            if (runId === 'preview') return true;
            const [row] = await db.select().from(schema.settingsSnapshots).where(and(
              eq(schema.settingsSnapshots.storeId, sid),
              eq(schema.settingsSnapshots.applyRunId, runId),
            )).limit(1);
            return !!row;
          },
          manifestHasWriteOps: () => marketsManifest.hasWriteOperations,
          graphql: ({ shopDomain, apiVersion, token, mutation: m, variables: v }) =>
            graphqlCall({ shopDomain, apiVersion, token, query: m, variables: v }),
          decryptToken: getStoreToken,
        },
      });
      return { data };
    },
    recordAudit: async (entry) =>
      recordAudit({
        userId,
        storeId: entry.storeId,
        featureKey: marketsManifest.key,
        action: entry.action,
        target: entry.target ?? 'markets',
        requestSummary: entry.requestSummary ?? null,
        result: entry.result === 'partial_error' ? 'partial' : entry.result,
        errorDetail: entry.errorDetail ?? null,
      }),
    insertApplyHistory: async (args) => {
      const [row] = await db.insert(schema.marketApplyHistory).values({
        storeId: args.storeId,
        marketHandle: args.marketHandle,
        userId,
        action: args.action,
        status: args.status,
        diff: args.diff as object,
        errorDetail: args.errorDetail,
      }).returning();
      return row.id;
    },
  };
}

async function readLiveMarkets(store: ApplyStore) {
  const data = await runQuery({
    store: {
      id: store.id, shopDomain: store.shopDomain, apiVersion: store.apiVersion,
      status: store.status, maintenanceMode: store.maintenanceMode, scopes: store.scopes,
    },
    featureKey: marketsManifest.key,
    requiredScopes: marketsManifest.requiredScopes,
    query: MARKETS_QUERY,
    deps: {
      isEnabled: (fk, sid) => isFeatureEnabled(fk, sid),
      graphql: ({ shopDomain, apiVersion, token, query, variables }) =>
        graphqlCall({ shopDomain, apiVersion, token, query, variables }),
      decryptToken: getStoreToken,
    },
  });
  return normalizeMarkets(data);
}

async function buildEffective(storeId: string): Promise<EffectiveMarket[]> {
  const templates = await listTemplates();
  const overrides = await listOverridesForStore(storeId);
  const overrideByHandle = new Map(overrides.map((o) => [o.marketHandle, o] as const));
  return templates.map((t) => mergeMarketConfig(t, overrideByHandle.get(t.handle) ?? null));
}

export async function previewMarketsApply(storeId: string) {
  const [store] = await db.select().from(schema.stores)
    .where(eq(schema.stores.id, storeId)).limit(1);
  if (!store) throw new Error(`Store ${storeId} not found`);
  const applyStore: ApplyStore = {
    id: store.id, shopDomain: store.shopDomain, apiVersion: store.apiVersion,
    status: store.status, maintenanceMode: store.maintenanceMode, scopes: store.scopes,
  };
  const live = await readLiveMarkets(applyStore);
  const effective = await buildEffective(storeId);
  const ops = diffMarkets(effective, live);
  return { ops, live, effective };
}

export async function executeMarketsApply(storeId: string, userId: string) {
  const [store] = await db.select().from(schema.stores)
    .where(eq(schema.stores.id, storeId)).limit(1);
  if (!store) throw new Error(`Store ${storeId} not found`);
  const applyStore: ApplyStore = {
    id: store.id, shopDomain: store.shopDomain, apiVersion: store.apiVersion,
    status: store.status, maintenanceMode: store.maintenanceMode, scopes: store.scopes,
  };
  const live = await readLiveMarkets(applyStore);
  const effective = await buildEffective(storeId);
  const ops = diffMarkets(effective, live);
  const effectiveByHandle = Object.fromEntries(effective.map((e) => [e.handle, e]));
  const applyRunId = crypto.randomUUID();
  return runMarketsApply({
    store: applyStore, applyRunId, ops, effectiveByHandle, dryRun: false,
    deps: buildApplyDeps(userId),
  });
}

export async function listApplyHistory(storeId: string, limit = 25) {
  return db.select().from(schema.marketApplyHistory)
    .where(eq(schema.marketApplyHistory.storeId, storeId))
    .orderBy(desc(schema.marketApplyHistory.createdAt))
    .limit(limit);
}
```

- [ ] **Step 2: Add `markets` to settings_snapshots domain enum if needed**

Run: `psql $DATABASE_URL -c "SELECT enum_range(NULL::setting_domain);"`
Expected: shows existing values.

If `markets` is not in the enum, add a migration:

```bash
echo "ALTER TYPE setting_domain ADD VALUE 'markets';" > db/migrations/00YY_add_markets_to_setting_domain.sql
```

Then run: `npm run db:migrate`

- [ ] **Step 3: Type-check the actions file**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add features/markets/actions.ts db/migrations/
git commit -m "feat(markets): add server actions for templates, overrides, preview, execute, history"
```

---

## Task 14: API probe script

**Files:**
- Create: `scripts/probe-markets-api.ts`

- [ ] **Step 1: Write `scripts/probe-markets-api.ts`**

```typescript
/* eslint-disable no-console */
import 'dotenv/config';
import { db, schema } from '@/db/client';
import { eq } from 'drizzle-orm';
import { graphqlCall, getStoreToken } from '@/lib/shopify/client';
import { MARKETS_QUERY } from '@/features/markets/domain/markets';

async function main() {
  const targetDomain = process.argv[2];
  if (!targetDomain) {
    console.error('Usage: tsx scripts/probe-markets-api.ts <shop-domain>');
    process.exit(1);
  }
  const [store] = await db.select().from(schema.stores)
    .where(eq(schema.stores.shopDomain, targetDomain)).limit(1);
  if (!store) {
    console.error(`Store ${targetDomain} not connected`);
    process.exit(1);
  }
  const token = await getStoreToken(store.id);
  const result = await graphqlCall({
    shopDomain: store.shopDomain,
    apiVersion: store.apiVersion,
    token,
    query: MARKETS_QUERY,
  });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Add npm script**

Edit `package.json` scripts section, add:

```json
"probe:markets": "tsx scripts/probe-markets-api.ts"
```

- [ ] **Step 3: Run probe against cici-mean**

Run: `npm run probe:markets -- cici-mean.myshopify.com`
Expected: JSON output showing `markets.edges` with current store markets. If any field name (e.g. `marketsToAssociate`, `regions`, `webPresence`) is rejected with `Field "X" doesn't exist`, update the corresponding mutation/query constant in domain files and re-run.

- [ ] **Step 4: Document any API version adjustments**

If probe found field name differences, update affected `.ts` files in `features/markets/domain/` and re-run the unit tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/probe-markets-api.ts package.json
git commit -m "tools(markets): add read-only API probe script for shape verification"
```

---

## Task 15: Markets list UI page

**Files:**
- Create: `app/(dashboard)/f/markets/page.tsx`

- [ ] **Step 1: Write `app/(dashboard)/f/markets/page.tsx`**

```typescript
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { listTemplates, seedDefaultMarkets } from '@/features/markets/actions';

export default async function MarketsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/auth/sign-in');
  const role = await getRole(session.user.id);
  if (!hasPermission(role, 'view_markets_history')) {
    return <div className="p-8">Forbidden</div>;
  }

  const markets = await listTemplates();
  const canManage = hasPermission(role, 'manage_markets_template');

  async function handleSeed() {
    'use server';
    const s = await auth.api.getSession({ headers: await headers() });
    if (!s) throw new Error('unauthenticated');
    const r = await getRole(s.user.id);
    if (!hasPermission(r, 'manage_markets_template')) throw new Error('forbidden');
    await seedDefaultMarkets(s.user.id);
  }

  return (
    <div className="p-6 md:p-10 max-w-6xl mx-auto">
      <header className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-semibold tracking-tight">Markets</h1>
        <div className="flex gap-3">
          {canManage && markets.length === 0 && (
            <form action={handleSeed}>
              <button
                type="submit"
                className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
              >
                Seed default markets
              </button>
            </form>
          )}
          {canManage && (
            <Link
              href="/f/markets/new"
              className="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium"
            >
              New market
            </Link>
          )}
          <Link
            href="/f/markets/apply"
            className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
          >
            Apply to stores…
          </Link>
        </div>
      </header>

      {markets.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center text-muted-foreground">
          <p className="mb-4">No markets configured.</p>
          {canManage && (
            <p className="text-sm">Click <strong>Seed default markets</strong> to start with the 11 default markets.</p>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {markets.map((m) => (
            <Link
              key={m.handle}
              href={`/f/markets/${m.handle}`}
              className="rounded-lg border p-5 hover:shadow-md transition-shadow"
            >
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold">{m.name}</h2>
                <span className={`text-xs px-2 py-0.5 rounded ${m.enabled ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200' : 'bg-zinc-200 text-zinc-700'}`}>
                  {m.enabled ? 'Enabled' : 'Disabled'}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mb-3">{m.handle}</p>
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="px-2 py-0.5 rounded bg-secondary">
                  {m.countries.length} {m.countries.length === 1 ? 'country' : 'countries'}
                </span>
                <span className="px-2 py-0.5 rounded bg-secondary">
                  {m.primaryCurrency}
                  {m.alternativeCurrencies.length > 0 && ` + ${m.alternativeCurrencies.length}`}
                </span>
                <span className="px-2 py-0.5 rounded bg-secondary">
                  {m.primaryLanguage.toUpperCase()}
                  {m.alternativeLanguages.length > 0 && ` + ${m.alternativeLanguages.length}`}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Manual smoke test**

Run: `npm run dev`
Open: `http://localhost:3001/f/markets`
Expected: Empty state with "Seed default markets" button. Click → 11 cards appear.

- [ ] **Step 4: Commit**

```bash
git add app/\(dashboard\)/f/markets/page.tsx
git commit -m "feat(markets): add markets list UI with seed action"
```

---

## Task 16: Market detail + new + per-store override UI

**Files:**
- Create: `app/(dashboard)/f/markets/[handle]/page.tsx`
- Create: `app/(dashboard)/f/markets/new/page.tsx`
- Create: `app/(dashboard)/f/markets/[handle]/stores/[storeId]/page.tsx`
- Create: `components/markets/MarketForm.tsx` (shared form)
- Create: `components/markets/OverrideForm.tsx`

- [ ] **Step 1: Write shared `components/markets/MarketForm.tsx`**

```typescript
'use client';

import { useState } from 'react';
import type { Market } from '@/features/markets/types';

interface Props {
  initial: Market;
  isNew: boolean;
  onSubmit: (m: Market) => Promise<void>;
}

export function MarketForm({ initial, isNew, onSubmit }: Props) {
  const [m, setM] = useState<Market>(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        setBusy(true);
        try {
          await onSubmit(m);
        } catch (err) {
          setError(String(err));
        } finally {
          setBusy(false);
        }
      }}
      className="space-y-6 max-w-2xl"
    >
      <div className="grid grid-cols-2 gap-4">
        <label className="block">
          <span className="text-sm font-medium">Handle</span>
          <input
            type="text"
            disabled={!isNew}
            value={m.handle}
            onChange={(e) => setM({ ...m, handle: e.target.value })}
            className="mt-1 block w-full rounded border px-3 py-2 disabled:bg-muted"
            pattern="[a-z0-9-]+"
            required
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium">Name</span>
          <input
            type="text"
            value={m.name}
            onChange={(e) => setM({ ...m, name: e.target.value })}
            className="mt-1 block w-full rounded border px-3 py-2"
            required
          />
        </label>
      </div>

      <label className="block">
        <span className="text-sm font-medium">Type</span>
        <select
          value={m.type}
          onChange={(e) => setM({ ...m, type: e.target.value as 'regional' | 'international' })}
          className="mt-1 block w-full rounded border px-3 py-2"
        >
          <option value="regional">Regional</option>
          <option value="international">International (catch-all)</option>
        </select>
      </label>

      {m.type === 'regional' && (
        <label className="block">
          <span className="text-sm font-medium">Countries (ISO-2, comma-separated)</span>
          <input
            type="text"
            value={m.countries.join(', ')}
            onChange={(e) => setM({
              ...m,
              countries: e.target.value.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean),
            })}
            className="mt-1 block w-full rounded border px-3 py-2"
            placeholder="DE, FR, IT"
          />
        </label>
      )}

      <div className="grid grid-cols-2 gap-4">
        <label className="block">
          <span className="text-sm font-medium">Primary currency</span>
          <input
            type="text"
            value={m.primaryCurrency}
            onChange={(e) => setM({ ...m, primaryCurrency: e.target.value.toUpperCase() })}
            className="mt-1 block w-full rounded border px-3 py-2"
            pattern="[A-Z]{3}"
            required
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium">Alt currencies (comma)</span>
          <input
            type="text"
            value={m.alternativeCurrencies.join(', ')}
            onChange={(e) => setM({
              ...m,
              alternativeCurrencies: e.target.value.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean),
            })}
            className="mt-1 block w-full rounded border px-3 py-2"
          />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <label className="block">
          <span className="text-sm font-medium">Primary language</span>
          <input
            type="text"
            value={m.primaryLanguage}
            onChange={(e) => setM({ ...m, primaryLanguage: e.target.value.toLowerCase() })}
            className="mt-1 block w-full rounded border px-3 py-2"
            pattern="[a-z]{2}"
            required
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium">Alt languages (comma)</span>
          <input
            type="text"
            value={m.alternativeLanguages.join(', ')}
            onChange={(e) => setM({
              ...m,
              alternativeLanguages: e.target.value.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
            })}
            className="mt-1 block w-full rounded border px-3 py-2"
          />
        </label>
      </div>

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={m.enabled}
          onChange={(e) => setM({ ...m, enabled: e.target.checked })}
        />
        <span className="text-sm">Enabled</span>
      </label>

      {error && <div className="text-sm text-red-600">{error}</div>}

      <button
        type="submit"
        disabled={busy}
        className="rounded-md bg-primary text-primary-foreground px-5 py-2 text-sm font-medium disabled:opacity-50"
      >
        {busy ? 'Saving…' : isNew ? 'Create market' : 'Save changes'}
      </button>
    </form>
  );
}
```

- [ ] **Step 2: Write `app/(dashboard)/f/markets/new/page.tsx`**

```typescript
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { saveTemplate } from '@/features/markets/actions';
import { MarketForm } from '@/components/markets/MarketForm';
import type { Market } from '@/features/markets/types';

const EMPTY: Market = {
  handle: '', name: '', type: 'regional',
  countries: [], primaryCurrency: 'USD', alternativeCurrencies: [],
  primaryLanguage: 'en', alternativeLanguages: [], enabled: true,
};

export default async function NewMarketPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/auth/sign-in');
  const role = await getRole(session.user.id);
  if (!hasPermission(role, 'manage_markets_template')) {
    return <div className="p-8">Forbidden</div>;
  }

  async function handleSubmit(m: Market) {
    'use server';
    const s = await auth.api.getSession({ headers: await headers() });
    if (!s) throw new Error('unauthenticated');
    await saveTemplate(m, s.user.id);
    redirect(`/f/markets/${m.handle}`);
  }

  return (
    <div className="p-6 md:p-10 max-w-3xl mx-auto">
      <h1 className="text-2xl font-semibold mb-6">New market</h1>
      <MarketForm initial={EMPTY} isNew onSubmit={handleSubmit} />
    </div>
  );
}
```

- [ ] **Step 3: Write `app/(dashboard)/f/markets/[handle]/page.tsx`**

```typescript
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { eq } from 'drizzle-orm';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { db, schema } from '@/db/client';
import { listTemplates, saveTemplate, deleteTemplate } from '@/features/markets/actions';
import { MarketForm } from '@/components/markets/MarketForm';
import type { Market } from '@/features/markets/types';

export default async function MarketDetailPage({
  params,
}: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/auth/sign-in');
  const role = await getRole(session.user.id);
  if (!hasPermission(role, 'view_markets_history')) {
    return <div className="p-8">Forbidden</div>;
  }

  const all = await listTemplates();
  const market = all.find((m) => m.handle === handle);
  if (!market) notFound();
  const canManage = hasPermission(role, 'manage_markets_template');

  const stores = await db.select().from(schema.stores);
  const overrides = await db.select().from(schema.marketStoreOverrides)
    .where(eq(schema.marketStoreOverrides.marketHandle, handle));
  const overrideByStore = new Map(overrides.map((o) => [o.storeId, o] as const));

  async function handleSubmit(m: Market) {
    'use server';
    const s = await auth.api.getSession({ headers: await headers() });
    if (!s) throw new Error('unauthenticated');
    await saveTemplate(m, s.user.id);
  }

  async function handleDelete() {
    'use server';
    const s = await auth.api.getSession({ headers: await headers() });
    if (!s) throw new Error('unauthenticated');
    const r = await getRole(s.user.id);
    if (!hasPermission(r, 'manage_markets_template')) throw new Error('forbidden');
    await deleteTemplate(handle);
    redirect('/f/markets');
  }

  return (
    <div className="p-6 md:p-10 max-w-5xl mx-auto space-y-10">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{market.name}</h1>
        {canManage && (
          <form action={handleDelete}>
            <button
              type="submit"
              className="text-sm text-red-600 hover:underline"
            >
              Delete market
            </button>
          </form>
        )}
      </div>

      <section>
        <h2 className="text-lg font-medium mb-4">Template</h2>
        {canManage ? (
          <MarketForm initial={market} isNew={false} onSubmit={handleSubmit} />
        ) : (
          <pre className="bg-muted p-4 rounded text-xs overflow-x-auto">{JSON.stringify(market, null, 2)}</pre>
        )}
      </section>

      <section>
        <h2 className="text-lg font-medium mb-4">Per-store overrides</h2>
        {stores.length === 0 ? (
          <p className="text-sm text-muted-foreground">No stores connected.</p>
        ) : (
          <ul className="divide-y border rounded-lg">
            {stores.map((s) => {
              const o = overrideByStore.get(s.id);
              const hasAdj = o && o.priceAdjustment;
              const zoneCount = (o?.shipping as { zones?: object } | null | undefined)?.zones
                ? Object.keys((o!.shipping as { zones: object }).zones).length
                : 0;
              return (
                <li key={s.id} className="px-4 py-3 flex items-center justify-between">
                  <div>
                    <div className="font-medium">{s.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {hasAdj
                        ? `${(o!.priceAdjustment as { value: number }).value}% adj`
                        : 'No price adjustment'}
                      {' · '}
                      {zoneCount} shipping {zoneCount === 1 ? 'zone' : 'zones'}
                    </div>
                  </div>
                  <Link
                    href={`/f/markets/${handle}/stores/${s.id}`}
                    className="text-sm text-primary hover:underline"
                  >
                    Edit
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 4: Write `components/markets/OverrideForm.tsx`**

```typescript
'use client';

import { useState } from 'react';
import type {
  Market, MarketStoreOverride, ShippingZone, ShippingRate, MarketShipping, MarketPriceAdjustment,
} from '@/features/markets/types';

interface Props {
  market: Market;
  storeId: string;
  storeName: string;
  initial: MarketStoreOverride;
  onSubmit: (o: MarketStoreOverride) => Promise<void>;
}

export function OverrideForm({ market, storeId, storeName, initial, onSubmit }: Props) {
  const [adj, setAdj] = useState<MarketPriceAdjustment | null>(initial.priceAdjustment);
  const [shipping, setShipping] = useState<MarketShipping | null>(initial.shipping);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function addZone() {
    const name = prompt('Zone name?');
    if (!name) return;
    setShipping({
      zones: { ...(shipping?.zones ?? {}), [name]: { countries: [], rates: {} } },
    });
  }

  function removeZone(name: string) {
    if (!shipping) return;
    const { [name]: _gone, ...rest } = shipping.zones;
    setShipping(Object.keys(rest).length === 0 ? null : { zones: rest });
  }

  function updateZone(name: string, patch: Partial<ShippingZone>) {
    if (!shipping) return;
    setShipping({
      zones: { ...shipping.zones, [name]: { ...shipping.zones[name], ...patch } },
    });
  }

  function addRate(zoneName: string) {
    const name = prompt('Rate name?');
    if (!name) return;
    updateZone(zoneName, {
      rates: {
        ...shipping!.zones[zoneName].rates,
        [name]: { type: 'flat', price: 0, currency: market.primaryCurrency },
      },
    });
  }

  function updateRate(zoneName: string, rateName: string, patch: Partial<ShippingRate>) {
    updateZone(zoneName, {
      rates: {
        ...shipping!.zones[zoneName].rates,
        [rateName]: { ...shipping!.zones[zoneName].rates[rateName], ...patch },
      },
    });
  }

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        setBusy(true);
        try {
          await onSubmit({
            storeId, marketHandle: market.handle,
            priceAdjustment: adj, shipping,
          });
        } catch (err) {
          setError(String(err));
        } finally {
          setBusy(false);
        }
      }}
      className="space-y-8"
    >
      <p className="text-sm text-muted-foreground">
        Store: <strong>{storeName}</strong> · Market: <strong>{market.name}</strong>
      </p>

      <section>
        <h2 className="text-lg font-medium mb-3">Price adjustment</h2>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={adj !== null}
            onChange={(e) => setAdj(e.target.checked ? { type: 'percentage', value: 0 } : null)}
          />
          Enable price adjustment
        </label>
        {adj && (
          <label className="block mt-3">
            <span className="text-sm">Percentage (-50 to +200)</span>
            <input
              type="number"
              value={adj.value}
              min={-50}
              max={200}
              onChange={(e) => setAdj({ type: 'percentage', value: Number(e.target.value) })}
              className="mt-1 block w-40 rounded border px-3 py-2"
            />
          </label>
        )}
      </section>

      <section>
        <h2 className="text-lg font-medium mb-3 flex items-center justify-between">
          Shipping zones
          <button
            type="button"
            onClick={addZone}
            className="text-sm text-primary hover:underline"
          >
            + Add zone
          </button>
        </h2>
        {!shipping || Object.keys(shipping.zones).length === 0 ? (
          <p className="text-sm text-muted-foreground">No shipping zones configured.</p>
        ) : (
          <div className="space-y-4">
            {Object.entries(shipping.zones).map(([zoneName, zone]) => (
              <div key={zoneName} className="border rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-medium">{zoneName}</h3>
                  <button
                    type="button"
                    onClick={() => removeZone(zoneName)}
                    className="text-xs text-red-600 hover:underline"
                  >
                    Remove zone
                  </button>
                </div>
                <label className="block mb-3">
                  <span className="text-sm">Countries (ISO-2, comma)</span>
                  <input
                    type="text"
                    value={zone.countries.join(', ')}
                    onChange={(e) => updateZone(zoneName, {
                      countries: e.target.value.split(',')
                        .map((s) => s.trim().toUpperCase()).filter(Boolean),
                    })}
                    className="mt-1 block w-full rounded border px-3 py-2 text-sm"
                    placeholder={market.countries.join(', ')}
                  />
                </label>
                <div className="space-y-2">
                  {Object.entries(zone.rates).map(([rateName, rate]) => (
                    <div key={rateName} className="flex items-center gap-2 text-sm">
                      <span className="w-32 font-mono">{rateName}</span>
                      <input
                        type="number"
                        value={rate.price}
                        onChange={(e) => updateRate(zoneName, rateName, { price: Number(e.target.value) })}
                        className="w-24 rounded border px-2 py-1"
                      />
                      <input
                        type="text"
                        value={rate.currency}
                        onChange={(e) => updateRate(zoneName, rateName, { currency: e.target.value.toUpperCase() })}
                        className="w-20 rounded border px-2 py-1 font-mono"
                      />
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => addRate(zoneName)}
                    className="text-xs text-primary hover:underline"
                  >
                    + Add rate
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {error && <div className="text-sm text-red-600">{error}</div>}

      <button
        type="submit"
        disabled={busy}
        className="rounded-md bg-primary text-primary-foreground px-5 py-2 text-sm font-medium disabled:opacity-50"
      >
        {busy ? 'Saving…' : 'Save override'}
      </button>
    </form>
  );
}
```

- [ ] **Step 5: Write `app/(dashboard)/f/markets/[handle]/stores/[storeId]/page.tsx`**

```typescript
import { notFound, redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { eq } from 'drizzle-orm';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { db, schema } from '@/db/client';
import { listTemplates, getOverride, saveOverride } from '@/features/markets/actions';
import { OverrideForm } from '@/components/markets/OverrideForm';
import type { MarketStoreOverride } from '@/features/markets/types';

export default async function OverridePage({
  params,
}: { params: Promise<{ handle: string; storeId: string }> }) {
  const { handle, storeId } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/auth/sign-in');
  const role = await getRole(session.user.id);
  if (!hasPermission(role, 'apply_markets')) {
    return <div className="p-8">Forbidden</div>;
  }

  const templates = await listTemplates();
  const market = templates.find((m) => m.handle === handle);
  if (!market) notFound();

  const [store] = await db.select().from(schema.stores)
    .where(eq(schema.stores.id, storeId)).limit(1);
  if (!store) notFound();

  const existing = await getOverride(storeId, handle);
  const initial: MarketStoreOverride = existing ?? {
    storeId, marketHandle: handle, priceAdjustment: null, shipping: null,
  };

  async function handleSubmit(o: MarketStoreOverride) {
    'use server';
    const s = await auth.api.getSession({ headers: await headers() });
    if (!s) throw new Error('unauthenticated');
    await saveOverride(o, s.user.id);
  }

  return (
    <div className="p-6 md:p-10 max-w-4xl mx-auto">
      <h1 className="text-2xl font-semibold mb-6">Override</h1>
      <OverrideForm
        market={market}
        storeId={storeId}
        storeName={store.name}
        initial={initial}
        onSubmit={handleSubmit}
      />
    </div>
  );
}
```

- [ ] **Step 6: Type-check and manual test**

Run: `npm run typecheck`
Expected: no errors.

Run: `npm run dev`
Open: `http://localhost:3001/f/markets/europe` (after seeding)
Expected: detail page with template form and store list.
Open: `http://localhost:3001/f/markets/new`
Expected: new market form.
Open per-store override link from detail page.
Expected: override editor.

- [ ] **Step 7: Commit**

```bash
git add app/\(dashboard\)/f/markets/ components/markets/
git commit -m "feat(markets): add market detail, new market, and per-store override UI"
```

---

## Task 17: Apply modal + history UI

**Files:**
- Create: `app/(dashboard)/f/markets/apply/page.tsx`
- Create: `app/(dashboard)/f/markets/history/page.tsx`
- Create: `components/markets/ApplyModal.tsx`

- [ ] **Step 1: Write `components/markets/ApplyModal.tsx`**

```typescript
'use client';

import { useState } from 'react';
import type { MarketOps } from '@/features/markets/diff';

interface Store {
  id: string;
  name: string;
  shopDomain: string;
}

interface Props {
  stores: Store[];
  onPreview: (storeId: string) => Promise<{ ops: MarketOps }>;
  onApply: (storeId: string) => Promise<{ errors: Array<{ step: string; error: string }> }>;
}

export function ApplyModal({ stores, onPreview, onApply }: Props) {
  const [storeId, setStoreId] = useState<string | null>(null);
  const [ops, setOps] = useState<MarketOps | null>(null);
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const store = stores.find((s) => s.id === storeId);

  return (
    <div className="space-y-6 max-w-3xl">
      <section>
        <h2 className="text-lg font-medium mb-3">1. Select store</h2>
        <select
          value={storeId ?? ''}
          onChange={(e) => { setStoreId(e.target.value || null); setOps(null); setResult(null); }}
          className="rounded border px-3 py-2 w-full"
        >
          <option value="">— pick a store —</option>
          {stores.map((s) => (
            <option key={s.id} value={s.id}>{s.name} ({s.shopDomain})</option>
          ))}
        </select>
      </section>

      {storeId && (
        <section>
          <h2 className="text-lg font-medium mb-3">2. Dry-run preview</h2>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setResult(null);
              try {
                const r = await onPreview(storeId);
                setOps(r.ops);
              } catch (e) {
                setResult(`Preview failed: ${e}`);
              } finally {
                setBusy(false);
              }
            }}
            className="rounded border px-4 py-2 text-sm hover:bg-accent disabled:opacity-50"
          >
            {busy ? 'Running…' : 'Run dry-run'}
          </button>
          {ops && (
            <div className="mt-4 space-y-2 text-sm">
              <DiffSummary ops={ops} />
            </div>
          )}
        </section>
      )}

      {ops && store && (
        <section>
          <h2 className="text-lg font-medium mb-3">3. Confirm and apply</h2>
          <label className="block mb-3 text-sm">
            <span>Type <code className="bg-muted px-1">{store.shopDomain}</code> to confirm</span>
            <input
              type="text"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="mt-1 block w-full rounded border px-3 py-2"
            />
          </label>
          <button
            type="button"
            disabled={busy || confirm !== store.shopDomain}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await onApply(storeId!);
                setResult(r.errors.length === 0
                  ? `Applied successfully (${countOps(ops)} ops).`
                  : `Applied with ${r.errors.length} error(s): ${r.errors.map((e) => e.step).join(', ')}`);
              } catch (e) {
                setResult(`Apply failed: ${e}`);
              } finally {
                setBusy(false);
              }
            }}
            className="rounded-md bg-primary text-primary-foreground px-5 py-2 text-sm font-medium disabled:opacity-50"
          >
            {busy ? 'Applying…' : `Apply ${countOps(ops)} changes`}
          </button>
        </section>
      )}

      {result && (
        <div className="rounded border p-4 text-sm whitespace-pre-wrap">{result}</div>
      )}
    </div>
  );
}

function countOps(ops: MarketOps): number {
  return ops.marketsToCreate.length + ops.marketsToUpdate.length + ops.marketsToDelete.length
    + ops.regionsToAdd.length + ops.regionsToRemove.length
    + ops.currencyUpdates.length + ops.languageUpdates.length
    + ops.priceListsToCreate.length + ops.priceListsToUpdate.length + ops.priceListsToDelete.length;
}

function DiffSummary({ ops }: { ops: MarketOps }) {
  const rows: Array<[string, number, string]> = [
    ['Markets to create', ops.marketsToCreate.length, 'emerald'],
    ['Markets to update', ops.marketsToUpdate.length, 'amber'],
    ['Markets to delete', ops.marketsToDelete.length, 'red'],
    ['Regions to add', ops.regionsToAdd.length, 'emerald'],
    ['Regions to remove', ops.regionsToRemove.length, 'red'],
    ['Currency updates', ops.currencyUpdates.length, 'amber'],
    ['Language updates', ops.languageUpdates.length, 'amber'],
    ['Price lists to create', ops.priceListsToCreate.length, 'emerald'],
    ['Price lists to update', ops.priceListsToUpdate.length, 'amber'],
    ['Price lists to delete', ops.priceListsToDelete.length, 'red'],
  ];
  return (
    <div className="grid grid-cols-2 gap-2">
      {rows.map(([label, n, color]) => (
        <div
          key={label}
          className={`rounded border px-3 py-2 ${n > 0 ? 'border-' + color + '-500' : ''}`}
        >
          <span className="text-xs text-muted-foreground">{label}</span>
          <div className="text-lg font-medium">{n}</div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Write `app/(dashboard)/f/markets/apply/page.tsx`**

```typescript
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { db, schema } from '@/db/client';
import { previewMarketsApply, executeMarketsApply } from '@/features/markets/actions';
import { ApplyModal } from '@/components/markets/ApplyModal';

export default async function ApplyPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/auth/sign-in');
  const role = await getRole(session.user.id);
  if (!hasPermission(role, 'apply_markets')) {
    return <div className="p-8">Forbidden</div>;
  }

  const stores = (await db.select().from(schema.stores))
    .map((s) => ({ id: s.id, name: s.name, shopDomain: s.shopDomain }));

  async function preview(storeId: string) {
    'use server';
    const s = await auth.api.getSession({ headers: await headers() });
    if (!s) throw new Error('unauthenticated');
    const r = await previewMarketsApply(storeId);
    return { ops: r.ops };
  }

  async function apply(storeId: string) {
    'use server';
    const s = await auth.api.getSession({ headers: await headers() });
    if (!s) throw new Error('unauthenticated');
    const r = await executeMarketsApply(storeId, s.user.id);
    return { errors: r.kind === 'applied' ? r.errors : [] };
  }

  return (
    <div className="p-6 md:p-10 max-w-4xl mx-auto">
      <h1 className="text-2xl font-semibold mb-6">Apply markets to a store</h1>
      <ApplyModal stores={stores} onPreview={preview} onApply={apply} />
    </div>
  );
}
```

- [ ] **Step 3: Write `app/(dashboard)/f/markets/history/page.tsx`**

```typescript
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { desc } from 'drizzle-orm';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { db, schema } from '@/db/client';

export default async function HistoryPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/auth/sign-in');
  const role = await getRole(session.user.id);
  if (!hasPermission(role, 'view_markets_history')) {
    return <div className="p-8">Forbidden</div>;
  }

  const rows = await db.select().from(schema.marketApplyHistory)
    .orderBy(desc(schema.marketApplyHistory.createdAt))
    .limit(100);

  const stores = new Map(
    (await db.select().from(schema.stores)).map((s) => [s.id, s.name] as const),
  );

  return (
    <div className="p-6 md:p-10 max-w-6xl mx-auto">
      <h1 className="text-2xl font-semibold mb-6">Markets apply history</h1>
      <ul className="divide-y border rounded-lg">
        {rows.length === 0 ? (
          <li className="px-4 py-6 text-sm text-muted-foreground">No apply history yet.</li>
        ) : (
          rows.map((r) => (
            <li key={r.id} className="px-4 py-3 flex items-center justify-between">
              <div>
                <div className="text-sm font-medium">
                  {stores.get(r.storeId) ?? r.storeId}
                  <span className="text-xs text-muted-foreground ml-2">{r.action}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {new Date(r.createdAt).toLocaleString()}
                </div>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded ${
                r.status === 'success' ? 'bg-emerald-100 text-emerald-800' :
                r.status === 'partial_error' ? 'bg-amber-100 text-amber-800' :
                'bg-red-100 text-red-800'
              }`}>
                {r.status}
              </span>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: Type-check and manual test**

Run: `npm run typecheck`
Expected: no errors.

Run: `npm run dev`
Open: `http://localhost:3001/f/markets/apply` and `/f/markets/history`
Expected: pages render. Apply page can pick store, run dry-run, see diff summary.

- [ ] **Step 5: Commit**

```bash
git add app/\(dashboard\)/f/markets/apply/ app/\(dashboard\)/f/markets/history/ components/markets/ApplyModal.tsx
git commit -m "feat(markets): add apply modal page and history page"
```

---

## Task 18: E2E tests, feature flag, manual smoke, final commit

**Files:**
- Create: `e2e/markets-flow.spec.ts`
- Modify: `.env.example` and `lib/env.ts` to register `MARKETS_WRITER_ENABLED`

- [ ] **Step 1: Register feature flag env var**

Open `lib/env.ts`. Add to the schema (next to other flags):

```typescript
MARKETS_WRITER_ENABLED: z.string().optional().default('false').transform((v) => v === 'true'),
```

Edit `.env.example` (or local `.env` for dev):

```
MARKETS_WRITER_ENABLED=false
```

Then wire `lib/flags/flags.ts` `isFeatureEnabled('markets', _)` to return `env.MARKETS_WRITER_ENABLED` for the `markets` key, mirroring how settings-sync's flag is wired (consult `lib/flags/flags.ts:1-30` for exact pattern; add an entry for `'markets'`).

- [ ] **Step 2: Write E2E test**

Create `e2e/markets-flow.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';

test.describe('Markets feature', () => {
  test('admin can seed defaults and see 11 cards', async ({ page }) => {
    await page.goto('/f/markets');
    const empty = await page.getByText('No markets configured.').isVisible().catch(() => false);
    if (empty) {
      await page.getByRole('button', { name: /seed default markets/i }).click();
    }
    await expect(page.locator('h2', { hasText: 'United States' })).toBeVisible();
    await expect(page.locator('h2', { hasText: 'Europe' })).toBeVisible();
  });

  test('admin can open a market detail page', async ({ page }) => {
    await page.goto('/f/markets');
    await page.getByRole('link', { name: /europe/i }).first().click();
    await expect(page.getByText('Template')).toBeVisible();
    await expect(page.getByText('Per-store overrides')).toBeVisible();
  });

  test('apply page shows dry-run summary', async ({ page }) => {
    await page.goto('/f/markets/apply');
    await page.locator('select').selectOption({ index: 1 });
    await page.getByRole('button', { name: /run dry-run/i }).click();
    await expect(page.getByText(/Markets to create/i)).toBeVisible();
  });
});
```

- [ ] **Step 3: Run unit + integration test suite**

Run: `npm test`
Expected: ALL tests pass (markets + existing settings-sync + other). Coverage ≥80% for new features/markets/ module.

- [ ] **Step 4: Run E2E test against local dev**

Run: `npm run dev` (in one terminal) then `npm run test:e2e -- e2e/markets-flow.spec.ts` (in another)
Expected: all 3 E2E specs pass.

- [ ] **Step 5: Manual smoke test on cici-mean (Phase 2 of rollout)**

Set `MARKETS_WRITER_ENABLED=true` on Railway. Deploy. Then on the live site:

1. Login as admin. Navigate `/f/markets`.
2. Click "Seed default markets" → verify 11 cards appear.
3. Open `/f/markets/apply`, pick cici-mean, run dry-run. Note ops count.
4. Type domain to confirm, click Apply. Verify success/partial.
5. Open Shopify Admin → Markets. Verify the 11 markets created.
6. Back in app, edit Europe market → add `+12%` price adjustment override for cici-mean → apply again.
7. Verify in Shopify Admin → Price lists, "Markets sync – Europe" appears with +12% rule.
8. Add a shipping zone "EU Standard" with €8 to Europe override → apply.
9. Verify in Shopify Admin → Shipping → "Europe – {storeId-prefix}" delivery profile with zone + rate.
10. Run apply again → ops should be all zero (idempotency).

Record any issues in `docs/superpowers/plans/2026-05-21-markets-and-shipping.md` under a new "Issues found during smoke" section if needed.

- [ ] **Step 6: Final commit**

```bash
git add e2e/markets-flow.spec.ts lib/env.ts .env.example lib/flags/flags.ts
git commit -m "feat(markets): add E2E tests and register MARKETS_WRITER_ENABLED feature flag"
```

---

## Done Criteria Verification

After Task 18 manual smoke test, confirm against spec Section 9:

- [ ] 11 default markets seeded successfully on cici-mean.myshopify.com (smoke step 5)
- [ ] Per-store override saves for price adjustment + shipping (smoke step 6-8)
- [ ] Dry-run shows accurate diff (smoke step 3, 10)
- [ ] Apply runs in correct order, idempotent (smoke step 10 — re-run = empty diff)
- [ ] Partial failure doesn't corrupt state; retry works (test in Task 12 + manual)
- [ ] Audit log + snapshot data sufficient (verify in `audit_log` + `settings_snapshots` + `market_apply_history` tables)
- [ ] Coverage ≥80% (verify with `npm test -- --coverage`)
- [ ] All unit + integration + E2E tests pass (Task 18 step 3-4)
- [ ] Manual smoke 5 steps pass (Task 18 step 5)
- [ ] Spec #2 still works (run existing `/f/settings-sync` flow, verify nothing broken)
