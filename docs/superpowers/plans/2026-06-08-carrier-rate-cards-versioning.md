# Carrier Rate Cards — base-rate versioning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cho base rate của carrier có **thời gian hiệu lực** (nhiều "rate card" theo ngày) để đối soát đơn theo đúng bảng giá tại ngày ship, không mất dữ liệu cũ và không sửa engine `quote.ts`.

**Architecture:** Thêm entity `carrier_rate_cards` (label + `effective_from`/`effective_to`). `carrier_rate_cells` gắn vào một card qua `rate_card_id` (unique đổi sang `(card, zone, tier, package_type)`). `load.ts` chọn card phủ `effectiveDate` rồi chỉ nạp cells của card đó — `quote.ts` nhận snapshot y như cũ. `reconcile.ts` pre-load mọi card của carrier rồi chọn theo ngày ship từng kiện. Zones/tiers/surcharges giữ chung ở account-level (date-gate surcharge đã có sẵn).

**Tech Stack:** Next.js 16 (App Router) · Drizzle ORM + Postgres · Vitest · TypeScript.

**Spec:** `docs/superpowers/specs/2026-06-08-carrier-rate-cards-versioning-design.md`

---

## File map

- **Modify** `db/schema.ts` — thêm `carrierRateCards`; thêm `rateCardId` vào `carrierRateCells`; đổi unique index.
- **Create** `db/migrations/0035_carrier_rate_cards.sql` — DDL + data-backfill (data-safe).
- **Create** `features/carrier-rates/engine/rate-cards.ts` — pure `pickRateCardForDate()` + DB helper `listRateCards()`.
- **Create** `features/carrier-rates/engine/rate-cards.test.ts` — test pure picker.
- **Modify** `features/carrier-rates/engine/load.ts` — `loadAccountSnapshot(accountId, effectiveDate?)` chọn card theo ngày; export `loadSnapshotForCard()`.
- **Create** `features/carrier-rates/engine/load.test.ts` — 2 card, chọn đúng cells theo ngày.
- **Modify** `features/shipments/reconcile.ts` — pre-load mọi card/carrier, chọn theo ship date; thêm reason `no_rate_card`.
- **Create** `features/shipments/reconcile.test.ts` — đơn 2025 vs 2026 dùng đúng base.
- **Modify** `features/carrier-rates/matrix-actions.ts` — `loadMatrix/setCell/clearCell/importMatrix` scoped theo `rateCardId`.
- **Create** `features/carrier-rates/rate-cards-actions.ts` — `listRateCardsForAccount`, `createRateCard`, `getCurrentCardId`.
- **Create** `features/carrier-rates/rate-cards-actions.test.ts` — overlap guard.
- **Modify** `app/(dashboard)/f/carrier-rates/[id]/matrix/page.tsx` — card selector + management section + bind actions theo card.
- **Create** `scripts/verify-carrier-surcharge-windows.ts` — rà demand/remote/VAT theo năm (data task, read-only report).

---

## Phase 1 — Schema + migration (data-safe)

### Task 1: Thêm `carrier_rate_cards` + `rate_card_id` vào schema

**Files:**
- Modify: `db/schema.ts` (block carrier rates, quanh dòng 290–302)

- [ ] **Step 1: Thêm bảng `carrierRateCards` ngay TRƯỚC `carrierRateCells`**

Trong `db/schema.ts`, chèn trước `export const carrierRateCells = pgTable(...)`:

```ts
// One base-rate sheet with an effective window. A carrier account can have
// several over time (2025 card, 2026 card…). Reconciliation picks the card
// whose [effectiveFrom, effectiveTo] covers a shipment's ship date; the
// calculator/push always use the open card (effectiveTo IS NULL).
export const carrierRateCards = pgTable('carrier_rate_cards', {
  id: uuid('id').defaultRandom().primaryKey(),
  carrierAccountId: uuid('carrier_account_id')
    .references(() => carrierAccounts.id, { onDelete: 'cascade' }).notNull(),
  label: text('label').notNull(),
  // Inclusive lower bound.
  effectiveFrom: date('effective_from').notNull(),
  // Inclusive upper bound; NULL = open-ended "current" card. App logic keeps
  // at most one open card per account and forbids overlapping windows.
  effectiveTo: date('effective_to'),
  createdBy: text('created_by').references(() => user.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('carrier_rate_cards_account_idx').on(t.carrierAccountId),
]);
```

- [ ] **Step 2: Thêm cột `rateCardId` vào `carrierRateCells` và đổi unique index**

Sửa định nghĩa `carrierRateCells`: thêm cột `rateCardId` (sau `carrierWeightTierId`) và thay khối index cuối:

```ts
export const carrierRateCells = pgTable('carrier_rate_cells', {
  id: uuid('id').defaultRandom().primaryKey(),
  rateCardId: uuid('rate_card_id')
    .references(() => carrierRateCards.id, { onDelete: 'cascade' }).notNull(),
  carrierZoneId: uuid('carrier_zone_id').references(() => carrierZones.id, { onDelete: 'cascade' }).notNull(),
  carrierWeightTierId: uuid('carrier_weight_tier_id').references(() => carrierWeightTiers.id, { onDelete: 'cascade' }).notNull(),
  packageType: carrierPackageTypeEnum('package_type').notNull().default('package'),
  costAmount: numeric('cost_amount', { precision: 14, scale: 2 }).notNull(),
  updatedBy: text('updated_by').references(() => user.id),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  // Unique per (card, zone, tier, package_type) — Pak and Package are
  // independent rates for the same destination weight, per rate card.
  uniqueIndex('carrier_rate_cells_card_zone_tier_pkg_idx')
    .on(table.rateCardId, table.carrierZoneId, table.carrierWeightTierId, table.packageType),
]);
```

- [ ] **Step 3: Typecheck (kỳ vọng FAIL ở các caller cũ — sẽ sửa ở các task sau)**

Run: `npm run typecheck`
Expected: lỗi liên quan `rateCardId` thiếu ở `matrix-actions.ts` (insert thiếu cột). Ghi nhận, KHÔNG sửa vội — sẽ xử lý ở Phase 4. Không commit ở step này.

### Task 2: Migration data-safe 0035

**Files:**
- Create: `db/migrations/0035_carrier_rate_cards.sql`
- Modify: `db/migrations/meta/_journal.json` + tạo `db/migrations/meta/0035_snapshot.json`

- [ ] **Step 1: Sinh migration khung bằng drizzle-kit**

Run: `npm run db:generate`
Expected: tạo `db/migrations/0035_*.sql` (tên ngẫu nhiên) + `meta/0035_snapshot.json` + cập nhật `_journal.json`. File SQL sinh ra sẽ có `ADD COLUMN "rate_card_id" ... NOT NULL` → **không data-safe**, ta sẽ thay nội dung ở Step 2.

- [ ] **Step 2: Thay TOÀN BỘ nội dung file SQL 0035 vừa sinh bằng bản data-safe dưới đây**

(Giữ nguyên tên file drizzle đã đặt; chỉ thay nội dung.)

```sql
CREATE TABLE "carrier_rate_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"carrier_account_id" uuid NOT NULL,
	"label" text NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "carrier_rate_cards" ADD CONSTRAINT "carrier_rate_cards_carrier_account_id_carrier_accounts_id_fk" FOREIGN KEY ("carrier_account_id") REFERENCES "public"."carrier_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carrier_rate_cards" ADD CONSTRAINT "carrier_rate_cards_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "carrier_rate_cards_account_idx" ON "carrier_rate_cards" USING btree ("carrier_account_id");--> statement-breakpoint
ALTER TABLE "carrier_rate_cells" ADD COLUMN "rate_card_id" uuid;--> statement-breakpoint
INSERT INTO "carrier_rate_cards" ("carrier_account_id", "label", "effective_from", "effective_to")
SELECT DISTINCT z."carrier_account_id", 'Current (migrated)', DATE '2020-01-01', NULL
FROM "carrier_zones" z
JOIN "carrier_rate_cells" c ON c."carrier_zone_id" = z."id";--> statement-breakpoint
UPDATE "carrier_rate_cells" c
SET "rate_card_id" = rc."id"
FROM "carrier_zones" z, "carrier_rate_cards" rc
WHERE c."carrier_zone_id" = z."id" AND rc."carrier_account_id" = z."carrier_account_id";--> statement-breakpoint
ALTER TABLE "carrier_rate_cells" ALTER COLUMN "rate_card_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "carrier_rate_cells" ADD CONSTRAINT "carrier_rate_cells_rate_card_id_carrier_rate_cards_id_fk" FOREIGN KEY ("rate_card_id") REFERENCES "public"."carrier_rate_cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
DROP INDEX "carrier_rate_cells_zone_tier_pkg_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "carrier_rate_cells_card_zone_tier_pkg_idx" ON "carrier_rate_cells" USING btree ("rate_card_id","carrier_zone_id","carrier_weight_tier_id","package_type");
```

> Lưu ý: `meta/0035_snapshot.json` (drizzle sinh) phản ánh trạng thái CUỐI của schema — giữ nguyên, không sửa. Migrate chỉ chạy file `.sql`; snapshot chỉ dùng cho diff lần sau.

- [ ] **Step 3: Chạy migrate trên một bản sao DB và xác minh không mất data**

Run (đặt `DATABASE_URL` trỏ DB staging/bản sao):
```bash
DATABASE_URL='<staging-url>' npm run db:migrate
```
Expected: migrate thành công. Kiểm chứng bằng psql/script:
```sql
SELECT count(*) FROM carrier_rate_cells WHERE rate_card_id IS NULL;          -- = 0
SELECT carrier_account_id, count(*) FROM carrier_rate_cards GROUP BY 1;       -- 1 card/account-có-cells
```
Expected: 0 cell mồ côi; mỗi account có cells nhận đúng 1 card "Current (migrated)".

- [ ] **Step 4: Commit**

```bash
git add db/schema.ts db/migrations/0035_carrier_rate_cards.sql db/migrations/meta/_journal.json db/migrations/meta/0035_snapshot.json
git commit -m "feat(carrier-rates): add carrier_rate_cards + rate_card_id (data-safe migration)"
```

---

## Phase 2 — Engine: chọn card theo ngày (load.ts), KHÔNG đụng quote.ts

### Task 3: Pure `pickRateCardForDate` + helper `listRateCards`

**Files:**
- Create: `features/carrier-rates/engine/rate-cards.ts`
- Test: `features/carrier-rates/engine/rate-cards.test.ts`

- [ ] **Step 1: Viết test fail trước**

Tạo `features/carrier-rates/engine/rate-cards.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { pickRateCardForDate, type RateCardWindow } from './rate-cards';

const cards: RateCardWindow[] = [
  { id: 'c2025', effectiveFrom: new Date('2025-01-01'), effectiveTo: new Date('2026-01-04') },
  { id: 'c2026', effectiveFrom: new Date('2026-01-05'), effectiveTo: null },
];

describe('pickRateCardForDate', () => {
  it('picks the 2025 card for a ship date inside its window', () => {
    expect(pickRateCardForDate(cards, new Date('2025-07-09'))?.id).toBe('c2025');
  });
  it('includes the inclusive upper bound (04/01/2026 → 2025 card)', () => {
    expect(pickRateCardForDate(cards, new Date('2026-01-04'))?.id).toBe('c2025');
  });
  it('picks the open 2026 card for the day after cutover', () => {
    expect(pickRateCardForDate(cards, new Date('2026-01-05'))?.id).toBe('c2026');
  });
  it('picks the open card for a future date', () => {
    expect(pickRateCardForDate(cards, new Date('2030-01-01'))?.id).toBe('c2026');
  });
  it('returns null when no card covers the date', () => {
    expect(pickRateCardForDate(cards, new Date('2024-06-01'))).toBeNull();
  });
});
```

- [ ] **Step 2: Chạy test — kỳ vọng FAIL**

Run: `npm run test -- features/carrier-rates/engine/rate-cards.test.ts`
Expected: FAIL (`pickRateCardForDate` chưa tồn tại).

- [ ] **Step 3: Viết `rate-cards.ts`**

```ts
import { asc, eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';

/** Minimal window shape the picker needs. Dates compared at day granularity. */
export interface RateCardWindow {
  id: string;
  effectiveFrom: Date;
  /** null = open-ended (current) card. */
  effectiveTo: Date | null;
}

/**
 * Pick the rate card whose [effectiveFrom, effectiveTo] covers `date`.
 * Both bounds are INCLUSIVE. effectiveTo === null means open-ended.
 * Returns null when no card covers the date (caller emits a clear reason).
 *
 * Compares on calendar day (UTC date portion) so a ship timestamp at any
 * hour on the cutover day still lands in the right card.
 */
export function pickRateCardForDate(
  cards: RateCardWindow[],
  date: Date,
): RateCardWindow | null {
  const day = toDayNumber(date);
  for (const c of cards) {
    const from = toDayNumber(c.effectiveFrom);
    const to = c.effectiveTo === null ? Infinity : toDayNumber(c.effectiveTo);
    if (day >= from && day <= to) return c;
  }
  return null;
}

function toDayNumber(d: Date): number {
  // Days since epoch in UTC — drops the time-of-day so inclusive day-bounds
  // behave predictably regardless of timezone.
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 86_400_000);
}

/** All rate cards for an account, ordered oldest-first. `date` columns come
 *  back from node-postgres as JS Date at local midnight — fine for the
 *  day-granularity picker above. */
export async function listRateCards(carrierAccountId: string): Promise<RateCardWindow[]> {
  const rows = await db
    .select({
      id: schema.carrierRateCards.id,
      effectiveFrom: schema.carrierRateCards.effectiveFrom,
      effectiveTo: schema.carrierRateCards.effectiveTo,
    })
    .from(schema.carrierRateCards)
    .where(eq(schema.carrierRateCards.carrierAccountId, carrierAccountId))
    .orderBy(asc(schema.carrierRateCards.effectiveFrom));
  return rows.map((r) => ({
    id: r.id,
    effectiveFrom: new Date(r.effectiveFrom),
    effectiveTo: r.effectiveTo ? new Date(r.effectiveTo) : null,
  }));
}
```

- [ ] **Step 4: Chạy test — kỳ vọng PASS**

Run: `npm run test -- features/carrier-rates/engine/rate-cards.test.ts`
Expected: PASS (5/5).

- [ ] **Step 5: Commit**

```bash
git add features/carrier-rates/engine/rate-cards.ts features/carrier-rates/engine/rate-cards.test.ts
git commit -m "feat(carrier-rates): pure rate-card date picker + listRateCards"
```

### Task 4: `load.ts` nạp cells theo card được chọn

**Files:**
- Modify: `features/carrier-rates/engine/load.ts:15-46`

- [ ] **Step 1: Sửa chữ ký + chọn card + lọc cells theo card**

Thay phần đầu `loadAccountSnapshot` (từ chữ ký đến chỗ load `cells`). Thêm import ở đầu file:

```ts
import { pickRateCardForDate, listRateCards } from './rate-cards';
```

Đổi chữ ký và thân hàm tới đoạn load cells:

```ts
export async function loadAccountSnapshot(
  carrierAccountId: string,
  effectiveDate: Date = new Date(),
): Promise<CarrierAccountSnapshot | null> {
  const [account] = await db
    .select()
    .from(schema.carrierAccounts)
    .where(eq(schema.carrierAccounts.id, carrierAccountId))
    .limit(1);
  if (!account) return null;

  // Pick the base-rate card whose window covers effectiveDate. No card →
  // no base rates for that date; return null so callers surface it clearly.
  const cards = await listRateCards(carrierAccountId);
  const card = pickRateCardForDate(cards, effectiveDate);
  if (!card) return null;

  const [zones, zoneCountries, tiers, surcharges, postcodes] = await Promise.all([
    db.select().from(schema.carrierZones)
      .where(eq(schema.carrierZones.carrierAccountId, carrierAccountId))
      .orderBy(asc(schema.carrierZones.position)),
    db.select().from(schema.carrierZoneCountries)
      .where(eq(schema.carrierZoneCountries.carrierAccountId, carrierAccountId)),
    db.select().from(schema.carrierWeightTiers)
      .where(eq(schema.carrierWeightTiers.carrierAccountId, carrierAccountId))
      .orderBy(asc(sql`(${schema.carrierWeightTiers.upperKg})::numeric`)),
    db.select().from(schema.carrierSurcharges)
      .where(and(
        eq(schema.carrierSurcharges.carrierAccountId, carrierAccountId),
        eq(schema.carrierSurcharges.active, true),
      )),
    db.select().from(schema.carrierRemotePostcodes)
      .where(eq(schema.carrierRemotePostcodes.carrierAccountId, carrierAccountId)),
  ]);

  // Cells scoped to the chosen rate card (NOT all cells for the account).
  const cells = await db.select().from(schema.carrierRateCells)
    .where(eq(schema.carrierRateCells.rateCardId, card.id));
```

> Phần còn lại của hàm (index cells, zonesByCountry, return) GIỮ NGUYÊN — chỉ biến `cells` đổi nguồn. Xoá đoạn cũ `const zoneIds = zones.map(...)` + `inArray(...)` vì không cần lọc theo zone nữa.

- [ ] **Step 2: Sửa caller mặc định không cần đổi — xác nhận bằng typecheck**

Run: `npm run typecheck`
Expected: load.ts hết lỗi. Caller cũ (`runQuote`, calculator, push, batch-estimator, audit scripts) gọi `loadAccountSnapshot(id)` vẫn hợp lệ (effectiveDate mặc định = now → card mở). Nếu typecheck báo lỗi ở nơi khác (matrix-actions) → để Phase 4.

- [ ] **Step 3: Viết test cho load (integration, dùng mock db? — dùng test thuần trên picker đã đủ; ở đây test wiring tối thiểu)**

Tạo `features/carrier-rates/engine/load.test.ts` — test rằng `loadAccountSnapshot` truyền `effectiveDate` vào picker đúng. Vì `load.ts` đụng DB, ta test gián tiếp qua picker đã phủ ở Task 3. Thêm 1 test "ngày ngoài mọi window → null" bằng cách mock `listRateCards`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/db/client', () => ({
  db: { select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn(async () => [{ id: 'acc', fxCostPerDisplay: '26000' }]) })) })) })) },
  schema: {},
}));
vi.mock('./rate-cards', () => ({
  listRateCards: vi.fn(async () => [
    { id: 'c2025', effectiveFrom: new Date('2025-01-01'), effectiveTo: new Date('2026-01-04') },
  ]),
  pickRateCardForDate: (await vi.importActual<typeof import('./rate-cards')>('./rate-cards')).pickRateCardForDate,
}));

import { loadAccountSnapshot } from './load';

describe('loadAccountSnapshot card selection', () => {
  beforeEach(() => vi.clearAllMocks());
  it('returns null when no card covers the effectiveDate', async () => {
    const snap = await loadAccountSnapshot('acc', new Date('2024-01-01'));
    expect(snap).toBeNull();
  });
});
```

> Nếu mock db quá giòn với cấu trúc query thực tế, BỎ test này và thay bằng ghi chú: "load.ts wiring được phủ bởi reconcile.test.ts (Task 6) chạy trên DB thật/seed". Picker logic đã test đầy đủ ở Task 3. Ưu tiên không viết test giòn.

- [ ] **Step 4: Chạy test**

Run: `npm run test -- features/carrier-rates/engine`
Expected: PASS (hoặc chỉ giữ Task 3 nếu bỏ test giòn).

- [ ] **Step 5: Commit**

```bash
git add features/carrier-rates/engine/load.ts features/carrier-rates/engine/load.test.ts
git commit -m "feat(carrier-rates): load base cells from the rate card covering effectiveDate"
```

---

## Phase 3 — Reconcile chọn base card theo ship date

### Task 5: `reconcile.ts` pre-load mọi card/carrier + chọn theo ngày

**Files:**
- Modify: `features/shipments/reconcile.ts:107-171`

- [ ] **Step 1: Thay khối pre-load snapshot (dòng ~107-118) bằng pre-load theo card**

Thêm import đầu file:
```ts
import { listRateCards, pickRateCardForDate, type RateCardWindow } from '@/features/carrier-rates/engine/rate-cards';
```

Thay đoạn `// 2. Pre-load snapshots, one per carrier brand.` … tới hết khối tạo `snapsByKey`:

```ts
  // 2. Pre-load one snapshot PER rate card, grouped by carrier key.
  // A carrier (fedex/dhl) has one account; that account has N dated cards.
  // We load each card's snapshot once, then pick by ship date in the loop.
  const accounts = await db
    .select({ id: schema.carrierAccounts.id, key: schema.carriers.key })
    .from(schema.carrierAccounts)
    .leftJoin(schema.carriers, eq(schema.carriers.id, schema.carrierAccounts.carrierId))
    .where(eq(schema.carrierAccounts.enabled, true));

  interface CarrierCards {
    cards: RateCardWindow[];
    snapByCard: Map<string, Awaited<ReturnType<typeof loadAccountSnapshot>>>;
  }
  const byKey = new Map<string, CarrierCards>();
  for (const a of accounts) {
    if (a.key !== 'fedex' && a.key !== 'dhl') continue;
    const cards = await listRateCards(a.id);
    const snapByCard = new Map<string, Awaited<ReturnType<typeof loadAccountSnapshot>>>();
    for (const c of cards) {
      // Anchor load to the card's own start date so it resolves that card.
      snapByCard.set(c.id, await loadAccountSnapshot(a.id, c.effectiveFrom));
    }
    byKey.set(a.key, { cards, snapByCard });
  }
```

- [ ] **Step 2: Thay logic chọn snapshot trong vòng lặp (dòng ~124-133)**

Thay `const snap = r.carrierKey ? snapsByKey.get(r.carrierKey) : null;` và nhánh `if (!snap || !r.shipCountry)`:

```ts
    const shipDate = r.labelCreatedAt ?? r.processedAtShopify ?? null;
    const entry = r.carrierKey ? byKey.get(r.carrierKey) : undefined;
    const card = entry && shipDate ? pickRateCardForDate(entry.cards, shipDate) : null;
    const snap = card ? entry!.snapByCard.get(card.id) ?? null : null;
    const billedTotal = Number(r.billedTotal);
    sumBilled += billedTotal;

    if (!entry || !shipDate || !card) {
      unmatched += 1;
      rows.push(buildRow(r, null, !shipDate ? 'no_ship_date' : 'no_rate_card'));
      continue;
    }
    if (!snap || !r.shipCountry) {
      unmatched += 1;
      rows.push(buildRow(r, null, 'no_snapshot_or_country'));
      continue;
    }
```

> Phần `quote(snap, { … effectiveDate: r.labelCreatedAt ?? r.processedAtShopify ?? undefined })` GIỮ NGUYÊN — surcharge vẫn gate theo ngày như cũ. Xoá dòng `const billedTotal = Number(r.billedTotal); sumBilled += billedTotal;` cũ phía dưới (đã chuyển lên trên) để không cộng đôi.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS (reconcile.ts không còn tham chiếu `snapsByKey`).

### Task 6: Test reconcile chọn đúng base theo năm

**Files:**
- Create: `features/shipments/reconcile.test.ts`

- [ ] **Step 1: Viết test trên seed DB (test integration nhẹ qua hàm thuần nếu DB không sẵn)**

Vì `reconcileShipments` đụng DB, viết test ở mức **pure picker wiring**: tách phần chọn card đã test (Task 3). Ở đây thêm test khẳng định hành vi reason `no_rate_card` bằng cách kiểm tra nhánh: tạo test dùng `vi.mock('@/db/client')` trả 1 shipment ship năm 2024 + 1 card chỉ phủ 2025 → row reason `no_rate_card`.

```ts
import { describe, it, expect, vi } from 'vitest';

// Two charges: one ship 2025-06 (covered), one ship 2024-06 (no card).
const SHIPMENTS = [
  { shipmentId: 's1', trackingNumber: 'T1', carrierKey: 'fedex', dimLengthCm: null, dimWidthCm: null, dimHeightCm: null, actualWeightKg: '1.0', packagingType: null, labelCreatedAt: new Date('2025-06-01'), chargeId: 'c1', billedTotal: '500000', billedBase: null, billedFuel: null, orderNumber: 'O1', shipCountry: 'US', shipWeightKgOverride: null, processedAtShopify: new Date('2025-06-01'), storeName: 'meanblvd' },
  { shipmentId: 's2', trackingNumber: 'T2', carrierKey: 'fedex', dimLengthCm: null, dimWidthCm: null, dimHeightCm: null, actualWeightKg: '1.0', packagingType: null, labelCreatedAt: new Date('2024-06-01'), chargeId: 'c2', billedTotal: '400000', billedBase: null, billedFuel: null, orderNumber: 'O2', shipCountry: 'US', shipWeightKgOverride: null, processedAtShopify: new Date('2024-06-01'), storeName: 'meanblvd' },
];

vi.mock('@/db/client', () => {
  const chain = (rows: unknown[]) => ({ from: () => ({ innerJoin: () => ({ innerJoin: () => ({ innerJoin: () => rows }) }), leftJoin: () => ({ where: () => rows }), where: () => rows }) });
  return { db: { select: (proj?: unknown) => chain(proj && 'id' in (proj as object) ? [{ id: 'accF', key: 'fedex' }] : SHIPMENTS) }, schema: { shipmentCharges: {}, shipments: {}, shopifyOrders: {}, stores: {}, carrierAccounts: {}, carriers: {} } };
});
vi.mock('@/features/carrier-rates/engine/load', () => ({
  loadAccountSnapshot: vi.fn(async () => ({ id: 'accF', name: 'FedEx', costCurrency: 'VND', displayCurrency: 'USD', fxCostPerDisplay: 26000, zonesByCountry: new Map([['US', { label: 'A', rateByTierUpper: new Map([[1, 300000]]) }]]), weightTiers: [{ upperKg: 1 }], surcharges: [], remotePostcodes: new Map() })),
}));
vi.mock('@/features/carrier-rates/engine/rate-cards', async () => {
  const actual = await vi.importActual<typeof import('@/features/carrier-rates/engine/rate-cards')>('@/features/carrier-rates/engine/rate-cards');
  return { ...actual, listRateCards: vi.fn(async () => [{ id: 'c2025', effectiveFrom: new Date('2025-01-01'), effectiveTo: new Date('2026-01-04') }]) };
});

import { reconcileShipments } from './reconcile';

describe('reconcileShipments rate-card selection', () => {
  it('quotes the 2025 shipment and marks the 2024 one no_rate_card', async () => {
    const r = await reconcileShipments({ carrierKey: 'fedex' });
    const reasons = r.rows.map((x) => x.engineReason);
    expect(reasons).toContain('no_rate_card');         // 2024 ship → no card
    expect(r.matched).toBe(1);                          // 2025 ship → quoted
  });
});
```

> Nếu cấu trúc mock `db` không khớp thứ tự join thực tế của `reconcile.ts` và test quá giòn, THAY bằng: chạy script `scripts/reconcile-shipments.ts` trên DB staging (sau khi đã tạo card 2025 ở Phase 5) và xác nhận summary có dòng `no_rate_card` cho đơn ngoài window. Ghi rõ lựa chọn đã dùng trong commit message.

- [ ] **Step 2: Chạy test**

Run: `npm run test -- features/shipments/reconcile.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add features/shipments/reconcile.ts features/shipments/reconcile.test.ts
git commit -m "feat(reconcile): pick base rate card by shipment ship date; no_rate_card reason"
```

---

## Phase 4 — Matrix actions scoped theo card

### Task 7: `matrix-actions.ts` nhận `rateCardId`

**Files:**
- Modify: `features/carrier-rates/matrix-actions.ts`

- [ ] **Step 1: `loadMatrix` lọc cells theo card**

Đổi chữ ký và truy vấn cells:

```ts
export async function loadMatrix(carrierAccountId: string, rateCardId: string): Promise<MatrixSnapshot> {
```

Trong hàm, thay khối load `cellRows` (dòng ~45-54): bỏ `inArray(carrierZoneId, zoneIds)`, dùng:

```ts
  const cellRows = await db
    .select({
      zoneId: schema.carrierRateCells.carrierZoneId,
      tierId: schema.carrierRateCells.carrierWeightTierId,
      costAmount: schema.carrierRateCells.costAmount,
      updatedAt: schema.carrierRateCells.updatedAt,
    })
    .from(schema.carrierRateCells)
    .where(eq(schema.carrierRateCells.rateCardId, rateCardId));
```

(`zoneIds` không còn cần cho cells — giữ nếu vẫn dùng cho check `zones.length===0`.)

- [ ] **Step 2: `setCell` / `clearCell` mang `rateCardId` + đúng unique 4-cột**

```ts
export async function setCell({
  rateCardId, zoneId, tierId, costAmount, userId,
}: { rateCardId: string; zoneId: string; tierId: string; costAmount: string; userId: string }): Promise<void> {
  const n = Number(costAmount);
  if (!Number.isFinite(n) || n < 0) throw new Error('Cost must be a non-negative number.');

  await db
    .insert(schema.carrierRateCells)
    .values({
      rateCardId,
      carrierZoneId: zoneId,
      carrierWeightTierId: tierId,
      packageType: 'package',
      costAmount: n.toFixed(2),
      updatedBy: userId,
    })
    .onConflictDoUpdate({
      target: [
        schema.carrierRateCells.rateCardId,
        schema.carrierRateCells.carrierZoneId,
        schema.carrierRateCells.carrierWeightTierId,
        schema.carrierRateCells.packageType,
      ],
      set: { costAmount: n.toFixed(2), updatedBy: userId, updatedAt: new Date() },
    });
}

export async function clearCell({
  rateCardId, zoneId, tierId,
}: { rateCardId: string; zoneId: string; tierId: string }): Promise<void> {
  await db.delete(schema.carrierRateCells).where(and(
    eq(schema.carrierRateCells.rateCardId, rateCardId),
    eq(schema.carrierRateCells.carrierZoneId, zoneId),
    eq(schema.carrierRateCells.carrierWeightTierId, tierId),
  ));
}
```

- [ ] **Step 3: `importMatrix` ghi cells vào card**

Đổi chữ ký: `importMatrix(carrierAccountId, rateCardId, parsed, userId)`. Zones/tiers vẫn tạo theo account (dùng chung). Trong khối "3. Upsert cells", đổi insert:

```ts
      await db
        .insert(schema.carrierRateCells)
        .values({
          rateCardId,
          carrierZoneId: zone.id,
          carrierWeightTierId: tier.id,
          packageType: 'package',
          costAmount: r.cost.toFixed(2),
          updatedBy: userId,
        })
        .onConflictDoUpdate({
          target: [
            schema.carrierRateCells.rateCardId,
            schema.carrierRateCells.carrierZoneId,
            schema.carrierRateCells.carrierWeightTierId,
            schema.carrierRateCells.packageType,
          ],
          set: { costAmount: r.cost.toFixed(2), updatedBy: userId, updatedAt: new Date() },
        });
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: lỗi còn lại chỉ ở `matrix/page.tsx` (caller) — sửa ở Phase 5.

- [ ] **Step 5: Commit**

```bash
git add features/carrier-rates/matrix-actions.ts
git commit -m "feat(carrier-rates): scope matrix cell read/write/import to a rate card"
```

---

## Phase 5 — Rate-cards actions + UI

### Task 8: Server actions cho rate cards

**Files:**
- Create: `features/carrier-rates/rate-cards-actions.ts`
- Test: `features/carrier-rates/rate-cards-actions.test.ts`

- [ ] **Step 1: Viết test overlap (pure helper)**

```ts
import { describe, it, expect } from 'vitest';
import { windowsOverlap } from './rate-cards-actions';

describe('windowsOverlap', () => {
  const existing = [
    { effectiveFrom: '2025-01-01', effectiveTo: '2026-01-04' },
    { effectiveFrom: '2026-01-05', effectiveTo: null },
  ];
  it('rejects a new window overlapping the 2025 card', () => {
    expect(windowsOverlap(existing, { effectiveFrom: '2025-12-01', effectiveTo: '2026-02-01' })).toBe(true);
  });
  it('rejects a second open-ended card', () => {
    expect(windowsOverlap(existing, { effectiveFrom: '2027-01-01', effectiveTo: null })).toBe(true);
  });
  it('accepts a non-overlapping past window', () => {
    expect(windowsOverlap(existing, { effectiveFrom: '2024-01-01', effectiveTo: '2024-12-31' })).toBe(false);
  });
});
```

- [ ] **Step 2: Chạy — FAIL**

Run: `npm run test -- features/carrier-rates/rate-cards-actions.test.ts`
Expected: FAIL (`windowsOverlap` chưa có).

- [ ] **Step 3: Viết `rate-cards-actions.ts`**

```ts
'use server';

import { and, asc, eq, isNull } from 'drizzle-orm';
import { db, schema } from '@/db/client';

export interface RateCardRow {
  id: string;
  label: string;
  effectiveFrom: string;       // 'YYYY-MM-DD'
  effectiveTo: string | null;
  isOpen: boolean;
}

interface WindowLike { effectiveFrom: string; effectiveTo: string | null }

/** Inclusive-day overlap test. An open-ended card (effectiveTo null) extends
 *  to +∞. Used to forbid creating overlapping cards for one account. */
export function windowsOverlap(existing: WindowLike[], next: WindowLike): boolean {
  const nf = next.effectiveFrom;
  const nt = next.effectiveTo ?? '9999-12-31';
  for (const e of existing) {
    const ef = e.effectiveFrom;
    const et = e.effectiveTo ?? '9999-12-31';
    // [ef,et] ∩ [nf,nt] non-empty (string compare works for ISO dates).
    if (ef <= nt && nf <= et) return true;
  }
  return false;
}

export async function listRateCardsForAccount(carrierAccountId: string): Promise<RateCardRow[]> {
  const rows = await db
    .select()
    .from(schema.carrierRateCards)
    .where(eq(schema.carrierRateCards.carrierAccountId, carrierAccountId))
    .orderBy(asc(schema.carrierRateCards.effectiveFrom));
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    effectiveFrom: r.effectiveFrom,
    effectiveTo: r.effectiveTo,
    isOpen: r.effectiveTo === null,
  }));
}

/** The current open card (effectiveTo IS NULL). Calculator/push use this. */
export async function getCurrentCardId(carrierAccountId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: schema.carrierRateCards.id })
    .from(schema.carrierRateCards)
    .where(and(
      eq(schema.carrierRateCards.carrierAccountId, carrierAccountId),
      isNull(schema.carrierRateCards.effectiveTo),
    ))
    .limit(1);
  return row?.id ?? null;
}

export async function createRateCard(input: {
  carrierAccountId: string;
  label: string;
  effectiveFrom: string;       // 'YYYY-MM-DD'
  effectiveTo: string | null;
  userId: string;
}): Promise<{ id: string }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveFrom)) throw new Error('effectiveFrom must be YYYY-MM-DD.');
  if (input.effectiveTo !== null && !/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveTo)) throw new Error('effectiveTo must be YYYY-MM-DD or empty.');
  if (input.effectiveTo !== null && input.effectiveTo < input.effectiveFrom) throw new Error('effectiveTo must be on/after effectiveFrom.');
  if (!input.label.trim()) throw new Error('Label is required.');

  const existing = await listRateCardsForAccount(input.carrierAccountId);
  if (windowsOverlap(existing, { effectiveFrom: input.effectiveFrom, effectiveTo: input.effectiveTo })) {
    throw new Error('Window overlaps an existing rate card for this account.');
  }

  const [row] = await db
    .insert(schema.carrierRateCards)
    .values({
      carrierAccountId: input.carrierAccountId,
      label: input.label.trim(),
      effectiveFrom: input.effectiveFrom,
      effectiveTo: input.effectiveTo,
      createdBy: input.userId,
    })
    .returning({ id: schema.carrierRateCards.id });
  return { id: row.id };
}
```

- [ ] **Step 4: Chạy — PASS**

Run: `npm run test -- features/carrier-rates/rate-cards-actions.test.ts`
Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add features/carrier-rates/rate-cards-actions.ts features/carrier-rates/rate-cards-actions.test.ts
git commit -m "feat(carrier-rates): rate-card actions (list/create/current) with overlap guard"
```

### Task 9: Matrix page — card selector + management + bind theo card

**Files:**
- Modify: `app/(dashboard)/f/carrier-rates/[id]/matrix/page.tsx`

- [ ] **Step 1: Cập nhật imports + searchParams + chọn card hiện hành**

Thay phần import actions và chữ ký component:

```ts
import { loadMatrix, setCell, clearCell, importMatrix } from '@/features/carrier-rates/matrix-actions';
import { listRateCardsForAccount, getCurrentCardId, createRateCard } from '@/features/carrier-rates/rate-cards-actions';
```

Đổi chữ ký + đầu hàm để đọc `?card=`:

```ts
export default async function MatrixPage({
  params, searchParams,
}: { params: Promise<{ id: string }>; searchParams: Promise<{ card?: string }> }) {
  const { id } = await params;
  const { card: cardParam } = await searchParams;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_carrier_rates')) {
    return <div className="max-w-3xl mx-auto px-6 md:px-10 py-16 text-center"><h1 className="text-3xl font-semibold">Forbidden</h1></div>;
  }
  const account = await getAccount(id);
  if (!account) notFound();

  const canManage = hasPermission(role, 'manage_carrier_rates');
  const cards = await listRateCardsForAccount(id);
  // Selected card: ?card= if valid, else the current open card, else newest.
  const selectedCardId = (cardParam && cards.some((c) => c.id === cardParam))
    ? cardParam
    : (await getCurrentCardId(id)) ?? cards[cards.length - 1]?.id ?? null;
```

- [ ] **Step 2: Guard khi account chưa có card nào + load matrix theo card**

Ngay sau đoạn trên:

```ts
  if (!selectedCardId) {
    return (
      <div className="px-6 md:px-10 py-12 space-y-6">
        <Link href={`/f/carrier-rates/${id}`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-4" />{account.name}
        </Link>
        <h1 className="text-3xl font-semibold">No rate card yet</h1>
        <p className="text-sm text-muted-foreground">Create a rate card below to start entering the matrix.</p>
        {canManage && <CreateCardForm action={createCardAction} />}
      </div>
    );
  }
  const { zones, tiers, cells } = await loadMatrix(id, selectedCardId);
```

- [ ] **Step 3: Cập nhật các server-action wrapper mang `rateCardId`**

Thay 3 wrapper hiện có:

```ts
async function setCellWrapper(accountId: string, cardId: string, userId: string, input: { zoneId: string; tierId: string; costAmount: string }) {
  'use server';
  await setCell({ rateCardId: cardId, ...input, userId });
  revalidatePath(`/f/carrier-rates/${accountId}/matrix`);
}

async function clearCellWrapper(accountId: string, cardId: string, input: { zoneId: string; tierId: string }) {
  'use server';
  await clearCell({ rateCardId: cardId, ...input });
  revalidatePath(`/f/carrier-rates/${accountId}/matrix`);
}

async function importCsvAction(accountId: string, cardId: string, userId: string, formData: FormData) {
  'use server';
  const csv = String(formData.get('csv') ?? '');
  const parsed = parseMatrixCsv(csv);
  if (parsed.rows.length === 0) {
    throw new Error('CSV produced no rows. ' + (parsed.warnings.join(' · ') || ''));
  }
  await importMatrix(accountId, cardId, parsed, userId);
  revalidatePath(`/f/carrier-rates/${accountId}/matrix`);
}

async function createCardAction(accountId: string, userId: string, formData: FormData) {
  'use server';
  await createRateCard({
    carrierAccountId: accountId,
    label: String(formData.get('label') ?? ''),
    effectiveFrom: String(formData.get('effectiveFrom') ?? ''),
    effectiveTo: String(formData.get('effectiveTo') ?? '').trim() || null,
    userId,
  });
  revalidatePath(`/f/carrier-rates/${accountId}/matrix`);
}
```

- [ ] **Step 4: Bind actions theo card + thêm UI selector/management**

Đổi 3 dòng `bind`:

```ts
  const setBound = setCellWrapper.bind(null, id, selectedCardId, session.user.id);
  const clearBound = clearCellWrapper.bind(null, id, selectedCardId);
  const importBound = importCsvAction.bind(null, id, selectedCardId, session.user.id);
  const createCardBound = createCardAction.bind(null, id, session.user.id);
```

Thêm khối "Rate cards" NGAY DƯỚI `<header>` (trước grid StatTile). Dùng thẻ `<a>` cho selector (server component, không cần client JS):

```tsx
      <Card>
        <CardContent className="p-6 md:p-8 space-y-4">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wider">Rate cards</h2>
            <Badge variant="outline" className="h-5 text-[10px] uppercase tracking-wider ml-auto">By effective date</Badge>
          </div>
          <div className="flex flex-wrap gap-2">
            {cards.map((c) => (
              <Link
                key={c.id}
                href={`/f/carrier-rates/${id}/matrix?card=${c.id}`}
                className={`rounded-lg border px-3 py-1.5 text-xs ${c.id === selectedCardId ? 'border-foreground bg-foreground text-background' : 'border-border text-muted-foreground hover:text-foreground'}`}
              >
                {c.label} · {c.effectiveFrom} → {c.effectiveTo ?? 'open'}
              </Link>
            ))}
          </div>
          {canManage && <CreateCardForm action={createCardBound} />}
        </CardContent>
      </Card>
```

Thêm component form ở cuối file:

```tsx
function CreateCardForm({ action }: { action: (formData: FormData) => Promise<void> }) {
  return (
    <form action={action} className="flex flex-wrap items-end gap-3 pt-2 border-t border-border">
      <label className="text-xs space-y-1">
        <span className="text-muted-foreground uppercase tracking-wider">Label</span>
        <input name="label" required placeholder="FedEx 2025" className="block rounded-md border border-border bg-card px-2 py-1.5 text-sm" />
      </label>
      <label className="text-xs space-y-1">
        <span className="text-muted-foreground uppercase tracking-wider">Effective from</span>
        <input name="effectiveFrom" type="date" required className="block rounded-md border border-border bg-card px-2 py-1.5 text-sm" />
      </label>
      <label className="text-xs space-y-1">
        <span className="text-muted-foreground uppercase tracking-wider">Effective to (blank = open)</span>
        <input name="effectiveTo" type="date" className="block rounded-md border border-border bg-card px-2 py-1.5 text-sm" />
      </label>
      <Button type="submit" variant="outline" className="h-9">Create card</Button>
    </form>
  );
}
```

- [ ] **Step 5: Typecheck + build**

Run: `npm run typecheck`
Expected: PASS toàn repo.

- [ ] **Step 6: Smoke trên app chạy local (hoặc production qua scripts/snap.ts)**

Run: `npm run dev` → mở `/f/carrier-rates/<fedex-id>/matrix`. Kỳ vọng: thấy thanh "Rate cards" với card "Current (migrated)"; tạo card "FedEx 2025" (from 2025-01-01, to 2026-01-04) thành công; chọn card 2025 → ma trận rỗng; import CSV vào card 2025; quay lại card current → ma trận cũ còn nguyên.

- [ ] **Step 7: Commit**

```bash
git add "app/(dashboard)/f/carrier-rates/[id]/matrix/page.tsx"
git commit -m "feat(carrier-rates): matrix page rate-card selector + create-card UI"
```

---

## Phase 6 — Rà surcharge theo năm (data task)

### Task 10: Script báo cáo cửa sổ hiệu lực surcharge

**Files:**
- Create: `scripts/verify-carrier-surcharge-windows.ts`

- [ ] **Step 1: Viết script read-only liệt kê demand/remote/VAT theo carrier kèm startsAt/endsAt**

```ts
/**
 * Read-only audit: list time-sensitive surcharges (demand_per_kg,
 * remote_fixed, country_fixed, vat_percent, fuel_percent) per carrier
 * account with their effective windows, so the operator can confirm
 * 2025 rows end at the cutover and 2026 rows start after it.
 *
 *   DATABASE_URL=... npx tsx scripts/verify-carrier-surcharge-windows.ts
 */
import { asc, eq, inArray } from 'drizzle-orm';
import { db, schema } from '@/db/client';

const KINDS = ['demand_per_kg', 'remote_fixed', 'country_fixed', 'vat_percent', 'fuel_percent'] as const;

async function main(): Promise<void> {
  const accounts = await db
    .select({ id: schema.carrierAccounts.id, name: schema.carrierAccounts.name, key: schema.carriers.key })
    .from(schema.carrierAccounts)
    .leftJoin(schema.carriers, eq(schema.carriers.id, schema.carrierAccounts.carrierId))
    .orderBy(asc(schema.carrierAccounts.name));

  for (const a of accounts) {
    const rows = await db
      .select()
      .from(schema.carrierSurcharges)
      .where(inArray(schema.carrierSurcharges.kind, KINDS as unknown as string[]))
      .orderBy(asc(schema.carrierSurcharges.kind));
    const mine = rows.filter((r) => r.carrierAccountId === a.id);
    process.stdout.write(`\n=== ${a.name} (${a.key ?? '?'}) — ${mine.length} time-sensitive surcharges ===\n`);
    for (const r of mine) {
      const from = r.startsAt ? r.startsAt.toISOString().slice(0, 10) : '—';
      const to = r.endsAt ? r.endsAt.toISOString().slice(0, 10) : 'open';
      process.stdout.write(`  ${r.kind.padEnd(16)} value=${String(r.value).padStart(12)}  [${from} → ${to}]  active=${r.active}\n`);
    }
  }
}

main().catch((e) => { process.stderr.write(String(e instanceof Error ? e.stack : e) + '\n'); process.exit(1); }).finally(() => process.exit());
```

- [ ] **Step 2: Chạy trên DB và đọc báo cáo**

Run: `DATABASE_URL='<url>' npx tsx scripts/verify-carrier-surcharge-windows.ts`
Expected: in danh sách demand/remote/VAT/fuel theo từng carrier với window. Người vận hành đối chiếu: VAT 8% (không window — đúng); demand/remote 2025 có `endsAt` ≤ cutover, 2026 `startsAt` > cutover. Nếu thiếu window đúng → tạo/sửa dòng surcharge qua trang Surcharges (ngoài phạm vi code task này; ghi lại phát hiện).

- [ ] **Step 3: Commit**

```bash
git add scripts/verify-carrier-surcharge-windows.ts
git commit -m "tools(carrier-rates): audit surcharge effective windows per carrier"
```

---

## Phase 7 — Verify toàn cục + no-regression

### Task 11: Chạy full test + reconcile before/after

- [ ] **Step 1: Full unit test**

Run: `npm run test`
Expected: PASS toàn bộ (đặc biệt `quote.test.ts` KHÔNG đổi → không hồi quy engine).

- [ ] **Step 2: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 3: Reconcile no-regression (chỉ có card "current" → kết quả phải y như trước migration)**

Run: `DATABASE_URL='<staging>' npx tsx scripts/reconcile-shipments.ts --carrier=fedex --top=20`
Expected: Σ Billed / Σ Engine / Δ giống số liệu phiên trước khi thêm card 2025 (vì mọi đơn vẫn rơi vào card "Current (migrated)" phủ 2020→∞). Đây là bằng chứng migration không đổi hành vi.

- [ ] **Step 4: (Sau khi user import bảng 2025) Reconcile kiểm tra phân tách**

Sau khi tạo card "FedEx 2025" (to=2026-01-04) + import ma trận 2025, và set card current `effectiveFrom`/`effectiveTo` phù hợp:
Run: `DATABASE_URL='<staging>' npx tsx scripts/reconcile-shipments.ts --carrier=fedex --top=50`
Expected: đơn ship ≤ 04/01/2026 dùng base 2025; đơn sau dùng base 2026. Δ của các đơn 2025 cải thiện rõ so với khi tính bằng base 2026.

---

## Self-review notes (đã kiểm)

- **Spec coverage:** §4 data model → Task 1–2; §5 load.ts → Task 4; §6 reconcile → Task 5–6; §7 importer+UI → Task 7–9; §8 surcharge verify → Task 10; §9 testing → rải khắp + Task 11. ✅
- **Type consistency:** `loadAccountSnapshot(id, effectiveDate?)`, `loadMatrix(accountId, rateCardId)`, `importMatrix(accountId, rateCardId, parsed, userId)`, `setCell({rateCardId,...})`, `pickRateCardForDate(cards, date)`, `listRateCards(accountId)` — dùng nhất quán giữa các task. ✅
- **No placeholders:** mọi step có code/command thật. Hai test integration giòn (Task 4 Step 3, Task 6) có lối thoát rõ ràng (chuyển sang verify bằng script trên staging) — không để mơ hồ. ✅
- **Engine core bất biến:** `quote.ts` không nằm trong bất kỳ "Modify" nào. ✅
