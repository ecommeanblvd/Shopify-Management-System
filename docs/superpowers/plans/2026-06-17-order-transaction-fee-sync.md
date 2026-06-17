# Order Transaction Fee Sync Implementation Plan (Plan B)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Sync phí transaction (payment processing + FX fee) thực từ Shopify cho mỗi đơn, quy về đồng đơn (order currency) bằng tỉ lệ suy từ chính fee, rồi nạp vào P&L (thay `transactionFeeVnd: null`).

**Architecture:** Hàm thuần `derive-txn-fee.ts` chuyển mảng `transactions` Shopify → phí theo đồng đơn (+ native để đối chiếu). Thêm field vào GraphQL order query + mapper + cột `shopify_orders.transaction_fee*`. Backfill đơn cũ bằng script fetch per-order. `getOrderDetail` đọc `order.transactionFee` → quy VND qua `toVnd` sẵn có.

**Tech Stack:** Next.js, TypeScript, Drizzle, Shopify Admin GraphQL 2025-01, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-17-order-detail-pnl-panel-design.md` §4 (transaction fee). Builds on Plan A (`feat/order-pnl-panel` branch).

**Probe findings (real data, store meanblvd):** fees trả về theo payout currency (USD/SGD/SAR/EUR tuỳ đơn); mỗi fee có `{ amount{amount currencyCode}, rate, type ('processing_fee'|'foreign_exchange_fee'), flatFee{amount} }`. Đơn có thể có nhiều transaction (AUTHORIZATION không phí + CAPTURE có phí; SALE FAILURE + SALE SUCCESS) → chỉ tính `status='SUCCESS'` & `kind ∈ {SALE,CAPTURE}`. Vài đơn `fees: none`.

---

## File Structure
- **Create** `features/shopify-orders/derive-txn-fee.ts` (+ test): hàm thuần.
- **Modify** `db/schema.ts` + migration: cột `transaction_fee`, `transaction_fee_native`, `transaction_fee_native_currency`.
- **Modify** `features/shopify-orders/sync/order-fields.ts`: thêm `transactions{...}` vào `ORDER_NODE_FIELDS`.
- **Modify** `features/shopify-types.ts`: type `ShopifyTransaction`/fee + thêm vào `ShopifyOrderPayload`.
- **Modify** `features/shopify-orders/sync/shopify-mapper.ts`: gọi `deriveTxnFee`, set 3 field.
- **Create** `scripts/backfill-transaction-fees.ts`: backfill đơn cũ (fetch per-order).
- **Modify** `features/shopify-orders/order-actions.ts`: `transactionFeeVnd` từ `order.transactionFee` (thay null).

---

## Task 1: Pure derive-txn-fee module

**Files:** Create `features/shopify-orders/derive-txn-fee.ts` + `features/shopify-orders/derive-txn-fee.test.ts`

Thuật toán: lọc tx `status==='SUCCESS' && (kind==='SALE'||kind==='CAPTURE')`. Mỗi tx có `fees[]` cùng một currency. Với mỗi tx có fees: tìm `processing_fee` rate>0 → `settlement = (amount − flatFee)/rate`; `txRate = Σfees / settlement`; `feeOrderCcy += sale × txRate` (sale = `amountSet.shopMoney.amount`, đồng đơn). Nếu không có processing_fee dùng được NHƯNG fee currency === order currency → cộng thẳng `Σfees`. Không tx nào có fee → trả null hết.

- [ ] **Step 1: Write the failing test** — `features/shopify-orders/derive-txn-fee.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { deriveTxnFee, type ShopifyTxn } from './derive-txn-fee';

const tx = (o: Partial<ShopifyTxn> & { fees?: ShopifyTxn['fees'] }): ShopifyTxn => ({
  kind: 'SALE', status: 'SUCCESS',
  amountSet: { shopMoney: { amount: '100', currencyCode: 'USD' } },
  fees: [], ...o,
});
const fee = (amount: string, currencyCode: string, rate: string, type: string, flat = '0') =>
  ({ amount: { amount, currencyCode }, rate, type, flatFee: { amount: flat } });

describe('deriveTxnFee', () => {
  it('phí cùng đồng đơn (USD): cộng thẳng tổng phí', () => {
    const r = deriveTxnFee([tx({
      amountSet: { shopMoney: { amount: '370.80', currencyCode: 'USD' } },
      fees: [fee('8.64', 'USD', '0.0225', 'processing_fee', '0.3')],
    })], 'USD');
    expect(r.feeOrderCcy).toBeCloseTo(8.64, 1);
    expect(r.feeNative).toBeCloseTo(8.64, 2);
    expect(r.feeNativeCurrency).toBe('USD');
  });

  it('phí ngoại tệ (SGD) → quy về USD qua feeRate suy từ processing_fee', () => {
    // settlement = (10.33−0.38)/0.0325 = 306.15 SGD; feeRate = 14.85/306.15 = 0.0485
    // feeUSD = 238.74 × 0.0485 ≈ 11.58
    const r = deriveTxnFee([tx({
      amountSet: { shopMoney: { amount: '238.74', currencyCode: 'USD' } },
      fees: [fee('10.33', 'SGD', '0.0325', 'processing_fee', '0.38'), fee('4.52', 'SGD', '0.015', 'foreign_exchange_fee')],
    })], 'USD');
    expect(r.feeOrderCcy).toBeGreaterThan(11.0);
    expect(r.feeOrderCcy).toBeLessThan(12.2);
    expect(r.feeNative).toBeCloseTo(14.85, 2);
    expect(r.feeNativeCurrency).toBe('SGD');
  });

  it('bỏ qua transaction FAILURE / AUTHORIZATION không phí', () => {
    const r = deriveTxnFee([
      tx({ kind: 'AUTHORIZATION', status: 'SUCCESS', fees: [] }),
      tx({ kind: 'SALE', status: 'FAILURE', fees: [fee('99', 'USD', '0.0225', 'processing_fee', '0.3')] }),
      tx({ kind: 'CAPTURE', status: 'SUCCESS',
           amountSet: { shopMoney: { amount: '237.80', currencyCode: 'USD' } },
           fees: [fee('5.65', 'USD', '0.0225', 'processing_fee', '0.3')] }),
    ], 'USD');
    expect(r.feeNative).toBeCloseTo(5.65, 2); // chỉ CAPTURE/SUCCESS
  });

  it('đơn không có phí → null hết', () => {
    const r = deriveTxnFee([tx({ fees: [] })], 'USD');
    expect(r.feeOrderCcy).toBeNull();
    expect(r.feeNative).toBeNull();
    expect(r.feeNativeCurrency).toBeNull();
  });

  it('mảng rỗng → null', () => {
    const r = deriveTxnFee([], 'USD');
    expect(r.feeOrderCcy).toBeNull();
  });
});
```

- [ ] **Step 2: Run `npx vitest run features/shopify-orders/derive-txn-fee.test.ts` → FAIL (module not found).**

- [ ] **Step 3: Create `features/shopify-orders/derive-txn-fee.ts`:**

```typescript
/**
 * Suy phí transaction (theo đồng ĐƠN) từ mảng transactions Shopify. THUẦN.
 * Phí Shopify trả theo payout currency (có thể ≠ đồng đơn) → dùng tỉ lệ
 * feeRate = Σfees / settlement (cùng đồng phí, không thứ nguyên) rồi nhân với
 * sale (đồng đơn) để quy về đồng đơn — sidestep việc đổi chéo tiền tệ.
 */
export interface ShopifyFee {
  amount: { amount: string; currencyCode: string };
  rate: string | null;
  type: string;
  flatFee?: { amount: string } | null;
}
export interface ShopifyTxn {
  kind: string;   // SALE | CAPTURE | AUTHORIZATION | REFUND | ...
  status: string; // SUCCESS | FAILURE | ...
  amountSet: { shopMoney: { amount: string; currencyCode: string } };
  fees: ShopifyFee[];
}

export interface DerivedTxnFee {
  /** Tổng phí quy về đồng đơn (order currency). null khi không suy được. */
  feeOrderCcy: number | null;
  /** Tổng phí ở đồng gốc (payout currency) — để đối chiếu. */
  feeNative: number | null;
  feeNativeCurrency: string | null;
}

const n = (s: string | null | undefined) => (s == null ? 0 : Number(s));
const r2 = (x: number) => Math.round(x * 100) / 100;

export function deriveTxnFee(transactions: ShopifyTxn[], orderCurrency: string): DerivedTxnFee {
  const relevant = (transactions ?? []).filter(
    (t) => t.status === 'SUCCESS' && (t.kind === 'SALE' || t.kind === 'CAPTURE'),
  );
  let feeOrderCcy = 0;
  let feeNative = 0;
  let nativeCcy: string | null = null;
  let any = false;

  for (const t of relevant) {
    const fees = t.fees ?? [];
    if (fees.length === 0) continue;
    any = true;
    const ccy = fees[0].amount.currencyCode;
    nativeCcy = nativeCcy ?? ccy;
    const totalFee = fees.reduce((s, f) => s + n(f.amount.amount), 0);
    feeNative += totalFee;

    const sale = n(t.amountSet?.shopMoney?.amount);
    const proc = fees.find((f) => f.type === 'processing_fee' && n(f.rate) > 0);
    if (proc) {
      const settlement = (n(proc.amount.amount) - n(proc.flatFee?.amount)) / n(proc.rate);
      if (settlement > 0) feeOrderCcy += sale * (totalFee / settlement);
    } else if (ccy === orderCurrency) {
      feeOrderCcy += totalFee; // cùng đồng → cộng thẳng
    }
    // else: không suy được tx này → bỏ qua phần đồng-đơn (vẫn tính vào native)
  }

  if (!any) return { feeOrderCcy: null, feeNative: null, feeNativeCurrency: null };
  return { feeOrderCcy: r2(feeOrderCcy), feeNative: r2(feeNative), feeNativeCurrency: nativeCcy };
}
```

- [ ] **Step 4: Run test → 5 pass.**
- [ ] **Step 5: Commit** `git add features/shopify-orders/derive-txn-fee.ts features/shopify-orders/derive-txn-fee.test.ts && git commit -m "feat(orders): hàm thuần suy phí transaction Shopify về đồng đơn"`

---

## Task 2: Schema + migration

**Files:** Modify `db/schema.ts`; Create `db/migrations/0064_order-transaction-fee.sql` + journal entry.

- [ ] **Step 1: Add columns to `shopifyOrders` in `db/schema.ts`** (gần `totalPrice`):

```typescript
  /** Phí transaction (payment processing + FX) quy về đồng ĐƠN. null khi chưa sync / Shopify không trả fee. */
  transactionFee: numeric('transaction_fee', { precision: 14, scale: 2 }),
  /** Phí ở đồng gốc payout (SGD/SAR/EUR…) để đối chiếu. */
  transactionFeeNative: numeric('transaction_fee_native', { precision: 14, scale: 2 }),
  transactionFeeNativeCurrency: text('transaction_fee_native_currency'),
```

- [ ] **Step 2: Create migration `db/migrations/0064_order-transaction-fee.sql`:**

```sql
ALTER TABLE "shopify_orders" ADD COLUMN IF NOT EXISTS "transaction_fee" numeric(14, 2);
ALTER TABLE "shopify_orders" ADD COLUMN IF NOT EXISTS "transaction_fee_native" numeric(14, 2);
ALTER TABLE "shopify_orders" ADD COLUMN IF NOT EXISTS "transaction_fee_native_currency" text;
```

- [ ] **Step 3: Append journal entry** — edit `db/migrations/meta/_journal.json`, append to `entries` (copy the last entry's `when` + 86400000):
```json
{ "idx": 64, "version": "7", "when": <last.when + 86400000>, "tag": "0064_order-transaction-fee", "breakpoints": true }
```

- [ ] **Step 4: Apply** `npx dotenv -- drizzle-kit migrate` → "migrations applied successfully". Verify: `npx tsc --noEmit 2>&1 | grep -i schema` empty.

- [ ] **Step 5: Commit** `git add db/schema.ts db/migrations/0064_order-transaction-fee.sql db/migrations/meta/_journal.json && git commit -m "feat(orders): cột transaction_fee (+native) trên shopify_orders"`

---

## Task 3: GraphQL field + types + mapper

**Files:** Modify `features/shopify-orders/sync/order-fields.ts`, `features/shopify-types.ts`, `features/shopify-orders/sync/shopify-mapper.ts`.

- [ ] **Step 1: Add transactions to `ORDER_NODE_FIELDS`** (`features/shopify-orders/sync/order-fields.ts`) — append inside the field block:

```graphql
    transactions(first: 20) {
      kind
      status
      amountSet { shopMoney { amount currencyCode } }
      fees { amount { amount currencyCode } rate type flatFee { amount } }
    }
```

- [ ] **Step 2: Types in `features/shopify-types.ts`** — add and wire into `ShopifyOrderPayload`:

```typescript
export interface ShopifyTxnFee { amount: ShopifyMoney; rate: string | null; type: string; flatFee?: { amount: string } | null }
export interface ShopifyTxn { kind: string; status: string; amountSet: { shopMoney: ShopifyMoney }; fees: ShopifyTxnFee[] }
```
Add `transactions?: ShopifyTxn[];` to `ShopifyOrderPayload`.
(Note: `ShopifyMoney` = `{ amount: string; currencyCode: string }` — already defined. The `fees[].amount` shape matches `ShopifyMoney`; `deriveTxnFee`'s `ShopifyFee` is structurally compatible.)

- [ ] **Step 3: Mapper** (`features/shopify-orders/sync/shopify-mapper.ts`, in `mapShopifyOrder`) — import + compute + add to returned order object:

```typescript
import { deriveTxnFee } from '../derive-txn-fee';
// ... where the order fields are built:
const txnFee = deriveTxnFee((payload.transactions ?? []) as never, payload.currencyCode);
// add to the returned order mapping:
  transactionFee: txnFee.feeOrderCcy !== null ? String(txnFee.feeOrderCcy) : null,
  transactionFeeNative: txnFee.feeNative !== null ? String(txnFee.feeNative) : null,
  transactionFeeNativeCurrency: txnFee.feeNativeCurrency,
```
(Read the mapper to find the exact returned-object shape + how `currencyCode` is named on the payload — adapt names. The upsert in `upsert-order.ts` writes the whole mapped order, so no change needed there IF the column names match schema; verify the upsert's `onConflictDoUpdate` set-list includes new fields — if it lists fields explicitly, add the 3 there too.)

- [ ] **Step 4: Verify** `npx tsc --noEmit 2>&1 | grep -iE "mapper|order-fields|shopify-types"` empty. Run `npx vitest run features/shopify-orders` → pass (update any mapper snapshot test that asserts the full mapped object by adding the 3 new fields = null for fixtures without transactions).

- [ ] **Step 5: Commit** `git add features/shopify-orders/sync/order-fields.ts features/shopify-types.ts features/shopify-orders/sync/shopify-mapper.ts && git commit -m "feat(orders): sync transactions → transaction_fee khi map đơn Shopify"`

---

## Task 4: Wire transactionFee vào getOrderDetail (P&L)

**Files:** Modify `features/shopify-orders/order-actions.ts`.

- [ ] **Step 1: Thay `transactionFeeVnd: null`** trong khối P&L của `getOrderDetail`:

```typescript
const transactionFeeVnd = order.transactionFee != null ? toVnd(Number(order.transactionFee)) : null;
// ... trong computeOrderPnl({...}):
      transactionFeeVnd,
```
(`toVnd` quy đồng-đơn→VND đã có. `order.transactionFee` là đồng đơn. Khi null → `transactionFeeVnd` null → panel hiện "chưa có phí GD" như cũ.)

- [ ] **Step 2: (tuỳ chọn) thêm `transactionFeeNative`/currency vào OrderDetail** nếu muốn panel hiện tham chiếu native — KHÔNG bắt buộc cho v1; bỏ qua nếu không cần.

- [ ] **Step 3: Verify** `npx tsc --noEmit 2>&1 | grep -i order-actions` empty; `npx vitest run features/shopify-orders` pass.

- [ ] **Step 4: Commit** `git add features/shopify-orders/order-actions.ts && git commit -m "feat(orders): nạp transaction fee thực vào P&L (thay placeholder null)"`

---

## Task 5: Backfill script cho đơn cũ

**Files:** Create `scripts/backfill-transaction-fees.ts`.

Cách an toàn nhất: page qua `shopify_orders` theo store, fetch transactions per-order bằng `graphqlCall` (query nhỏ chỉ lấy transactions), `deriveTxnFee`, update 3 cột. Throttle ~500ms/đơn (giống các script khác). Hỗ trợ `--dry` và `--store <domain>`.

- [ ] **Step 1: Create `scripts/backfill-transaction-fees.ts`:**

```typescript
/**
 * Backfill transaction_fee cho đơn Shopify đã sync trước khi có cột này.
 * Fetch transactions per-order từ Shopify → deriveTxnFee → update 3 cột.
 * Chạy: npx dotenv -- tsx scripts/backfill-transaction-fees.ts [--dry] [--store <domain>]
 */
import { and, eq, isNull } from 'drizzle-orm';
import { db, schema } from '../db/client';
import { getStoreToken, graphqlCall } from '../lib/shopify/client';
import { deriveTxnFee, type ShopifyTxn } from '../features/shopify-orders/derive-txn-fee';

const DRY = process.argv.includes('--dry');
const storeArg = (() => { const i = process.argv.indexOf('--store'); return i >= 0 ? process.argv[i + 1] : null; })();
const API = process.env.SHOPIFY_API_VERSION ?? '2025-01';
const Q = `query($id: ID!){ order(id:$id){ currencyCode transactions(first:20){ kind status amountSet{ shopMoney{ amount currencyCode } } fees{ amount{ amount currencyCode } rate type flatFee{ amount } } } } }`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const stores = await db.select().from(schema.stores);
  let updated = 0, skipped = 0, noFee = 0;
  for (const store of stores) {
    if (storeArg && store.shopDomain !== storeArg) continue;
    const token = await getStoreToken(store.id);
    const orders = await db
      .select({ id: schema.shopifyOrders.id, gid: schema.shopifyOrders.shopifyOrderId, cur: schema.shopifyOrders.currency })
      .from(schema.shopifyOrders)
      .where(and(eq(schema.shopifyOrders.storeId, store.id), isNull(schema.shopifyOrders.transactionFee)));
    console.log(`${store.shopDomain}: ${orders.length} đơn cần backfill`);
    for (const o of orders) {
      let res;
      try { res = await graphqlCall({ shopDomain: store.shopDomain, apiVersion: API, token, query: Q, variables: { id: o.gid } }); }
      catch { skipped++; continue; }
      const ord = (res.data as { order?: { currencyCode: string; transactions: ShopifyTxn[] } } | null)?.order;
      if (!ord) { skipped++; continue; }
      const f = deriveTxnFee(ord.transactions ?? [], ord.currencyCode ?? o.cur);
      if (f.feeOrderCcy === null) { noFee++; await sleep(500); continue; }
      if (!DRY) {
        await db.update(schema.shopifyOrders).set({
          transactionFee: String(f.feeOrderCcy),
          transactionFeeNative: f.feeNative !== null ? String(f.feeNative) : null,
          transactionFeeNativeCurrency: f.feeNativeCurrency,
        }).where(eq(schema.shopifyOrders.id, o.id));
      }
      updated++;
      await sleep(500);
    }
  }
  console.log(`\n${DRY ? '[DRY] ' : ''}Xong: updated=${updated} noFee=${noFee} skipped=${skipped}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Dry-run 1 store** `npx dotenv -- tsx scripts/backfill-transaction-fees.ts --dry --store meanblvd.myshopify.com` → in ra số đơn + updated/noFee, không lỗi.

- [ ] **Step 3: Commit** `git add scripts/backfill-transaction-fees.ts && git commit -m "chore(orders): script backfill transaction fee cho đơn cũ"`

> Backfill THẬT (bỏ `--dry`) chạy ngoài plan, sau khi merge — vì gọi Shopify per-order tốn thời gian (~500ms/đơn). Có thể chạy theo store.

---

## Self-Review
- Spec §4 (sync thực, lưu native, quy đổi) ↔ Task 1 (derive) + Task 2 (cột native) + Task 4 (VND) ✓
- Đa tiền tệ + multi-tx + SUCCESS-only + no-fee ↔ Task 1 tests ✓
- New orders auto có fee (Task 3) + đơn cũ backfill (Task 5) ✓
- Panel đã có sẵn (Plan A) hiện "chưa có phí GD" khi null → tự hiển thị số khi có ✓
