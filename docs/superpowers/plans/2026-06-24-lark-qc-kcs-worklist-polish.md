# Sync Lark QC → KCS + polish worklist — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Đổ trạng thái QC từ Lark QC table vào cột KCS, ẩn cột Brand khi không cần, và hiện mã tracking thật + trạng thái API ở cột Vận chuyển.

**Architecture:** Cron Lark đọc thêm QC table (`LARK_QC_TABLE_ID`), gom `QC Check` per đơn → cột `qc_status` mới trên `lark_order_status`. Worklist query đọc `qcStatus` + danh sách tracking (json_agg). Summarizer thuần map sang badge; KCS ưu tiên hệ thống rồi fallback Lark; cột Vận chuyển render từng tracking + chip trạng thái.

**Tech Stack:** Next.js App Router (RSC), Drizzle, Vitest, Lark Bitable API (read-only), Tailwind.

## Global Constraints

- Lark read-only, one-way. Best-effort QC: thiếu `LARK_QC_TABLE_ID` → bỏ qua phần QC, KHÔNG vỡ sync logistics.
- Env table id đã đổi sang `LARK_LOG_TABLE_ID` (xong ở PR #220, có fallback `?? LARK_TABLE_ID`) — KHÔNG làm lại trong plan này. QC table dùng env mới `LARK_QC_TABLE_ID` = `tblfnOiEwzcXmemM`.
- QC Check (Lark single-select) 4 giá trị: `QC Pass` / `QC Failed` / `Tiếp nhận - chưa QC` / `Gửi dư`. Khoá nối đơn = field `Order Number final` (vd `#MBLVD29248`).
- Gom nhiều dòng/đơn theo ưu tiên: `QC Failed`→fail > `Tiếp nhận - chưa QC`→pending > `QC Pass`→pass > `Gửi dư`→extra.
- KCS cột: ưu tiên hệ thống `goods_receipt_items` (pending/pass/fail > 0) → dùng logic cũ; else Lark `qc_status`; else ẩn (muted).
- Brand & KCS: render **ô trống** khi badge tone = `muted` (không có việc thật).
- Vận chuyển: có tracking → mỗi tracking 1 dòng: **mã tracking là link** sang trang hãng (mở tab mới) + chip trạng thái API (Đang chuyển/Đã giao/Sự cố/Chưa cập nhật). Không tracking → giữ badge `summarizeDelivery` (Chưa/Chưa ship).
- Migration hand-authored, KHÔNG chạy local. Journal latest idx 77 → next **0078**.
- Verify mỗi task TS: `npx tsc --noEmit` sạch; task UI thêm `npx vitest run` + `npm run build` xanh.
- Branch: `feat/lark-qc-kcs` (đã rebase trên main, spec commit có sẵn).

---

### Task 1: `parseQcRow` + `reduceQcStatus` (thuần)

**Files:**
- Create: `features/lark/parse-qc-row.ts`
- Test: `features/lark/parse-qc-row.test.ts`

**Interfaces:**
- Consumes: `larkText` từ `./parse-pack-row` (đã export).
- Produces: `parseQcRow(fields): { orderNumber: string | null; qcCheck: string | null }`; `reduceQcStatus(values: Array<string | null>): 'fail' | 'pending' | 'pass' | 'extra' | null`.

- [ ] **Step 1: Write the failing test**

Create `features/lark/parse-qc-row.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseQcRow, reduceQcStatus } from './parse-qc-row';

describe('parseQcRow', () => {
  it('đọc Order Number final + QC Check', () => {
    expect(parseQcRow({ 'Order Number final': '#MBLVD29248', 'QC Check': 'QC Pass' }))
      .toEqual({ orderNumber: '#MBLVD29248', qcCheck: 'QC Pass' });
  });
  it('thiếu field → null', () => {
    expect(parseQcRow({})).toEqual({ orderNumber: null, qcCheck: null });
  });
});

describe('reduceQcStatus', () => {
  it('ưu tiên Failed > chưa-QC > Pass > Gửi dư', () => {
    expect(reduceQcStatus(['QC Pass', 'QC Failed', 'Tiếp nhận - chưa QC'])).toBe('fail');
    expect(reduceQcStatus(['QC Pass', 'Tiếp nhận - chưa QC'])).toBe('pending');
    expect(reduceQcStatus(['QC Pass', 'Gửi dư'])).toBe('pass');
    expect(reduceQcStatus(['Gửi dư'])).toBe('extra');
  });
  it('rỗng / không khớp → null', () => {
    expect(reduceQcStatus([])).toBeNull();
    expect(reduceQcStatus([null, 'gì đó lạ'])).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run features/lark/parse-qc-row.test.ts`
Expected: FAIL — "Cannot find module './parse-qc-row'".

- [ ] **Step 3: Write minimal implementation**

Create `features/lark/parse-qc-row.ts`:

```ts
/**
 * THUẦN: 1 record QC table Lark → (orderNumber, qcCheck) + gom nhiều dòng/đơn
 * thành 1 trạng thái KCS. Field: 'Order Number final', 'QC Check' (single-select).
 */
import { larkText } from './parse-pack-row';

export function parseQcRow(fields: Record<string, unknown>): { orderNumber: string | null; qcCheck: string | null } {
  return {
    orderNumber: larkText(fields['Order Number final']),
    qcCheck: larkText(fields['QC Check']),
  };
}

export type QcStatus = 'fail' | 'pending' | 'pass' | 'extra';

/** Gom QC Check nhiều dòng/đơn → 1 trạng thái theo ưu tiên Failed>chưa-QC>Pass>Gửi dư. */
export function reduceQcStatus(values: Array<string | null>): QcStatus | null {
  const set = new Set(values.filter(Boolean) as string[]);
  if (set.has('QC Failed')) return 'fail';
  if (set.has('Tiếp nhận - chưa QC')) return 'pending';
  if (set.has('QC Pass')) return 'pass';
  if (set.has('Gửi dư')) return 'extra';
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run features/lark/parse-qc-row.test.ts`
Expected: PASS (4 test).

- [ ] **Step 5: tsc + commit**

Run: `npx tsc --noEmit` → no output.

```bash
git add features/lark/parse-qc-row.ts features/lark/parse-qc-row.test.ts
git commit -m "feat(ops): parseQcRow + reduceQcStatus thuần (Lark QC→KCS)"
```

---

### Task 2: `listAllQcRecords` trong Lark client

**Files:**
- Modify: `features/lark/client.ts`

**Interfaces:**
- Consumes: `getTenantToken`, `env`, `DOMAIN`, `LarkRecord` (cùng file).
- Produces: `listAllQcRecords(): Promise<LarkRecord[]>` — đọc `process.env.LARK_QC_TABLE_ID`; trả `[]` nếu thiếu env.

- [ ] **Step 1: Implement (thêm cuối file)**

Trong `features/lark/client.ts`, thêm cuối file:

```ts
/** Đọc TẤT CẢ record của QC table (env LARK_QC_TABLE_ID). Trả [] nếu chưa cấu
 *  hình env (QC là tuỳ chọn — không vỡ sync logistics). Phân trang 500/lần. */
export async function listAllQcRecords(): Promise<LarkRecord[]> {
  const qcTableId = process.env.LARK_QC_TABLE_ID;
  if (!qcTableId) return [];
  const token = await getTenantToken();
  const appToken = env('LARK_BASE_APP_TOKEN');
  const out: LarkRecord[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL(`${DOMAIN}/open-apis/bitable/v1/apps/${appToken}/tables/${qcTableId}/records`);
    url.searchParams.set('page_size', '500');
    if (pageToken) url.searchParams.set('page_token', pageToken);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const j = (await res.json()) as {
      code: number; msg: string;
      data?: { items?: LarkRecord[]; page_token?: string; has_more?: boolean };
    };
    if (j.code !== 0) throw new Error(`[lark] QC list fail: code=${j.code} msg=${j.msg}`);
    out.push(...(j.data?.items ?? []));
    pageToken = j.data?.has_more ? j.data?.page_token : undefined;
  } while (pageToken);
  return out;
}
```

- [ ] **Step 2: Verify tsc + commit**

Run: `npx tsc --noEmit` → no output.

```bash
git add features/lark/client.ts
git commit -m "feat(ops): listAllQcRecords đọc LARK_QC_TABLE_ID (best-effort)"
```

---

### Task 3: Cột `qc_status` + migration 0078

**Files:**
- Modify: `db/schema.ts` (thêm cột vào `larkOrderStatus`)
- Create: `db/migrations/0078_lark-qc-status.sql`
- Modify: `db/migrations/meta/_journal.json`

**Interfaces:**
- Produces: `schema.larkOrderStatus.qcStatus` (text, nullable).

- [ ] **Step 1: Thêm cột vào schema.ts**

Trong `db/schema.ts`, trong block `export const larkOrderStatus = pgTable(...)`, thêm sau dòng `expectedDeliveryDate: date('expected_delivery_date'),`:

```ts
  qcStatus: text('qc_status'), // fail|pending|pass|extra (gom từ Lark QC Check)
```

- [ ] **Step 2: Viết migration SQL**

Create `db/migrations/0078_lark-qc-status.sql`:

```sql
ALTER TABLE "lark_order_status" ADD COLUMN "qc_status" text;
```

- [ ] **Step 3: Thêm entry journal**

Trong `db/migrations/meta/_journal.json`, thêm vào cuối mảng `entries` (thêm `,` sau entry idx 77):

```json
{
"idx": 78,
"version": "7",
"when": 1783168800000,
"tag": "0078_lark-qc-status",
"breakpoints": true
}
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit` → no output.
Run: `python3 -c "import json;json.load(open('db/migrations/meta/_journal.json'));print('journal OK')"` → "journal OK".

- [ ] **Step 5: Commit**

```bash
git add db/schema.ts db/migrations/0078_lark-qc-status.sql db/migrations/meta/_journal.json
git commit -m "feat(ops): cột lark_order_status.qc_status + migration 0078"
```

---

### Task 4: Sync QC → upsert `qc_status`

**Files:**
- Modify: `features/lark/sync.ts`

**Interfaces:**
- Consumes: `listAllQcRecords` (Task 2), `parseQcRow`/`reduceQcStatus` (Task 1), `schema.larkOrderStatus.qcStatus` (Task 3), `resolveOrderIds`, `chunk`/`APPLY_CHUNK` (cùng file).
- Produces: trong `syncLarkPacks()`, upsert `qcStatus` theo orderId; thêm `qcUpserted: number` vào `LarkSyncSummary`.

- [ ] **Step 1: Import + field summary**

Trong `features/lark/sync.ts`:
- Thêm import:
```ts
import { listAllQcRecords } from './client';
import { parseQcRow, reduceQcStatus } from './parse-qc-row';
```
(Gộp `listAllQcRecords` vào import `./client` sẵn có nếu cùng dòng.)
- Trong `export interface LarkSyncSummary { ... }`, thêm:
```ts
  qcUpserted: number;
```

- [ ] **Step 2: Gom QC + upsert (đặt SAU block upsert lark_order_status status của Phần B, TRƯỚC khi tạo `warnings`/`summary`)**

```ts
    // QC từ Lark QC table (best-effort): gom QC Check theo đơn → qc_status.
    const qcRecords = await listAllQcRecords();
    let qcUpserted = 0;
    if (qcRecords.length > 0) {
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
      for (const batch of chunk(qcRows, APPLY_CHUNK)) {
        await db.transaction(async (tx) => {
          for (const q of batch) {
            await tx.insert(schema.larkOrderStatus).values({
              orderId: q.orderId, qcStatus: q.qcStatus, syncedAt: new Date(),
            }).onConflictDoUpdate({
              target: schema.larkOrderStatus.orderId,
              set: { qcStatus: q.qcStatus, syncedAt: new Date() },
            });
            qcUpserted += 1;
          }
        });
      }
    }
```

- [ ] **Step 3: Thêm vào object summary**

Tìm dòng tạo `const summary: LarkSyncSummary = { ... };` và thêm `qcUpserted`:

```ts
    const summary: LarkSyncSummary = { created: cls.create.length, updated: cls.update.length, unmatched: cls.unmatched, skipped: cls.skipped.length, warnings, larkStatusUpserted, qcUpserted };
```

(Giữ nguyên các field hiện có; chỉ thêm `qcUpserted`. Nếu tên biến `larkStatusUpserted` khác trong file, giữ đúng tên đang có và chỉ thêm `qcUpserted`.)

- [ ] **Step 4: Sửa nơi khác tạo LarkSyncSummary (nếu có)**

Run: `grep -rn "LarkSyncSummary" features/ app/ scripts/` — nếu có object literal khác, thêm `qcUpserted: 0`. Nếu không, bỏ qua.

- [ ] **Step 5: Verify tsc + suite**

Run: `npx tsc --noEmit` → no output.
Run: `npx vitest run` → toàn bộ xanh.

- [ ] **Step 6: Commit**

```bash
git add features/lark/sync.ts
git commit -m "feat(ops): sync gom Lark QC Check → lark_order_status.qc_status"
```

---

### Task 5: Summarizer thuần — KCS(Lark) + tracking helpers

**Files:**
- Modify: `features/fulfillment/worklist-status.ts`
- Test: `features/fulfillment/worklist-status.test.ts`

**Interfaces:**
- Consumes: type `Badge` (cùng file).
- Produces:
  - `summarizeKcs(o: { pending: number; pass: number; fail: number }, larkQc?: string | null): Badge` (mở rộng — thêm param 2).
  - `formatTrackingStatus(s: string | null): Badge`.
  - `carrierTrackingUrl(carrierKey: string | null, tracking: string): string`.

- [ ] **Step 1: Write the failing tests**

Thêm vào `features/fulfillment/worklist-status.test.ts`:

```ts
import { formatTrackingStatus, carrierTrackingUrl } from './worklist-status';

describe('summarizeKcs + larkQc', () => {
  it('hệ thống có data → ưu tiên hệ thống (bỏ qua larkQc)', () => {
    expect(summarizeKcs({ pending: 0, pass: 2, fail: 0 }, 'fail').tone).toBe('ok');
  });
  it('hệ thống rỗng → fallback larkQc', () => {
    expect(summarizeKcs({ pending: 0, pass: 0, fail: 0 }, 'fail').tone).toBe('bad');
    expect(summarizeKcs({ pending: 0, pass: 0, fail: 0 }, 'pending').tone).toBe('warn');
    expect(summarizeKcs({ pending: 0, pass: 0, fail: 0 }, 'pass').tone).toBe('ok');
    expect(summarizeKcs({ pending: 0, pass: 0, fail: 0 }, 'extra')).toEqual({ label: 'Gửi dư', tone: 'info' });
  });
  it('cả hai rỗng → muted', () => {
    expect(summarizeKcs({ pending: 0, pass: 0, fail: 0 }, null).tone).toBe('muted');
    expect(summarizeKcs({ pending: 0, pass: 0, fail: 0 }).tone).toBe('muted');
  });
});

describe('formatTrackingStatus', () => {
  it('map trạng thái API', () => {
    expect(formatTrackingStatus('delivered')).toEqual({ label: 'Đã giao', tone: 'ok' });
    expect(formatTrackingStatus('in_transit').tone).toBe('info');
    expect(formatTrackingStatus('out_for_delivery').tone).toBe('info');
    expect(formatTrackingStatus('exception')).toEqual({ label: 'Sự cố', tone: 'bad' });
    expect(formatTrackingStatus(null)).toEqual({ label: 'Chưa cập nhật', tone: 'muted' });
  });
});

describe('carrierTrackingUrl', () => {
  it('fedex/dhl/khác', () => {
    expect(carrierTrackingUrl('fedex', '7795')).toContain('fedex.com/fedextrack/?trknbr=7795');
    expect(carrierTrackingUrl('dhl', '12345')).toContain('tracking-id=12345');
    expect(carrierTrackingUrl(null, 'x')).toBe('#');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run features/fulfillment/worklist-status.test.ts`
Expected: FAIL — `formatTrackingStatus`/`carrierTrackingUrl` chưa export; summarizeKcs chưa nhận larkQc.

- [ ] **Step 3: Implement**

Trong `features/fulfillment/worklist-status.ts`:
- Thay `summarizeKcs` bằng:

```ts
export function summarizeKcs(o: { pending: number; pass: number; fail: number }, larkQc?: string | null): Badge {
  // Ưu tiên QC hệ thống (goods_receipt_items) nếu có dữ liệu.
  if (o.fail > 0) return { label: 'Lỗi', tone: 'bad' };
  if (o.pending > 0) return { label: 'Chờ', tone: 'warn' };
  if (o.pass > 0) return { label: 'Đạt', tone: 'ok' };
  // Fallback Lark QC.
  switch (larkQc) {
    case 'fail': return { label: 'Lỗi', tone: 'bad' };
    case 'pending': return { label: 'Chờ', tone: 'warn' };
    case 'pass': return { label: 'Đạt', tone: 'ok' };
    case 'extra': return { label: 'Gửi dư', tone: 'info' };
  }
  return { label: '—', tone: 'muted' };
}
```

- Thêm cuối file:

```ts
/** Trạng thái giao theo API track → badge. THUẦN. */
export function formatTrackingStatus(s: string | null): Badge {
  switch (s) {
    case 'delivered': return { label: 'Đã giao', tone: 'ok' };
    case 'in_transit':
    case 'out_for_delivery': return { label: 'Đang chuyển', tone: 'info' };
    case 'exception': return { label: 'Sự cố', tone: 'bad' };
    default: return { label: 'Chưa cập nhật', tone: 'muted' };
  }
}

/** URL trang tracking của hãng theo carrierKey. Carrier lạ → '#'. THUẦN. */
export function carrierTrackingUrl(carrierKey: string | null, tracking: string): string {
  const t = encodeURIComponent(tracking);
  if (carrierKey === 'fedex') return `https://www.fedex.com/fedextrack/?trknbr=${t}`;
  if (carrierKey === 'dhl') return `https://www.dhl.com/global-en/home/tracking.html?tracking-id=${t}`;
  return '#';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run features/fulfillment/worklist-status.test.ts`
Expected: PASS (case cũ + mới).

- [ ] **Step 5: tsc + commit**

Run: `npx tsc --noEmit` → no output.

```bash
git add features/fulfillment/worklist-status.ts features/fulfillment/worklist-status.test.ts
git commit -m "feat(ops): summarizeKcs fallback Lark + formatTrackingStatus + carrierTrackingUrl"
```

---

### Task 6: Query (qc + tracks) + WorklistTable (ẩn brand/kcs, render tracking)

**Files:**
- Modify: `features/fulfillment/worklist-status-queries.ts`
- Modify: `app/(dashboard)/f/fulfillment/page.tsx`
- Modify: `components/fulfillment/WorklistTable.tsx`

**Interfaces:**
- Consumes: `schema.larkOrderStatus.qcStatus` (Task 3); `summarizeKcs`/`formatTrackingStatus`/`carrierTrackingUrl` (Task 5).
- Produces: `WorklistStatusRow.larkQc: string | null`; `WorklistStatusRow.ship.tracks: Array<{ trackingNumber: string; carrierKey: string | null; deliveryStatus: string | null }>`.

- [ ] **Step 1: Query — thêm qcStatus + ship.tracks**

Trong `features/fulfillment/worklist-status-queries.ts`:
- `interface WorklistStatusRow`:
  - Trong `ship: {...}` thêm field: `tracks: Array<{ trackingNumber: string; carrierKey: string | null; deliveryStatus: string | null }>;`
  - Thêm field cấp cao: `larkQc: string | null;`
- Base `db.select({...})`: thêm sau `larkExpected: schema.larkOrderStatus.expectedDeliveryDate,`:
```ts
    larkQc: schema.larkOrderStatus.qcStatus,
```
- `shipAgg` `db.select({...})`: thêm (sau `inTransit`):
```ts
    tracks: sql<Array<{ trackingNumber: string; carrierKey: string | null; deliveryStatus: string | null }>>`coalesce(json_agg(json_build_object('trackingNumber', ${schema.shipments.trackingNumber}, 'carrierKey', ${schema.shipments.carrierKey}, 'deliveryStatus', ${schema.shipments.deliveryStatus})) filter (where ${schema.shipments.trackingNumber} is not null), '[]')`,
```
- Trong `return base.map(...)`:
  - `ship: {...}` thêm `tracks: s?.tracks ?? [],`
  - object trả về thêm `larkQc: r.larkQc,`

- [ ] **Step 2: Verify tsc (query trước UI)**

Run: `npx tsc --noEmit` → no output.

- [ ] **Step 3: Page — truyền larkQc vào summarizeKcs + tracks**

Trong `app/(dashboard)/f/fulfillment/page.tsx`, trong `worklistStatusRows.map((r) => ({ ... }))`:
- Đổi `kcs: summarizeKcs(r.kcs),` → `kcs: summarizeKcs(r.kcs, r.larkQc),`
- Thêm `tracks: r.ship.tracks,` (cạnh `packs: r.ship.packs,`).

- [ ] **Step 4: WorklistTable — type + ẩn brand/kcs + render tracking**

Trong `components/fulfillment/WorklistTable.tsx`:
- Import thêm (cạnh import `Badge`):
```ts
import { formatTrackingStatus, carrierTrackingUrl } from '@/features/fulfillment/worklist-status';
```
- `type WorklistRow`: thêm `tracks: Array<{ trackingNumber: string; carrierKey: string | null; deliveryStatus: string | null }>;`
- Cột **Brand**: đổi `<td className="px-3 py-2"><BadgeCell b={row.brand} /></td>` thành:
```tsx
                <td className="px-3 py-2">
                  {row.brand.tone === 'muted' ? null : <BadgeCell b={row.brand} />}
                </td>
```
- Cột **KCS**: đổi tương tự:
```tsx
                <td className="px-3 py-2">
                  {row.kcs.tone === 'muted' ? null : <BadgeCell b={row.kcs} />}
                </td>
```
- Cột **Vận chuyển**: đổi `<td className="px-3 py-2"><BadgeCell b={row.delivery} /></td>` thành:
```tsx
                <td className="px-3 py-2 align-top">
                  {row.tracks.length === 0 ? (
                    <BadgeCell b={row.delivery} />
                  ) : (
                    <div className="flex flex-col gap-1">
                      {row.tracks.map((t) => {
                        const st = formatTrackingStatus(t.deliveryStatus);
                        const url = carrierTrackingUrl(t.carrierKey, t.trackingNumber);
                        return (
                          <div key={t.trackingNumber} className="flex items-center gap-2">
                            {url === '#' ? (
                              <span className="font-mono text-xs">{t.trackingNumber}</span>
                            ) : (
                              <a href={url} target="_blank" rel="noopener noreferrer"
                                 className="font-mono text-xs text-primary underline-offset-2 hover:underline"
                                 onClick={(e) => e.stopPropagation()}>
                                {t.trackingNumber}
                              </a>
                            )}
                            <BadgeCell b={st} />
                          </div>
                        );
                      })}
                    </div>
                  )}
                </td>
```

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: tsc no output; vitest toàn bộ pass; build xanh.

- [ ] **Step 6: Commit**

```bash
git add features/fulfillment/worklist-status-queries.ts "app/(dashboard)/f/fulfillment/page.tsx" components/fulfillment/WorklistTable.tsx
git commit -m "feat(ops): cột KCS đọc Lark QC, ẩn brand/kcs rỗng, vận chuyển hiện tracking+status"
```

---

## Self-Review

**Spec coverage:**
- §3 mapping QC → Task 1 (`reduceQcStatus`) + Task 5 (`summarizeKcs` fallback). §4.1 client → Task 2 (`listAllQcRecords`; env-rename `logTableId` đã xong #220). §4.2 parse-qc-row → Task 1. §4.3 schema+migration → Task 3. §4.4 sync → Task 4. §4.5 summarizeKcs+query → Task 5+6. §4.6 WorklistTable brand/kcs/vận chuyển → Task 6. §4.7 ship tracks json_agg → Task 6. §4.8 helpers thuần → Task 5. §5 guard (thiếu env→[], best-effort) → Task 2. Đủ.

**Type consistency:**
- `QcStatus` ('fail'|'pending'|'pass'|'extra') (Task 1) = giá trị `qcStatus` lưu (Task 4) = nhánh `summarizeKcs` switch (Task 5) = `larkQc` đọc ra (Task 6). ✔
- `ship.tracks` shape (Task 6 query) = `WorklistRow.tracks` (Task 6 UI) = tham số `formatTrackingStatus(t.deliveryStatus)` / `carrierTrackingUrl(t.carrierKey, t.trackingNumber)` (Task 5). ✔
- `summarizeKcs(o, larkQc?)` (Task 5) khớp call site `summarizeKcs(r.kcs, r.larkQc)` (Task 6 page). ✔
- `larkOrderStatus.qcStatus` (Task 3) = select `larkQc` (Task 6) = upsert (Task 4). ✔
- `listAllQcRecords` trả `LarkRecord[]` (Task 2) = `parseQcRow(rec.fields)` (Task 4). ✔

**Placeholder scan:** không TBD/TODO; mọi step có code/command. ✔
