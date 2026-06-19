# SMS → MMP Orders Push — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Khi đơn có dòng brand (out_of_stock), SMS đẩy bản ghi đơn (tối giản PII) sang MMP `POST /api/integration/orders` bằng body-only HMAC, để admin orders của MMP có dữ liệu.

**Architecture:** Thêm hàm ký body-only `signMmpBody`, builder payload thuần `buildMmpOrderPayload`, sender `sendOrderToMmp` (load đơn + dòng brand, gate config + "có dòng brand", POST). Hook vào `checkStockForOrder` cạnh `sendPendingBrandRequests`. Backfill cho đơn tồn.

**Tech Stack:** TypeScript, Next.js server actions, Drizzle, Node crypto HMAC, Vitest.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-06-19-sms-mmp-orders-push-design.md`.
- **PII tối giản:** payload CHỈ gồm `orderNumber`, `store`, `recipientName` (shipName), `shipCountry`, và `lines[{sku,title,qty}]` (dòng brand). KHÔNG email/SĐT/địa chỉ chi tiết/giá.
- **Phạm vi:** chỉ đẩy khi đơn có ≥1 dòng brand. Dòng brand = `order_fulfillment_lines.status ∈ {out_of_stock, brand_requested, brand_confirmed, brand_rejected}`.
- **HMAC body-only:** `x-mean-signature: sha256=<hex>` của `HMAC_SHA256(secret, rawBody)` — KHÔNG timestamp. Khác `signMmpPayload` (timestamped).
- **Config:** URL = `process.env.MMP_ORDERS_URL`; secret = `process.env.MMP_OUTBOUND_SECRET` (cùng giá trị = MEAN_WEBHOOK_SECRET phía MMP). Thiếu URL/secret → `{ ok:false, error:'not configured' }`, không gửi.
- Idempotency: MMP dedupe theo `orderNumber`+`store`.
- Commands: `npx vitest run <path>`, `npx tsc --noEmit`, `npx eslint <files>`, `npm run build`. Commit body kết thúc `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## File Structure
- `features/mmp/hmac.ts` (modify) — thêm `signMmpBody`.
- `features/mmp/order-push-logic.ts` (create) — `buildMmpOrderPayload` thuần + types.
- `features/mmp/order-outbound.ts` (create) — `sendOrderToMmp`.
- `features/fulfillment/actions.ts` (modify) — hook `sendOrderToMmp` trong `checkStockForOrder`.
- `features/mmp/order-backfill.ts` (create) — `backfillMmpOrders` action.
- `.env.example` (modify) + `docs/mmp-outbound-integration.md` (modify) — config + contract.

---

## Task 1: `signMmpBody` (body-only HMAC)

**Files:**
- Modify: `features/mmp/hmac.ts`
- Test: `features/mmp/hmac.test.ts`

**Interfaces:**
- Produces: `export function signMmpBody(secret: string, rawBody: string): string` — trả `'sha256=<hex>'` của `HMAC_SHA256(secret, rawBody)` (KHÔNG timestamp).

- [ ] **Step 1: Write the failing test** — thêm vào `features/mmp/hmac.test.ts`:
```ts
import { signMmpBody } from './hmac';
import crypto from 'node:crypto';

describe('signMmpBody', () => {
  it('ký body-only sha256=<hex>, không timestamp', () => {
    const secret = 'sek'; const body = '{"a":1}';
    const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex');
    expect(signMmpBody(secret, body)).toBe(expected);
  });
  it('khác signMmpPayload (timestamped) cho cùng body', () => {
    expect(signMmpBody('s', '{}')).not.toBe(signMmpPayload('s', 100, '{}'));
  });
});
```
(Bổ sung `signMmpBody` vào dòng import sẵn có từ `./hmac`; `signMmpPayload` đã được import trong file test.)

- [ ] **Step 2: Run test to verify it fails** — `npx vitest run features/mmp/hmac.test.ts` → FAIL (`signMmpBody` chưa có).

- [ ] **Step 3: Implement** — trong `features/mmp/hmac.ts`, sau `signMmpPayload`:
```ts
/** Body-only HMAC cho SMS→MMP orders: sha256=<hex> của HMAC_SHA256(secret, rawBody).
 *  KHÁC signMmpPayload (timestamped) — MMP /api/integration/orders verify scheme này. */
export function signMmpBody(secret: string, rawBody: string): string {
  const sig = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  return `sha256=${sig}`;
}
```

- [ ] **Step 4: Run test to verify it passes** — `npx vitest run features/mmp/hmac.test.ts` → PASS.

- [ ] **Step 5: Commit**
```bash
git add features/mmp/hmac.ts features/mmp/hmac.test.ts
git commit -m "feat(mmp): signMmpBody (body-only HMAC cho orders-push)"
```

---

## Task 2: `buildMmpOrderPayload` (builder thuần)

**Files:**
- Create: `features/mmp/order-push-logic.ts`
- Test: `features/mmp/order-push-logic.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface MmpOrderLine { sku: string | null; title: string; qty: number }
  export interface MmpOrderPayload {
    orderNumber: string; store: string;
    recipientName: string | null; shipCountry: string | null;
    lines: MmpOrderLine[];
  }
  export function buildMmpOrderPayload(input: {
    orderNumber: string; store: string; recipientName: string | null; shipCountry: string | null;
    brandLines: MmpOrderLine[];
  }): MmpOrderPayload
  ```

- [ ] **Step 1: Write the failing test** — `features/mmp/order-push-logic.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { buildMmpOrderPayload } from './order-push-logic';

describe('buildMmpOrderPayload', () => {
  it('chỉ gồm field đã chốt (không PII chi tiết)', () => {
    const p = buildMmpOrderPayload({
      orderNumber: '#MBLVD28899', store: 'meanblvd', recipientName: 'Nguyen A', shipCountry: 'SA',
      brandLines: [{ sku: 'ABC', title: 'Áo', qty: 2 }],
    });
    expect(p).toEqual({
      orderNumber: '#MBLVD28899', store: 'meanblvd', recipientName: 'Nguyen A', shipCountry: 'SA',
      lines: [{ sku: 'ABC', title: 'Áo', qty: 2 }],
    });
    // không lọt key lạ (email/address/price)
    expect(Object.keys(p).sort()).toEqual(['lines','orderNumber','recipientName','shipCountry','store']);
  });
  it('giữ nguyên thứ tự + nhiều dòng brand', () => {
    const p = buildMmpOrderPayload({ orderNumber: 'TA1', store: 'tinhatelier', recipientName: null, shipCountry: 'DE',
      brandLines: [{ sku: 'A', title: 'X', qty: 1 }, { sku: null, title: 'Y', qty: 3 }] });
    expect(p.lines).toEqual([{ sku: 'A', title: 'X', qty: 1 }, { sku: null, title: 'Y', qty: 3 }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `npx vitest run features/mmp/order-push-logic.test.ts` → FAIL (module chưa có).

- [ ] **Step 3: Implement** — `features/mmp/order-push-logic.ts`:
```ts
/** Builder thuần cho payload SMS→MMP orders. CHỈ field đã chốt (PII tối giản):
 *  orderNumber, store, tên người nhận, quốc gia ship, các dòng brand {sku,title,qty}.
 *  KHÔNG email/SĐT/địa chỉ chi tiết/giá. Không I/O. */
export interface MmpOrderLine { sku: string | null; title: string; qty: number }
export interface MmpOrderPayload {
  orderNumber: string; store: string;
  recipientName: string | null; shipCountry: string | null;
  lines: MmpOrderLine[];
}
export function buildMmpOrderPayload(input: {
  orderNumber: string; store: string; recipientName: string | null; shipCountry: string | null;
  brandLines: MmpOrderLine[];
}): MmpOrderPayload {
  return {
    orderNumber: input.orderNumber,
    store: input.store,
    recipientName: input.recipientName,
    shipCountry: input.shipCountry,
    lines: input.brandLines.map((l) => ({ sku: l.sku, title: l.title, qty: l.qty })),
  };
}
```

- [ ] **Step 4: Run test to verify it passes** — `npx vitest run features/mmp/order-push-logic.test.ts` → PASS.

- [ ] **Step 5: Commit**
```bash
git add features/mmp/order-push-logic.ts features/mmp/order-push-logic.test.ts
git commit -m "feat(mmp): buildMmpOrderPayload (payload đơn tối giản PII)"
```

---

## Task 3: `sendOrderToMmp` + hook + config + doc

**Files:**
- Create: `features/mmp/order-outbound.ts`
- Modify: `features/fulfillment/actions.ts` (hook trong `checkStockForOrder`)
- Modify: `.env.example`, `docs/mmp-outbound-integration.md`

**Interfaces:**
- Consumes: `signMmpBody` (T1), `buildMmpOrderPayload`/`MmpOrderLine` (T2), `SendResult` (từ `features/mmp/outbound.ts`).
- Produces: `export async function sendOrderToMmp(orderId: string): Promise<SendResult>`

- [ ] **Step 1: Implement `sendOrderToMmp`** — `features/mmp/order-outbound.ts`:
```ts
import { eq, inArray } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { signMmpBody } from '@/features/mmp/hmac';
import { buildMmpOrderPayload, type MmpOrderLine } from '@/features/mmp/order-push-logic';
import type { SendResult } from '@/features/mmp/outbound';

// Dòng brand (MMP phải sản xuất) — khớp BRAND_STATUSES ở staging-logic.
const BRAND_STATUSES = ['out_of_stock', 'brand_requested', 'brand_confirmed', 'brand_rejected'];

/** Đẩy bản ghi đơn (tối giản PII) sang MMP /api/integration/orders khi đơn có dòng
 *  brand. Gate: chưa cấu hình → 'not configured'; không có dòng brand → 'no brand lines'. */
export async function sendOrderToMmp(orderId: string): Promise<SendResult> {
  const url = process.env.MMP_ORDERS_URL;
  const secret = process.env.MMP_OUTBOUND_SECRET; // cùng giá trị MEAN_WEBHOOK_SECRET
  if (!url || !secret) return { ok: false, error: 'not configured' };

  const [ful] = await db.select({ id: schema.orderFulfillment.id })
    .from(schema.orderFulfillment).where(eq(schema.orderFulfillment.orderId, orderId)).limit(1);
  if (!ful) return { ok: false, error: 'no fulfillment' };

  const fLines = await db.select({ sku: schema.orderFulfillmentLines.sku, qty: schema.orderFulfillmentLines.qty, status: schema.orderFulfillmentLines.status })
    .from(schema.orderFulfillmentLines)
    .where(eq(schema.orderFulfillmentLines.fulfillmentId, ful.id));
  const brand = fLines.filter((l) => BRAND_STATUSES.includes(l.status as string));
  if (brand.length === 0) return { ok: false, error: 'no brand lines' };

  const [ord] = await db.select({
      orderNumber: schema.shopifyOrders.shopifyOrderNumber,
      shipName: schema.shopifyOrders.shipName, shipCountry: schema.shopifyOrders.shipCountry,
      store: schema.stores.name,
    })
    .from(schema.shopifyOrders)
    .innerJoin(schema.stores, eq(schema.stores.id, schema.shopifyOrders.storeId))
    .where(eq(schema.shopifyOrders.id, orderId)).limit(1);
  if (!ord) return { ok: false, error: 'no order' };

  // title theo sku (map từ shopify_order_lines của đơn).
  const oLines = await db.select({ sku: schema.shopifyOrderLines.sku, title: schema.shopifyOrderLines.productTitle })
    .from(schema.shopifyOrderLines).where(eq(schema.shopifyOrderLines.orderId, orderId));
  const titleBySku = new Map<string, string>();
  for (const l of oLines) if (l.sku) titleBySku.set(l.sku, l.title);
  const brandLines: MmpOrderLine[] = brand.map((l) => ({ sku: l.sku, title: (l.sku && titleBySku.get(l.sku)) || l.sku || '', qty: l.qty }));

  const rawBody = JSON.stringify(buildMmpOrderPayload({
    orderNumber: ord.orderNumber, store: ord.store, recipientName: ord.shipName, shipCountry: ord.shipCountry, brandLines,
  }));
  const signature = signMmpBody(secret, rawBody);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-mean-signature': signature },
      body: rawBody, signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { ok: false, error: `http ${res.status}` };
    const data = await res.json().catch(() => ({}));
    return { ok: true, externalRef: typeof data?.externalRef === 'string' ? data.externalRef : undefined };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'fetch failed' };
  }
}
```

- [ ] **Step 2: Hook vào `checkStockForOrder`** — trong `features/fulfillment/actions.ts`, tìm dòng `await sendPendingBrandRequests(orderId);` (cuối `checkStockForOrder`). Thêm import ở đầu file: `import { sendOrderToMmp } from '@/features/mmp/order-outbound';`. Sau dòng `sendPendingBrandRequests`, thêm (nuốt lỗi, không chặn kiểm kho):
```ts
    await sendPendingBrandRequests(orderId);
    try { await sendOrderToMmp(orderId); } catch (e) { console.error(`sendOrderToMmp failed for ${orderId}:`, e); }
```

- [ ] **Step 3: `.env.example`** — dưới khối MMP outbound, thêm:
```
# SMS → MMP orders push (bản ghi đơn cho đơn có hàng brand). Receiver MMP:
# POST /api/integration/orders, body-only HMAC. Secret dùng chung MMP_OUTBOUND_SECRET.
MMP_ORDERS_URL=
```

- [ ] **Step 4: Doc** — thêm mục "Orders push" vào `docs/mmp-outbound-integration.md`: endpoint `/api/integration/orders`, header `x-mean-signature: sha256=<hex>` (body-only, không timestamp), payload `MmpOrderPayload` (orderNumber, store, recipientName, shipCountry, lines[{sku,title,qty}]), response `2xx {externalRef}`, idempotency orderNumber+store, scope "chỉ đơn có dòng brand", PII tối giản.

- [ ] **Step 5: Verify** — `npx tsc --noEmit && npx eslint features/mmp/order-outbound.ts features/fulfillment/actions.ts && npx vitest run features/mmp features/fulfillment && npm run build` → tất cả pass/clean.

- [ ] **Step 6: Commit**
```bash
git add features/mmp/order-outbound.ts features/fulfillment/actions.ts .env.example docs/mmp-outbound-integration.md
git commit -m "feat(mmp): sendOrderToMmp + hook checkStockForOrder + config/doc"
```

---

## Task 4: Backfill action

**Files:**
- Create: `features/mmp/order-backfill.ts`

**Interfaces:**
- Consumes: `sendOrderToMmp` (T3).
- Produces: `export async function backfillMmpOrders(): Promise<{ pushed: number; skipped: number; failed: number }>`

- [ ] **Step 1: Implement** — `features/mmp/order-backfill.ts`:
```ts
'use server';
import { headers } from 'next/headers';
import { inArray } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { sendOrderToMmp } from '@/features/mmp/order-outbound';

const BRAND_STATUSES = ['out_of_stock', 'brand_requested', 'brand_confirmed', 'brand_rejected'];

/** Đẩy lại các đơn ĐÃ có dòng brand sang MMP (tồn đọng). Idempotent (MMP dedupe). */
export async function backfillMmpOrders(): Promise<{ pushed: number; skipped: number; failed: number }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error('unauthenticated');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'manage_fulfillment')) throw new Error('Forbidden');

  // fulfillment có ≥1 dòng brand → orderId distinct.
  const rows = await db.select({ orderId: schema.orderFulfillment.orderId })
    .from(schema.orderFulfillmentLines)
    .innerJoin(schema.orderFulfillment, inArray(schema.orderFulfillmentLines.status, BRAND_STATUSES as never))
    .where(inArray(schema.orderFulfillmentLines.status, BRAND_STATUSES as never));
  // dedupe orderId (join ở trên có thể trùng) — thực ra lấy distinct qua fulfillmentId.
  const orderIds = [...new Set(rows.map((r) => r.orderId))];

  let pushed = 0, skipped = 0, failed = 0;
  for (const oid of orderIds) {
    const r = await sendOrderToMmp(oid);
    if (r.ok) pushed++;
    else if (r.error === 'no brand lines' || r.error === 'not configured') skipped++;
    else failed++;
  }
  return { pushed, skipped, failed };
}
```
> Lưu ý query: lấy distinct `orderId` của các fulfillment có dòng brand. Nếu join trên phức tạp, thay bằng: select `orderFulfillment.orderId` join `orderFulfillmentLines` on `fulfillmentId` where line.status ∈ BRAND_STATUSES, rồi `[...new Set(...)]`. Implementer chỉnh cho đúng cú pháp Drizzle, miễn ra danh sách orderId distinct có dòng brand.

- [ ] **Step 2: Verify** — `npx tsc --noEmit && npx eslint features/mmp/order-backfill.ts` → clean.

- [ ] **Step 3: Commit**
```bash
git add features/mmp/order-backfill.ts
git commit -m "feat(mmp): backfillMmpOrders cho đơn brand tồn đọng"
```

---

## Task 5: Verify toàn bộ + PR

- [ ] **Step 1:** `npx tsc --noEmit && npx vitest run && npm run build` → pass/clean.
- [ ] **Step 2:** Xác nhận brand-request (outbound.ts) KHÔNG bị đụng; chỉ thêm mới.
- [ ] **Step 3: PR**
```bash
git push -u origin feat/sms-mmp-orders-push
gh pr create --base main --head feat/sms-mmp-orders-push --title "feat(mmp): SMS→MMP orders-push (đơn brand, PII tối giản)" --body "Spec docs/superpowers/specs/2026-06-19-sms-mmp-orders-push-design.md. Đẩy bản ghi đơn sang MMP /api/integration/orders khi đơn có dòng brand; body-only HMAC; payload tối giản (orderNumber/store/tên người nhận/quốc gia/sku+title+qty). Hook sau kiểm kho + backfill. Cần ops set MMP_ORDERS_URL.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

---

## Self-Review notes
- **Spec coverage:** signMmpBody (T1), payload tối giản (T2), sender+gate+hook+config+doc (T3), backfill (T4), verify+PR (T5). Đủ.
- **Naming:** `signMmpBody`, `buildMmpOrderPayload`/`MmpOrderPayload`/`MmpOrderLine`, `sendOrderToMmp`, `backfillMmpOrders`, env `MMP_ORDERS_URL`, secret `MMP_OUTBOUND_SECRET` — nhất quán.
- **PII:** chỉ orderNumber/store/recipientName/shipCountry/lines{sku,title,qty}; test T2 chốt không lọt key lạ.
- **Trigger đúng thời điểm:** sau kiểm kho (dòng brand đã biết), không ở upsert-order.
