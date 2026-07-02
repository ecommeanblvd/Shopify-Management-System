# Ship Hộ — Phase 1 (MVP core) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tạo được đơn ship hộ (nhập tay) cho brand đối tác, tính cước carrier thật qua engine + markup theo partner, hiển thị list/detail.

**Architecture:** Module mới `features/ship-ho/` + routes `app/(dashboard)/f/ship-ho/`, dữ liệu cô lập khỏi `shopifyOrders`/`shipments`. Tái dùng `carrier-rates/engine` (quote) + `mmpBrands` (đối tác). Logic thuần (`applyMarkup`, normalize cước→VND) tách file test được; server actions mỏng.

**Tech Stack:** Next.js App Router (server components + server actions), Drizzle ORM (Postgres), Vitest, better-auth + RBAC, Tailwind + shadcn ui.

## Global Constraints

- Đây là customized Next.js — đọc `node_modules/next/dist/docs/` nếu cần; migration **hand-authored** (không dùng `drizzle-kit generate`).
- Tiền tệ P1: thu partner bằng **VND** (0 chữ số thập phân). Nếu carrier account không quy được về VND → quote fail, đơn giữ `draft`.
- Giá lưu **snapshot bất biến** (`carrierCostVnd`, `markupPercent`, `chargedVnd`, `quoteBreakdown`) — không đổi khi rate card/fuel đổi sau đó.
- Mọi bảng mới prefix `ship_ho_*`; chỉ FK ra ngoài tới `mmp_brands.slug` + `carrier_accounts.id` (read-only).
- P1 KHÔNG làm: import lô, tracking/auto-track, statement/đối soát (để P2/P3). Bảng `ship_ho_statements` được tạo sẵn ở migration nhưng chưa dùng.
- Server actions bắt đầu bằng `'use server'`; numeric lưu dạng **string** khi insert (Drizzle numeric). Page kiểm quyền qua `hasPermission(role, 'view_ship_ho')` / `'manage_ship_ho'`.
- Chạy trước khi push: `npx tsc --noEmit` + `npx vitest run` phải xanh.

---

## File Structure

| File | Trách nhiệm |
|---|---|
| `db/schema.ts` (modify) | + 4 enum + 3 bảng `ship_ho_*` |
| `db/migrations/0083_ship-ho.sql` (create) | CREATE TYPE + CREATE TABLE (hand-authored) |
| `db/migrations/meta/_journal.json` (modify) | + entry idx 83 |
| `lib/auth/rbac.ts` (modify) | + `view_ship_ho`, `manage_ship_ho` cho admin/operator |
| `features/ship-ho/markup.ts` (+test) | `applyMarkup` thuần |
| `features/ship-ho/quote-adapter.ts` (+test) | `pickCarrierCostVnd` (thuần) + `quoteShipHoOrder` (I/O gọi engine) |
| `features/ship-ho/partners-actions.ts` (create) | CRUD `ship_ho_partners` |
| `features/ship-ho/orders-actions.ts` (create) | create / (re)quote đơn |
| `features/ship-ho/queries.ts` (create) | list + detail read |
| `app/(dashboard)/f/ship-ho/page.tsx` | list đơn |
| `app/(dashboard)/f/ship-ho/new/page.tsx` + `NewOrderForm.tsx` | form tạo đơn tay |
| `app/(dashboard)/f/ship-ho/[id]/page.tsx` | detail đơn (breakdown giá) |
| `app/(dashboard)/f/ship-ho/partners/page.tsx` + `PartnersManager.tsx` | cấu hình partner |

---

### Task 1: Schema + migration 0083 + RBAC

**Files:**
- Modify: `db/schema.ts` (append at end of file)
- Create: `db/migrations/0083_ship-ho.sql`
- Modify: `db/migrations/meta/_journal.json`
- Modify: `lib/auth/rbac.ts`

**Interfaces:**
- Produces: `schema.shipHoPartners`, `schema.shipHoOrders`, `schema.shipHoStatements` (Drizzle tables); enums `shipHoBillingCycleEnum`, `shipHoPartnerStatusEnum`, `shipHoOrderStatusEnum`, `shipHoStatementStatusEnum`. Permissions `'view_ship_ho'`, `'manage_ship_ho'`.

- [ ] **Step 1: Add enums + tables to `db/schema.ts`**

Append to the end of `db/schema.ts`:

```ts
// ---- Ship Hộ (partner proxy shipping) -------------------------------------
export const shipHoBillingCycleEnum = pgEnum('ship_ho_billing_cycle', ['weekly', 'monthly']);
export const shipHoPartnerStatusEnum = pgEnum('ship_ho_partner_status', ['active', 'inactive']);
export const shipHoOrderStatusEnum = pgEnum('ship_ho_order_status', [
  'draft', 'quoted', 'shipped', 'delivered', 'billed', 'settled',
]);
export const shipHoStatementStatusEnum = pgEnum('ship_ho_statement_status', ['draft', 'issued', 'paid']);

/** Bật dịch vụ ship hộ cho 1 brand (mmp_brands). 1 config / brand. */
export const shipHoPartners = pgTable('ship_ho_partners', {
  id: uuid('id').defaultRandom().primaryKey(),
  brandSlug: text('brand_slug').references(() => mmpBrands.slug).notNull().unique(),
  markupPercent: numeric('markup_percent', { precision: 8, scale: 4 }).notNull().default('0'),
  billingCycle: shipHoBillingCycleEnum('billing_cycle').notNull().default('monthly'),
  billingCurrency: text('billing_currency').notNull().default('VND'),
  status: shipHoPartnerStatusEnum('status').notNull().default('active'),
  note: text('note'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

/** Bảng kê kỳ (P3 dùng; tạo sẵn để ship_ho_orders.statement_id FK được). */
export const shipHoStatements = pgTable('ship_ho_statements', {
  id: uuid('id').defaultRandom().primaryKey(),
  partnerBrandSlug: text('partner_brand_slug').references(() => mmpBrands.slug).notNull(),
  periodStart: date('period_start').notNull(),
  periodEnd: date('period_end').notNull(),
  orderCount: integer('order_count').notNull().default(0),
  totalChargedVnd: numeric('total_charged_vnd', { precision: 16, scale: 2 }).notNull().default('0'),
  status: shipHoStatementStatusEnum('status').notNull().default('draft'),
  issuedAt: timestamp('issued_at'),
  paidAt: timestamp('paid_at'),
  fileKey: text('file_key'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

/** Đơn ship hộ (nhập tay P1; import lô P2). */
export const shipHoOrders = pgTable('ship_ho_orders', {
  id: uuid('id').defaultRandom().primaryKey(),
  code: text('code').notNull(),
  partnerBrandSlug: text('partner_brand_slug').references(() => mmpBrands.slug).notNull(),
  // Người nhận
  recipientName: text('recipient_name'),
  recipientCompany: text('recipient_company'),
  recipientPhone: text('recipient_phone'),
  country: text('country').notNull(),
  city: text('city'),
  province: text('province'),
  postcode: text('postcode'),
  address1: text('address1'),
  address2: text('address2'),
  // Kiện
  weightKg: numeric('weight_kg', { precision: 10, scale: 3 }).notNull(),
  dimLengthCm: numeric('dim_length_cm', { precision: 10, scale: 2 }),
  dimWidthCm: numeric('dim_width_cm', { precision: 10, scale: 2 }),
  dimHeightCm: numeric('dim_height_cm', { precision: 10, scale: 2 }),
  packagingType: text('packaging_type'), // 'bag' | 'box' | null
  // Carrier
  carrierKey: text('carrier_key'),
  carrierAccountId: uuid('carrier_account_id').references(() => carrierAccounts.id),
  // Giá (snapshot bất biến)
  carrierCostVnd: numeric('carrier_cost_vnd', { precision: 16, scale: 2 }),
  markupPercent: numeric('markup_percent', { precision: 8, scale: 4 }),
  chargedVnd: numeric('charged_vnd', { precision: 16, scale: 2 }),
  quoteBreakdown: jsonb('quote_breakdown'),
  quotedAt: timestamp('quoted_at'),
  // Tracking (P2)
  trackingNumber: text('tracking_number'),
  deliveryStatus: text('delivery_status'),
  deliveredAt: timestamp('delivered_at'),
  lastTrackedAt: timestamp('last_tracked_at'),
  // Đối soát (P3)
  actualCarrierCostVnd: numeric('actual_carrier_cost_vnd', { precision: 16, scale: 2 }),
  reconcileStatus: text('reconcile_status'),
  deltaVnd: numeric('delta_vnd', { precision: 16, scale: 2 }),
  marginVnd: numeric('margin_vnd', { precision: 16, scale: 2 }),
  // Bill (P3)
  statementId: uuid('statement_id').references(() => shipHoStatements.id),
  status: shipHoOrderStatusEnum('status').notNull().default('draft'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  createdBy: text('created_by'),
});
```

- [ ] **Step 2: Write migration `db/migrations/0083_ship-ho.sql`**

```sql
CREATE TYPE "ship_ho_billing_cycle" AS ENUM('weekly', 'monthly');
CREATE TYPE "ship_ho_partner_status" AS ENUM('active', 'inactive');
CREATE TYPE "ship_ho_order_status" AS ENUM('draft', 'quoted', 'shipped', 'delivered', 'billed', 'settled');
CREATE TYPE "ship_ho_statement_status" AS ENUM('draft', 'issued', 'paid');

CREATE TABLE "ship_ho_partners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_slug" text NOT NULL,
	"markup_percent" numeric(8, 4) DEFAULT '0' NOT NULL,
	"billing_cycle" "ship_ho_billing_cycle" DEFAULT 'monthly' NOT NULL,
	"billing_currency" text DEFAULT 'VND' NOT NULL,
	"status" "ship_ho_partner_status" DEFAULT 'active' NOT NULL,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ship_ho_partners_brand_slug_unique" UNIQUE("brand_slug")
);

CREATE TABLE "ship_ho_statements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_brand_slug" text NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"order_count" integer DEFAULT 0 NOT NULL,
	"total_charged_vnd" numeric(16, 2) DEFAULT '0' NOT NULL,
	"status" "ship_ho_statement_status" DEFAULT 'draft' NOT NULL,
	"issued_at" timestamp,
	"paid_at" timestamp,
	"file_key" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "ship_ho_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"partner_brand_slug" text NOT NULL,
	"recipient_name" text,
	"recipient_company" text,
	"recipient_phone" text,
	"country" text NOT NULL,
	"city" text,
	"province" text,
	"postcode" text,
	"address1" text,
	"address2" text,
	"weight_kg" numeric(10, 3) NOT NULL,
	"dim_length_cm" numeric(10, 2),
	"dim_width_cm" numeric(10, 2),
	"dim_height_cm" numeric(10, 2),
	"packaging_type" text,
	"carrier_key" text,
	"carrier_account_id" uuid,
	"carrier_cost_vnd" numeric(16, 2),
	"markup_percent" numeric(8, 4),
	"charged_vnd" numeric(16, 2),
	"quote_breakdown" jsonb,
	"quoted_at" timestamp,
	"tracking_number" text,
	"delivery_status" text,
	"delivered_at" timestamp,
	"last_tracked_at" timestamp,
	"actual_carrier_cost_vnd" numeric(16, 2),
	"reconcile_status" text,
	"delta_vnd" numeric(16, 2),
	"margin_vnd" numeric(16, 2),
	"statement_id" uuid,
	"status" "ship_ho_order_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text
);

ALTER TABLE "ship_ho_partners" ADD CONSTRAINT "ship_ho_partners_brand_slug_mmp_brands_slug_fk" FOREIGN KEY ("brand_slug") REFERENCES "public"."mmp_brands"("slug") ON DELETE no action ON UPDATE no action;
ALTER TABLE "ship_ho_statements" ADD CONSTRAINT "ship_ho_statements_partner_brand_slug_mmp_brands_slug_fk" FOREIGN KEY ("partner_brand_slug") REFERENCES "public"."mmp_brands"("slug") ON DELETE no action ON UPDATE no action;
ALTER TABLE "ship_ho_orders" ADD CONSTRAINT "ship_ho_orders_partner_brand_slug_mmp_brands_slug_fk" FOREIGN KEY ("partner_brand_slug") REFERENCES "public"."mmp_brands"("slug") ON DELETE no action ON UPDATE no action;
ALTER TABLE "ship_ho_orders" ADD CONSTRAINT "ship_ho_orders_carrier_account_id_carrier_accounts_id_fk" FOREIGN KEY ("carrier_account_id") REFERENCES "public"."carrier_accounts"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "ship_ho_orders" ADD CONSTRAINT "ship_ho_orders_statement_id_ship_ho_statements_id_fk" FOREIGN KEY ("statement_id") REFERENCES "public"."ship_ho_statements"("id") ON DELETE no action ON UPDATE no action;

CREATE INDEX "ship_ho_orders_partner_idx" ON "ship_ho_orders" ("partner_brand_slug");
CREATE INDEX "ship_ho_orders_status_idx" ON "ship_ho_orders" ("status");
```

- [ ] **Step 3: Add journal entry** in `db/migrations/meta/_journal.json` — append inside the `entries` array after idx 82:

```json
    ,{
      "idx": 83,
      "version": "7",
      "when": 1783600800000,
      "tag": "0083_ship-ho",
      "breakpoints": true
    }
```

(Insert the leading comma correctly so the array stays valid: the previous entry's closing `}` is followed by this object.)

- [ ] **Step 4: Add RBAC permissions** in `lib/auth/rbac.ts` — add to the `Permission` union (after `'view_pack_check'` or any line):

```ts
  | 'view_ship_ho'
  | 'manage_ship_ho'
```

Then add `'view_ship_ho', 'manage_ship_ho',` to BOTH the admin and operator permission arrays (the two arrays containing `'view_carrier_rates'`).

- [ ] **Step 5: Verify tsc + apply migration locally**

Run: `npx tsc --noEmit`
Expected: exit 0.

Run: `railway run npm run db:migrate` (applies 0083 to the DB the env points at)
Expected: migration 0083 applied, no error.

- [ ] **Step 6: Commit**

```bash
git add db/schema.ts db/migrations/0083_ship-ho.sql db/migrations/meta/_journal.json lib/auth/rbac.ts
git commit -m "feat(ship-ho): schema 3 bảng ship_ho_* + migration 0083 + RBAC"
```

---

### Task 2: `applyMarkup` (pure)

**Files:**
- Create: `features/ship-ho/markup.ts`
- Test: `features/ship-ho/markup.test.ts`

**Interfaces:**
- Produces: `applyMarkup(carrierCostVnd: number, markupPercent: number): number` — VND (0 lẻ), clamp ≥ 0.

- [ ] **Step 1: Write the failing test** `features/ship-ho/markup.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { applyMarkup } from './markup';

describe('applyMarkup', () => {
  it('cộng markup% và làm tròn VND (0 lẻ)', () => {
    expect(applyMarkup(100000, 20)).toBe(120000);
    expect(applyMarkup(100000, 0)).toBe(100000);
  });

  it('làm tròn tới VND gần nhất', () => {
    // 100000 * 1.155 = 115500 ; 100001 * 1.1 = 110001.1 → 110001
    expect(applyMarkup(100000, 15.5)).toBe(115500);
    expect(applyMarkup(100001, 10)).toBe(110001);
  });

  it('markup âm không cho ra số âm (clamp ≥ 0)', () => {
    expect(applyMarkup(100000, -150)).toBe(0);
  });

  it('cost 0 → 0', () => {
    expect(applyMarkup(0, 50)).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run features/ship-ho/markup.test.ts`
Expected: FAIL — "Cannot find module './markup'".

- [ ] **Step 3: Implement** `features/ship-ho/markup.ts`

```ts
/**
 * THUẦN: giá thu partner = cước carrier (VND) cộng markup%.
 * Làm tròn tới VND gần nhất (VND không có phần thập phân), clamp ≥ 0.
 */
export function applyMarkup(carrierCostVnd: number, markupPercent: number): number {
  const raw = carrierCostVnd * (1 + markupPercent / 100);
  return Math.max(0, Math.round(raw));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run features/ship-ho/markup.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add features/ship-ho/markup.ts features/ship-ho/markup.test.ts
git commit -m "feat(ship-ho): applyMarkup thuần + test"
```

---

### Task 3: quote-adapter (normalize cước→VND thuần + gọi engine)

**Files:**
- Create: `features/ship-ho/quote-adapter.ts`
- Test: `features/ship-ho/quote-adapter.test.ts`

**Interfaces:**
- Consumes: `loadAccountSnapshot(db, accountId)` + `quote(snap, input)` từ `@/features/carrier-rates/engine/quote` và `.../engine/load`; `QuoteBreakdown` type.
- Produces:
  - `pickCarrierCostVnd(snap: {costCurrency,displayCurrency}, breakdown: {carrierCost,carrierCostDisplay}): { ok: true; vnd: number } | { ok: false; reason: string }` (thuần)
  - `quoteShipHoOrder(input: ShipHoQuoteInput): Promise<ShipHoQuoteResult>` (I/O)
  - types `ShipHoQuoteInput`, `ShipHoQuoteResult`.

- [ ] **Step 1: Write the failing test** `features/ship-ho/quote-adapter.test.ts` (chỉ test phần thuần `pickCarrierCostVnd`)

```ts
import { describe, it, expect } from 'vitest';
import { pickCarrierCostVnd } from './quote-adapter';

describe('pickCarrierCostVnd', () => {
  it('costCurrency VND → lấy carrierCost', () => {
    const r = pickCarrierCostVnd(
      { costCurrency: 'VND', displayCurrency: 'USD' },
      { carrierCost: 123456, carrierCostDisplay: 4.75 },
    );
    expect(r).toEqual({ ok: true, vnd: 123456 });
  });

  it('displayCurrency VND (cost khác) → lấy carrierCostDisplay', () => {
    const r = pickCarrierCostVnd(
      { costCurrency: 'USD', displayCurrency: 'VND' },
      { carrierCost: 4.75, carrierCostDisplay: 124000 },
    );
    expect(r).toEqual({ ok: true, vnd: 124000 });
  });

  it('không có VND ở đâu → fail có reason', () => {
    const r = pickCarrierCostVnd(
      { costCurrency: 'USD', displayCurrency: 'EUR' },
      { carrierCost: 4.75, carrierCostDisplay: 4.4 },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('non_vnd');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run features/ship-ho/quote-adapter.test.ts`
Expected: FAIL — "Cannot find module './quote-adapter'".

- [ ] **Step 3: Implement** `features/ship-ho/quote-adapter.ts`

```ts
/**
 * Adapter giữa đơn ship hộ và engine carrier-rates. Phần THUẦN
 * (`pickCarrierCostVnd`) quy cước carrier về VND từ breakdown; phần I/O
 * (`quoteShipHoOrder`) nạp snapshot account rồi gọi engine `quote`.
 */
import { db } from '@/db/client';
import { loadAccountSnapshot } from '@/features/carrier-rates/engine/load';
import { quote, type QuoteBreakdown } from '@/features/carrier-rates/engine/quote';

export interface ShipHoQuoteInput {
  carrierAccountId: string;
  weightKg: number;
  dimensions?: { lengthCm: number; widthCm: number; heightCm: number } | null;
  packagingType?: 'bag' | 'box' | null;
  destinationCountry: string;
  destinationPostcode?: string;
  destinationCity?: string;
}

export type ShipHoQuoteResult =
  | { ok: true; carrierCostVnd: number; zone: string; breakdown: QuoteBreakdown }
  | { ok: false; reason: string };

/** THUẦN: chọn cước ở VND. VND có thể là cost- hoặc display-currency của account. */
export function pickCarrierCostVnd(
  snap: { costCurrency: string; displayCurrency: string },
  breakdown: { carrierCost: number; carrierCostDisplay: number },
): { ok: true; vnd: number } | { ok: false; reason: string } {
  if (snap.costCurrency === 'VND') return { ok: true, vnd: breakdown.carrierCost };
  if (snap.displayCurrency === 'VND') return { ok: true, vnd: breakdown.carrierCostDisplay };
  return {
    ok: false,
    reason: `non_vnd_currency(cost=${snap.costCurrency},display=${snap.displayCurrency})`,
  };
}

/** I/O: nạp snapshot + gọi engine, quy cước về VND. */
export async function quoteShipHoOrder(input: ShipHoQuoteInput): Promise<ShipHoQuoteResult> {
  const snap = await loadAccountSnapshot(db, input.carrierAccountId);
  if (!snap) return { ok: false, reason: 'carrier_account_not_found' };

  const res = quote(snap, {
    weightKg: input.weightKg,
    dimensions: input.dimensions ?? null,
    packagingType: input.packagingType ?? null,
    destinationCountry: input.destinationCountry,
    destinationPostcode: input.destinationPostcode,
    destinationCity: input.destinationCity,
  });
  if (!res.ok) return { ok: false, reason: res.code };

  const vnd = pickCarrierCostVnd(snap, res.breakdown);
  if (!vnd.ok) return { ok: false, reason: vnd.reason };

  return { ok: true, carrierCostVnd: vnd.vnd, zone: res.zone, breakdown: res.breakdown };
}
```

> NOTE: xác nhận chữ ký `loadAccountSnapshot(db, accountId)` khi implement — đọc `features/carrier-rates/engine/load.ts:16`. Nếu nó chỉ nhận `(accountId)` thì bỏ tham số `db`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run features/ship-ho/quote-adapter.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Verify tsc**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add features/ship-ho/quote-adapter.ts features/ship-ho/quote-adapter.test.ts
git commit -m "feat(ship-ho): quote-adapter (pickCarrierCostVnd thuần + quoteShipHoOrder)"
```

---

### Task 4: partners actions (CRUD ship_ho_partners)

**Files:**
- Create: `features/ship-ho/partners-actions.ts`

**Interfaces:**
- Consumes: `schema.shipHoPartners`, `schema.mmpBrands` (Task 1).
- Produces:
  - `listShipHoPartners(): Promise<Array<{ id, brandSlug, displayName, markupPercent, billingCycle, billingCurrency, status, note }>>`
  - `listBrandsForShipHo(): Promise<Array<{ slug, displayName }>>`
  - `createShipHoPartner(input): Promise<{ ok: boolean; error?: string }>` với `input = { brandSlug, markupPercent, billingCycle, billingCurrency, note? }`
  - `updateShipHoPartner(id, input): Promise<{ ok: boolean; error?: string }>`

- [ ] **Step 1: Implement** `features/ship-ho/partners-actions.ts`

```ts
'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db, schema } from '@/db/client';

export async function listBrandsForShipHo() {
  return db
    .select({ slug: schema.mmpBrands.slug, displayName: schema.mmpBrands.displayName })
    .from(schema.mmpBrands)
    .orderBy(schema.mmpBrands.displayName);
}

export async function listShipHoPartners() {
  return db
    .select({
      id: schema.shipHoPartners.id,
      brandSlug: schema.shipHoPartners.brandSlug,
      displayName: schema.mmpBrands.displayName,
      markupPercent: schema.shipHoPartners.markupPercent,
      billingCycle: schema.shipHoPartners.billingCycle,
      billingCurrency: schema.shipHoPartners.billingCurrency,
      status: schema.shipHoPartners.status,
      note: schema.shipHoPartners.note,
    })
    .from(schema.shipHoPartners)
    .leftJoin(schema.mmpBrands, eq(schema.mmpBrands.slug, schema.shipHoPartners.brandSlug))
    .orderBy(schema.mmpBrands.displayName);
}

export interface UpsertPartnerInput {
  brandSlug: string;
  markupPercent: string; // numeric string, e.g. '20'
  billingCycle: 'weekly' | 'monthly';
  billingCurrency: string;
  note?: string;
}

export async function createShipHoPartner(input: UpsertPartnerInput): Promise<{ ok: boolean; error?: string }> {
  if (!input.brandSlug) return { ok: false, error: 'brandSlug required' };
  const mk = Number(input.markupPercent);
  if (!Number.isFinite(mk) || mk < 0) return { ok: false, error: 'markup không hợp lệ' };
  try {
    await db.insert(schema.shipHoPartners).values({
      brandSlug: input.brandSlug,
      markupPercent: input.markupPercent,
      billingCycle: input.billingCycle,
      billingCurrency: input.billingCurrency || 'VND',
      note: input.note || null,
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  revalidatePath('/f/ship-ho/partners');
  return { ok: true };
}

export async function updateShipHoPartner(
  id: string,
  input: Partial<UpsertPartnerInput> & { status?: 'active' | 'inactive' },
): Promise<{ ok: boolean; error?: string }> {
  try {
    await db
      .update(schema.shipHoPartners)
      .set({
        ...(input.markupPercent !== undefined ? { markupPercent: input.markupPercent } : {}),
        ...(input.billingCycle !== undefined ? { billingCycle: input.billingCycle } : {}),
        ...(input.billingCurrency !== undefined ? { billingCurrency: input.billingCurrency } : {}),
        ...(input.note !== undefined ? { note: input.note || null } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      })
      .where(eq(schema.shipHoPartners.id, id));
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  revalidatePath('/f/ship-ho/partners');
  return { ok: true };
}
```

- [ ] **Step 2: Verify tsc**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add features/ship-ho/partners-actions.ts
git commit -m "feat(ship-ho): partners CRUD actions"
```

---

### Task 5: orders actions (create + (re)quote)

**Files:**
- Create: `features/ship-ho/orders-actions.ts`

**Interfaces:**
- Consumes: `applyMarkup` (Task 2), `quoteShipHoOrder` (Task 3), `schema.shipHoOrders`, `schema.shipHoPartners` (Task 1).
- Produces:
  - `createShipHoOrder(input: CreateShipHoOrderInput): Promise<{ ok: boolean; id?: string; error?: string }>`
  - `requoteShipHoOrder(orderId: string): Promise<{ ok: boolean; error?: string }>`
  - type `CreateShipHoOrderInput`.

- [ ] **Step 1: Implement** `features/ship-ho/orders-actions.ts`

```ts
'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db, schema } from '@/db/client';
import { applyMarkup } from './markup';
import { quoteShipHoOrder } from './quote-adapter';

export interface CreateShipHoOrderInput {
  code: string;
  partnerBrandSlug: string;
  recipientName?: string;
  recipientCompany?: string;
  recipientPhone?: string;
  country: string;
  city?: string;
  province?: string;
  postcode?: string;
  address1?: string;
  address2?: string;
  weightKg: string; // numeric string
  dimLengthCm?: string;
  dimWidthCm?: string;
  dimHeightCm?: string;
  packagingType?: 'bag' | 'box' | null;
  carrierKey?: string;
  carrierAccountId?: string;
  createdBy?: string;
}

export async function createShipHoOrder(
  input: CreateShipHoOrderInput,
): Promise<{ ok: boolean; id?: string; error?: string }> {
  if (!input.code?.trim()) return { ok: false, error: 'Thiếu mã đơn' };
  if (!input.partnerBrandSlug) return { ok: false, error: 'Thiếu partner' };
  if (!input.country?.trim()) return { ok: false, error: 'Thiếu quốc gia' };
  if (!Number.isFinite(Number(input.weightKg)) || Number(input.weightKg) <= 0) {
    return { ok: false, error: 'Cân nặng không hợp lệ' };
  }
  let id: string;
  try {
    const [row] = await db
      .insert(schema.shipHoOrders)
      .values({
        code: input.code.trim(),
        partnerBrandSlug: input.partnerBrandSlug,
        recipientName: input.recipientName || null,
        recipientCompany: input.recipientCompany || null,
        recipientPhone: input.recipientPhone || null,
        country: input.country.trim().toUpperCase(),
        city: input.city || null,
        province: input.province || null,
        postcode: input.postcode || null,
        address1: input.address1 || null,
        address2: input.address2 || null,
        weightKg: input.weightKg,
        dimLengthCm: input.dimLengthCm || null,
        dimWidthCm: input.dimWidthCm || null,
        dimHeightCm: input.dimHeightCm || null,
        packagingType: input.packagingType ?? null,
        carrierKey: input.carrierKey || null,
        carrierAccountId: input.carrierAccountId || null,
        status: 'draft',
        createdBy: input.createdBy || null,
      })
      .returning({ id: schema.shipHoOrders.id });
    id = row.id;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  // Auto-quote nếu đã đủ dữ liệu carrier — lỗi quote KHÔNG chặn tạo đơn.
  if (input.carrierAccountId) await requoteShipHoOrder(id);

  revalidatePath('/f/ship-ho');
  return { ok: true, id };
}

/** Tính lại cước + markup, ghi snapshot giá. Đơn giữ 'draft' nếu quote fail. */
export async function requoteShipHoOrder(orderId: string): Promise<{ ok: boolean; error?: string }> {
  const [order] = await db.select().from(schema.shipHoOrders).where(eq(schema.shipHoOrders.id, orderId)).limit(1);
  if (!order) return { ok: false, error: 'Không tìm thấy đơn' };
  if (!order.carrierAccountId) return { ok: false, error: 'Chưa chọn carrier account' };

  const [partner] = await db
    .select()
    .from(schema.shipHoPartners)
    .where(eq(schema.shipHoPartners.brandSlug, order.partnerBrandSlug))
    .limit(1);
  const markupPercent = partner?.markupPercent ?? '0';

  const dims =
    order.dimLengthCm && order.dimWidthCm && order.dimHeightCm
      ? {
          lengthCm: Number(order.dimLengthCm),
          widthCm: Number(order.dimWidthCm),
          heightCm: Number(order.dimHeightCm),
        }
      : null;

  const q = await quoteShipHoOrder({
    carrierAccountId: order.carrierAccountId,
    weightKg: Number(order.weightKg),
    dimensions: dims,
    packagingType: (order.packagingType as 'bag' | 'box' | null) ?? null,
    destinationCountry: order.country,
    destinationPostcode: order.postcode ?? undefined,
    destinationCity: order.city ?? undefined,
  });

  if (!q.ok) {
    await db.update(schema.shipHoOrders).set({ status: 'draft' }).where(eq(schema.shipHoOrders.id, orderId));
    return { ok: false, error: `Quote lỗi: ${q.reason}` };
  }

  const charged = applyMarkup(q.carrierCostVnd, Number(markupPercent));
  await db
    .update(schema.shipHoOrders)
    .set({
      carrierCostVnd: String(q.carrierCostVnd),
      markupPercent: String(markupPercent),
      chargedVnd: String(charged),
      quoteBreakdown: q.breakdown,
      quotedAt: new Date(),
      status: 'quoted',
    })
    .where(eq(schema.shipHoOrders.id, orderId));

  revalidatePath('/f/ship-ho');
  revalidatePath(`/f/ship-ho/${orderId}`);
  return { ok: true };
}
```

- [ ] **Step 2: Verify tsc**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add features/ship-ho/orders-actions.ts
git commit -m "feat(ship-ho): orders create + (re)quote actions"
```

---

### Task 6: queries (list + detail)

**Files:**
- Create: `features/ship-ho/queries.ts`

**Interfaces:**
- Consumes: `schema.shipHoOrders`, `schema.mmpBrands` (Task 1).
- Produces:
  - `listShipHoOrders(filter?: { partnerBrandSlug?: string; status?: string }): Promise<ShipHoOrderRow[]>`
  - `getShipHoOrder(id: string): Promise<typeof schema.shipHoOrders.$inferSelect | null>`
  - type `ShipHoOrderRow`.

- [ ] **Step 1: Implement** `features/ship-ho/queries.ts`

```ts
import { and, desc, eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';

export interface ShipHoOrderRow {
  id: string;
  code: string;
  partnerBrandSlug: string;
  brandName: string | null;
  country: string;
  weightKg: string;
  carrierKey: string | null;
  carrierCostVnd: string | null;
  chargedVnd: string | null;
  status: string;
  createdAt: Date;
}

export async function listShipHoOrders(filter?: {
  partnerBrandSlug?: string;
  status?: string;
}): Promise<ShipHoOrderRow[]> {
  const conds = [];
  if (filter?.partnerBrandSlug) conds.push(eq(schema.shipHoOrders.partnerBrandSlug, filter.partnerBrandSlug));
  if (filter?.status) conds.push(eq(schema.shipHoOrders.status, filter.status as 'draft'));

  return db
    .select({
      id: schema.shipHoOrders.id,
      code: schema.shipHoOrders.code,
      partnerBrandSlug: schema.shipHoOrders.partnerBrandSlug,
      brandName: schema.mmpBrands.displayName,
      country: schema.shipHoOrders.country,
      weightKg: schema.shipHoOrders.weightKg,
      carrierKey: schema.shipHoOrders.carrierKey,
      carrierCostVnd: schema.shipHoOrders.carrierCostVnd,
      chargedVnd: schema.shipHoOrders.chargedVnd,
      status: schema.shipHoOrders.status,
      createdAt: schema.shipHoOrders.createdAt,
    })
    .from(schema.shipHoOrders)
    .leftJoin(schema.mmpBrands, eq(schema.mmpBrands.slug, schema.shipHoOrders.partnerBrandSlug))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(schema.shipHoOrders.createdAt));
}

export async function getShipHoOrder(id: string) {
  const [row] = await db.select().from(schema.shipHoOrders).where(eq(schema.shipHoOrders.id, id)).limit(1);
  return row ?? null;
}
```

- [ ] **Step 2: Verify tsc**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add features/ship-ho/queries.ts
git commit -m "feat(ship-ho): list + detail queries"
```

---

### Task 7: UI routes (list, partners, new, detail)

**Files:**
- Create: `app/(dashboard)/f/ship-ho/page.tsx`
- Create: `app/(dashboard)/f/ship-ho/partners/page.tsx`
- Create: `app/(dashboard)/f/ship-ho/partners/PartnersManager.tsx`
- Create: `app/(dashboard)/f/ship-ho/new/page.tsx`
- Create: `app/(dashboard)/f/ship-ho/new/NewOrderForm.tsx`
- Create: `app/(dashboard)/f/ship-ho/[id]/page.tsx`

**Interfaces:**
- Consumes: `listShipHoOrders`, `getShipHoOrder` (Task 6); `listShipHoPartners`, `listBrandsForShipHo`, `createShipHoPartner`, `updateShipHoPartner` (Task 4); `createShipHoOrder` (Task 5); `listAccounts` từ `@/features/carrier-rates/actions`; auth `hasPermission(role, 'view_ship_ho'|'manage_ship_ho')`.

- [ ] **Step 1: List page** `app/(dashboard)/f/ship-ho/page.tsx`

```tsx
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { listShipHoOrders } from '@/features/ship-ho/queries';
import { Card, CardContent } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';

export const dynamic = 'force-dynamic';

const STATUS_LABEL: Record<string, string> = {
  draft: 'Nháp', quoted: 'Đã báo giá', shipped: 'Đã gửi',
  delivered: 'Đã giao', billed: 'Đã lên bảng kê', settled: 'Đã thanh toán',
};

export default async function ShipHoListPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_ship_ho')) {
    return <div className="max-w-3xl mx-auto px-6 py-16 text-center"><h1 className="text-2xl font-semibold">Forbidden</h1></div>;
  }
  const orders = await listShipHoOrders();

  return (
    <div className="max-w-6xl mx-auto px-6 md:px-10 py-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Đơn ship hộ</h1>
          <p className="text-sm text-muted-foreground">Ship hộ cho đối tác brand ngoài (tách khỏi đơn khách lẻ).</p>
        </div>
        <div className="flex gap-2">
          <Link href="/f/ship-ho/partners" className={buttonVariants({ variant: 'outline' })}>Đối tác</Link>
          <Link href="/f/ship-ho/new" className={buttonVariants({})}>+ Tạo đơn</Link>
        </div>
      </div>
      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b text-muted-foreground">
              <tr className="[&>th]:text-left [&>th]:p-3">
                <th>Mã</th><th>Đối tác</th><th>Đến</th><th>Cân</th><th>Carrier</th><th>Cước gốc</th><th>Giá thu</th><th>Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {orders.length === 0 ? (
                <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">Chưa có đơn ship hộ.</td></tr>
              ) : orders.map((o) => (
                <tr key={o.id} className="border-b hover:bg-muted/40 [&>td]:p-3">
                  <td><Link href={`/f/ship-ho/${o.id}`} className="font-medium underline-offset-2 hover:underline">{o.code}</Link></td>
                  <td>{o.brandName ?? o.partnerBrandSlug}</td>
                  <td>{o.country}</td>
                  <td>{o.weightKg} kg</td>
                  <td>{o.carrierKey ?? '—'}</td>
                  <td>{o.carrierCostVnd ? Number(o.carrierCostVnd).toLocaleString('vi-VN') : '—'}</td>
                  <td className="font-medium">{o.chargedVnd ? Number(o.chargedVnd).toLocaleString('vi-VN') : '—'}</td>
                  <td>{STATUS_LABEL[o.status] ?? o.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Partners page + client manager**

`app/(dashboard)/f/ship-ho/partners/page.tsx`:

```tsx
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { listShipHoPartners, listBrandsForShipHo } from '@/features/ship-ho/partners-actions';
import { PartnersManager } from './PartnersManager';

export const dynamic = 'force-dynamic';

export default async function ShipHoPartnersPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_ship_ho')) {
    return <div className="max-w-3xl mx-auto px-6 py-16 text-center"><h1 className="text-2xl font-semibold">Forbidden</h1></div>;
  }
  const canManage = hasPermission(role, 'manage_ship_ho');
  const [partners, brands] = await Promise.all([listShipHoPartners(), listBrandsForShipHo()]);
  return (
    <div className="max-w-4xl mx-auto px-6 md:px-10 py-8 space-y-6">
      <h1 className="text-3xl font-semibold tracking-tight">Đối tác ship hộ</h1>
      <PartnersManager partners={partners} brands={brands} canManage={canManage} />
    </div>
  );
}
```

`app/(dashboard)/f/ship-ho/partners/PartnersManager.tsx`:

```tsx
'use client';

import { useState, useTransition } from 'react';
import { createShipHoPartner, updateShipHoPartner } from '@/features/ship-ho/partners-actions';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

interface Partner {
  id: string; brandSlug: string; displayName: string | null;
  markupPercent: string; billingCycle: string; billingCurrency: string; status: string; note: string | null;
}
interface Brand { slug: string; displayName: string }

export function PartnersManager({ partners, brands, canManage }: { partners: Partner[]; brands: Brand[]; canManage: boolean }) {
  const [pending, start] = useTransition();
  const [brandSlug, setBrandSlug] = useState('');
  const [markup, setMarkup] = useState('20');
  const [cycle, setCycle] = useState<'weekly' | 'monthly'>('monthly');
  const [err, setErr] = useState<string | null>(null);

  const add = () =>
    start(async () => {
      setErr(null);
      const r = await createShipHoPartner({ brandSlug, markupPercent: markup, billingCycle: cycle, billingCurrency: 'VND' });
      if (!r.ok) setErr(r.error ?? 'Lỗi');
      else { setBrandSlug(''); setMarkup('20'); }
    });

  const toggle = (p: Partner) =>
    start(async () => {
      await updateShipHoPartner(p.id, { status: p.status === 'active' ? 'inactive' : 'active' });
    });

  const existing = new Set(partners.map((p) => p.brandSlug));

  return (
    <div className="space-y-4">
      {canManage && (
        <Card>
          <CardContent className="p-4 flex flex-wrap items-end gap-3">
            <label className="text-sm">Brand
              <select className="block border rounded px-2 py-1 mt-1" value={brandSlug} onChange={(e) => setBrandSlug(e.target.value)}>
                <option value="">— chọn —</option>
                {brands.filter((b) => !existing.has(b.slug)).map((b) => <option key={b.slug} value={b.slug}>{b.displayName}</option>)}
              </select>
            </label>
            <label className="text-sm">Markup %
              <input className="block border rounded px-2 py-1 mt-1 w-24" value={markup} onChange={(e) => setMarkup(e.target.value)} />
            </label>
            <label className="text-sm">Kỳ bill
              <select className="block border rounded px-2 py-1 mt-1" value={cycle} onChange={(e) => setCycle(e.target.value as 'weekly' | 'monthly')}>
                <option value="monthly">Tháng</option><option value="weekly">Tuần</option>
              </select>
            </label>
            <Button onClick={add} disabled={pending || !brandSlug}>Thêm</Button>
            {err && <span className="text-sm text-red-600">{err}</span>}
          </CardContent>
        </Card>
      )}
      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b text-muted-foreground"><tr className="[&>th]:text-left [&>th]:p-3"><th>Brand</th><th>Markup</th><th>Kỳ</th><th>Trạng thái</th><th></th></tr></thead>
            <tbody>
              {partners.map((p) => (
                <tr key={p.id} className="border-b [&>td]:p-3">
                  <td>{p.displayName ?? p.brandSlug}</td>
                  <td>{p.markupPercent}%</td>
                  <td>{p.billingCycle === 'weekly' ? 'Tuần' : 'Tháng'}</td>
                  <td>{p.status === 'active' ? 'Bật' : 'Tắt'}</td>
                  <td className="text-right">{canManage && <Button variant="outline" size="sm" onClick={() => toggle(p)} disabled={pending}>{p.status === 'active' ? 'Tắt' : 'Bật'}</Button>}</td>
                </tr>
              ))}
              {partners.length === 0 && <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">Chưa có đối tác ship hộ.</td></tr>}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 3: New-order page + form**

`app/(dashboard)/f/ship-ho/new/page.tsx`:

```tsx
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { listShipHoPartners } from '@/features/ship-ho/partners-actions';
import { listAccounts } from '@/features/carrier-rates/actions';
import { NewOrderForm } from './NewOrderForm';

export const dynamic = 'force-dynamic';

export default async function NewShipHoOrderPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'manage_ship_ho')) {
    return <div className="max-w-3xl mx-auto px-6 py-16 text-center"><h1 className="text-2xl font-semibold">Forbidden</h1></div>;
  }
  const [partners, accounts] = await Promise.all([listShipHoPartners(), listAccounts()]);
  return (
    <div className="max-w-2xl mx-auto px-6 md:px-10 py-8 space-y-6">
      <h1 className="text-3xl font-semibold tracking-tight">Tạo đơn ship hộ</h1>
      <NewOrderForm
        partners={partners.filter((p) => p.status === 'active').map((p) => ({ slug: p.brandSlug, name: p.displayName ?? p.brandSlug }))}
        accounts={accounts.map((a) => ({ id: a.id, name: a.name, carrierKey: a.carrierKey ?? '' }))}
        userEmail={session.user.email}
      />
    </div>
  );
}
```

`app/(dashboard)/f/ship-ho/new/NewOrderForm.tsx`:

```tsx
'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createShipHoOrder } from '@/features/ship-ho/orders-actions';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

interface PartnerOpt { slug: string; name: string }
interface AccountOpt { id: string; name: string; carrierKey: string }

export function NewOrderForm({ partners, accounts, userEmail }: { partners: PartnerOpt[]; accounts: AccountOpt[]; userEmail: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [f, setF] = useState({
    code: '', partnerBrandSlug: '', recipientName: '', country: '', city: '', postcode: '',
    address1: '', weightKg: '', dimLengthCm: '', dimWidthCm: '', dimHeightCm: '',
    packagingType: '' as '' | 'bag' | 'box', carrierAccountId: '',
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  const submit = () =>
    start(async () => {
      setErr(null);
      const acc = accounts.find((a) => a.id === f.carrierAccountId);
      const r = await createShipHoOrder({
        code: f.code, partnerBrandSlug: f.partnerBrandSlug, recipientName: f.recipientName,
        country: f.country, city: f.city, postcode: f.postcode, address1: f.address1,
        weightKg: f.weightKg, dimLengthCm: f.dimLengthCm || undefined, dimWidthCm: f.dimWidthCm || undefined,
        dimHeightCm: f.dimHeightCm || undefined, packagingType: f.packagingType || null,
        carrierKey: acc?.carrierKey, carrierAccountId: f.carrierAccountId || undefined, createdBy: userEmail,
      });
      if (!r.ok) setErr(r.error ?? 'Lỗi');
      else router.push(`/f/ship-ho/${r.id}`);
    });

  const inputCls = 'block w-full border rounded px-2 py-1 mt-1';
  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <label className="text-sm">Mã đơn *<input className={inputCls} value={f.code} onChange={set('code')} placeholder="DISCN001" /></label>
        <label className="text-sm">Đối tác *
          <select className={inputCls} value={f.partnerBrandSlug} onChange={set('partnerBrandSlug')}>
            <option value="">— chọn —</option>
            {partners.map((p) => <option key={p.slug} value={p.slug}>{p.name}</option>)}
          </select>
        </label>
        <label className="text-sm">Người nhận<input className={inputCls} value={f.recipientName} onChange={set('recipientName')} /></label>
        <div className="grid grid-cols-3 gap-2">
          <label className="text-sm">Quốc gia (ISO2) *<input className={inputCls} value={f.country} onChange={set('country')} placeholder="US" /></label>
          <label className="text-sm">Thành phố<input className={inputCls} value={f.city} onChange={set('city')} /></label>
          <label className="text-sm">Postcode<input className={inputCls} value={f.postcode} onChange={set('postcode')} /></label>
        </div>
        <label className="text-sm">Địa chỉ<input className={inputCls} value={f.address1} onChange={set('address1')} /></label>
        <div className="grid grid-cols-4 gap-2">
          <label className="text-sm">Cân (kg) *<input className={inputCls} value={f.weightKg} onChange={set('weightKg')} /></label>
          <label className="text-sm">D (cm)<input className={inputCls} value={f.dimLengthCm} onChange={set('dimLengthCm')} /></label>
          <label className="text-sm">R (cm)<input className={inputCls} value={f.dimWidthCm} onChange={set('dimWidthCm')} /></label>
          <label className="text-sm">C (cm)<input className={inputCls} value={f.dimHeightCm} onChange={set('dimHeightCm')} /></label>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-sm">Kiểu đóng gói
            <select className={inputCls} value={f.packagingType} onChange={set('packagingType')}>
              <option value="">—</option><option value="bag">Bag (Pak)</option><option value="box">Box</option>
            </select>
          </label>
          <label className="text-sm">Carrier account
            <select className={inputCls} value={f.carrierAccountId} onChange={set('carrierAccountId')}>
              <option value="">— chọn để tính giá —</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
        </div>
        {err && <p className="text-sm text-red-600">{err}</p>}
        <Button onClick={submit} disabled={pending}>{pending ? 'Đang tạo…' : 'Tạo đơn & tính giá'}</Button>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: Detail page** `app/(dashboard)/f/ship-ho/[id]/page.tsx`

```tsx
import { notFound, redirect } from 'next/navigation';
import { headers } from 'next/headers';
import Link from 'next/link';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { getShipHoOrder } from '@/features/ship-ho/queries';
import { Card, CardContent } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';

export const dynamic = 'force-dynamic';

const vnd = (v: string | null) => (v ? Number(v).toLocaleString('vi-VN') + ' ₫' : '—');

export default async function ShipHoDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_ship_ho')) {
    return <div className="max-w-3xl mx-auto px-6 py-16 text-center"><h1 className="text-2xl font-semibold">Forbidden</h1></div>;
  }
  const o = await getShipHoOrder(id);
  if (!o) notFound();

  return (
    <div className="max-w-3xl mx-auto px-6 md:px-10 py-8 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-semibold tracking-tight">{o.code}</h1>
        <Link href="/f/ship-ho" className={buttonVariants({ variant: 'outline' })}>← Danh sách</Link>
      </div>

      <Card><CardContent className="p-4 grid grid-cols-2 gap-3 text-sm">
        <div><span className="text-muted-foreground">Đối tác</span><div>{o.partnerBrandSlug}</div></div>
        <div><span className="text-muted-foreground">Trạng thái</span><div>{o.status}</div></div>
        <div><span className="text-muted-foreground">Người nhận</span><div>{o.recipientName ?? '—'}</div></div>
        <div><span className="text-muted-foreground">Đến</span><div>{[o.address1, o.city, o.postcode, o.country].filter(Boolean).join(', ')}</div></div>
        <div><span className="text-muted-foreground">Cân</span><div>{o.weightKg} kg</div></div>
        <div><span className="text-muted-foreground">Carrier</span><div>{o.carrierKey ?? '—'}</div></div>
      </CardContent></Card>

      <Card><CardContent className="p-4 space-y-2 text-sm">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">Giá</div>
        <div className="flex justify-between"><span>Cước carrier (gốc)</span><span>{vnd(o.carrierCostVnd)}</span></div>
        <div className="flex justify-between"><span>Markup</span><span>{o.markupPercent ? o.markupPercent + '%' : '—'}</span></div>
        <div className="flex justify-between font-semibold border-t pt-2"><span>Giá thu partner</span><span>{vnd(o.chargedVnd)}</span></div>
        {!o.quotedAt && <p className="text-amber-600 text-xs">Chưa tính được giá — kiểm tra carrier account / rate card.</p>}
      </CardContent></Card>
    </div>
  );
}
```

- [ ] **Step 5: Verify tsc + build the route**

Run: `npx tsc --noEmit`
Expected: exit 0.

Run: `npx next build 2>&1 | grep -i "ship-ho\|error" | head` (hoặc chạy `npm run dev` và mở `/f/ship-ho`)
Expected: route `/f/ship-ho` compile, không lỗi type.

- [ ] **Step 6: Commit**

```bash
git add "app/(dashboard)/f/ship-ho"
git commit -m "feat(ship-ho): UI list + partners + tạo đơn + detail"
```

---

## Self-Review

**1. Spec coverage:**
- §3 ranh giới/tái dùng → Task 3 (engine reuse), Task 1 (FK mmp_brands/carrier_accounts). ✔
- §4 data model (3 bảng + 4 enum) → Task 1. ✔
- §5 luồng tính giá (snapshot, applyMarkup, engine adapter, re-quote) → Task 2 + 3 + 5. ✔
- §6 states (draft/quoted; phần shipped→settled thuộc P2/P3) → Task 5 set draft/quoted; enum đủ 6 mức. ✔
- §8 lỗi (quote fail → giữ draft, không tạo giá sai) → Task 5 `requoteShipHoOrder`. ✔
- §9 phân rã file P1 → Task 1–7 khớp bảng file. ✔
- P2/P3 (import, tracking, statement) → KHÔNG có task (đúng phạm vi P1). Bảng `ship_ho_statements` tạo sẵn ở Task 1 để FK hợp lệ. ✔

**2. Placeholder scan:** không có TBD/TODO; mọi step có code/command cụ thể. Một NOTE ở Task 3 yêu cầu xác nhận chữ ký `loadAccountSnapshot` — đây là kiểm chứng thực tế bắt buộc, không phải placeholder.

**3. Type consistency:**
- `applyMarkup(number, number): number` — Task 2 định nghĩa, Task 5 gọi `applyMarkup(q.carrierCostVnd, Number(markupPercent))`. ✔
- `quoteShipHoOrder` trả `{ ok, carrierCostVnd, zone, breakdown }` — Task 3 định nghĩa, Task 5 dùng `q.carrierCostVnd`/`q.breakdown`. ✔
- Tên bảng/cột `schema.shipHoOrders.*` (Task 1) khớp truy vấn Task 5/6 và select UI Task 7. ✔
- `listShipHoPartners` trả `displayName`/`brandSlug`/`status` — Task 4 định nghĩa, Task 7 dùng đúng field. ✔
- numeric lưu dạng string khi insert/update (Task 5 `String(...)`), đọc ra string rồi `Number(...)` khi tính. ✔

## Execution Handoff (điền sau khi lưu plan)
