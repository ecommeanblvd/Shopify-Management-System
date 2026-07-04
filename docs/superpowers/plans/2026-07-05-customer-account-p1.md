# Customer Account Builder P1 — nền tảng (schema + token + config API + admin) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps dùng checkbox (`- [ ]`).
> Spec: `docs/superpowers/specs/2026-07-05-customer-account-builder-design.md` §4–§6.

**Goal:** Migration 0089 (4 bảng + expression index) + verify session-token JWT thuần + API `GET /api/customer-account/config` + assets PNG (upload S3, serve 302) + admin UI `/f/customer-account`.

**Architecture:** Feature module `features/customer-account/` (D-001); JWT verify thuần bằng node:crypto (không dep mới); route public có CORS `extensions.shopifycdn.com`; assets qua `lib/storage/s3.ts` (D-008); RBAC tái dùng `view_functions`/`manage_functions`.

**Tech Stack:** Next.js App Router, Drizzle, zod 4, node:crypto, Vitest.

## Global Constraints

- Migration số **0089**, tag `0089_customer-account`, journal idx 89, `when: 1784119200000`.
- KHÔNG dep mới. KHÔNG đụng `lib/shopify` (D-005), KHÔNG đụng feature khác (D-001 — chỉ import từ `lib/`).
- Env: `CUSTOMER_ACCOUNT_APP_SECRETS` (secrets phân cách dấu phẩy), `CUSTOMER_ACCOUNT_APP_CLIENT_IDS` (optional, phân cách dấu phẩy; rỗng → bỏ check aud).
- CORS: `Access-Control-Allow-Origin: https://extensions.shopifycdn.com`, methods `GET,POST,OPTIONS`, headers `Authorization,Content-Type`.
- Assets CHỈ nhận PNG: contentType `image/png` **và** magic bytes `89 50 4E 47`.
- KHÔNG chạy db:migrate trong build (apply sau merge). Route data-path không unit-test (env test không DB) — chỉ 401/preflight/validation.
- Tiếng Việt cho admin UI; module keys cố định: `profile|credit|tracking|wishlist|returns`.

---

### Task 1: Schema 4 bảng + migration 0089

**Files:** Modify `db/schema.ts` (append cuối) · Create `db/migrations/0089_customer-account.sql` · Modify `db/migrations/meta/_journal.json`

**Interfaces (Produces):** `customerAccountConfigs`, `customerAccountAssets`, `customerReturnRequests`, `customerLoyalty`.

- [ ] **Step 1: Append `db/schema.ts`** (sau block geo; import `uniqueIndex/index/jsonb/boolean/text/uuid/timestamp` đã có — kiểm dòng import đầu file, `jsonb` có thể cần thêm):

```ts
// ---------- Customer Account Builder (spec 2026-07-05-customer-account-builder-design.md §4) ----------

export const customerAccountConfigs = pgTable('customer_account_configs', {
  id: uuid('id').defaultRandom().primaryKey(),
  storeId: uuid('store_id').references(() => stores.id, { onDelete: 'cascade' }).notNull().unique(),
  enabled: boolean('enabled').notNull().default(false),
  /** Shape TS: features/customer-account/config-schema.ts (branding + modules[]) */
  config: jsonb('config').notNull().default({}),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const customerAccountAssets = pgTable('customer_account_assets', {
  id: uuid('id').defaultRandom().primaryKey(),
  storeId: uuid('store_id').references(() => stores.id, { onDelete: 'cascade' }).notNull(),
  kind: text('kind').notNull(), // 'logo' | 'hero' | 'icon'
  filename: text('filename').notNull(),
  fileKey: text('file_key').notNull(),
  contentType: text('content_type').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [index('customer_account_assets_store_idx').on(t.storeId)]);

export const customerReturnRequests = pgTable('customer_return_requests', {
  id: uuid('id').defaultRandom().primaryKey(),
  storeId: uuid('store_id').references(() => stores.id, { onDelete: 'cascade' }).notNull(),
  orderId: uuid('order_id').references(() => shopifyOrders.id, { onDelete: 'cascade' }).notNull(),
  shopifyCustomerId: text('shopify_customer_id').notNull(),
  orderNumber: text('order_number'),
  reason: text('reason').notNull(),
  note: text('note'),
  status: text('status').notNull().default('requested'), // requested|approved|rejected|received|refunded
  adminNote: text('admin_note'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('customer_return_requests_store_status_idx').on(t.storeId, t.status),
  index('customer_return_requests_customer_idx').on(t.storeId, t.shopifyCustomerId),
]);

export const customerLoyalty = pgTable('customer_loyalty', {
  id: uuid('id').defaultRandom().primaryKey(),
  storeId: uuid('store_id').references(() => stores.id, { onDelete: 'cascade' }).notNull(),
  shopifyCustomerId: text('shopify_customer_id').notNull(),
  tier: text('tier').notNull(),
  note: text('note'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [uniqueIndex('customer_loyalty_uq').on(t.storeId, t.shopifyCustomerId)]);
```

- [ ] **Step 2: `db/migrations/0089_customer-account.sql`**

```sql
CREATE TABLE "customer_account_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "customer_account_configs_store_id_unique" UNIQUE("store_id")
);
--> statement-breakpoint
CREATE TABLE "customer_account_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"filename" text NOT NULL,
	"file_key" text NOT NULL,
	"content_type" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_return_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"shopify_customer_id" text NOT NULL,
	"order_number" text,
	"reason" text NOT NULL,
	"note" text,
	"status" text DEFAULT 'requested' NOT NULL,
	"admin_note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_loyalty" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"shopify_customer_id" text NOT NULL,
	"tier" text NOT NULL,
	"note" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customer_account_configs" ADD CONSTRAINT "customer_account_configs_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "customer_account_assets" ADD CONSTRAINT "customer_account_assets_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "customer_return_requests" ADD CONSTRAINT "customer_return_requests_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "customer_return_requests" ADD CONSTRAINT "customer_return_requests_order_id_shopify_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."shopify_orders"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "customer_loyalty" ADD CONSTRAINT "customer_loyalty_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "customer_account_assets_store_idx" ON "customer_account_assets" ("store_id");
--> statement-breakpoint
CREATE INDEX "customer_return_requests_store_status_idx" ON "customer_return_requests" ("store_id","status");
--> statement-breakpoint
CREATE INDEX "customer_return_requests_customer_idx" ON "customer_return_requests" ("store_id","shopify_customer_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "customer_loyalty_uq" ON "customer_loyalty" ("store_id","shopify_customer_id");
--> statement-breakpoint
CREATE INDEX "shopify_orders_customer_expr_idx" ON "shopify_orders" ("store_id", ((raw_payload->'customer'->>'id')));
```
(Kiểm FK schema.ts của bảng khác dùng cú pháp `ADD CONSTRAINT` tương tự — mở migration 0086/0087 đối chiếu format. Expression index CHỈ nằm trong SQL — không sửa định nghĩa `shopifyOrders` trong schema.ts.)

- [ ] **Step 3: Journal** — append `{ "idx": 89, "version": "7", "when": 1784119200000, "tag": "0089_customer-account", "breakpoints": true }`.

- [ ] **Step 4: tsc + commit** — `npx tsc --noEmit` → 0. KHÔNG chạy migrate.

```bash
git add db/schema.ts db/migrations/0089_customer-account.sql db/migrations/meta/_journal.json
git commit -m "feat(customer-account): schema configs/assets/returns/loyalty + migration 0089"
```

---

### Task 2: Verify session token JWT thuần + test

**Files:** Create `features/customer-account/session-token.ts` · Test `features/customer-account/session-token.test.ts`

**Interfaces (Produces):**
```ts
export type TokenPayload = { dest: string; sub?: string; aud?: string | string[]; exp: number; [k: string]: unknown };
export type TokenVerify =
  | { ok: true; payload: TokenPayload; shopDomain: string; customerId: string | null }
  | { ok: false; reason: 'malformed' | 'bad_signature' | 'expired' | 'bad_aud' | 'no_dest' };
export function verifySessionToken(token: string, secrets: string[], opts?: { nowSeconds?: number; allowedClientIds?: string[] }): TokenVerify;
export function shopDomainFromDest(dest: string): string;      // 'https://x.myshopify.com/' → 'x.myshopify.com'
export function customerIdFromSub(sub: string | undefined): string | null; // 'gid://shopify/Customer/123' → '123'; '123' → '123'; undefined → null
```

- [ ] **Step 1: Test (FAIL trước)** — dùng node:crypto tự ký token trong test:

```ts
// features/customer-account/session-token.test.ts
import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { verifySessionToken, shopDomainFromDest, customerIdFromSub } from './session-token';

const b64u = (o: object | Buffer) =>
  (Buffer.isBuffer(o) ? o : Buffer.from(JSON.stringify(o))).toString('base64url');
function sign(payload: object, secret: string, header: object = { alg: 'HS256', typ: 'JWT' }): string {
  const h = b64u(header); const p = b64u(payload);
  const sig = crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${sig}`;
}
const NOW = 1_800_000_000;
const base = { dest: 'https://demo.myshopify.com', aud: 'client-1', sub: 'gid://shopify/Customer/777', exp: NOW + 300 };

describe('verifySessionToken', () => {
  it('token hợp lệ → ok + shopDomain + customerId', () => {
    const r = verifySessionToken(sign(base, 's1'), ['s1'], { nowSeconds: NOW });
    expect(r).toMatchObject({ ok: true, shopDomain: 'demo.myshopify.com', customerId: '777' });
  });
  it('đúng 1 trong nhiều secret → ok', () => {
    expect(verifySessionToken(sign(base, 's2'), ['s1', 's2'], { nowSeconds: NOW }).ok).toBe(true);
  });
  it('sai secret → bad_signature', () => {
    expect(verifySessionToken(sign(base, 'x'), ['s1'], { nowSeconds: NOW })).toEqual({ ok: false, reason: 'bad_signature' });
  });
  it('hết hạn → expired', () => {
    expect(verifySessionToken(sign({ ...base, exp: NOW - 1 }, 's1'), ['s1'], { nowSeconds: NOW })).toEqual({ ok: false, reason: 'expired' });
  });
  it('aud không thuộc allowedClientIds → bad_aud; allowedClientIds rỗng → bỏ check', () => {
    expect(verifySessionToken(sign(base, 's1'), ['s1'], { nowSeconds: NOW, allowedClientIds: ['other'] })).toEqual({ ok: false, reason: 'bad_aud' });
    expect(verifySessionToken(sign(base, 's1'), ['s1'], { nowSeconds: NOW, allowedClientIds: [] }).ok).toBe(true);
  });
  it('alg khác HS256 / thiếu phần / json hỏng → malformed', () => {
    expect(verifySessionToken(sign(base, 's1', { alg: 'none' }), ['s1'], { nowSeconds: NOW })).toEqual({ ok: false, reason: 'malformed' });
    expect(verifySessionToken('a.b', ['s1'], { nowSeconds: NOW })).toEqual({ ok: false, reason: 'malformed' });
  });
  it('thiếu dest → no_dest', () => {
    const { dest: _d, ...noDest } = base;
    expect(verifySessionToken(sign({ ...noDest, exp: NOW + 300 }, 's1'), ['s1'], { nowSeconds: NOW })).toEqual({ ok: false, reason: 'no_dest' });
  });
  it('sub thiếu → customerId null (vẫn ok)', () => {
    const { sub: _s, ...noSub } = base;
    const r = verifySessionToken(sign({ ...noSub, exp: NOW + 300 }, 's1'), ['s1'], { nowSeconds: NOW });
    expect(r).toMatchObject({ ok: true, customerId: null });
  });
});

describe('helpers', () => {
  it('shopDomainFromDest strip protocol + slash', () => {
    expect(shopDomainFromDest('https://a.myshopify.com/')).toBe('a.myshopify.com');
    expect(shopDomainFromDest('a.myshopify.com')).toBe('a.myshopify.com');
  });
  it('customerIdFromSub gid/numeric/undefined', () => {
    expect(customerIdFromSub('gid://shopify/Customer/42')).toBe('42');
    expect(customerIdFromSub('42')).toBe('42');
    expect(customerIdFromSub(undefined)).toBeNull();
  });
});
```

- [ ] **Step 2: FAIL** — `npx vitest run features/customer-account/session-token.test.ts`

- [ ] **Step 3: Implement**

```ts
// features/customer-account/session-token.ts
/** THUẦN: verify Shopify session token (JWT HS256) cho Customer Account UI Extension.
 *  Ký bằng app client secret; claims: dest (shop), aud (client id), sub (customer GID), exp (5').
 *  Không dep ngoài — node:crypto. */
import crypto from 'node:crypto';

export type TokenPayload = { dest: string; sub?: string; aud?: string | string[]; exp: number; [k: string]: unknown };
export type TokenVerify =
  | { ok: true; payload: TokenPayload; shopDomain: string; customerId: string | null }
  | { ok: false; reason: 'malformed' | 'bad_signature' | 'expired' | 'bad_aud' | 'no_dest' };

export function shopDomainFromDest(dest: string): string {
  return dest.replace(/^https?:\/\//, '').replace(/\/+$/, '');
}

export function customerIdFromSub(sub: string | undefined): string | null {
  if (!sub) return null;
  const m = /^gid:\/\/shopify\/Customer\/(\d+)$/.exec(sub);
  if (m) return m[1];
  return /^\d+$/.test(sub) ? sub : null;
}

function b64uJson(part: string): unknown {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}

export function verifySessionToken(
  token: string,
  secrets: string[],
  opts?: { nowSeconds?: number; allowedClientIds?: string[] },
): TokenVerify {
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed' };
  const [h, p, sig] = parts;

  let header: { alg?: string }; let payload: TokenPayload;
  try {
    header = b64uJson(h) as { alg?: string };
    payload = b64uJson(p) as TokenPayload;
  } catch { return { ok: false, reason: 'malformed' }; }
  if (header.alg !== 'HS256') return { ok: false, reason: 'malformed' };

  const sigBuf = Buffer.from(sig, 'base64url');
  const matched = secrets.some((s) => {
    const expected = crypto.createHmac('sha256', s).update(`${h}.${p}`).digest();
    return expected.length === sigBuf.length && crypto.timingSafeEqual(expected, sigBuf);
  });
  if (!matched) return { ok: false, reason: 'bad_signature' };

  const now = opts?.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp <= now) return { ok: false, reason: 'expired' };

  const allowed = opts?.allowedClientIds ?? [];
  if (allowed.length > 0) {
    const auds = Array.isArray(payload.aud) ? payload.aud : payload.aud ? [payload.aud] : [];
    if (!auds.some((a) => allowed.includes(a))) return { ok: false, reason: 'bad_aud' };
  }

  if (!payload.dest || typeof payload.dest !== 'string') return { ok: false, reason: 'no_dest' };
  return {
    ok: true, payload,
    shopDomain: shopDomainFromDest(payload.dest),
    customerId: customerIdFromSub(payload.sub),
  };
}
```

- [ ] **Step 4: PASS + tsc + commit**

```bash
git add features/customer-account/session-token.ts features/customer-account/session-token.test.ts
git commit -m "feat(customer-account): verify session token JWT thuần (HS256, multi-secret, aud/dest/exp)"
```

---

### Task 3: Config schema thuần + queries + API routes (config, assets)

**Files:**
- Create `features/customer-account/config-schema.ts` · Test `features/customer-account/config-schema.test.ts`
- Create `features/customer-account/queries.ts`
- Create `app/api/customer-account/_shared.ts`
- Create `app/api/customer-account/config/route.ts`
- Create `app/api/customer-account/assets/[assetId]/route.ts`
- Test `features/customer-account/routes-auth.test.ts`

**Interfaces:**
- Consumes: `verifySessionToken` (T2); schema T1; `getSignedDownloadUrl` (`@/lib/storage/s3` — kiểm chữ ký thật).
- Produces:
```ts
// config-schema.ts
export const MODULE_KEYS = ['profile', 'credit', 'tracking', 'wishlist', 'returns'] as const;
export type ModuleKey = typeof MODULE_KEYS[number];
export interface CustomerAccountConfig {
  branding: { logoAssetId?: string; heroAssetId?: string; supportEmail?: string; announcement?: string };
  modules: Array<{ key: ModuleKey; enabled: boolean; title?: string; iconAssetId?: string }>;
}
export const DEFAULT_CONFIG: CustomerAccountConfig; // 5 module enabled:true theo thứ tự MODULE_KEYS, branding {}
export function sanitizeConfig(raw: unknown): CustomerAccountConfig; // zod safeParse; hỏng/thiếu → DEFAULT + lọc key lạ + dedup key
// queries.ts
export async function getPublicConfig(storeId: string): Promise<{ enabled: boolean; branding: {...với *Url thay *AssetId}; modules: [...] }>;
export async function getAsset(assetId: string): Promise<{ fileKey: string; contentType: string } | null>;
// _shared.ts
export const CA_CORS: Record<string, string>; // 3 header Global Constraints
export function preflight(): Response; // 204 + CA_CORS
export async function authenticateExtension(req: NextRequest): Promise<{ store: { id: string }; customerId: string | null } | Response>;
```

- [ ] **Step 1: Test config-schema (FAIL trước)**

```ts
// features/customer-account/config-schema.test.ts
import { describe, it, expect } from 'vitest';
import { sanitizeConfig, DEFAULT_CONFIG, MODULE_KEYS } from './config-schema';

describe('sanitizeConfig', () => {
  it('null/garbage → DEFAULT_CONFIG (5 module đủ thứ tự)', () => {
    expect(sanitizeConfig(null)).toEqual(DEFAULT_CONFIG);
    expect(sanitizeConfig('x')).toEqual(DEFAULT_CONFIG);
    expect(DEFAULT_CONFIG.modules.map((m) => m.key)).toEqual([...MODULE_KEYS]);
  });
  it('lọc module key lạ + dedup, giữ thứ tự hợp lệ', () => {
    const r = sanitizeConfig({ branding: {}, modules: [
      { key: 'tracking', enabled: true }, { key: 'hack', enabled: true },
      { key: 'tracking', enabled: false }, { key: 'profile', enabled: false },
    ] });
    expect(r.modules.map((m) => m.key)).toEqual(['tracking', 'profile']);
  });
  it('branding giữ field hợp lệ, bỏ field lạ', () => {
    const r = sanitizeConfig({ branding: { supportEmail: 'a@b.c', evil: 1 }, modules: [] });
    expect(r.branding).toEqual({ supportEmail: 'a@b.c' });
  });
});
```

- [ ] **Step 2: FAIL → implement `config-schema.ts`** (zod 4):

```ts
// features/customer-account/config-schema.ts
/** THUẦN: shape + sanitize config Customer Account (jsonb → typed). */
import { z } from 'zod';

export const MODULE_KEYS = ['profile', 'credit', 'tracking', 'wishlist', 'returns'] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];

const brandingSchema = z.object({
  logoAssetId: z.string().optional(), heroAssetId: z.string().optional(),
  supportEmail: z.string().optional(), announcement: z.string().optional(),
}).strip();
const moduleSchema = z.object({
  key: z.enum(MODULE_KEYS), enabled: z.boolean(),
  title: z.string().optional(), iconAssetId: z.string().optional(),
}).strip();
const configSchema = z.object({ branding: brandingSchema.default({}), modules: z.array(z.unknown()).default([]) });

export interface CustomerAccountConfig {
  branding: z.infer<typeof brandingSchema>;
  modules: Array<z.infer<typeof moduleSchema>>;
}

export const DEFAULT_CONFIG: CustomerAccountConfig = {
  branding: {},
  modules: MODULE_KEYS.map((key) => ({ key, enabled: true })),
};

export function sanitizeConfig(raw: unknown): CustomerAccountConfig {
  const parsed = configSchema.safeParse(raw);
  if (!parsed.success) return DEFAULT_CONFIG;
  const seen = new Set<string>();
  const modules: CustomerAccountConfig['modules'] = [];
  for (const m of parsed.data.modules) {
    const pm = moduleSchema.safeParse(m);
    if (!pm.success || seen.has(pm.data.key)) continue;
    seen.add(pm.data.key);
    modules.push(pm.data);
  }
  return { branding: parsed.data.branding, modules };
}
```
(Nếu zod 4 API lệch (`.strip()`/`.default()`) → chỉnh theo zod bản repo, giữ hành vi test.)

- [ ] **Step 3: `queries.ts` + `_shared.ts` + 2 route**

```ts
// features/customer-account/queries.ts
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { sanitizeConfig, type CustomerAccountConfig } from './config-schema';

const assetUrl = (id: string | undefined) => (id ? `/api/customer-account/assets/${id}` : null);

export async function getPublicConfig(storeId: string) {
  const [row] = await db.select().from(schema.customerAccountConfigs)
    .where(eq(schema.customerAccountConfigs.storeId, storeId)).limit(1);
  if (!row || !row.enabled) return { enabled: false as const, branding: {}, modules: [] };
  const cfg: CustomerAccountConfig = sanitizeConfig(row.config);
  return {
    enabled: true as const,
    branding: {
      logoUrl: assetUrl(cfg.branding.logoAssetId), heroUrl: assetUrl(cfg.branding.heroAssetId),
      supportEmail: cfg.branding.supportEmail ?? null, announcement: cfg.branding.announcement ?? null,
    },
    modules: cfg.modules.filter((m) => m.enabled).map((m) => ({
      key: m.key, title: m.title ?? null, iconUrl: assetUrl(m.iconAssetId),
    })),
  };
}

export async function getAsset(assetId: string) {
  const [row] = await db.select({ fileKey: schema.customerAccountAssets.fileKey, contentType: schema.customerAccountAssets.contentType })
    .from(schema.customerAccountAssets).where(eq(schema.customerAccountAssets.id, assetId)).limit(1);
  return row ?? null;
}
```

```ts
// app/api/customer-account/_shared.ts
import { NextResponse, type NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { verifySessionToken } from '@/features/customer-account/session-token';

export const CA_CORS = {
  'Access-Control-Allow-Origin': 'https://extensions.shopifycdn.com',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization,Content-Type',
};
export function preflight(): Response { return new Response(null, { status: 204, headers: CA_CORS }); }
export const caJson = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: CA_CORS });

export async function authenticateExtension(req: NextRequest): Promise<{ store: { id: string }; customerId: string | null } | Response> {
  const secrets = (process.env.CUSTOMER_ACCOUNT_APP_SECRETS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (secrets.length === 0) return caJson({ error: 'CUSTOMER_ACCOUNT_APP_SECRETS not configured' }, 500);
  const auth = req.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return caJson({ error: 'missing bearer token' }, 401);
  const clientIds = (process.env.CUSTOMER_ACCOUNT_APP_CLIENT_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const v = verifySessionToken(token, secrets, { allowedClientIds: clientIds });
  if (!v.ok) return caJson({ error: 'invalid token', reason: v.reason }, 401);
  const [store] = await db.select({ id: schema.stores.id }).from(schema.stores)
    .where(eq(schema.stores.shopDomain, v.shopDomain)).limit(1);
  if (!store) return caJson({ error: 'unknown shop' }, 404);
  return { store, customerId: v.customerId };
}
```

```ts
// app/api/customer-account/config/route.ts
/** GET /api/customer-account/config — extension đọc config per-store. Bearer session token. */
import { type NextRequest } from 'next/server';
import { authenticateExtension, caJson, preflight } from '../_shared';
import { getPublicConfig } from '@/features/customer-account/queries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function OPTIONS(): Promise<Response> { return preflight(); }
export async function GET(req: NextRequest): Promise<Response> {
  const auth = await authenticateExtension(req);
  if (auth instanceof Response) return auth;
  return caJson(await getPublicConfig(auth.store.id));
}
```

```ts
// app/api/customer-account/assets/[assetId]/route.ts
/** GET — public ảnh PNG (302 → signed URL S3). Không cần token (chỉ ảnh). */
import { NextResponse, type NextRequest } from 'next/server';
import { getAsset } from '@/features/customer-account/queries';
import { getSignedDownloadUrl } from '@/lib/storage/s3';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, ctx: { params: Promise<{ assetId: string }> }): Promise<Response> {
  const { assetId } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/.test(assetId)) return NextResponse.json({ error: 'bad id' }, { status: 400 });
  const asset = await getAsset(assetId);
  if (!asset) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const url = await getSignedDownloadUrl(asset.fileKey, 300);
  return NextResponse.redirect(url, 302);
}
```
(Kiểm chữ ký `getSignedDownloadUrl` thật trong `lib/storage/s3.ts` — chỉnh param nếu lệch.)

- [ ] **Step 4: Test route auth (không chạm DB)**

```ts
// features/customer-account/routes-auth.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import type { NextRequest } from 'next/server';
import { GET as configGET, OPTIONS as configOPTIONS } from '@/app/api/customer-account/config/route';

beforeAll(() => { process.env.CUSTOMER_ACCOUNT_APP_SECRETS = 'test-secret'; });
const req = (headers: Record<string, string> = {}) =>
  new Request('https://x/api/customer-account/config', { headers }) as unknown as NextRequest;

describe('config route auth', () => {
  it('OPTIONS → 204 + CORS origin extensions.shopifycdn.com', async () => {
    const r = await configOPTIONS();
    expect(r.status).toBe(204);
    expect(r.headers.get('access-control-allow-origin')).toBe('https://extensions.shopifycdn.com');
  });
  it('thiếu bearer → 401 (kèm CORS)', async () => {
    const r = await configGET(req());
    expect(r.status).toBe(401);
    expect(r.headers.get('access-control-allow-origin')).toBe('https://extensions.shopifycdn.com');
  });
  it('token rác → 401 reason', async () => {
    const r = await configGET(req({ authorization: 'Bearer junk' }));
    expect(r.status).toBe(401);
    expect((await r.json()).reason).toBe('malformed');
  });
});
```

- [ ] **Step 5: PASS cả 2 test + tsc + eslint + commit**

Run: `npx vitest run features/customer-account/` → PASS. `npx tsc --noEmit` → 0. `npx eslint app/api/customer-account features/customer-account` → 0.
```bash
git add features/customer-account/config-schema.ts features/customer-account/config-schema.test.ts features/customer-account/queries.ts features/customer-account/routes-auth.test.ts app/api/customer-account
git commit -m "feat(customer-account): config schema thuần + API config/assets (session token + CORS)"
```

---

### Task 4: Admin UI `/f/customer-account` + upload PNG + nav

**Files:**
- Create `features/customer-account/admin-actions.ts` · Test `features/customer-account/png.test.ts`
- Create `features/customer-account/png.ts`
- Create `features/customer-account/admin-queries.ts`
- Create `app/(dashboard)/f/customer-account/page.tsx`
- Create `app/(dashboard)/f/customer-account/ConfigEditor.tsx`
- Modify `lib/nav.ts` (thêm entry)

**Interfaces:**
- Consumes: `sanitizeConfig`/`DEFAULT_CONFIG`/`MODULE_KEYS` (T3), schema (T1), `putObject` (`@/lib/storage/s3` — kiểm chữ ký), RBAC `hasPermission(role,'view_functions'|'manage_functions')` + auth/getRole pattern các trang `/f/*`.
- Produces:
```ts
// png.ts (thuần)
export function isPngBytes(bytes: Uint8Array): boolean; // magic 89 50 4E 47
// admin-queries.ts
export async function listStoresBasic(): Promise<Array<{ id: string; name: string; shopDomain: string }>>;
export async function getAdminConfig(storeId: string): Promise<{ enabled: boolean; config: CustomerAccountConfig }>;
export async function listAssets(storeId: string): Promise<Array<{ id: string; kind: string; filename: string }>>;
// admin-actions.ts ('use server', guard manage_functions — pattern try/catch trả {ok:false,error})
export async function saveCustomerAccountConfig(storeId: string, enabled: boolean, rawConfig: unknown): Promise<{ ok: boolean; error?: string }>;
export async function uploadCustomerAccountAsset(storeId: string, kind: string, formData: FormData): Promise<{ ok: boolean; assetId?: string; error?: string }>;
```

- [ ] **Step 1: Test png (FAIL) → implement**

```ts
// features/customer-account/png.test.ts
import { describe, it, expect } from 'vitest';
import { isPngBytes } from './png';
describe('isPngBytes', () => {
  it('magic PNG đúng → true', () => {
    expect(isPngBytes(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]))).toBe(true);
  });
  it('JPEG/rỗng/ngắn → false', () => {
    expect(isPngBytes(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe(false);
    expect(isPngBytes(new Uint8Array([]))).toBe(false);
    expect(isPngBytes(new Uint8Array([0x89, 0x50]))).toBe(false);
  });
});
```
```ts
// features/customer-account/png.ts
/** THUẦN: check magic bytes PNG (\x89PNG). */
export function isPngBytes(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
}
```

- [ ] **Step 2: `admin-queries.ts` + `admin-actions.ts`**

admin-queries: select stores (id,name,shopDomain order by name); config row (`sanitizeConfig(row?.config)`, enabled ?? false, không có row → DEFAULT); assets theo store (id, kind, filename, createdAt desc).

admin-actions (`'use server'`): guard đầu mỗi action —
```ts
async function requireManageFunctions(): Promise<void> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error('Unauthenticated');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'manage_functions')) throw new Error('Forbidden');
}
```
(import `auth`/`getRole`/`hasPermission`/`headers` như các actions hiện có — mở `features/ship-ho/require-manage.ts` đối chiếu pattern.)
- `saveCustomerAccountConfig`: sanitizeConfig(rawConfig) → upsert `customerAccountConfigs` (onConflictDoUpdate theo storeId, set enabled/config/updatedAt) → `{ok:true}`; lỗi → `{ok:false,error}`.
- `uploadCustomerAccountAsset`: lấy `formData.get('file')` là File; check `type === 'image/png'` + `isPngBytes(new Uint8Array(await file.arrayBuffer()))` (sai → `{ok:false,error:'Chỉ nhận PNG'}`); `kind` ∈ logo|hero|icon; key `customer-account/${storeId}/${crypto.randomUUID()}.png`; `putObject(key, bytes, 'image/png')`; insert row; trả `{ok:true, assetId}` + `revalidatePath('/f/customer-account')`.

- [ ] **Step 3: Page + ConfigEditor**

`page.tsx` (server): RBAC gate `view_functions` (mirror trang `/f/*` bất kỳ — auth/getRole/hasPermission/Forbidden); `searchParams {store?}`; load `listStoresBasic()`; nếu có store → `getAdminConfig` + `listAssets`; render tiêu đề "Customer Account Builder" + mô tả + `<ConfigEditor stores config assets activeStoreId canManage={hasPermission(role,'manage_functions')} />`.

`ConfigEditor.tsx` ('use client'): store `<select>` đẩy `?store=` (router.push); form: toggle Bật/Tắt; branding (supportEmail input, announcement textarea, logo/hero: select từ assets kind tương ứng + form upload file PNG riêng gọi `uploadCustomerAccountAsset`); bảng 5 module (checkbox enabled, input title, select icon từ assets kind icon, nút ↑↓ đổi thứ tự trong state); nút "Lưu" → `saveCustomerAccountConfig(storeId, enabled, {branding, modules})` → toast/text kết quả. Preview ảnh: `<img src={/api/customer-account/assets/${id}} className="h-8" alt="" />` trên nền caro (`bg-[conic-gradient(...)]` đơn giản hoặc `bg-muted`) để thấy PNG không nền. Disable control khi `!canManage`.

- [ ] **Step 4: Nav** — `lib/nav.ts` NAV thêm (trước Settings):
```ts
  { href: '/f/customer-account', label: 'Customer Account', icon: UserRound, requires: 'view_functions' },
```
(import `UserRound` từ lucide-react — verify tên export tồn tại, nếu không dùng `CircleUserRound`/`Users`.) Chạy `npx vitest run lib/nav.test.ts` — nếu test assert danh sách/số lượng NAV → cập nhật test tương ứng (thêm entry mới vào expectation, KHÔNG xoá assertion).

- [ ] **Step 5: Verify + commit**

Run: `npx vitest run features/customer-account/ lib/nav.test.ts` → PASS · `npx tsc --noEmit` → 0 · `npx eslint "app/(dashboard)/f/customer-account" features/customer-account lib/nav.ts` → 0.
```bash
git add features/customer-account app/(dashboard)/f/customer-account lib/nav.ts lib/nav.test.ts
git commit -m "feat(customer-account): admin UI config per-store + upload PNG (magic bytes) + nav"
```

---

## Self-Review (đã chạy)

- **Spec coverage P1 (§4/§5-config/§6-config):** schema+migration (T1) ✓ · verify JWT (T2) ✓ · config API + CORS + assets 302 (T3) ✓ · admin UI + upload PNG + nav (T4) ✓. Returns/loyalty/orders API = P2 (đúng phase).
- **Placeholder scan:** sạch — mọi bước có code; chỗ "kiểm chữ ký thật" là chỉ dẫn đối chiếu, kèm hành vi mong đợi.
- **Type consistency:** `verifySessionToken` (T2) dùng ở `_shared` (T3); `sanitizeConfig`/`CustomerAccountConfig` (T3) dùng ở queries/admin (T3/T4); `isPngBytes` (T4); env names khớp Global Constraints; asset URL path khớp giữa queries (T3) và preview (T4).
- **Rủi ro:** zod 4 API (`.strip()`) — implementer chỉnh theo bản repo; `jsonb` import trong schema.ts (kiểm dòng import); nav.test có thể assert cấu trúc → cập nhật đúng cách; `getSignedDownloadUrl`/`putObject` chữ ký kiểm thực tế.
