# Ship Hộ — Phase 2 (Import lô + Tracking) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import hàng loạt đơn ship hộ từ file partner (đủ địa chỉ người nhận) vào `ship_ho_orders`, cho nhập/gán tracking, và auto-track trạng thái giao qua cron tái dùng lib DHL/FedEx.

**Architecture:** Parser thuần cho file partner (thứ tự cột chuẩn) → orchestrator upsert theo `code`. Auto-track mirror `features/shipments/track.ts` (dùng `trackFedex`/`trackDhl`). Cô lập trong `features/ship-ho/`; không đụng flow shipments khách lẻ. Nguồn import: **file riêng từ partner** (đã chốt), KHÔNG phải LOG-Export.

**Tech Stack:** Next.js App Router (server actions), Drizzle ORM (Postgres), Vitest, `xlsx` (đã là dependency), lib/fedex/track + lib/dhl/track, Railway cron.

## Global Constraints

- Customized Next.js — migration **hand-authored** (không `drizzle-kit generate`).
- P1 đã merge vào main: `ship_ho_orders/partners/statements` + enums + `applyMarkup`/`quote-adapter`/`orders-actions`/`partners-actions`/`queries` + RBAC `ship_ho:*` + guard `requireManageShipHo`.
- Cột `numeric` đọc/ghi dạng **string**; `timestamp` là `Date`.
- Mọi server action ghi dữ liệu phải guard `requireManageShipHo()` (từ `features/ship-ho/require-manage.ts`).
- Nguồn import = **file partner theo template cột cố định** (§ Task 1). Đơn có `trackingNumber` → status `'shipped'`; không có → `'draft'`.
- Auto-track chỉ carrier `fedex`/`dhl`, tracking không rỗng, chưa `delivered`, tạo ≤ 45 ngày. Khi giao xong: `deliveryStatus='delivered'` + `deliveredAt` + `status='delivered'`.
- P2 KHÔNG làm: statement/đối soát/margin (P3), KHÔNG lưu `actualCarrierCostVnd` khi import (cước thực là việc của P3).
- Chạy trước push: `npx tsc --noEmit` + `npx vitest run` xanh.

---

## File Structure

| File | Trách nhiệm |
|---|---|
| `features/ship-ho/import-parse.ts` (+test) | Parser thuần 1 dòng file partner → `ParsedShipHoImport`; `statusForImportedOrder` |
| `db/migrations/0084_ship-ho-code-unique.sql` (+ schema `.unique()` + journal) | Unique `ship_ho_orders.code` (dedup import + vá deferrable P1) |
| `features/ship-ho/import-actions.ts` | `importShipHoOrders(rows, partnerBrandSlug, opts)` — upsert theo code, summary |
| `features/ship-ho/track.ts` (+test) | `trackPendingShipHo` + `trackAndStoreShipHo` + pure `orderStatusAfterTrack` |
| `scripts/cron/track-ship-ho.ts` · `railway.cron-track-ship-ho.json` · `package.json` | Cron auto-track ship hộ |
| `features/ship-ho/tracking-actions.ts` | `setShipHoTracking(orderId, input)` — gán tracking + carrier, status→shipped |
| `app/(dashboard)/f/ship-ho/import/page.tsx` + `ImportUploader.tsx` | UI upload file partner |
| `app/(dashboard)/f/ship-ho/[id]/TrackingCard.tsx` + sửa `[id]/page.tsx` | Nhập tracking + hiển thị trạng thái giao |

---

### Task 1: Import parser (thuần) + status helper

**Files:**
- Create: `features/ship-ho/import-parse.ts`
- Test: `features/ship-ho/import-parse.test.ts`

**Interfaces:**
- Produces:
  - `parseShipHoImportRow(row: readonly unknown[]): ParseShipHoResult`
  - `statusForImportedOrder(trackingNumber: string | null): 'shipped' | 'draft'`
  - types `ParsedShipHoImport`, `ParseShipHoResult`, and `SHIP_HO_IMPORT_COLUMNS` (0-indexed template).

**Template cột file partner (0-indexed; dòng đầu là header, bỏ qua khi import):**
`0 code* · 1 recipientName · 2 recipientCompany · 3 recipientPhone · 4 country* (ISO2) · 5 city · 6 province · 7 postcode · 8 address1 · 9 address2 · 10 weightKg* · 11 dimLengthCm · 12 dimWidthCm · 13 dimHeightCm · 14 packagingType (bag/box) · 15 carrierKey (fedex/dhl) · 16 trackingNumber` (* = bắt buộc).

- [ ] **Step 1: Write the failing test** `features/ship-ho/import-parse.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { parseShipHoImportRow, statusForImportedOrder } from './import-parse';

const base = [
  'DISCN100', 'Nguyen A', 'ACME', '0900000000', 'us', 'Houston', 'TX', '77441',
  '123 Main St', 'Apt 4', '0.8', '42', '30', '10', 'box', 'fedex', '794000000001',
];

describe('parseShipHoImportRow', () => {
  it('dòng hợp lệ → ok, chuẩn hoá country/carrier/packaging', () => {
    const r = parseShipHoImportRow(base);
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.row.code).toBe('DISCN100');
    expect(r.row.country).toBe('US');
    expect(r.row.carrierKey).toBe('fedex');
    expect(r.row.packagingType).toBe('box');
    expect(r.row.weightKg).toBe(0.8);
    expect(r.row.dimLengthCm).toBe(42);
    expect(r.row.trackingNumber).toBe('794000000001');
  });

  it('dòng rỗng → skip_empty', () => {
    expect(parseShipHoImportRow([null, '', '   ']).kind).toBe('skip_empty');
    expect(parseShipHoImportRow([]).kind).toBe('skip_empty');
  });

  it('thiếu code → error missing_code', () => {
    const r = parseShipHoImportRow(['', 'x', '', '', 'US', '', '', '', '', '', '1']);
    expect(r).toEqual({ kind: 'error', reason: 'missing_code' });
  });

  it('country không phải ISO2 → error bad_country', () => {
    const row = [...base]; row[4] = 'USA';
    expect(parseShipHoImportRow(row)).toEqual({ kind: 'error', reason: 'bad_country' });
  });

  it('cân ≤ 0 hoặc không phải số → error bad_weight', () => {
    const z = [...base]; z[10] = '0';
    expect(parseShipHoImportRow(z)).toEqual({ kind: 'error', reason: 'bad_weight' });
    const n = [...base]; n[10] = 'abc';
    expect(parseShipHoImportRow(n)).toEqual({ kind: 'error', reason: 'bad_weight' });
  });

  it('carrier/packaging lạ → null (không chặn)', () => {
    const row = [...base]; row[14] = 'crate'; row[15] = 'ups';
    const r = parseShipHoImportRow(row);
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.row.packagingType).toBeNull();
    expect(r.row.carrierKey).toBeNull();
  });

  it('dim thiếu → null', () => {
    const row = [...base]; row[11] = ''; row[12] = null; row[13] = '';
    const r = parseShipHoImportRow(row);
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.row.dimLengthCm).toBeNull();
  });
});

describe('statusForImportedOrder', () => {
  it('có tracking → shipped; không → draft', () => {
    expect(statusForImportedOrder('X1')).toBe('shipped');
    expect(statusForImportedOrder(null)).toBe('draft');
    expect(statusForImportedOrder('')).toBe('draft');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run features/ship-ho/import-parse.test.ts`
Expected: FAIL — "Cannot find module './import-parse'".

- [ ] **Step 3: Implement** `features/ship-ho/import-parse.ts`

```ts
/**
 * THUẦN: parse 1 dòng file import ship hộ (template cột cố định — xem
 * SHIP_HO_IMPORT_COLUMNS). Không I/O. Orchestrator `import-actions.ts` lo DB.
 */
export const SHIP_HO_IMPORT_COLUMNS = {
  code: 0, recipientName: 1, recipientCompany: 2, recipientPhone: 3,
  country: 4, city: 5, province: 6, postcode: 7, address1: 8, address2: 9,
  weightKg: 10, dimLengthCm: 11, dimWidthCm: 12, dimHeightCm: 13,
  packagingType: 14, carrierKey: 15, trackingNumber: 16,
} as const;

export interface ParsedShipHoImport {
  code: string;
  recipientName: string | null;
  recipientCompany: string | null;
  recipientPhone: string | null;
  country: string;
  city: string | null;
  province: string | null;
  postcode: string | null;
  address1: string | null;
  address2: string | null;
  weightKg: number;
  dimLengthCm: number | null;
  dimWidthCm: number | null;
  dimHeightCm: number | null;
  packagingType: 'bag' | 'box' | null;
  carrierKey: 'fedex' | 'dhl' | null;
  trackingNumber: string | null;
}

export type ParseShipHoResult =
  | { kind: 'ok'; row: ParsedShipHoImport }
  | { kind: 'skip_empty' }
  | { kind: 'error'; reason: 'missing_code' | 'bad_country' | 'bad_weight' };

function str(v: unknown): string {
  if (v == null) return '';
  return String(v).trim();
}
function strOrNull(v: unknown): string | null {
  const s = str(v);
  return s === '' ? null : s;
}
function numOrNull(v: unknown): number | null {
  const s = str(v).replace(/[,\s]/g, '');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function parseShipHoImportRow(row: readonly unknown[]): ParseShipHoResult {
  const C = SHIP_HO_IMPORT_COLUMNS;
  const allEmpty = row.every((c) => str(c) === '');
  if (allEmpty) return { kind: 'skip_empty' };

  const code = str(row[C.code]);
  if (code === '') return { kind: 'error', reason: 'missing_code' };

  const country = str(row[C.country]).toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) return { kind: 'error', reason: 'bad_country' };

  const weightKg = numOrNull(row[C.weightKg]);
  if (weightKg == null || weightKg <= 0) return { kind: 'error', reason: 'bad_weight' };

  const pkgRaw = str(row[C.packagingType]).toLowerCase();
  const packagingType = pkgRaw === 'bag' || pkgRaw === 'box' ? pkgRaw : null;
  const carRaw = str(row[C.carrierKey]).toLowerCase();
  const carrierKey = carRaw === 'fedex' || carRaw === 'dhl' ? carRaw : null;

  return {
    kind: 'ok',
    row: {
      code,
      recipientName: strOrNull(row[C.recipientName]),
      recipientCompany: strOrNull(row[C.recipientCompany]),
      recipientPhone: strOrNull(row[C.recipientPhone]),
      country,
      city: strOrNull(row[C.city]),
      province: strOrNull(row[C.province]),
      postcode: strOrNull(row[C.postcode]),
      address1: strOrNull(row[C.address1]),
      address2: strOrNull(row[C.address2]),
      weightKg,
      dimLengthCm: numOrNull(row[C.dimLengthCm]),
      dimWidthCm: numOrNull(row[C.dimWidthCm]),
      dimHeightCm: numOrNull(row[C.dimHeightCm]),
      packagingType,
      carrierKey,
      trackingNumber: strOrNull(row[C.trackingNumber]),
    },
  };
}

/** Đơn import: có tracking coi như đã gửi ('shipped'); chưa có → 'draft'. */
export function statusForImportedOrder(trackingNumber: string | null): 'shipped' | 'draft' {
  return trackingNumber && trackingNumber.trim() !== '' ? 'shipped' : 'draft';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run features/ship-ho/import-parse.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add features/ship-ho/import-parse.ts features/ship-ho/import-parse.test.ts
git commit -m "feat(ship-ho): parser file import partner (thuần) + test"
```

---

### Task 2: Migration 0084 (unique code) + import orchestrator

**Files:**
- Modify: `db/schema.ts` (add `.unique()` on `shipHoOrders.code`)
- Create: `db/migrations/0084_ship-ho-code-unique.sql`
- Modify: `db/migrations/meta/_journal.json`
- Create: `features/ship-ho/import-actions.ts`

**Interfaces:**
- Consumes: `parseShipHoImportRow`, `statusForImportedOrder` (Task 1); `schema.shipHoOrders`; `requireManageShipHo` (P1, `features/ship-ho/require-manage.ts`).
- Produces: `importShipHoOrders(rows: readonly unknown[][], partnerBrandSlug: string, opts?: { dryRun?: boolean }): Promise<ShipHoImportSummary>`; type `ShipHoImportSummary`.

- [ ] **Step 1: Add unique to schema** — in `db/schema.ts`, on the `shipHoOrders` table change the `code` column line to:

```ts
  code: text('code').notNull().unique(),
```

- [ ] **Step 2: Migration** `db/migrations/0084_ship-ho-code-unique.sql`

```sql
CREATE UNIQUE INDEX "ship_ho_orders_code_unique" ON "ship_ho_orders" ("code");
```

- [ ] **Step 3: Journal entry** — append to `entries` in `db/migrations/meta/_journal.json` after idx 83:

```json
    ,{
      "idx": 84,
      "version": "7",
      "when": 1783687200000,
      "tag": "0084_ship-ho-code-unique",
      "breakpoints": true
    }
```

- [ ] **Step 4: Implement orchestrator** `features/ship-ho/import-actions.ts`

```ts
'use server';

import { inArray } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { requireManageShipHo } from './require-manage';
import { parseShipHoImportRow, statusForImportedOrder, type ParsedShipHoImport } from './import-parse';

export interface ShipHoImportSummary {
  total: number;
  inserted: number;
  updated: number;
  skippedEmpty: number;
  errors: Array<{ rowIndex: number; reason: string }>;
  dryRun: boolean;
}

function toValues(p: ParsedShipHoImport, partnerBrandSlug: string) {
  return {
    code: p.code,
    partnerBrandSlug,
    recipientName: p.recipientName,
    recipientCompany: p.recipientCompany,
    recipientPhone: p.recipientPhone,
    country: p.country,
    city: p.city,
    province: p.province,
    postcode: p.postcode,
    address1: p.address1,
    address2: p.address2,
    weightKg: String(p.weightKg),
    dimLengthCm: p.dimLengthCm == null ? null : String(p.dimLengthCm),
    dimWidthCm: p.dimWidthCm == null ? null : String(p.dimWidthCm),
    dimHeightCm: p.dimHeightCm == null ? null : String(p.dimHeightCm),
    packagingType: p.packagingType,
    carrierKey: p.carrierKey,
    trackingNumber: p.trackingNumber,
    status: statusForImportedOrder(p.trackingNumber) as 'shipped' | 'draft',
  };
}

/**
 * Import lô đơn ship hộ cho 1 partner từ các dòng file (đã bỏ header ở caller).
 * Upsert theo `code`: đã có → cập nhật field vận hành + tracking; chưa có → insert.
 * KHÔNG chạm giá (carrierCostVnd/chargedVnd) — quote là việc P1 (requote thủ công).
 */
export async function importShipHoOrders(
  rows: readonly unknown[][],
  partnerBrandSlug: string,
  opts?: { dryRun?: boolean },
): Promise<ShipHoImportSummary> {
  await requireManageShipHo();
  const dryRun = opts?.dryRun ?? false;
  const summary: ShipHoImportSummary = {
    total: rows.length, inserted: 0, updated: 0, skippedEmpty: 0, errors: [], dryRun,
  };

  const parsed: ParsedShipHoImport[] = [];
  rows.forEach((row, i) => {
    const r = parseShipHoImportRow(row);
    if (r.kind === 'ok') parsed.push(r.row);
    else if (r.kind === 'skip_empty') summary.skippedEmpty += 1;
    else summary.errors.push({ rowIndex: i, reason: r.reason });
  });

  if (parsed.length === 0 || dryRun) {
    // Với dryRun vẫn phân loại inserted/updated để xem trước.
    if (dryRun && parsed.length) {
      const codes = parsed.map((p) => p.code);
      const existing = new Set(
        (await db.select({ code: schema.shipHoOrders.code }).from(schema.shipHoOrders)
          .where(inArray(schema.shipHoOrders.code, codes))).map((r) => r.code),
      );
      for (const p of parsed) (existing.has(p.code) ? summary.updated++ : summary.inserted++);
    }
    return summary;
  }

  const codes = parsed.map((p) => p.code);
  const existing = new Set(
    (await db.select({ code: schema.shipHoOrders.code }).from(schema.shipHoOrders)
      .where(inArray(schema.shipHoOrders.code, codes))).map((r) => r.code),
  );

  for (const p of parsed) {
    const values = toValues(p, partnerBrandSlug);
    if (existing.has(p.code)) {
      const { code, ...set } = values;
      await db.update(schema.shipHoOrders).set(set).where(eq(schema.shipHoOrders.code, code));
      summary.updated += 1;
    } else {
      await db.insert(schema.shipHoOrders).values(values);
      summary.inserted += 1;
    }
  }

  revalidatePath('/f/ship-ho');
  return summary;
}
```

- [ ] **Step 5: Verify tsc**

Run: `npx tsc --noEmit`
Expected: exit 0. (If Drizzle complains about the `status` literal type, keep the `as 'shipped' | 'draft'` cast in `toValues`.)

- [ ] **Step 6: Commit**

```bash
git add db/schema.ts db/migrations/0084_ship-ho-code-unique.sql db/migrations/meta/_journal.json features/ship-ho/import-actions.ts
git commit -m "feat(ship-ho): migration 0084 unique code + import orchestrator (upsert theo code)"
```

---

### Task 3: Auto-track engine + pure status helper

**Files:**
- Create: `features/ship-ho/track.ts`
- Test: `features/ship-ho/track.test.ts`

**Interfaces:**
- Consumes: `trackFedex`, `type DeliveryStatus` từ `@/lib/fedex/track`; `trackDhl` từ `@/lib/dhl/track`; `schema.shipHoOrders`.
- Produces:
  - `orderStatusAfterTrack(current: string, delivery: DeliveryStatus): string` (thuần)
  - `trackAndStoreShipHo(orderId: string): Promise<{ ok: boolean; status?: DeliveryStatus; error?: string }>`
  - `trackPendingShipHo(opts?: { limit?: number }): Promise<{ tracked: number; delivered: number; failed: number; skippedDhl: number }>`

- [ ] **Step 1: Write the failing test** `features/ship-ho/track.test.ts` (thuần helper)

```ts
import { describe, it, expect } from 'vitest';
import { orderStatusAfterTrack } from './track';

describe('orderStatusAfterTrack', () => {
  it('delivered → chuyển order sang delivered', () => {
    expect(orderStatusAfterTrack('shipped', 'delivered')).toBe('delivered');
  });
  it('chưa giao → giữ nguyên status hiện tại', () => {
    expect(orderStatusAfterTrack('shipped', 'in_transit')).toBe('shipped');
    expect(orderStatusAfterTrack('quoted', 'exception')).toBe('quoted');
  });
  it('đã billed/settled → KHÔNG hạ về delivered (giữ trạng thái cao hơn)', () => {
    expect(orderStatusAfterTrack('billed', 'delivered')).toBe('billed');
    expect(orderStatusAfterTrack('settled', 'delivered')).toBe('settled');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run features/ship-ho/track.test.ts`
Expected: FAIL — "Cannot find module './track'".

- [ ] **Step 3: Implement** `features/ship-ho/track.ts` (mirror `features/shipments/track.ts`)

```ts
import { and, eq, inArray, isNull, ne, or, gte, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { trackFedex, type DeliveryStatus } from '@/lib/fedex/track';
import { trackDhl } from '@/lib/dhl/track';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const TRACKERS = { fedex: trackFedex, dhl: trackDhl } as const;
type TrackableCarrier = keyof typeof TRACKERS;
const isTrackable = (c: string | null): c is TrackableCarrier => c === 'fedex' || c === 'dhl';

/** THUẦN: status đơn sau khi track. delivered → 'delivered'; nhưng KHÔNG hạ đơn
 *  đã 'billed'/'settled' (trạng thái tiền tệ cao hơn). Còn lại giữ nguyên. */
export function orderStatusAfterTrack(current: string, delivery: DeliveryStatus): string {
  if (delivery !== 'delivered') return current;
  if (current === 'billed' || current === 'settled') return current;
  return 'delivered';
}

export async function trackAndStoreShipHo(
  orderId: string,
): Promise<{ ok: boolean; status?: DeliveryStatus; error?: string }> {
  const [o] = await db
    .select({
      tracking: schema.shipHoOrders.trackingNumber,
      carrier: schema.shipHoOrders.carrierKey,
      status: schema.shipHoOrders.status,
    })
    .from(schema.shipHoOrders).where(eq(schema.shipHoOrders.id, orderId)).limit(1);
  if (!o) return { ok: false, error: 'order not found' };
  if (!isTrackable(o.carrier)) return { ok: false, error: 'unsupported carrier' };
  if (!o.tracking) return { ok: false, error: 'no tracking' };
  try {
    const r = await TRACKERS[o.carrier](o.tracking);
    await db.update(schema.shipHoOrders).set({
      deliveryStatus: r.status,
      deliveredAt: r.deliveredAt ?? undefined,
      lastTrackedAt: new Date(),
      status: orderStatusAfterTrack(o.status, r.status) as typeof o.status,
    }).where(eq(schema.shipHoOrders.id, orderId));
    return { ok: true, status: r.status };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'track failed' };
  }
}

const FEDEX_DELAY_MS = 300;
const DHL_DELAY_MS = Number(process.env.DHL_TRACK_DELAY_MS ?? 5000);
const DHL_MAX_PER_RUN = Number(process.env.DHL_MAX_PER_RUN ?? 30);

/** Poll đơn ship hộ chưa giao (fedex/dhl, có tracking, tạo ≤45 ngày). DHL giãn
 *  nhịp + cap/lượt; thiếu key/429 → bỏ nhánh DHL, FedEx vẫn chạy. */
export async function trackPendingShipHo(
  opts?: { limit?: number },
): Promise<{ tracked: number; delivered: number; failed: number; skippedDhl: number }> {
  const limit = opts?.limit ?? 100;
  const cutoff = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({ id: schema.shipHoOrders.id, carrier: schema.shipHoOrders.carrierKey })
    .from(schema.shipHoOrders)
    .where(and(
      inArray(schema.shipHoOrders.carrierKey, ['fedex', 'dhl']),
      sql`${schema.shipHoOrders.trackingNumber} is not null`,
      or(isNull(schema.shipHoOrders.deliveryStatus), ne(schema.shipHoOrders.deliveryStatus, 'delivered')),
      gte(schema.shipHoOrders.createdAt, cutoff),
    ))
    .orderBy(sql`${schema.shipHoOrders.lastTrackedAt} asc nulls first`)
    .limit(limit);

  const summary = { tracked: 0, delivered: 0, failed: 0, skippedDhl: 0 };
  let skipDhl = false;
  let dhlDone = 0;
  for (const r of rows) {
    const isDhl = r.carrier === 'dhl';
    if (isDhl && (skipDhl || dhlDone >= DHL_MAX_PER_RUN)) { summary.skippedDhl++; continue; }
    const res = await trackAndStoreShipHo(r.id);
    if (isDhl) dhlDone++;
    if (res.ok) {
      summary.tracked++;
      if (res.status === 'delivered') summary.delivered++;
    } else if (res.error === 'no_dhl_key') {
      skipDhl = true; summary.skippedDhl++;
    } else if (res.error === 'dhl_rate_limited') {
      skipDhl = true;
    } else if (res.error !== 'no tracking' && res.error !== 'unsupported carrier') {
      summary.failed++;
    }
    await sleep(isDhl ? DHL_DELAY_MS : FEDEX_DELAY_MS);
  }
  return summary;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run features/ship-ho/track.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Verify tsc**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add features/ship-ho/track.ts features/ship-ho/track.test.ts
git commit -m "feat(ship-ho): auto-track engine (mirror shipments) + orderStatusAfterTrack thuần"
```

---

### Task 4: Cron registration (track-ship-ho)

**Files:**
- Create: `scripts/cron/track-ship-ho.ts`
- Create: `railway.cron-track-ship-ho.json`
- Modify: `package.json` (add `cron:track-ship-ho` script)

**Interfaces:**
- Consumes: `trackPendingShipHo` (Task 3).

- [ ] **Step 1: Cron script** `scripts/cron/track-ship-ho.ts` (mirror `scripts/cron/track-shipments.ts`)

```ts
import { trackPendingShipHo } from '@/features/ship-ho/track';

async function main(): Promise<void> {
  const s = await trackPendingShipHo({ limit: 200 });
  process.stdout.write(
    `track-ship-ho: tracked ${s.tracked}, delivered ${s.delivered}, failed ${s.failed}, skipDHL ${s.skippedDhl}\n`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    process.stderr.write(`track-ship-ho failed: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  });
```

> NOTE: verify the exact main/exit shape against `scripts/cron/track-shipments.ts` when implementing and match it (imports, `process.exit`, error handling).

- [ ] **Step 2: Railway cron config** `railway.cron-track-ship-ho.json` (copy `railway.cron-track.json` verbatim, only change the start command)

```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": { "builder": "NIXPACKS", "buildCommand": "npm run build" },
  "deploy": { "startCommand": "npm run cron:track-ship-ho" }
}
```

- [ ] **Step 3: package.json script** — add next to `"cron:track-shipments"`:

```json
    "cron:track-ship-ho": "dotenv -- tsx scripts/cron/track-ship-ho.ts",
```

- [ ] **Step 4: Verify tsc**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add scripts/cron/track-ship-ho.ts railway.cron-track-ship-ho.json package.json
git commit -m "feat(ship-ho): cron track-ship-ho (auto-track delivery)"
```

---

### Task 5: UI — import upload + tracking entry/hiển thị

**Files:**
- Create: `features/ship-ho/tracking-actions.ts`
- Create: `app/(dashboard)/f/ship-ho/import/page.tsx`
- Create: `app/(dashboard)/f/ship-ho/import/ImportUploader.tsx`
- Create: `app/(dashboard)/f/ship-ho/[id]/TrackingCard.tsx`
- Modify: `app/(dashboard)/f/ship-ho/[id]/page.tsx` (render `TrackingCard` + delivery status)
- Modify: `app/(dashboard)/f/ship-ho/page.tsx` (link "Import" + cột trạng thái giao)

**Interfaces:**
- Consumes: `importShipHoOrders` (Task 2); `listShipHoPartners` (P1 `partners-actions`); `getShipHoOrder` (P1 `queries`); `requireManageShipHo`; `xlsx` (`read`, `utils`).
- Produces: `setShipHoTracking(orderId: string, input: { trackingNumber: string; carrierKey?: 'fedex' | 'dhl' | null }): Promise<{ ok: boolean; error?: string }>`.

- [ ] **Step 1: Tracking action** `features/ship-ho/tracking-actions.ts`

```ts
'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db, schema } from '@/db/client';
import { requireManageShipHo } from './require-manage';

export async function setShipHoTracking(
  orderId: string,
  input: { trackingNumber: string; carrierKey?: 'fedex' | 'dhl' | null },
): Promise<{ ok: boolean; error?: string }> {
  try {
    await requireManageShipHo();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  const tracking = input.trackingNumber.trim();
  if (!tracking) return { ok: false, error: 'Thiếu mã tracking' };
  const [cur] = await db
    .select({ status: schema.shipHoOrders.status })
    .from(schema.shipHoOrders).where(eq(schema.shipHoOrders.id, orderId)).limit(1);
  if (!cur) return { ok: false, error: 'Không tìm thấy đơn' };
  // Gán tracking → coi như đã gửi, trừ khi đã ở trạng thái cao hơn.
  const bump = cur.status === 'draft' || cur.status === 'quoted';
  await db.update(schema.shipHoOrders).set({
    trackingNumber: tracking,
    ...(input.carrierKey !== undefined ? { carrierKey: input.carrierKey } : {}),
    ...(bump ? { status: 'shipped' as const } : {}),
  }).where(eq(schema.shipHoOrders.id, orderId));
  revalidatePath(`/f/ship-ho/${orderId}`);
  revalidatePath('/f/ship-ho');
  return { ok: true };
}
```

- [ ] **Step 2: Import page** `app/(dashboard)/f/ship-ho/import/page.tsx`

```tsx
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { listShipHoPartners } from '@/features/ship-ho/partners-actions';
import { ImportUploader } from './ImportUploader';

export const dynamic = 'force-dynamic';

export default async function ShipHoImportPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'manage_ship_ho')) {
    return <div className="max-w-3xl mx-auto px-6 py-16 text-center"><h1 className="text-2xl font-semibold">Forbidden</h1></div>;
  }
  const partners = await listShipHoPartners();
  return (
    <div className="max-w-2xl mx-auto px-6 md:px-10 py-8 space-y-6">
      <h1 className="text-3xl font-semibold tracking-tight">Import đơn ship hộ</h1>
      <p className="text-sm text-muted-foreground">
        File .xlsx theo thứ tự cột: mã · người nhận · công ty · SĐT · nước(ISO2) · thành phố · tỉnh ·
        postcode · địa chỉ1 · địa chỉ2 · cân(kg) · D · R · C · đóng gói(bag/box) · carrier(fedex/dhl) · tracking.
        Dòng đầu là header (bỏ qua).
      </p>
      <ImportUploader partners={partners.filter((p) => p.status === 'active').map((p) => ({ slug: p.brandSlug, name: p.displayName ?? p.brandSlug }))} />
    </div>
  );
}
```

- [ ] **Step 3: Uploader (client, parse xlsx browser-side)** `app/(dashboard)/f/ship-ho/import/ImportUploader.tsx`

```tsx
'use client';

import { useState, useTransition } from 'react';
import { read, utils } from 'xlsx';
import { importShipHoOrders, type ShipHoImportSummary } from '@/features/ship-ho/import-actions';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

interface PartnerOpt { slug: string; name: string }

export function ImportUploader({ partners }: { partners: PartnerOpt[] }) {
  const [pending, start] = useTransition();
  const [partner, setPartner] = useState('');
  const [rows, setRows] = useState<unknown[][]>([]);
  const [fileName, setFileName] = useState('');
  const [summary, setSummary] = useState<ShipHoImportSummary | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setErr(null); setSummary(null);
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const buf = await file.arrayBuffer();
    const wb = read(buf, { type: 'array', cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const all = utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null, raw: true });
    setRows(all.slice(1)); // bỏ header
  };

  const run = (dryRun: boolean) =>
    start(async () => {
      setErr(null);
      if (!partner) { setErr('Chọn partner'); return; }
      if (rows.length === 0) { setErr('Chưa có dữ liệu'); return; }
      const s = await importShipHoOrders(rows, partner, { dryRun });
      setSummary(s);
    });

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <label className="text-sm block">Partner
          <select className="block w-full border rounded px-2 py-1 mt-1" value={partner} onChange={(e) => setPartner(e.target.value)}>
            <option value="">— chọn —</option>
            {partners.map((p) => <option key={p.slug} value={p.slug}>{p.name}</option>)}
          </select>
        </label>
        <label className="text-sm block">File .xlsx
          <input type="file" accept=".xlsx,.xls" className="block mt-1 text-sm" onChange={onFile} />
        </label>
        {fileName && <p className="text-xs text-muted-foreground">{fileName} · {rows.length} dòng dữ liệu</p>}
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => run(true)} disabled={pending || !rows.length}>Xem trước (dry-run)</Button>
          <Button onClick={() => run(false)} disabled={pending || !rows.length}>Import</Button>
        </div>
        {err && <p className="text-sm text-red-600">{err}</p>}
        {summary && (
          <div className="text-sm border-t pt-3 space-y-1">
            <div>{summary.dryRun ? 'Xem trước' : 'Đã import'}: <b>{summary.inserted}</b> tạo mới · <b>{summary.updated}</b> cập nhật · {summary.skippedEmpty} dòng trống · {summary.errors.length} lỗi</div>
            {summary.errors.slice(0, 10).map((e) => <div key={e.rowIndex} className="text-red-600 text-xs">Dòng {e.rowIndex + 2}: {e.reason}</div>)}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: Tracking card (client)** `app/(dashboard)/f/ship-ho/[id]/TrackingCard.tsx`

```tsx
'use client';

import { useState, useTransition } from 'react';
import { setShipHoTracking } from '@/features/ship-ho/tracking-actions';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

const DELIVERY_LABEL: Record<string, string> = {
  in_transit: 'Đang vận chuyển', out_for_delivery: 'Đang giao', delivered: 'Đã giao',
  exception: 'Sự cố', unknown: 'Chưa rõ',
};

export function TrackingCard({
  orderId, trackingNumber, carrierKey, deliveryStatus, deliveredAt,
}: {
  orderId: string; trackingNumber: string | null; carrierKey: string | null;
  deliveryStatus: string | null; deliveredAt: Date | null;
}) {
  const [pending, start] = useTransition();
  const [tn, setTn] = useState(trackingNumber ?? '');
  const [carrier, setCarrier] = useState(carrierKey ?? '');
  const [err, setErr] = useState<string | null>(null);

  const save = () =>
    start(async () => {
      setErr(null);
      const r = await setShipHoTracking(orderId, {
        trackingNumber: tn,
        carrierKey: carrier === 'fedex' || carrier === 'dhl' ? carrier : null,
      });
      if (!r.ok) setErr(r.error ?? 'Lỗi');
    });

  return (
    <Card><CardContent className="p-4 space-y-2 text-sm">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">Vận đơn & giao hàng</div>
      <div className="flex gap-2">
        <select className="border rounded px-2 py-1" value={carrier} onChange={(e) => setCarrier(e.target.value)}>
          <option value="">carrier</option><option value="fedex">fedex</option><option value="dhl">dhl</option>
        </select>
        <input className="border rounded px-2 py-1 flex-1" placeholder="Tracking number" value={tn} onChange={(e) => setTn(e.target.value)} />
        <Button onClick={save} disabled={pending}>Lưu</Button>
      </div>
      {err && <p className="text-red-600 text-xs">{err}</p>}
      <div className="flex justify-between border-t pt-2">
        <span>Trạng thái giao</span>
        <span className="font-medium">{deliveryStatus ? (DELIVERY_LABEL[deliveryStatus] ?? deliveryStatus) : '—'}{deliveredAt ? ` · ${new Date(deliveredAt).toLocaleDateString('vi-VN')}` : ''}</span>
      </div>
    </CardContent></Card>
  );
}
```

- [ ] **Step 5: Render TrackingCard in detail page** — in `app/(dashboard)/f/ship-ho/[id]/page.tsx`, add the import and render it after the price card:

```tsx
// add import near the top:
import { TrackingCard } from './TrackingCard';

// after the price <Card>…</Card> block, add:
      <TrackingCard
        orderId={o.id}
        trackingNumber={o.trackingNumber}
        carrierKey={o.carrierKey}
        deliveryStatus={o.deliveryStatus}
        deliveredAt={o.deliveredAt}
      />
```

- [ ] **Step 6: Add "Import" link + delivery column on the list page** — in `app/(dashboard)/f/ship-ho/page.tsx`, add an Import link next to "Đối tác"/"Tạo đơn":

```tsx
          <Link href="/f/ship-ho/import" className={buttonVariants({ variant: 'outline' })}>Import</Link>
```

(Placement: inside the header action `<div className="flex gap-2">`, before or after the existing links. Leave the table as-is — the existing "Trạng thái" column already reflects shipped/delivered.)

- [ ] **Step 7: Verify**

Run: `npx tsc --noEmit` → exit 0.
Run: `npx eslint "app/(dashboard)/f/ship-ho" features/ship-ho` → no errors.

- [ ] **Step 8: Commit**

```bash
git add "app/(dashboard)/f/ship-ho" features/ship-ho/tracking-actions.ts
git commit -m "feat(ship-ho): UI import upload + nhập tracking + hiển thị trạng thái giao"
```

---

## Self-Review

**1. Spec coverage (P2 scope):**
- Import lô từ file partner → Task 1 (parser) + Task 2 (orchestrator + migration) + Task 5 (upload UI). ✔ (nguồn = file partner, đã chốt; không dùng LOG-Export.)
- Nhập/gán trackingNumber → Task 5 `setShipHoTracking` + TrackingCard. ✔
- Auto-track delivery qua cron tái dùng lib DHL/FedEx → Task 3 (engine) + Task 4 (cron). ✔
- KHÔNG statement/đối soát (P3) → không task. ✔ KHÔNG lưu cước thực khi import → orchestrator không chạm cột giá/actual. ✔

**2. Placeholder scan:** không TBD/TODO; mọi step có code/command. 2 NOTE (Task 3 cast, Task 4 verify cron shape) là kiểm chứng thực tế, không phải placeholder.

**3. Type consistency:**
- `parseShipHoImportRow` trả `ParseShipHoResult` (Task 1) — Task 2 dùng `.kind`/`.row`/`.reason`. ✔
- `statusForImportedOrder` (Task 1) dùng ở Task 2 `toValues`. ✔
- `orderStatusAfterTrack(current, delivery)` (Task 3) dùng trong `trackAndStoreShipHo`. ✔
- `trackPendingShipHo` (Task 3) dùng ở cron Task 4. ✔
- `importShipHoOrders(rows, partnerBrandSlug, opts)` (Task 2) khớp lời gọi ở ImportUploader (Task 5). ✔
- Cột `schema.shipHoOrders.*` (P1) dùng nhất quán; `code` thêm `.unique()` (Task 2) khớp migration 0084. ✔
- `setShipHoTracking(orderId, {trackingNumber, carrierKey?})` (Task 5) khớp TrackingCard. ✔

## Execution Handoff (điền sau khi lưu plan)
