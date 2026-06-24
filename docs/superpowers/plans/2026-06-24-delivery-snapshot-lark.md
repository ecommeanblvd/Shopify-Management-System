# Snapshot trạng thái giao từ Lark — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lấy trạng thái giao + ngày giao thật từ Lark, freeze vào `shipments` (delivered sticky), để cột Vận chuyển hiện "Đã giao · dd/MM" thay vì "Chưa cập nhật" và không phụ thuộc tracking FedEx còn sống.

**Architecture:** Cron Lark sync (đã đọc logistics records) map "Final | Delivery Status" → DeliveryStatus + "Ngày giao thực tế" → ngày giao, rồi UPDATE shipments của đơn (chỉ khi chưa delivered). FedEx poll giữ nguyên (bổ sung). Cột Vận chuyển đọc `shipments.delivery_status` như cũ + thêm ngày.

**Tech Stack:** Next.js App Router (RSC), Drizzle, Vitest, Lark Bitable (read-only), Tailwind.

## Global Constraints

- Nguồn delivered = Lark chính + FedEx bổ sung (giữ FedEx poll 45d cap — đã an toàn với tái-dùng 3 tháng).
- Freeze vào `shipments` theo `order_id`; `delivered` **sticky** — WHERE loại trừ shipment đã `delivered` (không hạ cấp/đè delivered thật).
- `delivered_at` chỉ điền khi state='delivered' (ngày = "Ngày giao thực tế" order-level cho mọi kiện của đơn).
- Mapping Lark "Final | Delivery Status" → DeliveryStatus: `Chậm hơn dự kiến`/`Đúng dự kiến`/`Nhanh hơn dự kiến`→`delivered`; `Đang giao hàng`→`out_for_delivery`; `Đang xử lý`→`in_transit`; `Giao hàng thất bại`/`Gặp vấn đề`/`Mất hàng khi giao`→`exception`; khác/rỗng→`null` (không đụng).
- `DeliveryStatus` = union ở `lib/fedex/track.ts:3` (`in_transit|out_for_delivery|delivered|exception|unknown`).
- Phần freeze best-effort: try/catch riêng, lỗi KHÔNG chặn sync logistics/QC.
- Migration hand-authored, KHÔNG chạy local. Journal latest idx 78 → next **0079**.
- Verify mỗi task TS: `npx tsc --noEmit` sạch; task UI thêm `npx vitest run` + `npm run build` xanh.
- Branch: `feat/delivery-snapshot-lark` (đã tạo, spec commit `7a884f5`).

---

### Task 1: `mapLarkDelivery` + `actualDeliveredAt` (parse-status-row, thuần)

**Files:**
- Modify: `features/lark/parse-status-row.ts`
- Test: `features/lark/parse-status-row.test.ts`

**Interfaces:**
- Consumes: `larkText`, `larkEpochToVnMidnight` (đã export từ parse-pack-row); `DeliveryStatus` từ `@/lib/fedex/track`.
- Produces: `mapLarkDelivery(raw: string | null): DeliveryStatus | null`; `LarkStatusRow` thêm `deliveryState: DeliveryStatus | null` + `actualDeliveredAt: Date | null`.

- [ ] **Step 1: Write the failing test**

Thêm vào `features/lark/parse-status-row.test.ts`:

```ts
import { mapLarkDelivery, parseLarkStatus } from './parse-status-row';

describe('mapLarkDelivery', () => {
  it('các trạng thái hoàn tất → delivered', () => {
    expect(mapLarkDelivery('Chậm hơn dự kiến')).toBe('delivered');
    expect(mapLarkDelivery('Đúng dự kiến')).toBe('delivered');
    expect(mapLarkDelivery('Nhanh hơn dự kiến')).toBe('delivered');
  });
  it('đang giao / xử lý / sự cố', () => {
    expect(mapLarkDelivery('Đang giao hàng')).toBe('out_for_delivery');
    expect(mapLarkDelivery('Đang xử lý')).toBe('in_transit');
    expect(mapLarkDelivery('Giao hàng thất bại')).toBe('exception');
    expect(mapLarkDelivery('Gặp vấn đề')).toBe('exception');
    expect(mapLarkDelivery('Mất hàng khi giao')).toBe('exception');
  });
  it('rỗng/lạ → null', () => {
    expect(mapLarkDelivery(null)).toBeNull();
    expect(mapLarkDelivery('gì đó')).toBeNull();
  });
});

describe('parseLarkStatus delivery', () => {
  it('deliveryState + actualDeliveredAt', () => {
    const ms = Date.UTC(2026, 5, 3, 17, 0, 0); // 04/06 giờ VN
    const r = parseLarkStatus({ 'Final | Delivery Status': 'Nhanh hơn dự kiến', 'Ngày giao thực tế': ms });
    expect(r.deliveryState).toBe('delivered');
    expect(r.actualDeliveredAt?.toISOString()).toBe('2026-06-04T00:00:00.000Z');
  });
  it('không có ngày giao thực tế → null', () => {
    expect(parseLarkStatus({ 'Final | Delivery Status': 'Đang giao hàng' }).actualDeliveredAt).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run features/lark/parse-status-row.test.ts`
Expected: FAIL — `mapLarkDelivery` chưa export; `deliveryState`/`actualDeliveredAt` chưa có.

- [ ] **Step 3: Implement**

Trong `features/lark/parse-status-row.ts`:
- Thêm import:
```ts
import type { DeliveryStatus } from '@/lib/fedex/track';
```
- Thêm mapper (sau `larkDate`):
```ts
/** Map "Final | Delivery Status" (Lark) → DeliveryStatus. Null nếu rỗng/không khớp. THUẦN. */
export function mapLarkDelivery(raw: string | null): DeliveryStatus | null {
  switch (raw) {
    case 'Chậm hơn dự kiến':
    case 'Đúng dự kiến':
    case 'Nhanh hơn dự kiến': return 'delivered';
    case 'Đang giao hàng': return 'out_for_delivery';
    case 'Đang xử lý': return 'in_transit';
    case 'Giao hàng thất bại':
    case 'Gặp vấn đề':
    case 'Mất hàng khi giao': return 'exception';
    default: return null;
  }
}
```
- Mở rộng `LarkStatusRow` (thêm 2 field sau `expectedDeliveryDate`):
```ts
  deliveryState: DeliveryStatus | null;
  actualDeliveredAt: Date | null;
```
- Trong `parseLarkStatus` return, thêm:
```ts
    deliveryState: mapLarkDelivery(larkText(fields['Final | Delivery Status'])),
    actualDeliveredAt: larkDate(fields['Ngày giao thực tế']),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run features/lark/parse-status-row.test.ts`
Expected: PASS (case cũ + mới).

- [ ] **Step 5: tsc + commit**

Run: `npx tsc --noEmit` → no output.

```bash
git add features/lark/parse-status-row.ts features/lark/parse-status-row.test.ts
git commit -m "feat(ops): mapLarkDelivery + actualDeliveredAt (Lark delivery)"
```

---

### Task 2: Cột `delivery_source` + migration 0079

**Files:**
- Modify: `db/schema.ts` (shipments)
- Create: `db/migrations/0079_shipment-delivery-source.sql`
- Modify: `db/migrations/meta/_journal.json`

**Interfaces:**
- Produces: `schema.shipments.deliverySource` (text, nullable).

- [ ] **Step 1: Thêm cột schema**

Trong `db/schema.ts`, trong bảng `shipments`, thêm sau dòng `trackDetail: text('track_detail'),` (cạnh các cột delivery của migration 0075):
```ts
  deliverySource: text('delivery_source'), // 'lark' | 'fedex' | null — nguồn delivery_status
```

> Nếu không chắc dòng nào, đặt ngay sau `deliveryStatus: text('delivery_status'),` trong block `shipments`.

- [ ] **Step 2: Migration SQL**

Create `db/migrations/0079_shipment-delivery-source.sql`:
```sql
ALTER TABLE "shipments" ADD COLUMN "delivery_source" text;
```

- [ ] **Step 3: Journal entry**

Trong `db/migrations/meta/_journal.json`, thêm vào cuối `entries` (comma sau idx 78):
```json
{
"idx": 79,
"version": "7",
"when": 1783255200000,
"tag": "0079_shipment-delivery-source",
"breakpoints": true
}
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit` → no output.
Run: `python3 -c "import json;json.load(open('db/migrations/meta/_journal.json'));print('journal OK')"` → "journal OK".

- [ ] **Step 5: Commit**

```bash
git add db/schema.ts db/migrations/0079_shipment-delivery-source.sql db/migrations/meta/_journal.json
git commit -m "feat(ops): cột shipments.delivery_source + migration 0079"
```

---

### Task 3: Sync freeze delivery vào shipments + FedEx provenance

**Files:**
- Modify: `features/lark/sync.ts`
- Modify: `features/shipments/track.ts`

**Interfaces:**
- Consumes: `parseLarkStatus` (Task 1, nay trả `deliveryState`/`actualDeliveredAt`), `schema.shipments.deliverySource` (Task 2), `chunk`/`APPLY_CHUNK`/`db`/`schema`/`orderIdByNumber` (trong sync).
- Produces: `LarkSyncSummary` thêm `deliveryFrozen: number`; shipments được freeze delivery_status/delivered_at/delivery_source.

- [ ] **Step 1: Mở rộng gather trong sync.ts**

Trong `features/lark/sync.ts`, block `statusByOrderId`:
- Đổi kiểu Map value (thêm 2 field):
```ts
    const statusByOrderId = new Map<string, {
      dispatchStatus: string | null; cxFfStatus: string | null;
      deliveryStatus: string | null; expectedDeliveryDate: Date | null;
      deliveryState: import('@/lib/fedex/track').DeliveryStatus | null; actualDeliveredAt: Date | null;
    }>();
```
- Trong vòng lặp gán, đổi `prev` default + set để gồm 2 field mới:
```ts
      const prev = statusByOrderId.get(orderId) ?? { dispatchStatus: null, cxFfStatus: null, deliveryStatus: null, expectedDeliveryDate: null, deliveryState: null, actualDeliveredAt: null };
      statusByOrderId.set(orderId, {
        dispatchStatus: s.dispatchStatus ?? prev.dispatchStatus,
        cxFfStatus: s.cxFfStatus ?? prev.cxFfStatus,
        deliveryStatus: s.deliveryStatus ?? prev.deliveryStatus,
        expectedDeliveryDate: s.expectedDeliveryDate ?? prev.expectedDeliveryDate,
        deliveryState: s.deliveryState === 'delivered' || prev.deliveryState === 'delivered'
          ? 'delivered' : (s.deliveryState ?? prev.deliveryState),
        actualDeliveredAt: s.actualDeliveredAt ?? prev.actualDeliveredAt,
      });
```

- [ ] **Step 2: Thêm imports drizzle + freeze block (SAU block QC upsert, TRƯỚC `warnings`/`summary`)**

- Bổ sung import drizzle (dòng `import { eq, desc } from 'drizzle-orm';` → thêm and/or/isNull/ne):
```ts
import { eq, desc, and, or, isNull, ne } from 'drizzle-orm';
```
- Thêm block freeze:
```ts
    // Freeze trạng thái giao từ Lark vào shipments (delivered sticky). Best-effort.
    let deliveryFrozen = 0;
    try {
      const delRows = [...statusByOrderId.entries()].filter(([, s]) => s.deliveryState != null);
      for (const batch of chunk(delRows, APPLY_CHUNK)) {
        await db.transaction(async (tx) => {
          for (const [orderId, s] of batch) {
            const patch: Record<string, unknown> = {
              deliveryStatus: s.deliveryState, deliverySource: 'lark', updatedAt: sql`now()`,
            };
            if (s.deliveryState === 'delivered' && s.actualDeliveredAt) patch.deliveredAt = s.actualDeliveredAt;
            const res = await tx.update(schema.shipments).set(patch).where(and(
              eq(schema.shipments.orderId, orderId),
              or(isNull(schema.shipments.deliveryStatus), ne(schema.shipments.deliveryStatus, 'delivered')),
            ));
            deliveryFrozen += res.rowCount ?? 0;
          }
        });
      }
    } catch (e) {
      console.error('[lark] freeze delivery lỗi (bỏ qua, không chặn logistics):', e instanceof Error ? e.message : e);
    }
```

> `sql` đã được import trong sync.ts (dùng ở nơi khác). Nếu chưa, thêm `sql` vào import drizzle. `res.rowCount` là số dòng update (postgres-js trả về); nếu kiểu không có `rowCount`, dùng `(res as { rowCount?: number }).rowCount ?? 0`.

- [ ] **Step 3: Thêm `deliveryFrozen` vào summary**

Tìm `const summary: LarkSyncSummary = { ... };` và thêm `deliveryFrozen`; thêm `deliveryFrozen: number;` vào `interface LarkSyncSummary`.

- [ ] **Step 4: FedEx provenance (track.ts)**

Trong `features/shipments/track.ts`, hàm `trackAndStoreShipment`, trong `.set({...})` thêm:
```ts
      deliverySource: 'fedex',
```

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tsc no output; toàn bộ suite xanh.

- [ ] **Step 6: Commit**

```bash
git add features/lark/sync.ts features/shipments/track.ts
git commit -m "feat(ops): freeze delivery từ Lark vào shipments + delivery_source"
```

---

### Task 4: Cột Vận chuyển hiện ngày giao

**Files:**
- Modify: `features/fulfillment/worklist-status-queries.ts`
- Modify: `components/fulfillment/WorklistTable.tsx`

**Interfaces:**
- Consumes: `schema.shipments.deliveredAt`.
- Produces: `ship.tracks[].deliveredAt: string | null`; chip "Đã giao · dd/MM" khi delivered.

- [ ] **Step 1: Query — thêm deliveredAt vào tracks**

Trong `features/fulfillment/worklist-status-queries.ts`:
- `interface WorklistStatusRow` → trong `ship.tracks` item, thêm `deliveredAt: string | null`:
```ts
  ship: { packs: number; withTracking: number; delivered: number; exception: number; inTransit: number; tracks: Array<{ trackingNumber: string; carrierKey: string | null; deliveryStatus: string | null; deliveredAt: string | null }> };
```
- `shipAgg` `tracks` sql — thêm `'deliveredAt', ${schema.shipments.deliveredAt}` vào `json_build_object` và cập nhật type cast:
```ts
    tracks: sql<Array<{ trackingNumber: string; carrierKey: string | null; deliveryStatus: string | null; deliveredAt: string | null }>>`coalesce(json_agg(json_build_object('trackingNumber', ${schema.shipments.trackingNumber}, 'carrierKey', ${schema.shipments.carrierKey}, 'deliveryStatus', ${schema.shipments.deliveryStatus}, 'deliveredAt', ${schema.shipments.deliveredAt})) filter (where ${schema.shipments.trackingNumber} is not null), '[]')`,
```

- [ ] **Step 2: Verify tsc**

Run: `npx tsc --noEmit` → no output.

- [ ] **Step 3: WorklistTable — chip "Đã giao · dd/MM"**

Trong `components/fulfillment/WorklistTable.tsx`:
- `type WorklistRow` → `tracks` item thêm `deliveredAt: string | null`:
```ts
  tracks: Array<{ trackingNumber: string; carrierKey: string | null; deliveryStatus: string | null; deliveredAt: string | null }>;
```
- Trong cell Vận chuyển, đoạn `const st = formatTrackingStatus(t.deliveryStatus);` — thêm ghép ngày khi delivered. Đổi phần render `<BadgeCell b={st} />` thành dùng label có ngày:
```tsx
                        const st = formatTrackingStatus(t.deliveryStatus);
                        const url = carrierTrackingUrl(t.carrierKey, t.trackingNumber);
                        const label = (t.deliveryStatus === 'delivered' && t.deliveredAt && t.deliveredAt.length >= 10)
                          ? `${st.label} · ${t.deliveredAt.slice(8, 10)}/${t.deliveredAt.slice(5, 7)}`
                          : st.label;
```
  và đổi `<BadgeCell b={st} />` → `<BadgeCell b={{ label, tone: st.tone }} />`.

> `deliveredAt` từ json_agg của cột timestamp = chuỗi ISO ("2026-06-04T00:00:00…") → `slice(8,10)`=ngày, `slice(5,7)`=tháng. Guard `length >= 10`.

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: tsc no output; vitest toàn bộ pass; build xanh.

- [ ] **Step 5: Commit**

```bash
git add features/fulfillment/worklist-status-queries.ts components/fulfillment/WorklistTable.tsx
git commit -m "feat(ops): cột Vận chuyển hiện 'Đã giao · dd/MM' từ delivered_at"
```

---

## Self-Review

**Spec coverage:**
- §3 mapping → Task 1 (`mapLarkDelivery`). §4.1 parse → Task 1. §4.2 migration → Task 2. §4.3 freeze sync → Task 3. §4.4 FedEx provenance → Task 3 (track.ts). §4.5 query+UI → Task 4. §5 guard (sticky WHERE, delivered_at chỉ khi delivered, best-effort try/catch) → Task 3. §6 test thuần → Task 1. Đủ.

**Type consistency:**
- `DeliveryStatus` (lib/fedex/track) dùng nhất quán: `mapLarkDelivery` trả nó (Task 1) → `deliveryState` lưu vào `shipments.delivery_status` (Task 3, cùng vocab vì FedEx track cũng ghi các giá trị này). ✔
- `LarkStatusRow.deliveryState`/`actualDeliveredAt` (Task 1) = đọc trong sync gather (Task 3). ✔
- `shipments.deliverySource` (Task 2) = set 'lark' (Task 3 sync) + 'fedex' (Task 3 track.ts). ✔
- `ship.tracks[].deliveredAt` (Task 4 query) = `WorklistRow.tracks[].deliveredAt` (Task 4 UI). ✔
- freeze WHERE `or(isNull, ne('delivered'))` + `delivered_at` chỉ set khi delivered → khớp §5 sticky. ✔

**Placeholder scan:** không TBD/TODO; mọi step có code/command. ✔
