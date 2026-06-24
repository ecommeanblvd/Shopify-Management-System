# Worklist sticky header + modal chi tiết đơn — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Header bảng worklist dính khi scroll, và click một đơn mở modal chi tiết (tóm tắt hệ thống + Lark curated) thay vì nav sang page "tờ giấy trắng".

**Architecture:** Sticky `thead` (CSS). Row click → state mở `<Dialog>` (Radix có sẵn); Dialog gọi server action `getOrderDetailModal(orderId)` bọc các query có sẵn (getFulfillmentDetail + listPacksForOrder + Lark live curated). Theme tối. Giữ route `[orderId]` deep-link.

**Tech Stack:** Next.js App Router (RSC + 'use server' actions + client component), Drizzle, Vitest, Radix Dialog, Tailwind.

## Global Constraints

- Modal = 2 khối: **Tóm tắt đơn (hệ thống)** + **Lark vận hành (curated)**. KHÔNG khối chi phí, KHÔNG dump 89 cột. Theme tối (không `bg-white`).
- Lark live best-effort: lỗi/thiếu env → `larkFields: []`; modal hiện "Không có dữ liệu Lark", không vỡ.
- Server action `getOrderDetailModal` check quyền `view_fulfillment` (như trang detail).
- 12 field Lark curated (đúng tên): `LOG-EP-Dispatch Status`, `Sub-Status`, `CX-FF Status (look up)`, `Final | Delivery Status`, `Ngày giao dự kiến`, `Ngày giao thực tế`, `Couriers`, `Tracking Number`, `Weights`, `Dimension ( điền tay)`, `LOG-Order Remark (Full)`, `CX/Khách note on order (look up)`.
- Giữ route `[orderId]` (deep-link); link số đơn vẫn nav (stopPropagation). Row click → modal.
- KHÔNG migration. Verify mỗi task: `npx tsc --noEmit`; task UI thêm `npx vitest run` + `npm run build`.
- Branch: `feat/worklist-detail-modal` (đã tạo, spec commit `742d9eb`).
- Dialog primitives (`components/ui/dialog.tsx`): `Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription`.

---

### Task 1: `pickLarkFields` + curated list + raw fetch (detail.ts)

**Files:**
- Modify: `features/lark/detail.ts`
- Test: `features/lark/detail.test.ts`

**Interfaces:**
- Consumes: `larkText` (parse-pack-row), `searchRecordsByOrderNumber` (client), `db`/`schema`.
- Produces: `LARK_DETAIL_FIELDS: string[]`; `pickLarkFields(fields, names): Array<{label,value}>` (thuần); `getLarkRawFieldsForOrder(orderId): Promise<Record<string, unknown>>` (best-effort → `{}`).

- [ ] **Step 1: Write the failing test**

Thêm vào `features/lark/detail.test.ts`:

```ts
import { pickLarkFields, LARK_DETAIL_FIELDS } from './detail';

describe('pickLarkFields', () => {
  it('lấy đúng field theo thứ tự danh sách, bỏ rỗng/thiếu', () => {
    const out = pickLarkFields(
      { 'Tracking Number': '123', 'Weights': 1.5, 'Couriers': '', 'Khác': 'x' },
      ['Couriers', 'Tracking Number', 'Weights'],
    );
    expect(out).toEqual([
      { label: 'Tracking Number', value: '123' },
      { label: 'Weights', value: '1.5' },
    ]);
  });
  it('field lookup-array → text', () => {
    expect(pickLarkFields({ 'CX-FF Status (look up)': [{ text: 'OK' }] }, ['CX-FF Status (look up)']))
      .toEqual([{ label: 'CX-FF Status (look up)', value: 'OK' }]);
  });
  it('danh sách curated có 12 field', () => {
    expect(LARK_DETAIL_FIELDS.length).toBe(12);
    expect(LARK_DETAIL_FIELDS).toContain('Final | Delivery Status');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run features/lark/detail.test.ts`
Expected: FAIL — `pickLarkFields`/`LARK_DETAIL_FIELDS` chưa export.

- [ ] **Step 3: Implement (thêm vào detail.ts)**

Thêm vào `features/lark/detail.ts` (sau `flattenLarkRecord`):

```ts
/** Field Lark "cần thiết" hiển thị trong modal chi tiết (thứ tự = thứ tự hiện). */
export const LARK_DETAIL_FIELDS: string[] = [
  'LOG-EP-Dispatch Status',
  'Sub-Status',
  'CX-FF Status (look up)',
  'Final | Delivery Status',
  'Ngày giao dự kiến',
  'Ngày giao thực tế',
  'Couriers',
  'Tracking Number',
  'Weights',
  'Dimension ( điền tay)',
  'LOG-Order Remark (Full)',
  'CX/Khách note on order (look up)',
];

/** Lấy các field theo `names` (giữ thứ tự), bỏ field rỗng/thiếu. THUẦN. */
export function pickLarkFields(
  fields: Record<string, unknown>,
  names: string[],
): Array<{ label: string; value: string }> {
  const out: Array<{ label: string; value: string }> = [];
  for (const name of names) {
    const value = larkText(fields[name]);
    if (value) out.push({ label: name, value });
  }
  return out;
}

/** Raw fields của record Lark ĐẦU TIÊN khớp đơn. Best-effort → {}. */
export async function getLarkRawFieldsForOrder(orderId: string): Promise<Record<string, unknown>> {
  try {
    const [ord] = await db
      .select({ orderNumber: schema.shopifyOrders.shopifyOrderNumber })
      .from(schema.shopifyOrders)
      .where(eq(schema.shopifyOrders.id, orderId))
      .limit(1);
    if (!ord?.orderNumber) return {};
    const records = await searchRecordsByOrderNumber(ord.orderNumber);
    return records[0]?.fields ?? {};
  } catch (e) {
    console.error(`[lark] getLarkRawFieldsForOrder ${orderId} lỗi:`, e);
    return {};
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run features/lark/detail.test.ts`
Expected: PASS (case cũ + 3 mới).

- [ ] **Step 5: tsc + commit**

Run: `npx tsc --noEmit` → no output.

```bash
git add features/lark/detail.ts features/lark/detail.test.ts
git commit -m "feat(ops): pickLarkFields + LARK_DETAIL_FIELDS + getLarkRawFieldsForOrder"
```

---

### Task 2: Server action `getOrderDetailModal`

**Files:**
- Create: `features/fulfillment/order-modal.ts`

**Interfaces:**
- Consumes: `getFulfillmentDetail` (queries), `listPacksForOrder` (packing/queries), `getLarkRawFieldsForOrder`/`pickLarkFields`/`LARK_DETAIL_FIELDS` (Task 1), auth helpers.
- Produces: `getOrderDetailModal(orderId: string): Promise<OrderModalData>` (server action).

- [ ] **Step 1: Implement**

Create `features/fulfillment/order-modal.ts`:

```ts
'use server';

import { eq } from 'drizzle-orm';
import { headers } from 'next/headers';
import { db, schema } from '@/db/client';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { getFulfillmentDetail } from './queries';
import { listPacksForOrder } from '@/features/packing/queries';
import { getLarkRawFieldsForOrder, pickLarkFields, LARK_DETAIL_FIELDS } from '@/features/lark/detail';

export interface OrderModalData {
  summary: {
    orderNumber: string | null;
    storeName: string | null;
    createdAtShopify: string | null;
    status: string;
    address: { line: string | null; deliverable: boolean | null; verifiedAt: string | null } | null;
    lines: Array<{ sku: string | null; qty: number; status: string; productTitle: string | null }>;
    packs: Array<{ code: string | null; carrierKey: string | null; trackingNumber: string | null; deliveryStatus: string | null; deliveredAt: string | null; weightKg: string | null }>;
  } | null;
  larkFields: Array<{ label: string; value: string }>;
}

export async function getOrderDetailModal(orderId: string): Promise<OrderModalData> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { summary: null, larkFields: [] };
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_fulfillment')) return { summary: null, larkFields: [] };

  const detail = await getFulfillmentDetail(orderId);
  if (!detail) return { summary: null, larkFields: [] };

  const [ord] = await db
    .select({
      orderNumber: schema.shopifyOrders.shopifyOrderNumber,
      storeName: schema.stores.name,
      createdAtShopify: schema.shopifyOrders.createdAtShopify,
    })
    .from(schema.shopifyOrders)
    .leftJoin(schema.stores, eq(schema.stores.id, schema.shopifyOrders.storeId))
    .where(eq(schema.shopifyOrders.id, orderId))
    .limit(1);

  const a = detail.address;
  const address = a
    ? {
        line: [a.name, a.line1, a.line2, a.city, a.province, a.country].filter(Boolean).join(', ') || null,
        deliverable: a.addrDeliverable,
        verifiedAt: a.addrVerifiedAt ? a.addrVerifiedAt.toISOString() : null,
      }
    : null;

  const packsRaw = await listPacksForOrder(orderId);
  const packs = packsRaw.map((p) => ({
    code: p.code,
    carrierKey: p.carrierKey,
    trackingNumber: p.trackingNumber,
    deliveryStatus: p.deliveryStatus,
    deliveredAt: p.deliveredAt ? (p.deliveredAt as Date).toISOString() : null,
    weightKg: p.actualWeightKg,
  }));

  const rawFields = await getLarkRawFieldsForOrder(orderId);

  return {
    summary: {
      orderNumber: ord?.orderNumber ?? null,
      storeName: ord?.storeName ?? null,
      createdAtShopify: ord?.createdAtShopify ? ord.createdAtShopify.toISOString() : null,
      status: detail.fulfillment.status,
      address,
      lines: detail.lines.map((l) => ({ sku: l.sku, qty: l.qty, status: l.status, productTitle: l.productTitle ?? null })),
      packs,
    },
    larkFields: pickLarkFields(rawFields, LARK_DETAIL_FIELDS),
  };
}
```

> `detail.lines` (từ getFulfillmentDetail) đã có `sku`, `qty`, `status`, `productTitle`. `detail.fulfillment.status` là pipeline status. Nếu tên field khác, dùng đúng tên thực tế của `getFulfillmentDetail` return (lines/address/fulfillment).

- [ ] **Step 2: Verify tsc**

Run: `npx tsc --noEmit` → no output.

- [ ] **Step 3: Commit**

```bash
git add features/fulfillment/order-modal.ts
git commit -m "feat(ops): server action getOrderDetailModal (summary + Lark curated)"
```

---

### Task 3: OrderDetailDialog + WorklistTable (sticky + click→modal) + LarkDetailCard fix

**Files:**
- Create: `components/fulfillment/OrderDetailDialog.tsx`
- Modify: `components/fulfillment/WorklistTable.tsx`
- Modify: `components/fulfillment/LarkDetailCard.tsx`

**Interfaces:**
- Consumes: `getOrderDetailModal`/`OrderModalData` (Task 2); `Dialog`/`DialogContent`/`DialogHeader`/`DialogTitle` (`@/components/ui/dialog`); `formatTrackingStatus` (`@/features/fulfillment/worklist-status`) cho chip giao (optional).
- Produces: `<OrderDetailDialog orderId={string|null} onClose={() => void} />`.

- [ ] **Step 1: Tạo OrderDetailDialog.tsx**

Create `components/fulfillment/OrderDetailDialog.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { getOrderDetailModal, type OrderModalData } from '@/features/fulfillment/order-modal';

function fmtDate(iso: string | null): string {
  if (!iso || iso.length < 10) return '—';
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

export function OrderDetailDialog({ orderId, onClose }: { orderId: string | null; onClose: () => void }) {
  const [data, setData] = useState<OrderModalData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!orderId) { setData(null); return; }
    let active = true;
    setLoading(true);
    getOrderDetailModal(orderId)
      .then((d) => { if (active) setData(d); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [orderId]);

  const s = data?.summary;
  return (
    <Dialog open={orderId != null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {s ? `${s.orderNumber ?? orderId}` : 'Chi tiết đơn'}
            {s?.storeName ? <span className="ml-2 text-sm font-normal text-muted-foreground">{s.storeName}</span> : null}
          </DialogTitle>
        </DialogHeader>

        {loading && <p className="text-sm text-muted-foreground">Đang tải…</p>}
        {!loading && !s && <p className="text-sm text-muted-foreground">Không tìm thấy đơn.</p>}

        {s && (
          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
              <span>Ngày: {fmtDate(s.createdAtShopify)}</span>
              <span>Tình trạng: {s.status}</span>
            </div>

            {s.address && (
              <div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground">Địa chỉ</div>
                <div>{s.address.line ?? '—'}</div>
                {s.address.verifiedAt && (
                  <span className={`mt-1 inline-block rounded px-2 py-0.5 text-xs font-medium ${s.address.deliverable === false ? 'bg-red-500/15 text-red-700 dark:text-red-400' : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'}`}>
                    {s.address.deliverable === false ? '⚠ Không giao được' : '✓ Giao được'}
                  </span>
                )}
              </div>
            )}

            {s.lines.length > 0 && (
              <div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground">Sản phẩm</div>
                <table className="w-full">
                  <tbody>
                    {s.lines.map((l, i) => (
                      <tr key={i} className="border-t border-border/50">
                        <td className="py-1 pr-2 font-mono text-xs">{l.sku ?? '—'}</td>
                        <td className="py-1 pr-2">{l.productTitle ?? '—'}</td>
                        <td className="py-1 pr-2 text-right">×{l.qty}</td>
                        <td className="py-1 text-right text-xs text-muted-foreground">{l.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {s.packs.length > 0 && (
              <div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground">Kiện / Vận chuyển</div>
                {s.packs.map((p, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-2 border-t border-border/50 py-1">
                    <span className="text-xs">{p.code ?? '—'}</span>
                    {p.carrierKey && <span className="text-xs text-muted-foreground">{p.carrierKey}</span>}
                    {p.trackingNumber && <span className="font-mono text-xs">{p.trackingNumber}</span>}
                    {p.deliveryStatus === 'delivered' && <span className="text-xs text-emerald-600 dark:text-emerald-400">Đã giao{p.deliveredAt ? ` · ${fmtDate(p.deliveredAt).slice(0, 5)}` : ''}</span>}
                    {p.weightKg && <span className="text-xs text-muted-foreground">{p.weightKg}kg</span>}
                  </div>
                ))}
              </div>
            )}

            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Lark (vận hành)</div>
              {data!.larkFields.length === 0 ? (
                <p className="text-muted-foreground">Không có dữ liệu Lark.</p>
              ) : (
                <dl className="divide-y divide-border/50">
                  {data!.larkFields.map((f) => (
                    <div key={f.label} className="flex gap-3 py-1">
                      <dt className="w-2/5 shrink-0 text-muted-foreground">{f.label}</dt>
                      <dd className="flex-1 break-words">{f.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: WorklistTable — sticky header + row click → modal**

Trong `components/fulfillment/WorklistTable.tsx`:
- Thêm import:
```ts
import { OrderDetailDialog } from './OrderDetailDialog';
```
- Bỏ `useRouter` (không còn nav row): xoá dòng `import { useRouter } from 'next/navigation';` và `const router = useRouter();`. (Nếu `router` còn dùng chỗ khác thì giữ; kiểm tra — hiện chỉ dùng cho row click.)
- Thêm state cạnh `statusFilter`:
```ts
  const [openOrderId, setOpenOrderId] = useState<string | null>(null);
```
- `thead`: thêm `sticky top-0 z-10` + nền. Đổi:
```tsx
          <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
```
thành:
```tsx
          <thead className="sticky top-0 z-10 bg-background text-xs uppercase tracking-wider text-muted-foreground">
```
- Row handlers: đổi `onClick={() => router.push(...)}` → `onClick={() => setOpenOrderId(row.orderId)}`; trong `onKeyDown`, đổi `router.push(...)` → `setOpenOrderId(row.orderId)`.
- Cuối component (trước `</div>` bao ngoài cùng của return), thêm:
```tsx
      <OrderDetailDialog orderId={openOrderId} onClose={() => setOpenOrderId(null)} />
```
- Giữ nguyên link số đơn `<a href={/f/fulfillment/${row.orderId}} onClick={stopPropagation}>` (deep-link).

- [ ] **Step 3: LarkDetailCard — bỏ bg-white (page fallback)**

Trong `components/fulfillment/LarkDetailCard.tsx`, đổi `className` khối ngoài cùng từ `bg-white` (và border sáng) sang token theme. Cụ thể đổi:
```tsx
    <section className="rounded-lg border border-gray-200 bg-white p-4">
```
thành:
```tsx
    <section className="rounded-lg border border-border bg-card p-4">
```
và các `text-gray-*`/`border-gray-*`/`bg-gray-*` trong card → token theme tương ứng (`text-muted-foreground`, `border-border`, `bg-muted/40`). Giữ cấu trúc/logic.

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: tsc no output; vitest toàn bộ pass; build xanh.

- [ ] **Step 5: Commit**

```bash
git add components/fulfillment/OrderDetailDialog.tsx components/fulfillment/WorklistTable.tsx components/fulfillment/LarkDetailCard.tsx
git commit -m "feat(ops): sticky header + modal chi tiết đơn (click row), bỏ tờ giấy trắng"
```

---

## Self-Review

**Spec coverage:**
- §1 sticky + dialog + giữ page → Task 3. §2 luồng → Task 2+3. §3.1 pickLarkFields/curated/raw → Task 1. §3.2 server action → Task 2. §3.3 OrderDetailDialog → Task 3. §3.4 WorklistTable sticky+click → Task 3. §3.5 LarkDetailCard bg fix → Task 3. §4 guard (Lark []→"không có", đơn null→"không tìm thấy", auth) → Task 1 (best-effort) + Task 2 (auth/null) + Task 3 (render trống). §5 test thuần → Task 1. Đủ.

**Type consistency:**
- `OrderModalData` (Task 2) = `OrderDetailDialog` props consume (Task 3). ✔
- `pickLarkFields`/`LARK_DETAIL_FIELDS`/`getLarkRawFieldsForOrder` (Task 1) = dùng trong action (Task 2). ✔
- `OrderDetailDialog` props `{orderId, onClose}` (Task 3 component) = WorklistTable render (Task 3 table). ✔
- `larkFields: Array<{label,value}>` xuyên suốt. ✔

**Placeholder scan:** không TBD/TODO; mọi step có code/command. ✔
