# Shopify Management System — Foundation + Settings Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the foundation of a multi-store Shopify management system — OAuth app install, encrypted token storage, RBAC, a read-only Shopify connector, and a first feature that views shipping + checkout-branding settings across all stores.

**Architecture:** A single Next.js (App Router) app on Railway. A `lib/shopify` connector is the only path to the Shopify Admin GraphQL API and exposes read-only queries in this phase. Features live in self-contained `features/<key>/` folders registered in a registry and gated per-store by feature flags. Postgres (Railway) holds stores, users/roles, flags, access/audit logs, and settings snapshots.

**Tech Stack:** Next.js 15 (App Router) · TypeScript · Drizzle ORM + Postgres · Better-Auth · `@shopify/shopify-api` · Vitest (unit/integration) · Playwright (E2E) · Railway (host)

**Spec:** `docs/superpowers/specs/2026-05-19-shopify-management-foundation-design.md`

---

## File Structure

```
app/
  layout.tsx                          shell layout
  page.tsx                            store list (shell dashboard)
  stores/connect/page.tsx             "connect store" form
  api/auth/shopify/install/route.ts   OAuth install initiator
  api/auth/shopify/callback/route.ts  OAuth callback (HMAC + token exchange)
  api/stores/[id]/test/route.ts       test-connection endpoint
  f/settings-viewer/page.tsx          settings-viewer feature route
features/settings-viewer/
  manifest.ts                         feature manifest
  queries.ts                          shipping + checkout read queries
  ui/SettingsViewer.tsx               feature UI
lib/
  env.ts                              validated environment config
  crypto/index.ts                     versioned AES-256-GCM encrypt/decrypt
  flags/flags.ts                      feature-flag check
  logging/access.ts                   access_log writer
  logging/audit.ts                    audit_log writer
  snapshots/snapshots.ts              snapshot dedup + store
  shopify/client.ts                   @shopify/shopify-api config
  shopify/connector.ts                read-only connector (guards + rate limit)
  auth/auth.ts                        Better-Auth instance
  auth/rbac.ts                        role checks
  registry/registry.ts                feature registry
db/
  schema.ts                           Drizzle schema (all tables)
  client.ts                           Drizzle client
  migrations/                         generated SQL migrations
tests/e2e/                            Playwright specs
.github/
  workflows/ci.yml                    typecheck + lint + test + build
  CODEOWNERS                          mandatory review for lib core
  pull_request_template.md
drizzle.config.ts · railway.json · vitest.config.ts · playwright.config.ts
```

Each `lib/<area>/` folder owns one responsibility and is tested in isolation. Features never import another feature; they import only from `lib/`.

---

## Task 1: Scaffold the Next.js project

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `.gitignore`, `.env.example`, `app/layout.tsx`, `app/page.tsx`

- [ ] **Step 1: Scaffold the app**

Run in the repo root:

```bash
npx create-next-app@latest . --typescript --app --eslint --no-tailwind --no-src-dir --import-alias "@/*" --use-npm --yes
```

- [ ] **Step 2: Add project dependencies**

```bash
npm install drizzle-orm pg @shopify/shopify-api better-auth zod
npm install -D drizzle-kit @types/pg vitest @vitest/coverage-v8 dotenv-cli @playwright/test
```

- [ ] **Step 3: Add scripts to `package.json`**

Merge into the `"scripts"` block:

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "dotenv -- drizzle-kit migrate"
  }
}
```

- [ ] **Step 4: Create `.env.example`**

```bash
# Postgres (Railway provides DATABASE_URL automatically when a Postgres plugin is attached)
DATABASE_URL=postgres://user:pass@localhost:5432/shopify_mgmt

# Token encryption — generate with: openssl rand -hex 32
ENCRYPTION_KEY_V1=
ENCRYPTION_KEY_CURRENT=v1

# Shopify app (from Shopify Dev Dashboard)
SHOPIFY_API_KEY=
SHOPIFY_API_SECRET=
SHOPIFY_SCOPES=read_shipping,read_checkout_branding,read_products
SHOPIFY_APP_URL=http://localhost:3000
SHOPIFY_API_VERSION=2025-01

# Better-Auth
BETTER_AUTH_SECRET=
BETTER_AUTH_URL=http://localhost:3000
```

- [ ] **Step 5: Verify the app builds and commit**

Run: `npm run build`
Expected: build succeeds.

```bash
git add -A
git commit -m "chore: scaffold Next.js app with project dependencies"
```

---

## Task 2: GitHub safety setup

**Files:**
- Create: `.github/workflows/ci.yml`, `.github/CODEOWNERS`, `.github/pull_request_template.md`

- [ ] **Step 1: Create the CI workflow**

`.github/workflows/ci.yml`:

```yaml
name: CI
on:
  pull_request:
  push:
    branches: [main]
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '24'
          cache: npm
      - run: npm ci
      - run: npm run typecheck
      - run: npm run lint
      - run: npm run test
      - run: npm run build
        env:
          ENCRYPTION_KEY_V1: 0000000000000000000000000000000000000000000000000000000000000000
          ENCRYPTION_KEY_CURRENT: v1
```

- [ ] **Step 2: Create CODEOWNERS**

`.github/CODEOWNERS` (replace `@owner` with the repo owner's GitHub handle):

```
# Core security-sensitive code requires owner review
/lib/shopify/   @owner
/lib/crypto/    @owner
/lib/auth/      @owner
/db/schema.ts   @owner
```

- [ ] **Step 3: Create the PR template**

`.github/pull_request_template.md`:

```markdown
## What this changes

## Shopify impact
- Scopes touched:
- Stores affected:
- Contains write operations to a store? (yes/no — must be "no" until spec #2)

## Checklist
- [ ] Tests added/updated
- [ ] `npm run typecheck` passes
- [ ] No store write operations introduced
```

- [ ] **Step 4: Commit**

```bash
git add .github
git commit -m "ci: add CI workflow, CODEOWNERS, and PR template"
```

- [ ] **Step 5: Manual setup note (not code)**

After pushing to GitHub, the repo owner must enable branch protection on `main`: require PR, require 1 approval, require the `verify` CI check to pass. Record this in the repo README later.

---

## Task 3: Validated environment config

**Files:**
- Create: `lib/env.ts`, `lib/env.test.ts`

- [ ] **Step 1: Write the failing test**

`lib/env.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseEnv } from './env';

describe('parseEnv', () => {
  const valid = {
    DATABASE_URL: 'postgres://localhost/db',
    ENCRYPTION_KEY_V1: 'a'.repeat(64),
    ENCRYPTION_KEY_CURRENT: 'v1',
    SHOPIFY_API_KEY: 'key',
    SHOPIFY_API_SECRET: 'secret',
    SHOPIFY_SCOPES: 'read_shipping',
    SHOPIFY_APP_URL: 'http://localhost:3000',
    SHOPIFY_API_VERSION: '2025-01',
    BETTER_AUTH_SECRET: 's'.repeat(32),
    BETTER_AUTH_URL: 'http://localhost:3000',
  };

  it('parses a valid environment', () => {
    expect(parseEnv(valid).SHOPIFY_API_VERSION).toBe('2025-01');
  });

  it('throws when a required variable is missing', () => {
    const { DATABASE_URL, ...rest } = valid;
    expect(() => parseEnv(rest)).toThrow();
  });

  it('throws when ENCRYPTION_KEY_CURRENT has no matching key', () => {
    expect(() => parseEnv({ ...valid, ENCRYPTION_KEY_CURRENT: 'v9' })).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- lib/env.test.ts`
Expected: FAIL — `parseEnv` not found.

- [ ] **Step 3: Implement `lib/env.ts`**

```typescript
import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  ENCRYPTION_KEY_V1: z.string().length(64),
  ENCRYPTION_KEY_CURRENT: z.string().min(1),
  SHOPIFY_API_KEY: z.string().min(1),
  SHOPIFY_API_SECRET: z.string().min(1),
  SHOPIFY_SCOPES: z.string().min(1),
  SHOPIFY_APP_URL: z.string().url(),
  SHOPIFY_API_VERSION: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(16),
  BETTER_AUTH_URL: z.string().url(),
});

export type Env = z.infer<typeof schema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const parsed = schema.parse(source);
  const versionKey = `ENCRYPTION_KEY_${parsed.ENCRYPTION_KEY_CURRENT.toUpperCase()}`;
  if (!source[versionKey]) {
    throw new Error(`ENCRYPTION_KEY_CURRENT="${parsed.ENCRYPTION_KEY_CURRENT}" has no matching ${versionKey}`);
  }
  return parsed;
}

export const env = parseEnv(process.env);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- lib/env.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/env.ts lib/env.test.ts
git commit -m "feat: add validated environment config"
```

---

## Task 4: Versioned token encryption (`lib/crypto`)

This implements AES-256-GCM with key versioning so keys can be rotated without downtime. Ciphertext is stored as `v<n>:<ivHex>:<tagHex>:<dataHex>`.

**Files:**
- Create: `lib/crypto/index.ts`, `lib/crypto/crypto.test.ts`

- [ ] **Step 1: Write the failing test**

`lib/crypto/crypto.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { encrypt, decrypt, needsReEncryption } from './index';

const keys = {
  v1: '11'.repeat(32), // 32 bytes hex
  v2: '22'.repeat(32),
};

describe('crypto', () => {
  it('round-trips a value with the current key', () => {
    const cipher = encrypt('shpat_secret', { keys, current: 'v1' });
    expect(cipher.startsWith('v1:')).toBe(true);
    expect(decrypt(cipher, { keys, current: 'v1' })).toBe('shpat_secret');
  });

  it('decrypts a v1 ciphertext even when current key is v2', () => {
    const cipher = encrypt('shpat_secret', { keys, current: 'v1' });
    expect(decrypt(cipher, { keys, current: 'v2' })).toBe('shpat_secret');
  });

  it('reports re-encryption is needed when ciphertext version != current', () => {
    const v1cipher = encrypt('x', { keys, current: 'v1' });
    expect(needsReEncryption(v1cipher, 'v2')).toBe(true);
    expect(needsReEncryption(v1cipher, 'v1')).toBe(false);
  });

  it('throws when the ciphertext key version is unknown', () => {
    expect(() => decrypt('v9:aa:bb:cc', { keys, current: 'v1' })).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- lib/crypto`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/crypto/index.ts`**

```typescript
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export interface KeyConfig {
  keys: Record<string, string>; // version -> 64-char hex key
  current: string;
}

const ALGO = 'aes-256-gcm';

function keyBuffer(config: KeyConfig, version: string): Buffer {
  const hex = config.keys[version];
  if (!hex) throw new Error(`Unknown encryption key version: ${version}`);
  return Buffer.from(hex, 'hex');
}

export function encrypt(plaintext: string, config: KeyConfig): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, keyBuffer(config, config.current), iv);
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${config.current}:${iv.toString('hex')}:${tag.toString('hex')}:${data.toString('hex')}`;
}

export function decrypt(ciphertext: string, config: KeyConfig): string {
  const [version, ivHex, tagHex, dataHex] = ciphertext.split(':');
  if (!version || !ivHex || !tagHex || !dataHex) {
    throw new Error('Malformed ciphertext');
  }
  const decipher = createDecipheriv(ALGO, keyBuffer(config, version), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8');
}

export function needsReEncryption(ciphertext: string, currentVersion: string): boolean {
  return ciphertext.split(':')[0] !== currentVersion;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- lib/crypto`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/crypto
git commit -m "feat: add versioned AES-256-GCM token encryption"
```

---

## Task 5: Database schema (`db/schema.ts`)

**Files:**
- Create: `db/schema.ts`, `drizzle.config.ts`

- [ ] **Step 1: Create `drizzle.config.ts`**

```typescript
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './db/schema.ts',
  out: './db/migrations',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL! },
});
```

- [ ] **Step 2: Create `db/schema.ts`**

```typescript
import { pgTable, uuid, text, boolean, timestamp, jsonb, pgEnum } from 'drizzle-orm/pg-core';

export const roleEnum = pgEnum('role', ['admin', 'operator', 'viewer']);
export const storeStatusEnum = pgEnum('store_status', ['active', 'disconnected', 'error']);

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const roles = pgTable('roles', {
  userId: uuid('user_id').references(() => users.id).primaryKey(),
  role: roleEnum('role').notNull().default('viewer'),
});

export const stores = pgTable('stores', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  shopDomain: text('shop_domain').notNull().unique(),
  plan: text('plan'),
  encryptedToken: text('encrypted_token').notNull(),
  scopes: text('scopes').array().notNull().default([]),
  apiVersion: text('api_version').notNull(),
  status: storeStatusEnum('status').notNull().default('active'),
  maintenanceMode: boolean('maintenance_mode').notNull().default(false),
  connectedAt: timestamp('connected_at').defaultNow().notNull(),
});

export const featureFlags = pgTable('feature_flags', {
  id: uuid('id').defaultRandom().primaryKey(),
  featureKey: text('feature_key').notNull(),
  storeId: uuid('store_id').references(() => stores.id).notNull(),
  enabled: boolean('enabled').notNull().default(false),
  config: jsonb('config').notNull().default({}),
  updatedBy: uuid('updated_by').references(() => users.id),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Read activity — short retention, pruned by a scheduled job.
export const accessLog = pgTable('access_log', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id),
  storeId: uuid('store_id').references(() => stores.id),
  featureKey: text('feature_key').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Write/config changes — append-only, retained permanently.
export const auditLog = pgTable('audit_log', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id),
  storeId: uuid('store_id').references(() => stores.id),
  featureKey: text('feature_key'),
  action: text('action').notNull(),
  target: text('target'),
  requestSummary: text('request_summary'),
  result: text('result').notNull(), // 'success' | 'error'
  errorDetail: text('error_detail'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const settingsSnapshots = pgTable('settings_snapshots', {
  id: uuid('id').defaultRandom().primaryKey(),
  storeId: uuid('store_id').references(() => stores.id).notNull(),
  domain: text('domain').notNull(), // 'shipping' | 'checkout'
  payload: jsonb('payload').notNull(),
  payloadHash: text('payload_hash').notNull(),
  capturedAt: timestamp('captured_at').defaultNow().notNull(),
  capturedBy: uuid('captured_by').references(() => users.id),
});
```

- [ ] **Step 3: Generate the migration**

Run: `npm run db:generate`
Expected: a SQL file appears in `db/migrations/`.

- [ ] **Step 4: Commit**

```bash
git add db/schema.ts drizzle.config.ts db/migrations
git commit -m "feat: add database schema and initial migration"
```

---

## Task 6: Database client (`db/client.ts`)

**Files:**
- Create: `db/client.ts`

- [ ] **Step 1: Implement `db/client.ts`**

```typescript
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';
import { env } from '@/lib/env';

const pool = new Pool({ connectionString: env.DATABASE_URL });

export const db = drizzle(pool, { schema });
export { schema };
```

- [ ] **Step 2: Verify typecheck passes**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add db/client.ts
git commit -m "feat: add Drizzle database client"
```

---

## Task 7: Feature-flag check (`lib/flags`)

**Files:**
- Create: `lib/flags/flags.ts`, `lib/flags/flags.test.ts`

- [ ] **Step 1: Write the failing test**

`lib/flags/flags.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { isFeatureEnabled } from './flags';

describe('isFeatureEnabled', () => {
  const rows = [
    { featureKey: 'settings-viewer', storeId: 'store-a', enabled: true },
    { featureKey: 'settings-viewer', storeId: 'store-b', enabled: false },
  ];
  const lookup = async (featureKey: string, storeId: string) =>
    rows.find((r) => r.featureKey === featureKey && r.storeId === storeId) ?? null;

  it('returns true when the flag row is enabled', async () => {
    expect(await isFeatureEnabled('settings-viewer', 'store-a', lookup)).toBe(true);
  });

  it('returns false when the flag row is disabled', async () => {
    expect(await isFeatureEnabled('settings-viewer', 'store-b', lookup)).toBe(false);
  });

  it('returns false (default-off) when no flag row exists', async () => {
    expect(await isFeatureEnabled('settings-viewer', 'store-c', lookup)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- lib/flags`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/flags/flags.ts`**

```typescript
import { eq, and } from 'drizzle-orm';
import { db, schema } from '@/db/client';

export interface FlagRow {
  featureKey: string;
  storeId: string;
  enabled: boolean;
}

export type FlagLookup = (featureKey: string, storeId: string) => Promise<FlagRow | null>;

const dbLookup: FlagLookup = async (featureKey, storeId) => {
  const [row] = await db
    .select()
    .from(schema.featureFlags)
    .where(and(eq(schema.featureFlags.featureKey, featureKey), eq(schema.featureFlags.storeId, storeId)))
    .limit(1);
  return row ? { featureKey, storeId, enabled: row.enabled } : null;
};

/** Features are default-off: a missing flag row means disabled. */
export async function isFeatureEnabled(
  featureKey: string,
  storeId: string,
  lookup: FlagLookup = dbLookup,
): Promise<boolean> {
  const row = await lookup(featureKey, storeId);
  return row?.enabled ?? false;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- lib/flags`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/flags
git commit -m "feat: add per-store feature-flag check"
```

---

## Task 8: Logging writers (`lib/logging`)

**Files:**
- Create: `lib/logging/access.ts`, `lib/logging/audit.ts`, `lib/logging/logging.test.ts`

- [ ] **Step 1: Write the failing test**

`lib/logging/logging.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { buildAccessEntry } from './access';
import { buildAuditEntry } from './audit';

describe('buildAccessEntry', () => {
  it('builds a feature-entry access record', () => {
    const entry = buildAccessEntry({ userId: 'u1', storeId: 's1', featureKey: 'settings-viewer' });
    expect(entry).toEqual({ userId: 'u1', storeId: 's1', featureKey: 'settings-viewer' });
  });
});

describe('buildAuditEntry', () => {
  it('builds a success audit record', () => {
    const entry = buildAuditEntry({
      userId: 'u1', storeId: 's1', featureKey: 'settings-viewer',
      action: 'connect_store', target: 'shop.myshopify.com', result: 'success',
    });
    expect(entry.result).toBe('success');
    expect(entry.errorDetail).toBeNull();
  });

  it('keeps the error detail for a failed record', () => {
    const entry = buildAuditEntry({
      userId: 'u1', action: 'connect_store', result: 'error', errorDetail: 'HMAC mismatch',
    });
    expect(entry.errorDetail).toBe('HMAC mismatch');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- lib/logging`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `lib/logging/access.ts`**

```typescript
import { db, schema } from '@/db/client';

export interface AccessEntry {
  userId: string | null;
  storeId: string | null;
  featureKey: string;
}

export function buildAccessEntry(input: AccessEntry): AccessEntry {
  return { userId: input.userId, storeId: input.storeId, featureKey: input.featureKey };
}

/** One record per feature-entry (user opens a feature for a store). Not per API call. */
export async function recordAccess(input: AccessEntry): Promise<void> {
  await db.insert(schema.accessLog).values(buildAccessEntry(input));
}
```

- [ ] **Step 4: Implement `lib/logging/audit.ts`**

```typescript
import { db, schema } from '@/db/client';

export interface AuditInput {
  userId: string | null;
  storeId?: string | null;
  featureKey?: string | null;
  action: string;
  target?: string | null;
  requestSummary?: string | null;
  result: 'success' | 'error';
  errorDetail?: string | null;
}

export function buildAuditEntry(input: AuditInput) {
  return {
    userId: input.userId,
    storeId: input.storeId ?? null,
    featureKey: input.featureKey ?? null,
    action: input.action,
    target: input.target ?? null,
    requestSummary: input.requestSummary ?? null,
    result: input.result,
    errorDetail: input.errorDetail ?? null,
  };
}

/** Append-only. Used for write/config changes — populated from spec #2 onward. */
export async function recordAudit(input: AuditInput): Promise<void> {
  await db.insert(schema.auditLog).values(buildAuditEntry(input));
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test -- lib/logging`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add lib/logging
git commit -m "feat: add access_log and audit_log writers"
```

---

## Task 9: Read-only Shopify connector (`lib/shopify/connector`)

The connector is the only path to Shopify. It enforces the feature flag, the required scopes, and maintenance mode, handles rate-limit backoff, and exposes `query()` only — there is deliberately no `mutate()`.

**Files:**
- Create: `lib/shopify/connector.ts`, `lib/shopify/connector.test.ts`

- [ ] **Step 1: Write the failing test**

`lib/shopify/connector.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { runQuery, ConnectorError } from './connector';

const store = {
  id: 's1', shopDomain: 'shop.myshopify.com', apiVersion: '2025-01',
  status: 'active' as const, maintenanceMode: false, scopes: ['read_shipping'],
};

const okGraphql = vi.fn(async () => ({ data: { shop: { name: 'Shop' } } }));

describe('runQuery', () => {
  it('runs the query when flag is on, scopes satisfied, store active', async () => {
    const result = await runQuery({
      store, featureKey: 'settings-viewer', requiredScopes: ['read_shipping'],
      query: 'query { shop { name } }',
      deps: { isEnabled: async () => true, graphql: okGraphql, decryptToken: async () => 'tok' },
    });
    expect(result.shop.name).toBe('Shop');
    expect(okGraphql).toHaveBeenCalled();
  });

  it('blocks when the feature flag is off', async () => {
    await expect(runQuery({
      store, featureKey: 'settings-viewer', requiredScopes: ['read_shipping'],
      query: 'query { shop { name } }',
      deps: { isEnabled: async () => false, graphql: okGraphql, decryptToken: async () => 'tok' },
    })).rejects.toThrow(ConnectorError);
  });

  it('blocks when a required scope is missing', async () => {
    await expect(runQuery({
      store, featureKey: 'settings-viewer', requiredScopes: ['read_checkout_branding'],
      query: 'query { shop { name } }',
      deps: { isEnabled: async () => true, graphql: okGraphql, decryptToken: async () => 'tok' },
    })).rejects.toThrow(/scope/i);
  });

  it('blocks reads are still allowed but writes are unrepresentable (no mutate export)', async () => {
    const mod = await import('./connector');
    expect((mod as Record<string, unknown>).mutate).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- lib/shopify/connector`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/shopify/connector.ts`**

```typescript
export class ConnectorError extends Error {}

export interface ConnectorStore {
  id: string;
  shopDomain: string;
  apiVersion: string;
  status: 'active' | 'disconnected' | 'error';
  maintenanceMode: boolean;
  scopes: string[];
}

export interface ConnectorDeps {
  isEnabled: (featureKey: string, storeId: string) => Promise<boolean>;
  graphql: (args: { shopDomain: string; apiVersion: string; token: string; query: string; variables?: Record<string, unknown> }) => Promise<{ data: unknown; errors?: unknown }>;
  decryptToken: (storeId: string) => Promise<string>;
}

export interface RunQueryArgs<T> {
  store: ConnectorStore;
  featureKey: string;
  requiredScopes: string[];
  query: string;
  variables?: Record<string, unknown>;
  deps: ConnectorDeps;
}

const MAX_RETRIES = 3;

/** The only path to Shopify. Read-only by design — there is no mutate() in this module. */
export async function runQuery<T = any>(args: RunQueryArgs<T>): Promise<T> {
  const { store, featureKey, requiredScopes, query, variables, deps } = args;

  if (store.status !== 'active') {
    throw new ConnectorError(`Store ${store.shopDomain} is not active (${store.status})`);
  }
  if (store.maintenanceMode) {
    throw new ConnectorError(`Store ${store.shopDomain} is in maintenance mode`);
  }
  if (!(await deps.isEnabled(featureKey, store.id))) {
    throw new ConnectorError(`Feature "${featureKey}" is not enabled for ${store.shopDomain}`);
  }
  const missing = requiredScopes.filter((s) => !store.scopes.includes(s));
  if (missing.length > 0) {
    throw new ConnectorError(`Missing scope(s) for ${store.shopDomain}: ${missing.join(', ')}`);
  }

  const token = await deps.decryptToken(store.id);

  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const res = await deps.graphql({
        shopDomain: store.shopDomain, apiVersion: store.apiVersion, token, query, variables,
      });
      if (res.errors) {
        throw new ConnectorError(`GraphQL error: ${JSON.stringify(res.errors)}`);
      }
      return res.data as T;
    } catch (err) {
      lastError = err;
      const throttled = err instanceof Error && /throttl|429|rate/i.test(err.message);
      if (!throttled || attempt === MAX_RETRIES - 1) break;
      await new Promise((r) => setTimeout(r, 2 ** attempt * 500));
    }
  }
  throw lastError instanceof ConnectorError
    ? lastError
    : new ConnectorError(`Query failed for ${store.shopDomain}: ${String(lastError)}`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- lib/shopify/connector`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/shopify/connector.ts lib/shopify/connector.test.ts
git commit -m "feat: add read-only Shopify connector with flag/scope guards"
```

---

## Task 10: Shopify client + token helper (`lib/shopify/client.ts`)

**Files:**
- Create: `lib/shopify/client.ts`

- [ ] **Step 1: Implement `lib/shopify/client.ts`**

```typescript
import '@shopify/shopify-api/adapters/node';
import { shopifyApi, LATEST_API_VERSION } from '@shopify/shopify-api';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { env } from '@/lib/env';
import { decrypt, encrypt, needsReEncryption, type KeyConfig } from '@/lib/crypto';

export const shopify = shopifyApi({
  apiKey: env.SHOPIFY_API_KEY,
  apiSecretKey: env.SHOPIFY_API_SECRET,
  scopes: env.SHOPIFY_SCOPES.split(','),
  hostName: new URL(env.SHOPIFY_APP_URL).host,
  apiVersion: (env.SHOPIFY_API_VERSION as typeof LATEST_API_VERSION) ?? LATEST_API_VERSION,
  isEmbeddedApp: false,
});

function keyConfig(): KeyConfig {
  const keys: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    const match = name.match(/^ENCRYPTION_KEY_(V\d+)$/i);
    if (match && value) keys[match[1].toLowerCase()] = value;
  }
  return { keys, current: env.ENCRYPTION_KEY_CURRENT };
}

/** Decrypts a store's token; lazily re-encrypts under the current key if stale. */
export async function getStoreToken(storeId: string): Promise<string> {
  const [store] = await db.select().from(schema.stores).where(eq(schema.stores.id, storeId)).limit(1);
  if (!store) throw new Error(`Store not found: ${storeId}`);
  const config = keyConfig();
  const token = decrypt(store.encryptedToken, config);
  if (needsReEncryption(store.encryptedToken, config.current)) {
    await db.update(schema.stores)
      .set({ encryptedToken: encrypt(token, config) })
      .where(eq(schema.stores.id, storeId));
  }
  return token;
}

/** Raw GraphQL call. Used only via the connector — never call directly from features. */
export async function graphqlCall(args: {
  shopDomain: string; apiVersion: string; token: string;
  query: string; variables?: Record<string, unknown>;
}): Promise<{ data: unknown; errors?: unknown }> {
  const res = await fetch(`https://${args.shopDomain}/admin/api/${args.apiVersion}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': args.token },
    body: JSON.stringify({ query: args.query, variables: args.variables ?? {} }),
  });
  if (res.status === 429) throw new Error('Shopify rate limit (429)');
  return res.json();
}

export function encryptToken(plaintext: string): string {
  return encrypt(plaintext, keyConfig());
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add lib/shopify/client.ts
git commit -m "feat: add Shopify API client and token helper with lazy re-encryption"
```

---

## Task 11: Better-Auth + RBAC (`lib/auth`)

**Files:**
- Create: `lib/auth/auth.ts`, `lib/auth/rbac.ts`, `lib/auth/rbac.test.ts`, `app/api/auth/[...all]/route.ts`

- [ ] **Step 1: Write the failing test**

`lib/auth/rbac.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { hasPermission, type Role } from './rbac';

describe('hasPermission', () => {
  it('admin can manage stores', () => {
    expect(hasPermission('admin', 'manage_stores')).toBe(true);
  });
  it('operator cannot manage stores but can run features', () => {
    expect(hasPermission('operator', 'manage_stores')).toBe(false);
    expect(hasPermission('operator', 'run_feature')).toBe(true);
  });
  it('viewer can only view', () => {
    expect(hasPermission('viewer', 'view')).toBe(true);
    expect(hasPermission('viewer', 'run_feature')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- lib/auth/rbac`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/auth/rbac.ts`**

```typescript
export type Role = 'admin' | 'operator' | 'viewer';
export type Permission = 'view' | 'run_feature' | 'manage_stores';

const MATRIX: Record<Role, Permission[]> = {
  admin: ['view', 'run_feature', 'manage_stores'],
  operator: ['view', 'run_feature'],
  viewer: ['view'],
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return MATRIX[role].includes(permission);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- lib/auth/rbac`
Expected: PASS (3 tests).

- [ ] **Step 5: Implement `lib/auth/auth.ts`**

```typescript
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { db } from '@/db/client';
import { env } from '@/lib/env';

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: 'pg' }),
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  emailAndPassword: { enabled: true },
});
```

- [ ] **Step 6: Implement `app/api/auth/[...all]/route.ts`**

```typescript
import { auth } from '@/lib/auth/auth';
import { toNextJsHandler } from 'better-auth/next-js';

export const { GET, POST } = toNextJsHandler(auth);
```

- [ ] **Step 7: Generate the Better-Auth tables and regenerate the migration**

Run: `npx @better-auth/cli generate --output db/auth-schema.ts && npm run db:generate`
Expected: auth tables added to a new migration. Import `db/auth-schema.ts` from `db/schema.ts` by re-exporting it: add `export * from './auth-schema';` to the end of `db/schema.ts`.

- [ ] **Step 8: Commit**

```bash
git add lib/auth app/api/auth db/auth-schema.ts db/schema.ts db/migrations
git commit -m "feat: add Better-Auth with role-based access control"
```

---

## Task 12: OAuth install route

**Files:**
- Create: `app/api/auth/shopify/install/route.ts`, `app/stores/connect/page.tsx`

- [ ] **Step 1: Implement `app/api/auth/shopify/install/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { shopify } from '@/lib/shopify/client';
import { auth } from '@/lib/auth/auth';
import { db, schema } from '@/db/client';
import { eq } from 'drizzle-orm';
import { hasPermission, type Role } from '@/lib/auth/rbac';

export async function GET(req: NextRequest) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return NextResponse.redirect(new URL('/api/auth/sign-in', req.url));

  const [roleRow] = await db.select().from(schema.roles).where(eq(schema.roles.userId, session.user.id)).limit(1);
  if (!roleRow || !hasPermission(roleRow.role as Role, 'manage_stores')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const shop = req.nextUrl.searchParams.get('shop');
  if (!shop || !/^[a-z0-9-]+\.myshopify\.com$/.test(shop)) {
    return NextResponse.json({ error: 'invalid shop domain' }, { status: 400 });
  }

  await shopify.auth.begin({
    shop,
    callbackPath: '/api/auth/shopify/callback',
    isOnline: false,
    rawRequest: req,
  });
}
```

- [ ] **Step 2: Implement `app/stores/connect/page.tsx`**

```typescript
export default function ConnectStorePage() {
  return (
    <main style={{ padding: 24 }}>
      <h1>Connect a store</h1>
      <form action="/api/auth/shopify/install" method="get">
        <label>
          Shop domain
          <input name="shop" placeholder="your-shop.myshopify.com" required />
        </label>
        <button type="submit">Connect</button>
      </form>
    </main>
  );
}
```

- [ ] **Step 3: Verify typecheck passes**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add app/api/auth/shopify/install app/stores/connect
git commit -m "feat: add Shopify OAuth install route gated by manage_stores"
```

---

## Task 13: OAuth callback route

**Files:**
- Create: `app/api/auth/shopify/callback/route.ts`

- [ ] **Step 1: Implement the callback route**

`app/api/auth/shopify/callback/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { shopify, encryptToken } from '@/lib/shopify/client';
import { db, schema } from '@/db/client';
import { auth } from '@/lib/auth/auth';
import { env } from '@/lib/env';
import { recordAudit } from '@/lib/logging/audit';

export async function GET(req: NextRequest) {
  const session = await auth.api.getSession({ headers: req.headers });
  const userId = session?.user.id ?? null;

  try {
    // shopify.auth.callback verifies HMAC + state and exchanges the code for a token.
    const { session: shopifySession } = await shopify.auth.callback({ rawRequest: req });
    const shop = shopifySession.shop;
    const token = shopifySession.accessToken;
    if (!token) throw new Error('No access token returned');

    const encrypted = encryptToken(token);
    const scopes = env.SHOPIFY_SCOPES.split(',');

    const existing = await db.select().from(schema.stores).where(eq(schema.stores.shopDomain, shop)).limit(1);
    if (existing.length > 0) {
      await db.update(schema.stores)
        .set({ encryptedToken: encrypted, scopes, status: 'active', apiVersion: env.SHOPIFY_API_VERSION })
        .where(eq(schema.stores.shopDomain, shop));
    } else {
      await db.insert(schema.stores).values({
        name: shop.replace('.myshopify.com', ''),
        shopDomain: shop,
        encryptedToken: encrypted,
        scopes,
        apiVersion: env.SHOPIFY_API_VERSION,
        status: 'active',
      });
    }

    await recordAudit({ userId, action: 'connect_store', target: shop, result: 'success' });
    return NextResponse.redirect(new URL('/', req.url));
  } catch (err) {
    await recordAudit({
      userId, action: 'connect_store', result: 'error', errorDetail: String(err),
    });
    return NextResponse.json({ error: 'OAuth callback failed', detail: String(err) }, { status: 400 });
  }
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add app/api/auth/shopify/callback
git commit -m "feat: add Shopify OAuth callback with HMAC verify and encrypted token storage"
```

---

## Task 14: Feature registry (`lib/registry`)

**Files:**
- Create: `lib/registry/registry.ts`, `lib/registry/registry.test.ts`

- [ ] **Step 1: Write the failing test**

`lib/registry/registry.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { createRegistry, type FeatureManifest } from './registry';

const manifest: FeatureManifest = {
  key: 'settings-viewer',
  name: 'Settings Viewer',
  version: '1.0.0',
  requiredScopes: ['read_shipping'],
  hasWriteOperations: false,
};

describe('registry', () => {
  it('registers and retrieves a feature by key', () => {
    const reg = createRegistry([manifest]);
    expect(reg.get('settings-viewer')?.name).toBe('Settings Viewer');
  });

  it('lists all registered features', () => {
    const reg = createRegistry([manifest]);
    expect(reg.list()).toHaveLength(1);
  });

  it('throws on duplicate feature keys', () => {
    expect(() => createRegistry([manifest, manifest])).toThrow(/duplicate/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- lib/registry`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/registry/registry.ts`**

```typescript
export interface FeatureManifest {
  key: string;
  name: string;
  version: string;
  requiredScopes: string[];
  hasWriteOperations: boolean;
}

export interface Registry {
  get: (key: string) => FeatureManifest | undefined;
  list: () => FeatureManifest[];
}

export function createRegistry(manifests: FeatureManifest[]): Registry {
  const map = new Map<string, FeatureManifest>();
  for (const m of manifests) {
    if (map.has(m.key)) throw new Error(`Duplicate feature key: ${m.key}`);
    map.set(m.key, m);
  }
  return {
    get: (key) => map.get(key),
    list: () => [...map.values()],
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- lib/registry`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/registry
git commit -m "feat: add feature registry"
```

---

## Task 15: Snapshot dedup service (`lib/snapshots`)

**Files:**
- Create: `lib/snapshots/snapshots.ts`, `lib/snapshots/snapshots.test.ts`

- [ ] **Step 1: Write the failing test**

`lib/snapshots/snapshots.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { hashPayload, shouldInsertSnapshot } from './snapshots';

describe('hashPayload', () => {
  it('produces the same hash regardless of key order', () => {
    expect(hashPayload({ a: 1, b: 2 })).toBe(hashPayload({ b: 2, a: 1 }));
  });
  it('produces different hashes for different data', () => {
    expect(hashPayload({ a: 1 })).not.toBe(hashPayload({ a: 2 }));
  });
});

describe('shouldInsertSnapshot', () => {
  it('inserts when there is no previous snapshot', () => {
    expect(shouldInsertSnapshot(null, hashPayload({ a: 1 }))).toBe(true);
  });
  it('skips when the hash matches the latest snapshot', () => {
    const h = hashPayload({ a: 1 });
    expect(shouldInsertSnapshot(h, h)).toBe(false);
  });
  it('inserts when the hash differs from the latest snapshot', () => {
    expect(shouldInsertSnapshot(hashPayload({ a: 1 }), hashPayload({ a: 2 }))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- lib/snapshots`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/snapshots/snapshots.ts`**

```typescript
import { createHash } from 'node:crypto';
import { and, eq, desc } from 'drizzle-orm';
import { db, schema } from '@/db/client';

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>).sort().map((k) => [k, sortKeys((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

export function hashPayload(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(sortKeys(payload))).digest('hex');
}

export function shouldInsertSnapshot(latestHash: string | null, newHash: string): boolean {
  return latestHash !== newHash;
}

/** Stores a snapshot only when the payload differs from the store+domain's latest snapshot. */
export async function captureSnapshot(args: {
  storeId: string; domain: string; payload: unknown; capturedBy: string | null;
}): Promise<{ inserted: boolean }> {
  const newHash = hashPayload(args.payload);
  const [latest] = await db.select({ payloadHash: schema.settingsSnapshots.payloadHash })
    .from(schema.settingsSnapshots)
    .where(and(eq(schema.settingsSnapshots.storeId, args.storeId), eq(schema.settingsSnapshots.domain, args.domain)))
    .orderBy(desc(schema.settingsSnapshots.capturedAt))
    .limit(1);

  if (!shouldInsertSnapshot(latest?.payloadHash ?? null, newHash)) {
    return { inserted: false };
  }
  await db.insert(schema.settingsSnapshots).values({
    storeId: args.storeId, domain: args.domain,
    payload: args.payload as object, payloadHash: newHash, capturedBy: args.capturedBy,
  });
  return { inserted: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- lib/snapshots`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/snapshots
git commit -m "feat: add settings snapshot dedup service"
```

---

## Task 16: settings-viewer queries + graceful checkout degradation

**Files:**
- Create: `features/settings-viewer/manifest.ts`, `features/settings-viewer/queries.ts`, `features/settings-viewer/queries.test.ts`

- [ ] **Step 1: Write the failing test**

`features/settings-viewer/queries.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseCheckoutResult } from './queries';

describe('parseCheckoutResult', () => {
  it('returns available branding when present', () => {
    const result = parseCheckoutResult({ checkoutBranding: { designSystem: { colors: {} } } });
    expect(result.status).toBe('available');
  });

  it('degrades gracefully when the store is not migrated to Checkout Extensibility', () => {
    const result = parseCheckoutResult(null, [{ message: 'Checkout branding is not available' }]);
    expect(result.status).toBe('needs_migration');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- features/settings-viewer`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `features/settings-viewer/manifest.ts`**

```typescript
import type { FeatureManifest } from '@/lib/registry/registry';

export const settingsViewerManifest: FeatureManifest = {
  key: 'settings-viewer',
  name: 'Settings Viewer',
  version: '1.0.0',
  requiredScopes: ['read_shipping', 'read_checkout_branding'],
  hasWriteOperations: false,
};
```

- [ ] **Step 4: Implement `features/settings-viewer/queries.ts`**

```typescript
import { runQuery, type ConnectorStore } from '@/lib/shopify/connector';
import { isFeatureEnabled } from '@/lib/flags/flags';
import { getStoreToken, graphqlCall } from '@/lib/shopify/client';
import { settingsViewerManifest } from './manifest';

const SHIPPING_QUERY = `query {
  deliveryProfiles(first: 10) {
    edges { node { name profileItems(first: 50) { edges { node { product { title } } } }
      profileLocationGroups { locationGroupZones(first: 20) {
        edges { node { zone { name } methodDefinitions(first: 20) {
          edges { node { name rateProvider { __typename } } } } } } } } } }
}`;

const CHECKOUT_QUERY = `query {
  checkoutBranding { designSystem { colors { global { brand } } } }
}`;

export interface CheckoutResult {
  status: 'available' | 'needs_migration';
  data: unknown;
}

export function parseCheckoutResult(data: unknown, errors?: unknown): CheckoutResult {
  const branding = (data as { checkoutBranding?: unknown } | null)?.checkoutBranding;
  if (branding) return { status: 'available', data: branding };
  // Stores not on Checkout Extensibility return null/errors for checkoutBranding.
  return { status: 'needs_migration', data: errors ?? null };
}

const connectorDeps = {
  isEnabled: isFeatureEnabled,
  graphql: graphqlCall,
  decryptToken: getStoreToken,
};

export async function readShipping(store: ConnectorStore): Promise<unknown> {
  return runQuery({
    store,
    featureKey: settingsViewerManifest.key,
    requiredScopes: ['read_shipping'],
    query: SHIPPING_QUERY,
    deps: connectorDeps,
  });
}

export async function readCheckout(store: ConnectorStore): Promise<CheckoutResult> {
  try {
    const data = await runQuery({
      store,
      featureKey: settingsViewerManifest.key,
      requiredScopes: ['read_checkout_branding'],
      query: CHECKOUT_QUERY,
      deps: connectorDeps,
    });
    return parseCheckoutResult(data);
  } catch {
    return { status: 'needs_migration', data: null };
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test -- features/settings-viewer`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add features/settings-viewer/manifest.ts features/settings-viewer/queries.ts features/settings-viewer/queries.test.ts
git commit -m "feat: add settings-viewer queries with graceful checkout degradation"
```

---

## Task 17: settings-viewer route + UI

**Files:**
- Create: `app/f/settings-viewer/page.tsx`, `features/settings-viewer/ui/SettingsViewer.tsx`

- [ ] **Step 1: Implement `features/settings-viewer/ui/SettingsViewer.tsx`**

```typescript
interface StoreSettings {
  storeName: string;
  shipping: unknown;
  checkoutStatus: 'available' | 'needs_migration';
}

export function SettingsViewer({ stores }: { stores: StoreSettings[] }) {
  return (
    <section style={{ padding: 24 }}>
      <h1>Settings Viewer</h1>
      {stores.length === 0 && <p>No stores connected yet.</p>}
      {stores.map((s) => (
        <article key={s.storeName} style={{ border: '1px solid #ddd', margin: '12px 0', padding: 12 }}>
          <h2>{s.storeName}</h2>
          <h3>Shipping</h3>
          <pre>{JSON.stringify(s.shipping, null, 2)}</pre>
          <h3>Checkout branding</h3>
          {s.checkoutStatus === 'available'
            ? <p>Checkout branding available.</p>
            : <p>Checkout branding unavailable — store needs migration to Checkout Extensibility.</p>}
        </article>
      ))}
    </section>
  );
}
```

- [ ] **Step 2: Implement `app/f/settings-viewer/page.tsx`**

```typescript
import { headers } from 'next/headers';
import { db, schema } from '@/db/client';
import { auth } from '@/lib/auth/auth';
import { readShipping, readCheckout } from '@/features/settings-viewer/queries';
import { settingsViewerManifest } from '@/features/settings-viewer/manifest';
import { recordAccess } from '@/lib/logging/access';
import { captureSnapshot } from '@/lib/snapshots/snapshots';
import { SettingsViewer } from '@/features/settings-viewer/ui/SettingsViewer';
import type { ConnectorStore } from '@/lib/shopify/connector';

export default async function SettingsViewerPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return <p>Please sign in.</p>;

  const stores = await db.select().from(schema.stores);
  const results = [];

  for (const store of stores) {
    const connectorStore: ConnectorStore = {
      id: store.id, shopDomain: store.shopDomain, apiVersion: store.apiVersion,
      status: store.status, maintenanceMode: store.maintenanceMode, scopes: store.scopes,
    };
    await recordAccess({ userId: session.user.id, storeId: store.id, featureKey: settingsViewerManifest.key });

    let shipping: unknown = null;
    let checkoutStatus: 'available' | 'needs_migration' = 'needs_migration';
    try {
      shipping = await readShipping(connectorStore);
      await captureSnapshot({ storeId: store.id, domain: 'shipping', payload: shipping, capturedBy: session.user.id });
      const checkout = await readCheckout(connectorStore);
      checkoutStatus = checkout.status;
      await captureSnapshot({ storeId: store.id, domain: 'checkout', payload: checkout.data, capturedBy: session.user.id });
    } catch (err) {
      shipping = { error: String(err) };
    }
    results.push({ storeName: store.name, shipping, checkoutStatus });
  }

  return <SettingsViewer stores={results} />;
}
```

- [ ] **Step 3: Verify typecheck passes**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add app/f/settings-viewer features/settings-viewer/ui
git commit -m "feat: add settings-viewer route with access logging and snapshot capture"
```

---

## Task 18: Shell dashboard + test-connection endpoint

**Files:**
- Modify: `app/page.tsx`
- Create: `app/api/stores/[id]/test/route.ts`

- [ ] **Step 1: Implement `app/api/stores/[id]/test/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { getStoreToken, graphqlCall } from '@/lib/shopify/client';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [store] = await db.select().from(schema.stores).where(eq(schema.stores.id, id)).limit(1);
  if (!store) return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 });

  try {
    const token = await getStoreToken(store.id);
    const res = await graphqlCall({
      shopDomain: store.shopDomain, apiVersion: store.apiVersion, token,
      query: 'query { shop { name } }',
    });
    const ok = !res.errors;
    await db.update(schema.stores).set({ status: ok ? 'active' : 'error' }).where(eq(schema.stores.id, id));
    return NextResponse.json({ ok });
  } catch (err) {
    await db.update(schema.stores).set({ status: 'error' }).where(eq(schema.stores.id, id));
    return NextResponse.json({ ok: false, error: String(err) }, { status: 502 });
  }
}
```

- [ ] **Step 2: Replace `app/page.tsx`**

```typescript
import Link from 'next/link';
import { db, schema } from '@/db/client';

export default async function HomePage() {
  const stores = await db.select().from(schema.stores);
  return (
    <main style={{ padding: 24 }}>
      <h1>Shopify Management</h1>
      <p><Link href="/stores/connect">+ Connect a store</Link></p>
      <p><Link href="/f/settings-viewer">Open Settings Viewer</Link></p>
      <h2>Connected stores ({stores.length})</h2>
      <ul>
        {stores.map((s) => (
          <li key={s.id}>{s.name} — {s.shopDomain} — <strong>{s.status}</strong></li>
        ))}
      </ul>
    </main>
  );
}
```

- [ ] **Step 3: Verify build passes**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add app/page.tsx app/api/stores
git commit -m "feat: add shell dashboard and store test-connection endpoint"
```

---

## Task 19: E2E tests

**Files:**
- Create: `playwright.config.ts`, `tests/e2e/dashboard.spec.ts`, `vitest.config.ts`

- [ ] **Step 1: Create `vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['lib/**/*.test.ts', 'features/**/*.test.ts'],
    coverage: { provider: 'v8', thresholds: { lines: 80, functions: 80, branches: 80 } },
  },
  resolve: { alias: { '@': path.resolve(__dirname) } },
});
```

- [ ] **Step 2: Create `playwright.config.ts`**

```typescript
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  use: { baseURL: 'http://localhost:3000' },
  webServer: { command: 'npm run start', url: 'http://localhost:3000', reuseExistingServer: true },
});
```

- [ ] **Step 3: Create `tests/e2e/dashboard.spec.ts`**

```typescript
import { test, expect } from '@playwright/test';

test('home page renders the shell dashboard', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Shopify Management' })).toBeVisible();
  await expect(page.getByRole('link', { name: '+ Connect a store' })).toBeVisible();
});

test('connect-store page renders the form', async ({ page }) => {
  await page.goto('/stores/connect');
  await expect(page.getByPlaceholder('your-shop.myshopify.com')).toBeVisible();
});
```

- [ ] **Step 4: Run the test suites**

Run: `npm run test`
Expected: all unit/integration tests PASS, coverage ≥ 80%.

Run: `npm run build && npm run test:e2e`
Expected: both E2E tests PASS.

- [ ] **Step 5: Commit**

```bash
git add vitest.config.ts playwright.config.ts tests/e2e
git commit -m "test: add Vitest config with coverage thresholds and Playwright E2E tests"
```

---

## Task 20: Railway deployment config + README

**Files:**
- Create: `railway.json`, `README.md`

- [ ] **Step 1: Create `railway.json`**

```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": { "builder": "NIXPACKS", "buildCommand": "npm run build" },
  "deploy": { "startCommand": "npm run db:migrate && npm run start", "restartPolicyType": "ON_FAILURE" }
}
```

- [ ] **Step 2: Create `README.md`**

```markdown
# Shopify Management System

Central management for multiple Shopify stores. Spec #1: foundation + read-only settings viewer.

## Local setup
1. `cp .env.example .env` and fill values. Generate keys with `openssl rand -hex 32`.
2. Start a local Postgres or use a Railway dev database.
3. `npm install && npm run db:migrate && npm run dev`

## Deploy (Railway)
- One service for the Next.js app + an attached Postgres plugin.
- Set all `.env.example` variables in the Railway service. `DATABASE_URL` is provided by the Postgres plugin.
- `SHOPIFY_APP_URL` and `BETTER_AUTH_URL` must be the Railway public URL.

## Shopify Dev Dashboard app
- Create one app, unlisted. Set the redirect URL to `<APP_URL>/api/auth/shopify/callback`.
- Scopes: `read_shipping,read_checkout_branding,read_products`.

## GitHub branch protection (set once, manually)
On `main`: require PR, 1 approval, and the `verify` CI check.

## Roadmap
See `docs/superpowers/specs/` for sub-project specs (#2 settings write, #3 theme, etc.).
```

- [ ] **Step 3: Commit**

```bash
git add railway.json README.md
git commit -m "chore: add Railway deploy config and README"
```

---

## Self-Review

**Spec coverage:**
- App OAuth + install/callback → Tasks 12, 13 ✓
- Encrypted token storage + key versioning → Tasks 4, 10 ✓
- Auth + RBAC (admin/operator/viewer) → Task 11 ✓
- Core tables (stores, users, roles, feature_flags, access_log, audit_log, settings_snapshots) → Task 5 ✓
- Read-only connector with flag/scope/maintenance guards + rate-limit → Task 9 ✓
- Feature registry + manifest → Task 14 ✓
- settings-viewer (shipping + checkout, graceful degradation) → Tasks 16, 17 ✓
- access_log feature-entry logging → Task 17 ✓
- Snapshot dedup → Task 15 ✓
- Railway host + Postgres → Tasks 1, 20 ✓
- GitHub branch protection / CI / CODEOWNERS / PR template → Task 2 ✓
- Testing ≥ 80% coverage, unit/integration/E2E → Tasks 3–19, 19 ✓

**Placeholder scan:** No TBD/TODO; every code step contains complete code.

**Type consistency:** `ConnectorStore` (Task 9) is reused unchanged in Tasks 16–17. `FeatureManifest` (Task 14) is reused in Task 16. `KeyConfig` (Task 4) is reused in Task 10. `Role` (Task 11) is reused in Task 12. `runQuery` deps shape matches `graphqlCall` (Task 10) and `getStoreToken` (Task 10) signatures.

**Note on RBAC enforcement:** Task 12 enforces `manage_stores` on the install route. Operator/viewer read enforcement on feature routes is intentionally minimal in spec #1 (everything is read-only); full per-route role gating is tightened in spec #2 when write operations exist.
