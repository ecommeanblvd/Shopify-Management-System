# Worklist Phần B — Lark detail live + cột status synced — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bổ sung dữ liệu Lark vào worklist — card chi tiết live-fetch (mọi field) + 1 cột status Lark synced trên bảng list.

**Architecture:** Hai đường độc lập. (1) Cron `sync-lark` (đã chạy) được mở rộng để upsert snapshot 4 field status Lark/đơn vào bảng mới `lark_order_status`; bảng worklist LEFT JOIN bảng này → 1 cột "Lark (vận hành)" (đọc DB, không gọi Lark). (2) Trang chi tiết đơn gọi Lark search theo Order Number ngay khi mở → card liệt kê mọi field của record khớp.

**Tech Stack:** Next.js App Router (RSC, force-dynamic), Drizzle ORM, Vitest, Tailwind, Lark Bitable API (read-only).

## Global Constraints

- Lark API read-only, one-way (KHÔNG ghi ngược Lark).
- Migration **hand-authored**, KHÔNG chạy `db:migrate` local (Railway chạy khi deploy). Journal: latest idx 75 → next **0076**.
- Lỗi/thiếu env Lark trong path detail → trả `[]`, card hiện trạng thái trống; KHÔNG ném lỗi làm vỡ trang.
- List đọc DB synced, KHÔNG live-fetch Lark.
- Cột list "Lark (vận hành)" = chip text **muted** (không tô tone — vocab Lark không kiểm soát).
- 4 field Lark (tên thật trong base): `LOG-EP-Dispatch Status` → `dispatchStatus`; `CX-FF Status (look up)` → `cxFfStatus`; `Final | Delivery Status` → `deliveryStatus`; `Ngày giao dự kiến` (date) → `expectedDeliveryDate`.
- Sync mở rộng KHÔNG được làm hỏng path patch shipment hiện tại (giữ try/catch + summary cũ; chỉ thêm).
- Verify mỗi task đụng code TS: `npx tsc --noEmit` sạch; task UI thêm `npx vitest run` + `npm run build` xanh.
- Branch: `feat/worklist-lark-detail` (đã tạo, spec đã commit `eea2c21`).

---

### Task 1: `parseLarkStatus` — summarizer field Lark thuần

**Files:**
- Modify: `features/lark/parse-pack-row.ts` (export 2 helper sẵn có)
- Create: `features/lark/parse-status-row.ts`
- Test: `features/lark/parse-status-row.test.ts`

**Interfaces:**
- Consumes: `larkText`, `larkEpochToVnMidnight` từ `parse-pack-row.ts` (hiện là private → cần export).
- Produces: `interface LarkStatusRow { dispatchStatus: string | null; cxFfStatus: string | null; deliveryStatus: string | null; expectedDeliveryDate: Date | null }` và `parseLarkStatus(fields: Record<string, unknown>): LarkStatusRow`.

- [ ] **Step 1: Export 2 helper từ parse-pack-row.ts**

Trong `features/lark/parse-pack-row.ts`, đổi 2 khai báo sau thành `export` (giữ nguyên thân hàm):

```ts
export function larkText(v: unknown): string | null {
```
```ts
export function larkEpochToVnMidnight(ms: number): Date {
```

Chạy `npx vitest run features/lark/parse-pack-row.test.ts` để chắc không vỡ test cũ. Expected: PASS như cũ.

- [ ] **Step 2: Write the failing test**

Tạo `features/lark/parse-status-row.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseLarkStatus } from './parse-status-row';

describe('parseLarkStatus', () => {
  it('đọc field text + lookup-array + formula', () => {
    const r = parseLarkStatus({
      'LOG-EP-Dispatch Status': 'Đang giao',
      'CX-FF Status (look up)': [{ text: 'Đã xác nhận' }],
      'Final | Delivery Status': 'Delivered',
    });
    expect(r.dispatchStatus).toBe('Đang giao');
    expect(r.cxFfStatus).toBe('Đã xác nhận');
    expect(r.deliveryStatus).toBe('Delivered');
  });

  it('Ngày giao dự kiến: epoch ms → UTC nửa đêm ngày-lịch VN', () => {
    // 2026-06-08 17:00:00 UTC = 2026-06-09 00:00 giờ VN → kỳ vọng 2026-06-09T00:00:00Z
    const ms = Date.UTC(2026, 5, 8, 17, 0, 0);
    const r = parseLarkStatus({ 'Ngày giao dự kiến': ms });
    expect(r.expectedDeliveryDate?.toISOString()).toBe('2026-06-09T00:00:00.000Z');
  });

  it('field thiếu/rỗng → null', () => {
    const r = parseLarkStatus({});
    expect(r).toEqual({ dispatchStatus: null, cxFfStatus: null, deliveryStatus: null, expectedDeliveryDate: null });
  });

  it('Ngày giao dự kiến không phải số → null', () => {
    const r = parseLarkStatus({ 'Ngày giao dự kiến': 'n/a' });
    expect(r.expectedDeliveryDate).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run features/lark/parse-status-row.test.ts`
Expected: FAIL — "Cannot find module './parse-status-row'".

- [ ] **Step 4: Write minimal implementation**

Tạo `features/lark/parse-status-row.ts`:

```ts
/**
 * THUẦN: 1 record Lark (object `fields`) → 4 field status snapshot cho list.
 * Dùng lại helper đọc field + epoch→VN-date của parse-pack-row (DRY).
 */
import { larkText, larkEpochToVnMidnight } from './parse-pack-row';

export interface LarkStatusRow {
  dispatchStatus: string | null;
  cxFfStatus: string | null;
  deliveryStatus: string | null;
  expectedDeliveryDate: Date | null;
}

/** Field date Lark = epoch ms (số). Non-số/null → null. */
function larkDate(v: unknown): Date | null {
  if (typeof v === 'number' && Number.isFinite(v)) return larkEpochToVnMidnight(v);
  return null;
}

export function parseLarkStatus(fields: Record<string, unknown>): LarkStatusRow {
  return {
    dispatchStatus: larkText(fields['LOG-EP-Dispatch Status']),
    cxFfStatus: larkText(fields['CX-FF Status (look up)']),
    deliveryStatus: larkText(fields['Final | Delivery Status']),
    expectedDeliveryDate: larkDate(fields['Ngày giao dự kiến']),
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run features/lark/parse-status-row.test.ts`
Expected: PASS (4 test).

- [ ] **Step 6: tsc + commit**

Run: `npx tsc --noEmit` → no output.

```bash
git add features/lark/parse-pack-row.ts features/lark/parse-status-row.ts features/lark/parse-status-row.test.ts
git commit -m "feat(ops): parseLarkStatus — đọc 4 field status Lark thuần (Phần B)"
```

---

### Task 2: Bảng `lark_order_status` + migration 0076

**Files:**
- Modify: `db/schema.ts` (thêm table export, đặt ngay sau `larkSyncRuns`)
- Create: `db/migrations/0076_lark-order-status.sql`
- Modify: `db/migrations/meta/_journal.json` (thêm entry idx 76)

**Interfaces:**
- Produces: `schema.larkOrderStatus` với cột `orderId` (uuid, unique, FK shopify_orders cascade), `dispatchStatus` text, `cxFfStatus` text, `deliveryStatus` text, `expectedDeliveryDate` date, `syncedAt` timestamp notNull.

- [ ] **Step 1: Thêm table vào schema.ts**

Trong `db/schema.ts`, ngay **sau** block `export const larkSyncRuns = pgTable(...)`, thêm:

```ts
/** Snapshot status Lark/đơn (Phần B). Cron sync upsert; worklist LEFT JOIN để
 *  hiện cột "Lark (vận hành)". 1 dòng / đơn. */
export const larkOrderStatus = pgTable('lark_order_status', {
  id: uuid('id').primaryKey().defaultRandom(),
  orderId: uuid('order_id').notNull().unique()
    .references(() => shopifyOrders.id, { onDelete: 'cascade' }),
  dispatchStatus: text('dispatch_status'),
  cxFfStatus: text('cx_ff_status'),
  deliveryStatus: text('delivery_status'),
  expectedDeliveryDate: date('expected_delivery_date'),
  syncedAt: timestamp('synced_at').notNull().defaultNow(),
});
```

- [ ] **Step 2: Viết migration SQL (hand-authored)**

Tạo `db/migrations/0076_lark-order-status.sql`:

```sql
CREATE TABLE "lark_order_status" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"dispatch_status" text,
	"cx_ff_status" text,
	"delivery_status" text,
	"expected_delivery_date" date,
	"synced_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "lark_order_status_order_id_unique" UNIQUE("order_id")
);
--> statement-breakpoint
ALTER TABLE "lark_order_status" ADD CONSTRAINT "lark_order_status_order_id_shopify_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."shopify_orders"("id") ON DELETE cascade ON UPDATE no action;
```

- [ ] **Step 3: Thêm entry vào journal**

Trong `db/migrations/meta/_journal.json`, thêm vào cuối mảng `entries` (sau entry idx 75):

```json
{
"idx": 76,
"version": "7",
"when": 1782996000000,
"tag": "0076_lark-order-status",
"breakpoints": true
}
```

(Nhớ thêm dấu `,` sau entry idx 75 trước đó.)

- [ ] **Step 4: Verify tsc**

Run: `npx tsc --noEmit` → no output (schema biên dịch được; KHÔNG chạy db:migrate).

- [ ] **Step 5: Commit**

```bash
git add db/schema.ts db/migrations/0076_lark-order-status.sql db/migrations/meta/_journal.json
git commit -m "feat(ops): bảng lark_order_status + migration 0076 (Phần B)"
```

---

### Task 3: Lark client — search theo Order Number

**Files:**
- Modify: `features/lark/client.ts` (thêm builder thuần + hàm fetch)
- Test: `features/lark/client.test.ts` (mới — chỉ test builder thuần)

**Interfaces:**
- Consumes: `getTenantToken()`, `env()`, `LarkRecord`, `DOMAIN` (private trong client.ts — hàm mới ở cùng file nên truy cập được).
- Produces: `buildOrderNumberSearchBody(orderNumber: string): Record<string, unknown>` (export, thuần) và `searchRecordsByOrderNumber(orderNumber: string): Promise<LarkRecord[]>`.

- [ ] **Step 1: Write the failing test (builder thuần)**

Tạo `features/lark/client.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildOrderNumberSearchBody } from './client';

describe('buildOrderNumberSearchBody', () => {
  it('khớp cả dạng có # và không # (conjunction or)', () => {
    const body = buildOrderNumberSearchBody('#MBLVD28907') as {
      filter: { conjunction: string; conditions: Array<{ field_name: string; operator: string; value: string[] }> };
      page_size: number;
    };
    expect(body.filter.conjunction).toBe('or');
    const vals = body.filter.conditions.flatMap((c) => c.value);
    expect(vals).toContain('MBLVD28907');
    expect(vals).toContain('#MBLVD28907');
    expect(body.filter.conditions.every((c) => c.field_name === 'Order Number' && c.operator === 'is')).toBe(true);
    expect(body.page_size).toBe(500);
  });

  it('đầu vào không # vẫn sinh cả 2 dạng', () => {
    const body = buildOrderNumberSearchBody('TA2209') as {
      filter: { conditions: Array<{ value: string[] }> };
    };
    const vals = body.filter.conditions.flatMap((c) => c.value);
    expect(vals).toContain('TA2209');
    expect(vals).toContain('#TA2209');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run features/lark/client.test.ts`
Expected: FAIL — `buildOrderNumberSearchBody` không export / không tồn tại.

- [ ] **Step 3: Implement builder + fetch trong client.ts**

Trong `features/lark/client.ts`, thêm **cuối file**:

```ts
/** Body cho records/search filter theo "Order Number". Khớp CẢ dạng có '#' và
 *  không '#' (Shopify lưu '#MBLVD..' hoặc 'TA..'; Lark có thể khác) → conjunction
 *  'or' hai điều kiện. THUẦN để unit-test. */
export function buildOrderNumberSearchBody(orderNumber: string): Record<string, unknown> {
  const bare = orderNumber.replace(/^#/, '');
  const forms = [bare, `#${bare}`];
  return {
    filter: {
      conjunction: 'or',
      conditions: forms.map((v) => ({ field_name: 'Order Number', operator: 'is', value: [v] })),
    },
    automatic_fields: false,
    page_size: 500,
  };
}

/** Tìm record Lark theo Order Number (cả 2 dạng #). Read-only. Phân trang. */
export async function searchRecordsByOrderNumber(orderNumber: string): Promise<LarkRecord[]> {
  if (!orderNumber.trim()) return [];
  const token = await getTenantToken();
  const appToken = env('LARK_BASE_APP_TOKEN');
  const tableId = env('LARK_TABLE_ID');
  const out: LarkRecord[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL(`${DOMAIN}/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records/search`);
    if (pageToken) url.searchParams.set('page_token', pageToken);
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(buildOrderNumberSearchBody(orderNumber)),
    });
    const j = (await res.json()) as {
      code: number; msg: string;
      data?: { items?: LarkRecord[]; page_token?: string; has_more?: boolean };
    };
    if (j.code !== 0) throw new Error(`[lark] search fail: code=${j.code} msg=${j.msg}`);
    out.push(...(j.data?.items ?? []));
    pageToken = j.data?.has_more ? j.data?.page_token : undefined;
  } while (pageToken);
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run features/lark/client.test.ts`
Expected: PASS (2 test).

- [ ] **Step 5: tsc + commit**

Run: `npx tsc --noEmit` → no output.

```bash
git add features/lark/client.ts features/lark/client.test.ts
git commit -m "feat(ops): Lark searchRecordsByOrderNumber + builder thuần (Phần B)"
```

---

### Task 4: Sync mở rộng — upsert `lark_order_status`

**Files:**
- Modify: `features/lark/sync.ts`

**Interfaces:**
- Consumes: `parseLarkStatus`/`LarkStatusRow` (Task 1), `schema.larkOrderStatus` (Task 2), `resolveOrderIds` (sẵn có), `records` đã đọc trong `syncLarkPacks`, `chunk`/`APPLY_CHUNK` (sẵn có trong file).
- Produces: trong cùng `syncLarkPacks()`, upsert snapshot status theo orderId; thêm `larkStatusUpserted: number` vào `LarkSyncSummary`.

- [ ] **Step 1: Thêm import + field summary**

Trong `features/lark/sync.ts`:
- Thêm import:
```ts
import { parseLarkStatus } from './parse-status-row';
```
- Trong `export interface LarkSyncSummary { ... }`, thêm dòng:
```ts
  larkStatusUpserted: number;
```

- [ ] **Step 2: Gom status theo orderId + upsert (đặt SAU vòng create shipment, TRƯỚC khi tạo `warnings`/`summary`)**

Trong thân `syncLarkPacks()`, ngay sau block `for (const batch of chunk(cls.create, APPLY_CHUNK)) { ... }`, thêm:

```ts
    // Phần B: snapshot status Lark theo orderId (ghi đè CÓ ĐIỀU KIỆN — record sau
    // bù field record trước thiếu; đơn nhiều kiện vẫn ra 1 dòng/đơn).
    const statusByOrderId = new Map<string, {
      dispatchStatus: string | null; cxFfStatus: string | null;
      deliveryStatus: string | null; expectedDeliveryDate: Date | null;
    }>();
    for (const rec of records) {
      const orderNumber = (rec.fields['Order Number'] as unknown);
      const num = typeof orderNumber === 'string' ? orderNumber.replace(/^#/, '') : null;
      if (!num) continue;
      const orderId = orderIdByNumber.get(num);
      if (!orderId) continue;
      const s = parseLarkStatus(rec.fields);
      const prev = statusByOrderId.get(orderId) ?? { dispatchStatus: null, cxFfStatus: null, deliveryStatus: null, expectedDeliveryDate: null };
      statusByOrderId.set(orderId, {
        dispatchStatus: s.dispatchStatus ?? prev.dispatchStatus,
        cxFfStatus: s.cxFfStatus ?? prev.cxFfStatus,
        deliveryStatus: s.deliveryStatus ?? prev.deliveryStatus,
        expectedDeliveryDate: s.expectedDeliveryDate ?? prev.expectedDeliveryDate,
      });
    }
    const statusRows = [...statusByOrderId.entries()];
    let larkStatusUpserted = 0;
    for (const batch of chunk(statusRows, APPLY_CHUNK)) {
      await db.transaction(async (tx) => {
        for (const [orderId, s] of batch) {
          await tx.insert(schema.larkOrderStatus).values({
            orderId,
            dispatchStatus: s.dispatchStatus,
            cxFfStatus: s.cxFfStatus,
            deliveryStatus: s.deliveryStatus,
            expectedDeliveryDate: s.expectedDeliveryDate
              ? s.expectedDeliveryDate.toISOString().slice(0, 10) : null,
            syncedAt: new Date(),
          }).onConflictDoUpdate({
            target: schema.larkOrderStatus.orderId,
            set: {
              dispatchStatus: s.dispatchStatus,
              cxFfStatus: s.cxFfStatus,
              deliveryStatus: s.deliveryStatus,
              expectedDeliveryDate: s.expectedDeliveryDate
                ? s.expectedDeliveryDate.toISOString().slice(0, 10) : null,
              syncedAt: new Date(),
            },
          });
          larkStatusUpserted += 1;
        }
      });
    }
```

> Lưu ý: `expectedDeliveryDate` là cột `date` của Drizzle → set bằng **string `'YYYY-MM-DD'`** (cắt từ Date đã chuẩn-hoá-VN), KHÔNG truyền Date object.

- [ ] **Step 3: Thêm vào object summary**

Tìm dòng tạo `const summary: LarkSyncSummary = { created: ..., warnings };` và thêm `larkStatusUpserted`:

```ts
    const summary: LarkSyncSummary = { created: cls.create.length, updated: cls.update.length, unmatched: cls.unmatched, skipped: cls.skipped.length, warnings, larkStatusUpserted };
```

- [ ] **Step 4: Sửa mọi nơi khởi tạo LarkSyncSummary khác (nếu có)**

Run: `grep -rn "LarkSyncSummary" features/ app/` — nếu có chỗ nào tạo object `LarkSyncSummary` literal khác (vd trong actions/test), thêm `larkStatusUpserted: 0`. Nếu không có, bỏ qua.

- [ ] **Step 5: Verify tsc + suite**

Run: `npx tsc --noEmit` → no output.
Run: `npx vitest run` → toàn bộ suite xanh (không có test DB; chỉ chắc không vỡ biên dịch/test cũ).

- [ ] **Step 6: Commit**

```bash
git add features/lark/sync.ts
git commit -m "feat(ops): sync upsert lark_order_status snapshot theo đơn (Phần B)"
```

---

### Task 5: Cột "Lark (vận hành)" trên worklist

**Files:**
- Modify: `features/fulfillment/worklist-status-queries.ts`
- Modify: `components/fulfillment/WorklistTable.tsx`

**Interfaces:**
- Consumes: `schema.larkOrderStatus` (Task 2).
- Produces: `WorklistStatusRow.lark: { dispatchStatus: string | null; cxFfStatus: string | null; deliveryStatus: string | null; expectedDeliveryDate: string | null } | null`. WorklistTable render cột mới từ `row.lark`.

- [ ] **Step 1: Mở rộng query + type**

Trong `features/fulfillment/worklist-status-queries.ts`:
- Thêm vào `interface WorklistStatusRow` (sau `ship: {...}`):
```ts
  lark: { dispatchStatus: string | null; cxFfStatus: string | null; deliveryStatus: string | null; expectedDeliveryDate: string | null } | null;
```
- Thêm vào `db.select({...})` của `base` (sau `addrVerifiedAt`):
```ts
    larkDispatch: schema.larkOrderStatus.dispatchStatus,
    larkCxFf: schema.larkOrderStatus.cxFfStatus,
    larkDelivery: schema.larkOrderStatus.deliveryStatus,
    larkExpected: schema.larkOrderStatus.expectedDeliveryDate,
```
- Thêm LEFT JOIN vào chuỗi `base` (sau `.innerJoin(schema.stores, ...)`, TRƯỚC `.orderBy(...)`):
```ts
    .leftJoin(schema.larkOrderStatus, eq(schema.larkOrderStatus.orderId, schema.orderFulfillment.orderId))
```
- Trong `return base.map((r) => { ... })`, thay vì `...r` truyền thẳng (sẽ lẫn 4 field lark*), tách `lark` ra. Đổi block return thành:

```ts
  return base.map((r) => {
    const b = bMap.get(r.orderId); const k = kMap.get(r.orderId); const s = sMap.get(r.orderId);
    const lark = (r.larkDispatch || r.larkCxFf || r.larkDelivery || r.larkExpected)
      ? { dispatchStatus: r.larkDispatch, cxFfStatus: r.larkCxFf, deliveryStatus: r.larkDelivery, expectedDeliveryDate: r.larkExpected }
      : null;
    return {
      orderId: r.orderId, status: r.status, orderNumber: r.orderNumber, storeName: r.storeName,
      createdAtShopify: r.createdAtShopify, addrDeliverable: r.addrDeliverable, addrVerifiedAt: r.addrVerifiedAt,
      brand: { total: n(b?.total), awaiting: n(b?.awaiting), confirmed: n(b?.confirmed), delivered: n(b?.delivered), minExpected: b?.minExpected ?? null },
      kcs: { pending: n(k?.pending), pass: n(k?.pass), fail: n(k?.fail) },
      ship: { packs: n(s?.packs), withTracking: n(s?.withTracking), delivered: n(s?.delivered), exception: n(s?.exception), inTransit: n(s?.inTransit) },
      lark,
    };
  });
```

> `expectedDeliveryDate` (cột date) Drizzle trả **string `'YYYY-MM-DD'`** → `larkExpected` đã là string|null, khớp type.

- [ ] **Step 2: Verify tsc (query xong trước UI)**

Run: `npx tsc --noEmit` → no output.

- [ ] **Step 3: Thêm cột vào WorklistTable.tsx**

Trong `components/fulfillment/WorklistTable.tsx`:
- Mở rộng `WorklistRow` type (tìm `interface WorklistRow` / `type WorklistRow`) thêm:
```ts
  lark: { dispatchStatus: string | null; cxFfStatus: string | null; deliveryStatus: string | null; expectedDeliveryDate: string | null } | null;
```
- Trong header `<thead>`, thêm `<th>` **"Lark (vận hành)"** ngay TRƯỚC cột "Tình trạng" (cột cuối). Dùng cùng class `<th>` với các cột khác trong file.
- Trong body `<tbody>`, thêm `<td>` tương ứng ngay trước `<td>` render badge "Tình trạng". Nội dung:

```tsx
<td className="px-3 py-2 align-top">
  {row.lark ? (
    <div className="flex flex-col gap-0.5 text-xs text-gray-500">
      {row.lark.dispatchStatus && <span>{row.lark.dispatchStatus}</span>}
      {row.lark.cxFfStatus && <span>{row.lark.cxFfStatus}</span>}
      {row.lark.deliveryStatus && <span>{row.lark.deliveryStatus}</span>}
      {row.lark.expectedDeliveryDate && <span>Dự kiến: {ddmmyyyy(row.lark.expectedDeliveryDate)}</span>}
    </div>
  ) : (
    <span className="text-gray-400">—</span>
  )}
</td>
```

> Dùng cùng class `px-3 py-2` như các `<td>` khác trong file (khớp style hiện tại nếu khác). Nếu file chưa có helper format ngày dạng `dd/MM/yyyy` cho string ISO, thêm helper thuần cạnh component:
```ts
function ddmmyyyy(iso: string): string {
  // 'YYYY-MM-DD' → 'dd/MM/yyyy' bằng cắt chuỗi (không Date/timezone)
  if (!iso || iso.length < 10) return iso || '—';
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}
```
> Nếu cột "Ngày" (Phần A) đã có helper format ngày từ string, tái dùng thay vì thêm mới (DRY).

- [ ] **Step 4: Cập nhật colSpan empty-state**

Tìm `colSpan={8}` (dòng empty-state Phần A) → đổi thành `colSpan={9}` (đã thêm 1 cột).

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: tsc no output; vitest toàn bộ pass; build xanh.

- [ ] **Step 6: Commit**

```bash
git add features/fulfillment/worklist-status-queries.ts components/fulfillment/WorklistTable.tsx
git commit -m "feat(ops): cột 'Lark (vận hành)' synced trên worklist (Phần B)"
```

---

### Task 6: Card chi tiết Lark (live) trên trang đơn

**Files:**
- Create: `features/lark/detail.ts`
- Test: `features/lark/detail.test.ts` (chỉ test flatten thuần)
- Create: `components/fulfillment/LarkDetailCard.tsx`
- Modify: `app/(dashboard)/f/fulfillment/[orderId]/page.tsx`

**Interfaces:**
- Consumes: `searchRecordsByOrderNumber` (Task 3), `larkText` (export Task 1), `db`/`schema` (resolve order number theo orderId).
- Produces: `flattenLarkRecord(fields: Record<string, unknown>): Array<{ label: string; value: string }>` (export, thuần); `getLarkRecordsForOrder(orderId: string): Promise<Array<{ recordId: string; fields: Array<{ label: string; value: string }> }>>`; component `LarkDetailCard`.

- [ ] **Step 1: Write the failing test (flatten thuần)**

Tạo `features/lark/detail.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { flattenLarkRecord } from './detail';

describe('flattenLarkRecord', () => {
  it('làm phẳng field text/lookup, bỏ field rỗng', () => {
    const out = flattenLarkRecord({
      'Order Number': '#MBLVD1',
      'CX-FF Status (look up)': [{ text: 'OK' }],
      'Empty': '',
      'Null': null,
    });
    expect(out).toContainEqual({ label: 'Order Number', value: '#MBLVD1' });
    expect(out).toContainEqual({ label: 'CX-FF Status (look up)', value: 'OK' });
    expect(out.find((f) => f.label === 'Empty')).toBeUndefined();
    expect(out.find((f) => f.label === 'Null')).toBeUndefined();
  });

  it('số → chuỗi', () => {
    const out = flattenLarkRecord({ 'Weights': 1.5 });
    expect(out).toContainEqual({ label: 'Weights', value: '1.5' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run features/lark/detail.test.ts`
Expected: FAIL — "Cannot find module './detail'".

- [ ] **Step 3: Implement detail.ts**

Tạo `features/lark/detail.ts`:

```ts
/**
 * Phần B — fetch LIVE record Lark cho trang chi tiết đơn (mọi field, key→value).
 * Lỗi/thiếu env → trả [] (card hiện trạng thái trống), KHÔNG ném làm vỡ trang.
 */
import 'server-only';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { larkText } from './parse-pack-row';
import { searchRecordsByOrderNumber } from './client';

/** 1 record Lark → list {label,value}; bỏ field rỗng/không stringify được. THUẦN. */
export function flattenLarkRecord(fields: Record<string, unknown>): Array<{ label: string; value: string }> {
  const out: Array<{ label: string; value: string }> = [];
  for (const [label, raw] of Object.entries(fields)) {
    const value = larkText(raw);
    if (value) out.push({ label, value });
  }
  return out;
}

export interface LarkDetailRecord {
  recordId: string;
  fields: Array<{ label: string; value: string }>;
}

/** Lấy (các) record Lark của đơn theo Order Number. Best-effort: lỗi → []. */
export async function getLarkRecordsForOrder(orderId: string): Promise<LarkDetailRecord[]> {
  try {
    const [ord] = await db
      .select({ orderNumber: schema.shopifyOrders.shopifyOrderNumber })
      .from(schema.shopifyOrders)
      .where(eq(schema.shopifyOrders.id, orderId))
      .limit(1);
    if (!ord?.orderNumber) return [];
    const records = await searchRecordsByOrderNumber(ord.orderNumber);
    return records.map((r) => ({ recordId: r.record_id, fields: flattenLarkRecord(r.fields) }));
  } catch (e) {
    console.error(`[lark] getLarkRecordsForOrder ${orderId} lỗi:`, e);
    return [];
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run features/lark/detail.test.ts`
Expected: PASS (2 test).

- [ ] **Step 5: Tạo LarkDetailCard.tsx**

Tạo `components/fulfillment/LarkDetailCard.tsx`:

```tsx
import type { LarkDetailRecord } from '@/features/lark/detail';

/** Card hiển thị mọi field Lark của (các) record khớp đơn. RSC nhận props. */
export function LarkDetailCard({ records }: { records: LarkDetailRecord[] }) {
  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <h2 className="mb-3 text-sm font-semibold text-gray-700">Dữ liệu Lark (vận hành)</h2>
      {records.length === 0 ? (
        <p className="text-sm text-gray-400">Không tìm thấy dữ liệu Lark cho đơn này.</p>
      ) : (
        <div className="space-y-4">
          {records.map((rec, i) => (
            <div key={rec.recordId} className="rounded border border-gray-100">
              {records.length > 1 && (
                <div className="border-b border-gray-100 bg-gray-50 px-3 py-1 text-xs font-medium text-gray-500">
                  Kiện / record #{i + 1}
                </div>
              )}
              <dl className="divide-y divide-gray-50">
                {rec.fields.map((f) => (
                  <div key={f.label} className="flex gap-3 px-3 py-1.5 text-sm">
                    <dt className="w-1/3 shrink-0 text-gray-500">{f.label}</dt>
                    <dd className="flex-1 break-words text-gray-800">{f.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 6: Wire vào trang chi tiết**

Trong `app/(dashboard)/f/fulfillment/[orderId]/page.tsx`:
- Thêm import:
```ts
import { getLarkRecordsForOrder } from '@/features/lark/detail';
import { LarkDetailCard } from '@/components/fulfillment/LarkDetailCard';
```
- Thêm `getLarkRecordsForOrder(orderId)` vào `Promise.all` sẵn có. Đổi:
```ts
  const [picked, packs] = await Promise.all([pickedUnassignedLines(orderId), listPacksForOrder(orderId)]);
```
thành:
```ts
  const [picked, packs, larkRecords] = await Promise.all([
    pickedUnassignedLines(orderId), listPacksForOrder(orderId), getLarkRecordsForOrder(orderId),
  ]);
```
- Thêm `<LarkDetailCard records={larkRecords} />` ngay TRƯỚC thẻ đóng `</div>` cuối của return (sau `<PackPanel ... />`).

- [ ] **Step 7: Verify**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: tsc no output; vitest toàn bộ pass; build xanh.

- [ ] **Step 8: Commit**

```bash
git add features/lark/detail.ts features/lark/detail.test.ts components/fulfillment/LarkDetailCard.tsx "app/(dashboard)/f/fulfillment/[orderId]/page.tsx"
git commit -m "feat(ops): card chi tiết Lark live trên trang đơn (Phần B)"
```

---

## Self-Review

**Spec coverage:**
- Spec §4.1 client search → Task 3. §4.2 bảng + migration → Task 2. §4.3 parseLarkStatus → Task 1. §4.4 sync upsert → Task 4. §4.5 list cột → Task 5. §4.6 detail card → Task 6. §5 guard (best-effort []) → Task 6 try/catch + Task 5 lark null "—". §6 test thuần → Task 1/3/6 có unit test thuần. Đủ.

**Type consistency:**
- `LarkStatusRow` (Task 1) field names == cột bảng (Task 2) == map sync (Task 4). ✔
- `expectedDeliveryDate`: Date trong parse (Task 1) → set string `'YYYY-MM-DD'` cho cột date (Task 4) → Drizzle đọc ra string (Task 5 `larkExpected: string|null`, `lark.expectedDeliveryDate: string|null`) → format string trong UI. Nhất quán. ✔
- `WorklistStatusRow.lark` shape (Task 5 query) == `WorklistRow.lark` (Task 5 UI) == nothing else. ✔
- `flattenLarkRecord`/`LarkDetailRecord` (Task 6) khớp giữa detail.ts ↔ LarkDetailCard ↔ page. ✔
- `searchRecordsByOrderNumber` trả `LarkRecord[]` (Task 3) → Task 6 dùng `r.record_id`/`r.fields` (khớp `interface LarkRecord { record_id; fields }`). ✔

**Placeholder scan:** không có TBD/TODO; mọi step có code/command cụ thể. ✔
