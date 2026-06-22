# Đối soát ship order-driven (mảng A) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Shipment tự vào đối soát ngay khi kho tạo pack (không chờ hoá đơn carrier), hiện ước tính engine ngay sau khi có cân kho, billed fill dần để so.

**Architecture:** Lật chiều JOIN trong `reconcileShipments` từ `FROM shipment_charges INNER JOIN shipments` sang `FROM shipments LEFT JOIN shipment_charges`. `billedTotal` trở thành nullable; khi null, row mang 1 trong 2 trạng thái phái sinh `awaiting_measurement` (chưa cân) / `awaiting_billed` (đã cân, có ước tính). Không migration, không cột DB mới.

**Tech Stack:** Next.js (App Router, RSC), Drizzle ORM, Vitest, TypeScript.

## Global Constraints

- **Không migration, không cột DB mới** — 2 trạng thái mới là phái sinh (như `pending` ảo hiện tại).
- **Tiền chỉ trên billed** — report công nợ + vòng đời claim KHÔNG đổi; ước tính engine của dòng tiền-billed KHÔNG vào `sumBilled`/`sumEngine`/`totals`.
- **Cân Shopify (`shopifyWeightKg`) KHÔNG dùng để tính** — engine chỉ dùng `shipWeightKgOverride` rồi `actualWeightKg` (giữ nguyên logic reconcile.ts:257-259).
- **Row = shipment** — granularity không đổi.
- **Tên trạng thái mới (verbatim):** `awaiting_measurement`, `awaiting_billed`. Nhãn UI: "Chờ cân đo", "Chờ billed".
- **`effStatus` là điểm phái sinh DUY NHẤT** của 2 trạng thái mới — UI/filter/sort đọc qua `effStatus`, không tự suy.
- Validate trước push: `npx tsc --noEmit` + `npx vitest run` + `npm run build` đều xanh.

---

## File Structure

- `features/shipments/reconcile-view.ts` — `ReconcileStatus` type (thêm 2 giá trị). `ReconcileRow.billedTotal` → nullable. `mergeStatus` (đã null-safe sẵn, kiểm lại).
- `features/shipments/reconcile.ts` — `JoinedRow.billedTotal` nullable; `buildRow` null-safe delta; query JOIN flip; loop guard null billed.
- `features/shipments/reconcile-filter.ts` — `ReconcileFilters.status` thêm 2 giá trị; `effStatus` phái sinh 2 trạng thái; sort gộp 2 trạng thái vào nhóm "chưa xong"; helper `countByEffStatus`.
- `features/shipments/reconcile-filter.test.ts` — test effStatus, sort, count (thuần).
- `components/shipping-reconcile/ReconcileTable.tsx` + `ReconcileDetailPanel.tsx` — badge/nhãn 2 trạng thái, billed/delta "—", ẩn action trên dòng tiền-billed, dropdown filter, dòng summary.
- `app/(dashboard)/f/shipping-reconcile/export.csv/route.ts` — null-safe billed/delta.
- `features/shipments/carrier-error-report.ts`, `features/shipments/reconcile-status-actions.ts` — guard tsc cho `billedTotal` nullable (chỉ chạm dòng đã có billed).

---

## Task 1: `billedTotal` nullable — foundation

**Files:**
- Modify: `features/shipments/reconcile-view.ts:44` (ReconcileRow.billedTotal)
- Modify: `features/shipments/reconcile.ts:398-411` (JoinedRow.billedTotal), `:490-501` (buildRow)
- Modify (tsc fallout): `features/shipments/carrier-error-report.ts`, `features/shipments/reconcile-status-actions.ts`, `app/(dashboard)/f/shipping-reconcile/export.csv/route.ts`, `components/shipping-reconcile/ReconcileTable.tsx`, `components/shipping-reconcile/ReconcileDetailPanel.tsx`

**Interfaces:**
- Produces: `ReconcileRow.billedTotal: number | null` (và do kế thừa, `ReconcileViewRow.billedTotal: number | null`). `buildRow` trả `deltaVnd: null` khi `billedTotal === null`.

Đây là refactor mở rộng kiểu (chưa đổi hành vi runtime — query vẫn INNER JOIN nên billed vẫn luôn có). Verify bằng tsc + suite cũ xanh.

- [ ] **Step 1: Nới kiểu `ReconcileRow.billedTotal`**

Trong `features/shipments/reconcile-view.ts`, dòng 44 (trong `interface ReconcileRow`), đổi:
```ts
  billedTotal: number;
```
thành:
```ts
  billedTotal: number | null;
```

- [ ] **Step 2: Nới kiểu `JoinedRow.billedTotal`**

Trong `features/shipments/reconcile.ts`, trong `interface JoinedRow` (≈ dòng 411), đổi:
```ts
  billedTotal: string;
```
thành:
```ts
  billedTotal: string | null;
```

- [ ] **Step 3: `buildRow` null-safe delta**

Trong `features/shipments/reconcile.ts`, hàm `buildRow` (≈ dòng 496-501), đổi:
```ts
  const billedTotal = Number(r.billedTotal);
  const engineTotal = engine?.carrierCost ?? null;
  const deltaVnd = engineTotal !== null ? billedTotal - engineTotal : null;
  const deltaPct = (deltaVnd !== null && billedTotal > 0)
    ? (deltaVnd / billedTotal) * 100
    : null;
```
thành:
```ts
  const billedTotal = r.billedTotal != null ? Number(r.billedTotal) : null;
  const engineTotal = engine?.carrierCost ?? null;
  const deltaVnd = (billedTotal !== null && engineTotal !== null)
    ? billedTotal - engineTotal
    : null;
  const deltaPct = (deltaVnd !== null && billedTotal !== null && billedTotal > 0)
    ? (deltaVnd / billedTotal) * 100
    : null;
```

- [ ] **Step 4: Chạy tsc, sửa từng lỗi null tối thiểu**

Run: `npx tsc --noEmit`
Các consumer chỉ chạm dòng ĐÃ có billed (carrier_error/disputing/CSV billed rows). Sửa tối thiểu theo nguyên tắc:
- Nơi hiển thị (CSV `export.csv/route.ts`, `ReconcileTable.tsx`, `ReconcileDetailPanel.tsx`): `row.billedTotal ?? ''` (CSV) hoặc `row.billedTotal == null ? '—' : formatVnd(row.billedTotal)` (UI).
- Nơi tính tiền/so sánh trên dòng billed (`carrier-error-report.ts`, `reconcile-status-actions.ts`): các dòng này chỉ tới được khi status ∈ billed → dùng `row.billedTotal ?? 0` kèm comment `// billed luôn có ở nhánh này (status billed)`.

Expected sau sửa: `npx tsc --noEmit` sạch.

- [ ] **Step 5: Suite cũ xanh (chưa đổi hành vi)**

Run: `npx vitest run features/shipments/`
Expected: PASS toàn bộ (query vẫn INNER JOIN, billed vẫn luôn có → không test nào đổi kết quả).

- [ ] **Step 6: Commit**

```bash
git add features/shipments/reconcile-view.ts features/shipments/reconcile.ts features/shipments/carrier-error-report.ts features/shipments/reconcile-status-actions.ts "app/(dashboard)/f/shipping-reconcile/export.csv/route.ts" components/shipping-reconcile/ReconcileTable.tsx components/shipping-reconcile/ReconcileDetailPanel.tsx
git commit -m "refactor(reconcile): billedTotal nullable (foundation order-driven)"
```

---

## Task 2: `effStatus` phái sinh `awaiting_measurement` / `awaiting_billed`

**Files:**
- Modify: `features/shipments/reconcile-view.ts:20` (ReconcileStatus type)
- Modify: `features/shipments/reconcile-filter.ts:21-24` (effStatus), `:28` (ReconcileFilters.status)
- Test: `features/shipments/reconcile-filter.test.ts`

**Interfaces:**
- Consumes: `ReconcileViewRow.billedTotal: number | null`, `ReconcileViewRow.engineReason: string | null` (đã có sẵn trên ReconcileRow), `ReconcileViewRow.engineTotal: number | null`.
- Produces: `effStatus(r)` trả `'awaiting_measurement'` khi billed null + chưa cân; `'awaiting_billed'` khi billed null + (đã cân/khác). `ReconcileStatus` gồm 2 giá trị mới. `ReconcileFilters.status` gồm 2 giá trị mới.

- [ ] **Step 1: Viết test thất bại**

Thêm vào `features/shipments/reconcile-filter.test.ts`, trong `describe('isAutoReconciled / effStatus', ...)`:
```ts
  it('billed null + chưa cân (engineReason no_weight) → awaiting_measurement', () => {
    expect(effStatus(row({ billedTotal: null, engineTotal: null, deltaVnd: null, engineReason: 'no_weight' } as never)))
      .toBe('awaiting_measurement');
  });
  it('billed null + đã cân (có engineTotal) → awaiting_billed', () => {
    expect(effStatus(row({ billedTotal: null, engineTotal: 850_000, deltaVnd: null, engineReason: null } as never)))
      .toBe('awaiting_billed');
  });
  it('billed null + đã cân nhưng thiếu bảng giá (no_rate_card) → awaiting_billed (không phải awaiting_measurement)', () => {
    expect(effStatus(row({ billedTotal: null, engineTotal: null, deltaVnd: null, engineReason: 'no_rate_card' } as never)))
      .toBe('awaiting_billed');
  });
  it('billed null KHÔNG bị isAutoReconciled nuốt thành reconciled', () => {
    // deltaVnd null → Math.abs(0) < tolerance từng khiến nó thành "reconciled" — phải tránh.
    expect(effStatus(row({ billedTotal: null, engineTotal: null, deltaVnd: null, engineReason: 'no_weight' } as never)))
      .not.toBe('reconciled');
  });
```

- [ ] **Step 2: Chạy test, xác nhận FAIL**

Run: `npx vitest run features/shipments/reconcile-filter.test.ts`
Expected: FAIL (effStatus trả 'reconciled' hoặc 'pending', và type chưa có 'awaiting_*').

- [ ] **Step 3: Thêm 2 giá trị vào `ReconcileStatus`**

Trong `features/shipments/reconcile-view.ts` dòng 20, đổi:
```ts
export type ReconcileStatus = 'pending' | 'reconciled' | 'ignored' | 'carrier_error' | 'disputing' | 'internal_error' | 'credited' | 'accepted';
```
thành:
```ts
export type ReconcileStatus = 'pending' | 'reconciled' | 'ignored' | 'carrier_error' | 'disputing' | 'internal_error' | 'credited' | 'accepted' | 'awaiting_measurement' | 'awaiting_billed';
```

- [ ] **Step 4: Thêm 2 giá trị vào `ReconcileFilters.status`**

Trong `features/shipments/reconcile-filter.ts` dòng 28, đổi:
```ts
  status: 'all' | 'pending' | 'reconciled' | 'ignored' | 'carrier_error' | 'disputing' | 'internal_error' | 'credited' | 'accepted';
```
thành:
```ts
  status: 'all' | 'pending' | 'reconciled' | 'ignored' | 'carrier_error' | 'disputing' | 'internal_error' | 'credited' | 'accepted' | 'awaiting_measurement' | 'awaiting_billed';
```

- [ ] **Step 5: Phái sinh trong `effStatus` (đặt TRƯỚC isAutoReconciled)**

Trong `features/shipments/reconcile-filter.ts`, đổi `effStatus` (dòng 21-24):
```ts
export function effStatus(r: ReconcileViewRow): ReconcileStatus {
  if (isAutoReconciled(r) || r.staleDispute) return 'reconciled';
  return r.status;
}
```
thành:
```ts
export function effStatus(r: ReconcileViewRow): ReconcileStatus {
  // Tiền-billed: chưa có hoá đơn carrier. Phải xử TRƯỚC isAutoReconciled —
  // deltaVnd null khiến Math.abs(0) < tolerance, sẽ bị nuốt thành 'reconciled'.
  if (r.billedTotal === null) {
    return r.engineReason === 'no_weight' ? 'awaiting_measurement' : 'awaiting_billed';
  }
  if (isAutoReconciled(r) || r.staleDispute) return 'reconciled';
  return r.status;
}
```

- [ ] **Step 6: Chạy test, xác nhận PASS**

Run: `npx vitest run features/shipments/reconcile-filter.test.ts`
Expected: PASS toàn bộ.

- [ ] **Step 7: Commit**

```bash
git add features/shipments/reconcile-view.ts features/shipments/reconcile-filter.ts features/shipments/reconcile-filter.test.ts
git commit -m "feat(reconcile): effStatus phái sinh awaiting_measurement/awaiting_billed"
```

---

## Task 3: Sort gộp trạng thái tiền-billed + helper đếm

**Files:**
- Modify: `features/shipments/reconcile-filter.ts` (sort trong `filterReconcileRows`; thêm `countByEffStatus`)
- Test: `features/shipments/reconcile-filter.test.ts`

**Interfaces:**
- Consumes: `effStatus(r)`.
- Produces: sort xếp `{pending, awaiting_measurement, awaiting_billed}` vào nhóm "chưa xong" (group 0). `countByEffStatus(rows: ReconcileViewRow[]): Record<ReconcileStatus, number>`.

- [ ] **Step 1: Viết test thất bại**

Thêm vào `features/shipments/reconcile-filter.test.ts`:
```ts
import { countByEffStatus } from './reconcile-filter';

describe('order-driven sort + count', () => {
  const base = { carrier: 'all', status: 'all', country: '', minPct: '', q: '' } as const;
  it('awaiting_billed + awaiting_measurement nằm nhóm "chưa xong" (trên reconciled)', () => {
    const r = filterReconcileRows([
      row({ orderNumber: '#done', status: 'reconciled', billedTotal: 1_000_000, engineTotal: 1_000_000, deltaVnd: 0, labelDate: new Date('2026-06-20') }),
      row({ orderNumber: '#await', status: 'pending', billedTotal: null, engineTotal: 800_000, deltaVnd: null, engineReason: null, labelDate: new Date('2026-06-01') } as never),
    ], base);
    expect(r[0].orderNumber).toBe('#await'); // chưa xong lên đầu dù ngày cũ hơn
  });
  it('countByEffStatus đếm theo trạng thái hiệu lực', () => {
    const c = countByEffStatus([
      row({ billedTotal: null, engineTotal: null, deltaVnd: null, engineReason: 'no_weight' } as never),
      row({ billedTotal: null, engineTotal: 900_000, deltaVnd: null, engineReason: null } as never),
      row({ billedTotal: 1_000_000, engineTotal: 900_000, deltaVnd: 100_000 }),
    ]);
    expect(c.awaiting_measurement).toBe(1);
    expect(c.awaiting_billed).toBe(1);
    expect(c.pending).toBe(1);
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận FAIL**

Run: `npx vitest run features/shipments/reconcile-filter.test.ts`
Expected: FAIL (`#done` lên đầu vì mới hơn; `countByEffStatus` chưa tồn tại).

- [ ] **Step 3: Sửa nhóm sort**

Trong `features/shipments/reconcile-filter.ts`, trong `filterReconcileRows`, đổi block `.sort(...)`:
```ts
    .sort((a, b) => {
      const pa = effStatus(a) === 'pending' ? 0 : 1;
      const pb = effStatus(b) === 'pending' ? 0 : 1;
      if (pa !== pb) return pa - pb;          // chưa đối soát lên đầu
      return rowTime(b) - rowTime(a);         // rồi mới nhất → cũ nhất
    });
```
thành:
```ts
    .sort((a, b) => {
      const pa = PENDING_GROUP.has(effStatus(a)) ? 0 : 1;
      const pb = PENDING_GROUP.has(effStatus(b)) ? 0 : 1;
      if (pa !== pb) return pa - pb;          // chưa đối soát lên đầu
      return rowTime(b) - rowTime(a);         // rồi mới nhất → cũ nhất
    });
```
Và thêm hằng số ngay phía trên hàm `filterReconcileRows` (cạnh `rowTime`):
```ts
/** Trạng thái "chưa đối soát" — xếp lên đầu. Gồm pending billed + 2 trạng thái tiền-billed. */
const PENDING_GROUP = new Set<ReconcileStatus>(['pending', 'awaiting_measurement', 'awaiting_billed']);
```
(`ReconcileStatus` đã được import trong file này — kiểm `import` đầu file; nếu chưa, thêm `import type { ReconcileStatus } from './reconcile-view';`.)

- [ ] **Step 4: Thêm `countByEffStatus`**

Thêm vào cuối `features/shipments/reconcile-filter.ts`:
```ts
/** Đếm số dòng theo trạng thái hiệu lực (effStatus). Dùng cho dòng summary. */
export function countByEffStatus(rows: ReconcileViewRow[]): Record<ReconcileStatus, number> {
  const c: Record<ReconcileStatus, number> = {
    pending: 0, reconciled: 0, ignored: 0, carrier_error: 0, disputing: 0,
    internal_error: 0, credited: 0, accepted: 0, awaiting_measurement: 0, awaiting_billed: 0,
  };
  for (const r of rows) c[effStatus(r)] += 1;
  return c;
}
```

- [ ] **Step 5: Chạy test, xác nhận PASS**

Run: `npx vitest run features/shipments/reconcile-filter.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add features/shipments/reconcile-filter.ts features/shipments/reconcile-filter.test.ts
git commit -m "feat(reconcile): sort gộp trạng thái tiền-billed + countByEffStatus"
```

---

## Task 4: Lật JOIN + loop guard null billed (integration)

**Files:**
- Modify: `features/shipments/reconcile.ts:170-173` (query JOIN), `:236-298` (loop)

**Interfaces:**
- Consumes: `buildRow` (null-safe từ Task 1).
- Produces: `reconcileShipments` trả thêm dòng cho shipment KHÔNG có charge (billed null), có engine nếu cân được; `sumBilled`/`sumEngine`/`matched`/`unmatched` chỉ tính dòng có billed.

Không có test DB trong repo (reconcileShipments chạm `db` trực tiếp). Verify bằng tsc + build + đọc-soát logic. Hành vi mới phái sinh đã được test thuần ở Task 2-3.

- [ ] **Step 1: Lật chiều JOIN**

Trong `features/shipments/reconcile.ts` (dòng 170-173), đổi:
```ts
    .from(schema.shipmentCharges)
    .innerJoin(schema.shipments, eq(schema.shipments.id, schema.shipmentCharges.shipmentId))
    .innerJoin(schema.shopifyOrders, eq(schema.shopifyOrders.id, schema.shipments.orderId))
    .innerJoin(schema.stores, eq(schema.stores.id, schema.shopifyOrders.storeId));
```
thành:
```ts
    .from(schema.shipments)
    .leftJoin(schema.shipmentCharges, eq(schema.shipmentCharges.shipmentId, schema.shipments.id))
    .innerJoin(schema.shopifyOrders, eq(schema.shopifyOrders.id, schema.shipments.orderId))
    .innerJoin(schema.stores, eq(schema.stores.id, schema.shopifyOrders.storeId));
```

- [ ] **Step 2: Guard `sumBilled` + counter theo billed; đẩy dòng tiền-billed**

Trong `features/shipments/reconcile.ts`, đầu vòng `for (const r of filtered)` (dòng 236-264), đổi:
```ts
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

    // Weight: prefer operator override on the order, then shipment's
    // actualWeight. Matches the dashboard quoting flow.
    const weightKg = r.shipWeightKgOverride !== null
      ? Number(r.shipWeightKgOverride)
      : r.actualWeightKg !== null ? Number(r.actualWeightKg) : null;
    if (!weightKg || weightKg <= 0) {
      unmatched += 1;
      rows.push(buildRow(r, null, 'no_weight'));
      continue;
    }
```
thành:
```ts
    // Order-driven: shipment có thể CHƯA có hoá đơn carrier (LEFT JOIN → billed null).
    // Dòng tiền-billed không vào số liệu tiền (sumBilled/sumEngine) và không tính
    // matched/unmatched — chỉ đếm ở các nhánh khi thực sự có billed.
    const hasBilled = r.billedTotal != null;
    if (hasBilled) sumBilled += Number(r.billedTotal);

    if (!entry || !shipDate || !card) {
      if (hasBilled) unmatched += 1;
      rows.push(buildRow(r, null, !shipDate ? 'no_ship_date' : 'no_rate_card'));
      continue;
    }
    if (!snap || !r.shipCountry) {
      if (hasBilled) unmatched += 1;
      rows.push(buildRow(r, null, 'no_snapshot_or_country'));
      continue;
    }

    // Weight: prefer operator override on the order, then shipment's
    // actualWeight. Matches the dashboard quoting flow.
    const weightKg = r.shipWeightKgOverride !== null
      ? Number(r.shipWeightKgOverride)
      : r.actualWeightKg !== null ? Number(r.actualWeightKg) : null;
    if (!weightKg || weightKg <= 0) {
      if (hasBilled) unmatched += 1;
      // Chưa cân → engineReason 'no_weight' → effStatus = awaiting_measurement.
      rows.push(buildRow(r, null, 'no_weight'));
      continue;
    }
```

- [ ] **Step 3: Sau quote OK — tách nhánh tiền-billed (không diagnose, không cộng tiền)**

Trong cùng vòng lặp, sau block `if (!q.ok) { ... continue; }` (dòng 291-295), đổi:
```ts
    matched += 1;
    sumEngine += q.breakdown.carrierCost;
```
thành:
```ts
    // Dòng tiền-billed: đã cân + quote OK → có ước tính engine, nhưng chưa có
    // billed để so. Đẩy row (effStatus = awaiting_billed), bỏ qua diagnosis/tiền.
    if (!hasBilled) {
      rows.push(buildRow(r, q.breakdown, null));
      continue;
    }

    matched += 1;
    sumEngine += q.breakdown.carrierCost;
```

- [ ] **Step 4: tsc + build**

Run: `npx tsc --noEmit && npm run build`
Expected: sạch + build OK. (`Number(r.billedTotal)` ở block diagnosis dòng ~338 chỉ tới khi `hasBilled` → runtime an toàn; TS chấp nhận `Number(string|null)`.)

- [ ] **Step 5: Soát nhanh các consumer truy vấn khác**

Run: `npx vitest run features/shipments/`
Expected: PASS. (unmatched-billed #196 dùng query riêng billed-LEFT-JOIN-shipments, độc lập — không đổi.)

- [ ] **Step 6: Commit**

```bash
git add features/shipments/reconcile.ts
git commit -m "feat(reconcile): order-driven query (LEFT JOIN billed) + dòng tiền-billed"
```

---

## Task 5: UI — badge/nhãn, billed/delta "—", ẩn action, dropdown, summary, CSV

**Files:**
- Modify: `components/shipping-reconcile/ReconcileTable.tsx` (badge/nhãn, billed/delta hiển thị, dropdown status, dòng summary, ẩn action)
- Modify: `components/shipping-reconcile/ReconcileDetailPanel.tsx` (billed/delta "—", ẩn action)
- Modify: `app/(dashboard)/f/shipping-reconcile/export.csv/route.ts` (billed/delta null-safe — nếu chưa làm ở Task 1 step 4)

**Interfaces:**
- Consumes: `effStatus(row)`, `countByEffStatus(rows)`, `ReconcileViewRow.billedTotal: number | null`.

- [ ] **Step 1: Nhãn + badge 2 trạng thái mới**

Trong `components/shipping-reconcile/ReconcileTable.tsx`, tìm map nhãn trạng thái (object/`switch` ánh xạ `ReconcileStatus` → nhãn tiếng Việt + class màu — gần các chuỗi 'disputing'/'reconciled'). Thêm 2 mục:
```ts
  awaiting_measurement: { label: 'Chờ cân đo', className: '<class xám/neutral giống "ignored">' },
  awaiting_billed:      { label: 'Chờ billed',  className: '<class xanh nhạt/info>' },
```
Dùng đúng pattern/khóa map hiện có trong file (sao chép className từ một trạng thái neutral sẵn có). Badge phải lấy trạng thái từ `effStatus(row)`, không phải `row.status` thô.

- [ ] **Step 2: billed/delta hiển thị "—" khi null**

Trong cả `ReconcileTable.tsx` và `ReconcileDetailPanel.tsx`, nơi render cột billed và delta, bọc:
```tsx
{row.billedTotal == null ? '—' : formatVnd(row.billedTotal)}
```
và delta:
```tsx
{row.deltaVnd == null ? '—' : formatVnd(row.deltaVnd)}
```
(dùng đúng hàm format sẵn có trong file). Cột engine (`engineTotal`) vẫn hiển thị bình thường → dòng `awaiting_billed` hiện ước tính.

- [ ] **Step 3: Ẩn action trên dòng tiền-billed**

Nơi render nút accept/dispute/credit/ignore (trong `ReconcileTable.tsx` và/hoặc `ReconcileDetailPanel.tsx`), bọc điều kiện chỉ render khi đã có billed:
```tsx
{row.billedTotal != null && (
  /* ...các nút accept/dispute/credit/ignore hiện có... */
)}
```

- [ ] **Step 4: Thêm 2 mục vào dropdown filter trạng thái**

Trong `ReconcileTable.tsx`, danh sách option của dropdown lọc status, thêm:
```tsx
<option value="awaiting_measurement">Chờ cân đo</option>
<option value="awaiting_billed">Chờ billed</option>
```
(đặt cạnh các option status hiện có).

- [ ] **Step 5: Dòng summary đếm trạng thái mới**

Trong `ReconcileTable.tsx`, khu vực header/summary, dùng `countByEffStatus(rows)` để hiện thêm:
```tsx
{counts.awaiting_measurement > 0 && <span>{counts.awaiting_measurement} chờ cân đo</span>}
{counts.awaiting_billed > 0 && <span>{counts.awaiting_billed} chờ billed</span>}
```
Import `countByEffStatus` từ `@/features/shipments/reconcile-filter` (nếu component là 'use client' và file đó kéo theo server code, dùng `import type` cho type và gọi helper qua giá trị đã tính server-side ở page — kiểm pattern hiện tại của file; `reconcile-filter.ts` là module thuần không import db nên import giá trị an toàn).

- [ ] **Step 6: CSV null-safe (nếu chưa)**

Trong `app/(dashboard)/f/shipping-reconcile/export.csv/route.ts`, cột billed/delta dùng `row.billedTotal ?? ''` và `row.deltaVnd ?? ''`.

- [ ] **Step 7: tsc + build + suite**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: tất cả xanh.

- [ ] **Step 8: Commit**

```bash
git add components/shipping-reconcile/ReconcileTable.tsx components/shipping-reconcile/ReconcileDetailPanel.tsx "app/(dashboard)/f/shipping-reconcile/export.csv/route.ts"
git commit -m "feat(reconcile): UI trạng thái tiền-billed (badge/—/ẩn action/dropdown/summary)"
```

---

## Self-Review (đã chạy)

- **Spec coverage:** §3 JOIN flip → Task 4. §4 máy trạng thái → Task 2 (effStatus) + Task 1 (billed null). §5 sort/filter/summary/UI → Task 3 (sort/count) + Task 5 (UI). §6 edge (số học null) → Task 1 step 3; (đã cân thiếu card) → Task 2 (awaiting_billed); (report/claim không đổi) → Global Constraints + Task 4 không đụng. §7 test → Task 2,3 (thuần). Đủ.
- **Placeholder scan:** không có TBD; mọi step có code/diff cụ thể.
- **Type consistency:** `billedTotal: number | null`, `awaiting_measurement`/`awaiting_billed`, `countByEffStatus`, `PENDING_GROUP` nhất quán giữa các task.
- **Lưu ý reviewer:** Task 4 (DB) không có unit test trong repo — đây là giới hạn hạ tầng test hiện hữu, verify bằng tsc/build + logic thuần đã test ở Task 2-3, KHÔNG phải bỏ test cố ý.
