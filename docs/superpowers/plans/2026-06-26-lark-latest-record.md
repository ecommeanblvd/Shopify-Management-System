# Chọn record Lark mới nhất (created_time) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Khi 1 đơn có nhiều record Lark (QC fail→reship…), luôn lấy record **mới nhất theo `created_time`** cho QC, snapshot status, card/modal.

**Architecture:** Lấy `created_time` từ Lark (dùng endpoint `records/search` + `automatic_fields:true` cho mọi truy vấn). Thêm helper thuần `pickLatestRecord`/`sortRecordsLatestFirst`. Áp vào detail (modal/card), sync Part B (status), và QC (latest thay vì any-fail). Pack→shipment (Part A) giữ nguyên.

**Tech Stack:** Next.js, Vitest, Drizzle, Lark Bitable REST.

## Global Constraints

- "Mới nhất" = record có `created_time` (Lark) lớn nhất; so sánh tương đối (không phụ thuộc đơn vị s/ms).
- Thiếu `created_time` → fallback thứ tự mảng (record CUỐI = mới nhất); tiebreak ổn định (index sau thắng).
- Đơn nhiều KIỆN: KHÔNG gộp — sync Part A (pack→shipment, keyed `logUniqueCode`) GIỮ NGUYÊN.
- Card: record mới nhất hiện đầy đủ; record cũ thu gọn `<details>` (RSC, không JS ngoài `<details>`).
- QC: trạng thái = record QC `created_time` mới nhất, non-null (bỏ "bất kỳ fail → fail").
- Không migration. Sync giữ best-effort (lỗi QC/freeze không chặn logistics).
- Verify mỗi task: `npx tsc --noEmit` + `npx vitest run` của file liên quan; task cuối thêm `npx vitest run` toàn bộ + `npm run lint` (0 errors) + `npm run build`.
- Branch: `feat/lark-latest-record` (đã tạo, spec `5551847`).

---

### Task 1: Lark client lấy `created_time` (search + automatic_fields)

**Files:**
- Modify: `features/lark/client.ts`
- Test: `features/lark/client.test.ts`

**Interfaces:**
- Produces: `LarkRecord` có `created_time?: number`; `searchRecordsByOrderNumber`/`listAllRecords`/`listAllQcRecords` trả record kèm `created_time`.

- [ ] **Step 1: Cập nhật test buildOrderNumberSearchBody (automatic_fields:true)**

Trong `features/lark/client.test.ts`, tìm assertion `automatic_fields` của `buildOrderNumberSearchBody` (nếu có) và sửa kỳ vọng thành `true`; nếu chưa có, thêm:

```ts
import { buildOrderNumberSearchBody } from './client';

describe('buildOrderNumberSearchBody', () => {
  it('bật automatic_fields để lấy created_time', () => {
    const body = buildOrderNumberSearchBody('#MBLVD1');
    expect(body.automatic_fields).toBe(true);
  });
  it('khớp cả dạng có # và không #', () => {
    const body = buildOrderNumberSearchBody('#MBLVD1') as { filter: { conditions: Array<{ value: string[] }> } };
    const vals = body.filter.conditions.flatMap((c) => c.value);
    expect(vals).toEqual(expect.arrayContaining(['MBLVD1', '#MBLVD1']));
  });
});
```

- [ ] **Step 2: Run test → fail**

Run: `npx vitest run features/lark/client.test.ts`
Expected: FAIL ở case automatic_fields (đang `false`).

- [ ] **Step 3: Implement**

Trong `features/lark/client.ts`:

1. `LarkRecord` thêm field:
```ts
export interface LarkRecord { record_id: string; fields: Record<string, unknown>; created_time?: number; }
```

2. `buildOrderNumberSearchBody`: đổi `automatic_fields: false` → `automatic_fields: true`.

3. Thêm helper POST search dùng chung (đặt trên `searchRecordsByOrderNumber`):
```ts
/** POST records/search 1 table, phân trang hết, trả mọi item (kèm created_time
 *  nhờ automatic_fields). body: filter (optional) + automatic_fields + page_size. */
async function searchAllRecords(tableId: string, body: Record<string, unknown>): Promise<LarkRecord[]> {
  const token = await getTenantToken();
  const appToken = env('LARK_BASE_APP_TOKEN');
  const out: LarkRecord[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL(`${DOMAIN}/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records/search`);
    if (pageToken) url.searchParams.set('page_token', pageToken);
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const j = (await res.json()) as { code: number; msg: string; data?: { items?: LarkRecord[]; page_token?: string; has_more?: boolean } };
    if (j.code !== 0) throw new Error(`[lark] search fail: code=${j.code} msg=${j.msg}`);
    out.push(...(j.data?.items ?? []));
    pageToken = j.data?.has_more ? j.data?.page_token : undefined;
  } while (pageToken);
  return out;
}
```

4. `searchRecordsByOrderNumber`: thay thân vòng lặp bằng `return searchAllRecords(logTableId(), buildOrderNumberSearchBody(orderNumber));` (giữ guard `if (!orderNumber.trim()) return [];`).

5. `listAllRecords`: thay GET bằng:
```ts
export async function listAllRecords(): Promise<LarkRecord[]> {
  return searchAllRecords(logTableId(), { automatic_fields: true, page_size: 500 });
}
```

6. `listAllQcRecords`: giữ guard env, thay GET bằng search:
```ts
export async function listAllQcRecords(): Promise<LarkRecord[]> {
  const qcTableId = process.env.LARK_QC_TABLE_ID;
  if (!qcTableId) return [];
  return searchAllRecords(qcTableId, { automatic_fields: true, page_size: 500 });
}
```

(Xoá code GET cũ của 2 hàm. Giữ `logTableId()`/`env`/`getTenantToken`/`DOMAIN` như cũ.)

- [ ] **Step 4: Run test → pass**

Run: `npx vitest run features/lark/client.test.ts`
Expected: PASS.

- [ ] **Step 5: tsc + commit**

Run: `npx tsc --noEmit` → no output.
```bash
git add features/lark/client.ts features/lark/client.test.ts
git commit -m "feat(lark): lấy created_time qua records/search + automatic_fields"
```

---

### Task 2: Helper chọn record mới nhất (`record-select.ts`)

**Files:**
- Create: `features/lark/record-select.ts`
- Test: `features/lark/record-select.test.ts`

**Interfaces:**
- Consumes: `LarkRecord` (có `created_time?: number`) từ `./client`.
- Produces: `larkCreatedTime(rec): number`, `pickLatestRecord(records): LarkRecord | null`, `sortRecordsLatestFirst(records): LarkRecord[]`.

- [ ] **Step 1: Write the failing test**

Create `features/lark/record-select.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { pickLatestRecord, sortRecordsLatestFirst, larkCreatedTime } from './record-select';
import type { LarkRecord } from './client';

const rec = (id: string, t?: number): LarkRecord => ({ record_id: id, fields: {}, created_time: t });

describe('record-select', () => {
  it('larkCreatedTime: thiếu → 0', () => {
    expect(larkCreatedTime(rec('a'))).toBe(0);
    expect(larkCreatedTime(rec('a', 123))).toBe(123);
  });
  it('pickLatestRecord: chọn created_time lớn nhất', () => {
    expect(pickLatestRecord([rec('a', 100), rec('b', 300), rec('c', 200)])?.record_id).toBe('b');
  });
  it('pickLatestRecord: thiếu created_time hết → record CUỐI mảng', () => {
    expect(pickLatestRecord([rec('a'), rec('b'), rec('c')])?.record_id).toBe('c');
  });
  it('pickLatestRecord: rỗng → null', () => {
    expect(pickLatestRecord([])).toBeNull();
  });
  it('sortRecordsLatestFirst: desc theo created_time, ổn định', () => {
    const out = sortRecordsLatestFirst([rec('a', 100), rec('b', 300), rec('c', 200)]);
    expect(out.map((r) => r.record_id)).toEqual(['b', 'c', 'a']);
  });
});
```

- [ ] **Step 2: Run test → fail**

Run: `npx vitest run features/lark/record-select.test.ts`
Expected: FAIL — "Cannot find module './record-select'".

- [ ] **Step 3: Implement**

Create `features/lark/record-select.ts`:
```ts
/** Chọn record Lark "mới nhất" theo created_time khi 1 đơn có nhiều record. THUẦN. */
import type { LarkRecord } from './client';

export function larkCreatedTime(rec: LarkRecord): number {
  return typeof rec.created_time === 'number' && Number.isFinite(rec.created_time) ? rec.created_time : 0;
}

/** Record có created_time lớn nhất. Thiếu hết → record cuối mảng (mới nhất theo
 *  thứ tự Lark). Rỗng → null. Tiebreak: record sau thắng (ổn định). */
export function pickLatestRecord(records: LarkRecord[]): LarkRecord | null {
  if (records.length === 0) return null;
  let best = records[0];
  for (const r of records) {
    if (larkCreatedTime(r) >= larkCreatedTime(best)) best = r; // >= → record sau thắng khi bằng
  }
  return best;
}

/** Copy đã sort created_time GIẢM dần; bằng nhau giữ thứ tự gốc (ổn định). */
export function sortRecordsLatestFirst(records: LarkRecord[]): LarkRecord[] {
  return records
    .map((r, i) => ({ r, i }))
    .sort((a, b) => larkCreatedTime(b.r) - larkCreatedTime(a.r) || a.i - b.i)
    .map((x) => x.r);
}
```

- [ ] **Step 4: Run test → pass**

Run: `npx vitest run features/lark/record-select.test.ts`
Expected: PASS (5 case).

- [ ] **Step 5: tsc + commit**

Run: `npx tsc --noEmit` → no output.
```bash
git add features/lark/record-select.ts features/lark/record-select.test.ts
git commit -m "feat(lark): helper pickLatestRecord/sortRecordsLatestFirst theo created_time"
```

---

### Task 3: QC theo record mới nhất (`parse-qc-row.ts`)

**Files:**
- Modify: `features/lark/parse-qc-row.ts`
- Test: `features/lark/parse-qc-row.test.ts`

**Interfaces:**
- Produces: `mapQcCheck(value: string | null): QcStatus | null`; `latestQcCheck(items: Array<{ qcCheck: string | null; createdTime: number }>): string | null`.
- Removes: `reduceQcStatus` (chỉ sync dùng — Task 5 chuyển sang latest).

- [ ] **Step 1: Sửa test**

Trong `features/lark/parse-qc-row.test.ts`: XOÁ `describe('reduceQcStatus'...)` và import `reduceQcStatus`. Thêm:
```ts
import { parseQcRow, mapQcCheck, latestQcCheck } from './parse-qc-row';

describe('mapQcCheck', () => {
  it('map từng giá trị QC Check → status', () => {
    expect(mapQcCheck('QC Failed')).toBe('fail');
    expect(mapQcCheck('Tiếp nhận - chưa QC')).toBe('pending');
    expect(mapQcCheck('QC Pass')).toBe('pass');
    expect(mapQcCheck('Gửi dư')).toBe('extra');
    expect(mapQcCheck('lạ')).toBeNull();
    expect(mapQcCheck(null)).toBeNull();
  });
});

describe('latestQcCheck', () => {
  it('QC fail (cũ) + QC pass (mới) → lấy pass theo createdTime', () => {
    expect(latestQcCheck([
      { qcCheck: 'QC Failed', createdTime: 100 },
      { qcCheck: 'QC Pass', createdTime: 200 },
    ])).toBe('QC Pass');
  });
  it('bỏ qua record qcCheck null, lấy non-null mới nhất', () => {
    expect(latestQcCheck([
      { qcCheck: 'QC Pass', createdTime: 300 },
      { qcCheck: null, createdTime: 400 },
    ])).toBe('QC Pass');
  });
  it('rỗng / toàn null → null', () => {
    expect(latestQcCheck([])).toBeNull();
    expect(latestQcCheck([{ qcCheck: null, createdTime: 1 }])).toBeNull();
  });
});
```
(Giữ `describe('parseQcRow'...)` như cũ.)

- [ ] **Step 2: Run test → fail**

Run: `npx vitest run features/lark/parse-qc-row.test.ts`
Expected: FAIL — `mapQcCheck`/`latestQcCheck` chưa tồn tại.

- [ ] **Step 3: Implement**

Trong `features/lark/parse-qc-row.ts`, THAY `reduceQcStatus` bằng:
```ts
/** 1 giá trị "QC Check" (single-select) → status. Không khớp/null → null. THUẦN. */
export function mapQcCheck(value: string | null): QcStatus | null {
  switch (value) {
    case 'QC Failed': return 'fail';
    case 'Tiếp nhận - chưa QC': return 'pending';
    case 'QC Pass': return 'pass';
    case 'Gửi dư': return 'extra';
    default: return null;
  }
}

/** Giá trị QC Check của record createdTime LỚN NHẤT có qcCheck non-null. THUẦN. */
export function latestQcCheck(items: Array<{ qcCheck: string | null; createdTime: number }>): string | null {
  let best: { qcCheck: string; createdTime: number } | null = null;
  for (const it of items) {
    if (!it.qcCheck) continue;
    if (!best || it.createdTime >= best.createdTime) best = { qcCheck: it.qcCheck, createdTime: it.createdTime };
  }
  return best?.qcCheck ?? null;
}
```
(Giữ `parseQcRow`, type `QcStatus`, import `larkText`.)

- [ ] **Step 4: Run test → pass**

Run: `npx vitest run features/lark/parse-qc-row.test.ts`
Expected: PASS.

- [ ] **Step 5: tsc + commit**

Run: `npx tsc --noEmit` → no output (Task 5 sẽ sửa sync; nếu tsc báo sync.ts dùng `reduceQcStatus` thì ĐỂ NGUYÊN lỗi đó cho Task 5 — nhưng để task này tự đứng được, tạm giữ import sync chưa đổi sẽ gây lỗi tsc).

> LƯU Ý cho implementer: vì `sync.ts` còn import `reduceQcStatus`, để Task 3 commit sạch tsc, **đồng thời sửa nhanh `sync.ts`** ở Task 5. NẾU muốn Task 3 độc lập: giữ `reduceQcStatus` (không xoá) trong task này, chỉ THÊM `mapQcCheck`/`latestQcCheck`; Task 5 sẽ xoá `reduceQcStatus` sau khi gỡ consumer. → **Chọn cách này:** KHÔNG xoá `reduceQcStatus` ở Task 3; chỉ thêm 2 hàm mới. Xoá ở Task 5.

(Điều chỉnh Step 3: KHÔNG xoá `reduceQcStatus`, chỉ THÊM `mapQcCheck` + `latestQcCheck` bên dưới nó.)

```bash
git add features/lark/parse-qc-row.ts features/lark/parse-qc-row.test.ts
git commit -m "feat(lark): mapQcCheck + latestQcCheck (QC theo record mới nhất)"
```

---

### Task 4: detail.ts lấy record mới nhất

**Files:**
- Modify: `features/lark/detail.ts`
- Test: `features/lark/detail.test.ts`

**Interfaces:**
- Consumes: `pickLatestRecord`, `sortRecordsLatestFirst` (Task 2).
- Produces: `getLarkRawFieldsForOrder` lấy field record mới nhất; `getLarkRecordsForOrder` trả mới-nhất-đầu.

- [ ] **Step 1: Thêm test (mock client)**

Trong `features/lark/detail.test.ts` thêm test cho hàm thuần sắp xếp. Vì `getLarkRecordsForOrder`/`getLarkRawFieldsForOrder` gọi DB+Lark (không unit-test trực tiếp), test phần thuần qua `sortRecordsLatestFirst` đã có ở Task 2; ở đây thêm kiểm tra `flattenLarkRecord` vẫn đúng (không hồi quy) — KHÔNG cần test mới nếu Task 2 đã phủ sort. Bỏ qua test mới ở task này; xác minh bằng tsc + vitest detail.test.ts hiện có.

- [ ] **Step 2: Implement**

Trong `features/lark/detail.ts`:
1. Import: `import { pickLatestRecord, sortRecordsLatestFirst } from './record-select';`
2. `getLarkRawFieldsForOrder`: đổi
```ts
    const records = await searchRecordsByOrderNumber(ord.orderNumber);
    return records[0]?.fields ?? {};
```
thành
```ts
    const records = await searchRecordsByOrderNumber(ord.orderNumber);
    return pickLatestRecord(records)?.fields ?? {};
```
3. `getLarkRecordsForOrder`: đổi
```ts
    return records.map((r) => ({ recordId: r.record_id, fields: flattenLarkRecord(r.fields) }));
```
thành
```ts
    return sortRecordsLatestFirst(records).map((r) => ({ recordId: r.record_id, fields: flattenLarkRecord(r.fields) }));
```

- [ ] **Step 3: Verify**

Run: `npx vitest run features/lark/detail.test.ts && npx tsc --noEmit`
Expected: PASS + no output.

- [ ] **Step 4: Commit**
```bash
git add features/lark/detail.ts
git commit -m "feat(lark): modal/card lấy record mới nhất (pickLatest/sortLatestFirst)"
```

---

### Task 5: sync.ts — snapshot status theo thời gian + QC latest

**Files:**
- Modify: `features/lark/sync.ts`
- Modify: `features/lark/parse-qc-row.ts` (xoá `reduceQcStatus` sau khi gỡ consumer)

**Interfaces:**
- Consumes: `larkCreatedTime` (Task 2), `parseLarkStatus`, `parseQcRow`, `mapQcCheck`, `latestQcCheck` (Task 3).

- [ ] **Step 1: Status Part B — gom rồi sort theo created_time tăng dần**

Trong `syncLarkPacks`, Part B (vòng `for (const rec of records)` xây `statusByOrderId`): thay vì fold trực tiếp theo thứ tự `records`, GOM record theo orderId rồi sort created_time tăng dần trước khi fold.

Thêm import: `import { larkCreatedTime } from './record-select';`

Thay đoạn fold hiện tại bằng:
```ts
    // Gom record theo orderId, sort created_time TĂNG DẦN → fold (bản mới hơn ghi
    // đè field non-null). Xác định theo thời gian, không theo thứ tự Lark trả về.
    const recsByOrderId = new Map<string, typeof records>();
    for (const rec of records) {
      const orderNumber = rec.fields['Order Number'] as unknown;
      const num = typeof orderNumber === 'string' ? orderNumber.replace(/^#/, '') : null;
      if (!num) continue;
      const orderId = orderIdByNumber.get(num);
      if (!orderId) continue;
      const arr = recsByOrderId.get(orderId) ?? [];
      arr.push(rec);
      recsByOrderId.set(orderId, arr);
    }
    for (const [orderId, recs] of recsByOrderId) {
      const ordered = [...recs].sort((a, b) => larkCreatedTime(a) - larkCreatedTime(b));
      let acc = { dispatchStatus: null as string | null, cxFfStatus: null as string | null, deliveryStatus: null as string | null, expectedDeliveryDate: null as Date | null, deliveryState: null as import('@/lib/fedex/track').DeliveryStatus | null, actualDeliveredAt: null as Date | null };
      for (const rec of ordered) {
        const s = parseLarkStatus(rec.fields);
        acc = {
          dispatchStatus: s.dispatchStatus ?? acc.dispatchStatus,
          cxFfStatus: s.cxFfStatus ?? acc.cxFfStatus,
          deliveryStatus: s.deliveryStatus ?? acc.deliveryStatus,
          expectedDeliveryDate: s.expectedDeliveryDate ?? acc.expectedDeliveryDate,
          deliveryState: s.deliveryState === 'delivered' || acc.deliveryState === 'delivered' ? 'delivered' : (s.deliveryState ?? acc.deliveryState),
          actualDeliveredAt: s.actualDeliveredAt ?? acc.actualDeliveredAt,
        };
      }
      statusByOrderId.set(orderId, acc);
    }
```
(Giữ khai báo `const statusByOrderId = new Map<...>()` như cũ; xoá vòng `for (const rec of records)` cũ đã thay.)

- [ ] **Step 2: QC — latest theo created_time**

Trong khối QC (`try { const qcRecords = await listAllQcRecords(); ... }`): thay gom `Array<string|null>` + `reduceQcStatus` bằng gom kèm createdTime + `latestQcCheck` + `mapQcCheck`.

Sửa import: `import { parseQcRow, mapQcCheck, latestQcCheck } from './parse-qc-row';` (bỏ `reduceQcStatus`).

Thay:
```ts
        const byNum = new Map<string, Array<string | null>>();
        for (const rec of qcRecords) {
          const { orderNumber, qcCheck } = parseQcRow(rec.fields);
          if (!orderNumber) continue;
          const bare = orderNumber.replace(/^#/, '');
          const arr = byNum.get(bare) ?? [];
          arr.push(qcCheck);
          byNum.set(bare, arr);
        }
        const qcOrderIds = await resolveOrderIds([...byNum.keys()]);
        const qcRows: Array<{ orderId: string; qcStatus: string }> = [];
        for (const [bare, vals] of byNum) {
          const orderId = qcOrderIds.get(bare);
          const status = reduceQcStatus(vals);
          if (orderId && status) qcRows.push({ orderId, qcStatus: status });
        }
```
bằng:
```ts
        const byNum = new Map<string, Array<{ qcCheck: string | null; createdTime: number }>>();
        for (const rec of qcRecords) {
          const { orderNumber, qcCheck } = parseQcRow(rec.fields);
          if (!orderNumber) continue;
          const bare = orderNumber.replace(/^#/, '');
          const arr = byNum.get(bare) ?? [];
          arr.push({ qcCheck, createdTime: larkCreatedTime(rec) });
          byNum.set(bare, arr);
        }
        const qcOrderIds = await resolveOrderIds([...byNum.keys()]);
        const qcRows: Array<{ orderId: string; qcStatus: string }> = [];
        for (const [bare, items] of byNum) {
          const orderId = qcOrderIds.get(bare);
          const status = mapQcCheck(latestQcCheck(items));
          if (orderId && status) qcRows.push({ orderId, qcStatus: status });
        }
```

- [ ] **Step 3: Xoá `reduceQcStatus` (dead)**

Trong `features/lark/parse-qc-row.ts`: xoá hàm `reduceQcStatus` (không còn consumer). Xác nhận: `grep -rn "reduceQcStatus" features app` chỉ còn 0 kết quả (test đã gỡ ở Task 3).

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npx vitest run features/lark/`
Expected: tsc no output; mọi test lark pass.

- [ ] **Step 5: Commit**
```bash
git add features/lark/sync.ts features/lark/parse-qc-row.ts
git commit -m "feat(lark): sync status fold theo created_time + QC lấy record mới nhất"
```

---

### Task 6: Card hiển thị mới nhất + lịch sử thu gọn (+ final gate)

**Files:**
- Modify: `components/fulfillment/LarkDetailCard.tsx`

**Interfaces:**
- Consumes: `records` đã sort mới-nhất-đầu (Task 4).

- [ ] **Step 1: Implement**

Thay nội dung render danh sách record trong `components/fulfillment/LarkDetailCard.tsx`. records[0] = mới nhất (hiện đầy đủ); phần còn lại bọc `<details>`:

```tsx
import type { LarkDetailRecord } from '@/features/lark/detail';

function RecordFields({ rec }: { rec: LarkDetailRecord }) {
  return (
    <dl className="divide-y divide-border/50">
      {rec.fields.map((f) => (
        <div key={f.label} className="flex gap-3 px-3 py-1.5 text-sm">
          <dt className="w-1/3 shrink-0 text-muted-foreground">{f.label}</dt>
          <dd className="flex-1 break-words">{f.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Card hiển thị field Lark của record MỚI NHẤT; record cũ thu gọn (lịch sử). RSC. */
export function LarkDetailCard({ records }: { records: LarkDetailRecord[] }) {
  const [latest, ...older] = records;
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h2 className="mb-3 text-sm font-semibold text-foreground">Dữ liệu Lark (vận hành)</h2>
      {!latest ? (
        <p className="text-sm text-muted-foreground">Không tìm thấy dữ liệu Lark cho đơn này.</p>
      ) : (
        <div className="space-y-3">
          <div className="rounded border border-border">
            <RecordFields rec={latest} />
          </div>
          {older.length > 0 && (
            <details className="rounded border border-border">
              <summary className="cursor-pointer px-3 py-1.5 text-xs font-medium text-muted-foreground">
                Lịch sử ({older.length} bản cũ)
              </summary>
              <div className="space-y-3 p-2">
                {older.map((rec, i) => (
                  <div key={rec.recordId} className="rounded border border-border/60">
                    <div className="border-b border-border bg-muted/40 px-3 py-1 text-xs text-muted-foreground">
                      Bản cũ #{i + 1}
                    </div>
                    <RecordFields rec={rec} />
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 2: Final verification gate**

Run: `npx tsc --noEmit && npx vitest run && npm run lint && npm run build`
Expected: tsc no output; toàn bộ vitest pass; lint 0 errors; build thành công.
Nếu fail → sửa & chạy lại đến khi xanh.

- [ ] **Step 3: Commit**
```bash
git add components/fulfillment/LarkDetailCard.tsx
git commit -m "feat(lark): card hiện record mới nhất + lịch sử bản cũ thu gọn"
```

---

## Self-Review

**Spec coverage:** §3.1 client created_time → Task 1. §3.2 record-select → Task 2. §3.3 detail → Task 4. §3.4 card → Task 6. §3.5 sync status → Task 5 Step 1. §3.6 QC → Task 3 (helper) + Task 5 Step 2-3. §4 guard (thiếu created_time fallback, 1 record, QC null) → Task 2 + Task 3 test. §5 test thuần → Task 2/3. Đủ.

**Placeholder scan:** không TBD/TODO; mọi step có code/command. (Task 3 note giải quyết thứ tự xoá reduceQcStatus → chốt: KHÔNG xoá ở Task 3, xoá ở Task 5 Step 3.)

**Type consistency:**
- `LarkRecord.created_time?: number` (Task 1) ← `larkCreatedTime`/`pickLatestRecord`/`sortRecordsLatestFirst` (Task 2) ← detail (Task 4), sync (Task 5). ✔
- `mapQcCheck`/`latestQcCheck` (Task 3) ← sync QC (Task 5). ✔
- `LarkDetailRecord` (detail.ts, không đổi) ← card (Task 6). ✔
- `reduceQcStatus` tồn tại đến hết Task 5 Step 3 rồi xoá (consumer gỡ ở Task 5 Step 2). ✔
