# Verify địa chỉ FedEx vào luồng vận hành (hệ #1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gắn FedEx Address Validation (đã có lib) vào luồng vận hành: auto-verify đơn mới khi sync + nút "Verify lại" per-đơn.

**Architecture:** Tách lõi verify+lưu dùng chung (`features/shopify-orders/address-verify.ts`) → 3 cửa gọi: server action (nút), cron (auto), batch script (refactor DRY). Tái dùng nguyên `lib/fedex/address.verifyAddress`, schema `addr*`, `AddressVerifyCard`.

**Tech Stack:** Next.js (server action + RSC), Drizzle, Vitest, FedEx Address Validation API (lib có sẵn).

## Global Constraints

- **Tái dùng, KHÔNG đụng**: `lib/fedex/address.ts` (`verifyAddress`, `AddressInput`, `AddressVerification`), schema `shopify_orders.addr*` (`addrClass/addrDeliverable/addrIssue/addrStandardized/addrVerifiedAt`), `components/fulfillment/AddressVerifyCard.tsx`.
- **Rate-limit 300ms** giữa mỗi call FedEx (giữ như script hiện tại).
- **Auto chỉ verify đơn CHƯA verify** (`addrVerifiedAt IS NULL`); nút re-verify bất kể.
- **Gate quyền**: `manage_fulfillment` (pattern `requirePerm` cục bộ trong `features/fulfillment/actions.ts`).
- **Thiếu địa chỉ** (`shipAddress1`/`shipCountry` null) → không gọi API.
- Validate trước push: `npx tsc --noEmit` + `npx vitest run` + `npm run build` xanh.

---

## File Structure
- `features/shopify-orders/address-verify.ts` — MỚI: `buildAddressInput` (thuần), `verifyAndStoreOrderAddress`, `verifyUnverifiedAddresses`.
- `features/shopify-orders/address-verify.test.ts` — MỚI: test `buildAddressInput`.
- `features/fulfillment/actions.ts` — thêm action `verifyOrderAddressAction` (tái dùng `requirePerm`).
- `components/fulfillment/AddressVerifyButton.tsx` — MỚI: nút "Verify lại".
- `app/(dashboard)/f/fulfillment/[orderId]/page.tsx` — render nút cạnh `AddressVerifyCard`.
- `scripts/cron/sync-shopify-orders.ts` — chain auto-verify.
- `scripts/verify-shopify-addresses.ts` — refactor dùng `verifyUnverifiedAddresses`.

---

## Task 1: `buildAddressInput` (THUẦN)

**Files:**
- Create: `features/shopify-orders/address-verify.ts`
- Test: `features/shopify-orders/address-verify.test.ts`

**Interfaces:**
- Consumes: `AddressInput` từ `@/lib/fedex/address`.
- Produces:
  ```ts
  export interface OrderAddressFields {
    shipAddress1: string | null; shipAddress2: string | null;
    shipCity: string | null; shipProvinceCode: string | null;
    shipPostcode: string | null; shipCountry: string | null;
  }
  export function buildAddressInput(o: OrderAddressFields): AddressInput | null;
  ```

- [ ] **Step 1: Viết test thất bại**

Tạo `features/shopify-orders/address-verify.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { buildAddressInput } from './address-verify';

describe('buildAddressInput', () => {
  const base = { shipAddress1: '12 Main St', shipAddress2: 'Apt 4', shipCity: 'LA', shipProvinceCode: 'CA', shipPostcode: '90001', shipCountry: 'US' };
  it('đủ field → AddressInput đầy đủ', () => {
    expect(buildAddressInput(base)).toEqual({
      streetLines: ['12 Main St', 'Apt 4'], city: 'LA', stateOrProvinceCode: 'CA', postalCode: '90001', countryCode: 'US',
    });
  });
  it('thiếu address2 → 1 dòng street', () => {
    expect(buildAddressInput({ ...base, shipAddress2: null })?.streetLines).toEqual(['12 Main St']);
  });
  it('address2 rỗng/space → bỏ', () => {
    expect(buildAddressInput({ ...base, shipAddress2: '   ' })?.streetLines).toEqual(['12 Main St']);
  });
  it('thiếu shipAddress1 → null', () => {
    expect(buildAddressInput({ ...base, shipAddress1: null })).toBeNull();
  });
  it('thiếu shipCountry → null', () => {
    expect(buildAddressInput({ ...base, shipCountry: null })).toBeNull();
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận FAIL**

Run: `npx vitest run features/shopify-orders/address-verify.test.ts`
Expected: FAIL (module/hàm chưa có).

- [ ] **Step 3: Viết implementation**

Tạo `features/shopify-orders/address-verify.ts`:
```ts
import type { AddressInput } from '@/lib/fedex/address';

export interface OrderAddressFields {
  shipAddress1: string | null; shipAddress2: string | null;
  shipCity: string | null; shipProvinceCode: string | null;
  shipPostcode: string | null; shipCountry: string | null;
}

/** THUẦN: map field địa chỉ đơn → AddressInput. null khi thiếu street1/country. */
export function buildAddressInput(o: OrderAddressFields): AddressInput | null {
  if (!o.shipAddress1 || !o.shipCountry) return null;
  const streetLines = [o.shipAddress1, o.shipAddress2 ?? '']
    .map((s) => (s ?? '').trim())
    .filter(Boolean);
  return {
    streetLines,
    city: o.shipCity,
    stateOrProvinceCode: o.shipProvinceCode,
    postalCode: o.shipPostcode,
    countryCode: o.shipCountry,
  };
}
```

- [ ] **Step 4: Chạy test, xác nhận PASS**

Run: `npx vitest run features/shopify-orders/address-verify.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add features/shopify-orders/address-verify.ts features/shopify-orders/address-verify.test.ts
git commit -m "feat(ops): buildAddressInput thuần (order → FedEx AddressInput)"
```

---

## Task 2: lõi verify + batch + refactor script

**Files:**
- Modify: `features/shopify-orders/address-verify.ts` (thêm 2 hàm)
- Modify: `scripts/verify-shopify-addresses.ts` (dùng lõi mới)

**Interfaces:**
- Consumes: `buildAddressInput` (Task 1); `verifyAddress` từ `@/lib/fedex/address`; `db, schema`.
- Produces:
  ```ts
  export async function verifyAndStoreOrderAddress(orderId: string): Promise<{ ok: boolean; deliverable?: boolean; issue?: string | null; error?: string }>;
  export async function verifyUnverifiedAddresses(opts?: { limit?: number; includeVerified?: boolean }): Promise<{ verified: number; undeliverable: number; failed: number }>;
  ```

Integration (chạm db + FedEx API). Verify tsc/build; lõi pure đã test ở Task 1.

- [ ] **Step 1: Thêm 2 hàm vào `features/shopify-orders/address-verify.ts`**

Thêm import đầu file:
```ts
import { and, eq, isNull, isNotNull, desc } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { verifyAddress } from '@/lib/fedex/address';
```
Thêm cuối file:
```ts
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Verify + lưu địa chỉ 1 đơn. Lõi dùng bởi nút + batch. */
export async function verifyAndStoreOrderAddress(
  orderId: string,
): Promise<{ ok: boolean; deliverable?: boolean; issue?: string | null; error?: string }> {
  const [o] = await db
    .select({
      shipAddress1: schema.shopifyOrders.shipAddress1, shipAddress2: schema.shopifyOrders.shipAddress2,
      shipCity: schema.shopifyOrders.shipCity, shipProvinceCode: schema.shopifyOrders.shipProvinceCode,
      shipPostcode: schema.shopifyOrders.shipPostcode, shipCountry: schema.shopifyOrders.shipCountry,
    })
    .from(schema.shopifyOrders)
    .where(eq(schema.shopifyOrders.id, orderId))
    .limit(1);
  if (!o) return { ok: false, error: 'order not found' };
  const input = buildAddressInput(o);
  if (!input) return { ok: false, error: 'no address' };
  try {
    const v = await verifyAddress(input);
    await db.update(schema.shopifyOrders).set({
      addrClass: v.classification, addrDeliverable: v.deliverable,
      addrIssue: v.issue, addrStandardized: v.standardized, addrVerifiedAt: new Date(),
    }).where(eq(schema.shopifyOrders.id, orderId));
    return { ok: true, deliverable: v.deliverable, issue: v.issue };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'verify failed' };
  }
}

/** Batch verify đơn chưa verify (cho cron + script). Rate-limit 300ms. */
export async function verifyUnverifiedAddresses(
  opts?: { limit?: number; includeVerified?: boolean },
): Promise<{ verified: number; undeliverable: number; failed: number }> {
  const limit = opts?.limit ?? 100;
  const conds = [isNotNull(schema.shopifyOrders.shipAddress1), isNotNull(schema.shopifyOrders.shipCountry)];
  if (!opts?.includeVerified) conds.push(isNull(schema.shopifyOrders.addrVerifiedAt));
  const rows = await db
    .select({ id: schema.shopifyOrders.id })
    .from(schema.shopifyOrders)
    .where(and(...conds))
    .orderBy(desc(schema.shopifyOrders.processedAtShopify))
    .limit(limit);
  let verified = 0, undeliverable = 0, failed = 0;
  for (const r of rows) {
    const res = await verifyAndStoreOrderAddress(r.id);
    if (res.ok) { verified++; if (res.deliverable === false) undeliverable++; }
    else if (res.error !== 'no address') failed++;
    await sleep(300);
  }
  return { verified, undeliverable, failed };
}
```

- [ ] **Step 2: Refactor `scripts/verify-shopify-addresses.ts` dùng lõi**

Thay toàn bộ thân `main()` (phần query + loop verify + lưu) bằng gọi `verifyUnverifiedAddresses`. Nội dung file mới:
```ts
/**
 * Verify địa chỉ đơn Shopify qua FedEx Address Validation (batch).
 *   railway run -- npx tsx scripts/verify-shopify-addresses.ts [--limit N] [--refresh]
 */
import { verifyUnverifiedAddresses } from '@/features/shopify-orders/address-verify';

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };

async function main(): Promise<void> {
  const limit = Number(arg('limit') ?? '300');
  const includeVerified = process.argv.includes('--refresh');
  const r = await verifyUnverifiedAddresses({ limit, includeVerified });
  console.log(`✓ Verify ${r.verified} đơn | KHÔNG giao được: ${r.undeliverable} | lỗi: ${r.failed}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 3: tsc + build + suite**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: xanh hết.

- [ ] **Step 4: Commit**

```bash
git add features/shopify-orders/address-verify.ts scripts/verify-shopify-addresses.ts
git commit -m "feat(ops): lõi verifyAndStoreOrderAddress + verifyUnverifiedAddresses + refactor script"
```

---

## Task 3: Server action `verifyOrderAddressAction`

**Files:**
- Modify: `features/fulfillment/actions.ts` (thêm action, tái dùng `requirePerm`)

**Interfaces:**
- Consumes: `verifyAndStoreOrderAddress` (Task 2); `requirePerm` (cục bộ trong file).
- Produces: `verifyOrderAddressAction(orderId: string): Promise<{ ok: boolean; deliverable?: boolean; issue?: string | null; error?: string }>`.

- [ ] **Step 1: Thêm action**

Trong `features/fulfillment/actions.ts`:
- Thêm import: `import { verifyAndStoreOrderAddress } from '@/features/shopify-orders/address-verify';` (cạnh các import khác). Đảm bảo `revalidatePath` đã được import (file đã dùng — nếu chưa, thêm `import { revalidatePath } from 'next/cache';`).
- Thêm hàm (cuối file):
```ts
export async function verifyOrderAddressAction(
  orderId: string,
): Promise<{ ok: boolean; deliverable?: boolean; issue?: string | null; error?: string }> {
  await requirePerm('manage_fulfillment');
  const r = await verifyAndStoreOrderAddress(orderId);
  revalidatePath(`/f/fulfillment/${orderId}`);
  return r;
}
```
> Implementer: kiểm `requirePerm` là helper cục bộ trong file này (signature `requirePerm(perm: Permission): Promise<string>`) — dùng GIỐNG các action `manage_fulfillment` hiện có. Không tự tạo gate mới.

- [ ] **Step 2: tsc**

Run: `npx tsc --noEmit`
Expected: sạch.

- [ ] **Step 3: Commit**

```bash
git add features/fulfillment/actions.ts
git commit -m "feat(ops): server action verifyOrderAddressAction (gate manage_fulfillment)"
```

---

## Task 4: Nút "Verify lại" + gắn vào trang vận hành

**Files:**
- Create: `components/fulfillment/AddressVerifyButton.tsx`
- Modify: `app/(dashboard)/f/fulfillment/[orderId]/page.tsx` (render nút cạnh `AddressVerifyCard`)

**Interfaces:**
- Consumes: `verifyOrderAddressAction` (Task 3).

- [ ] **Step 1: Tạo nút**

Tạo `components/fulfillment/AddressVerifyButton.tsx`:
```tsx
'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { verifyOrderAddressAction } from '@/features/fulfillment/actions';

export function AddressVerifyButton({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setMsg(null);
          startTransition(async () => {
            const r = await verifyOrderAddressAction(orderId);
            if (!r.ok) setMsg(r.error === 'no address' ? 'Chưa có địa chỉ đầy đủ.' : `Lỗi: ${r.error}`);
            else setMsg(r.deliverable ? '✓ Giao được' : `⚠ Không giao được${r.issue ? ` — ${r.issue}` : ''}`);
            router.refresh();
          });
        }}
        className="rounded border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
      >
        {pending ? 'Đang verify…' : 'Verify lại địa chỉ'}
      </button>
      {msg && <span className="text-xs text-muted-foreground">{msg}</span>}
    </div>
  );
}
```

- [ ] **Step 2: Render nút cạnh AddressVerifyCard**

Trong `app/(dashboard)/f/fulfillment/[orderId]/page.tsx`:
- Thêm import: `import { AddressVerifyButton } from '@/components/fulfillment/AddressVerifyButton';`
- Tìm chỗ render `<AddressVerifyCard ... />`. Ngay dưới nó, thêm:
```tsx
<AddressVerifyButton orderId={order.id} />
```
> Implementer: đọc page để lấy đúng tên biến order id đang dùng (vd `order.id` / `orderId` / param). Dùng đúng biến đó. Đặt nút ngay dưới card (cùng cụm địa chỉ).

- [ ] **Step 3: tsc + build**

Run: `npx tsc --noEmit && npm run build`
Expected: sạch + build OK (nút client import action 'use server' — hợp lệ).

- [ ] **Step 4: Commit**

```bash
git add components/fulfillment/AddressVerifyButton.tsx "app/(dashboard)/f/fulfillment/[orderId]/page.tsx"
git commit -m "feat(ops): nút Verify lại địa chỉ trong trang vận hành đơn"
```

---

## Task 5: Cron auto-verify đơn mới

**Files:**
- Modify: `scripts/cron/sync-shopify-orders.ts` (chain `verifyUnverifiedAddresses`)

**Interfaces:**
- Consumes: `verifyUnverifiedAddresses` (Task 2).

- [ ] **Step 1: Chain vào cron (sau push-unsent-brand)**

Trong `scripts/cron/sync-shopify-orders.ts`:
- Thêm import: `import { verifyUnverifiedAddresses } from '@/features/shopify-orders/address-verify';`
- Sau block `push-unsent-brand` (try/catch của `pushUnsentBrandOrders`), thêm:
```ts
  // Auto-verify địa chỉ đơn mới (chưa verify) qua FedEx. Cap 100/giờ + rate-limit
  // trong hàm để không đụng giới hạn API.
  try {
    const av = await verifyUnverifiedAddresses({ limit: 100 });
    process.stdout.write(`addr-verify: verified ${av.verified}, undeliverable ${av.undeliverable}, failed ${av.failed}\n`);
  } catch (e) {
    process.stderr.write(`addr-verify: ${e instanceof Error ? e.message : String(e)}\n`);
  }
```

- [ ] **Step 2: tsc + build**

Run: `npx tsc --noEmit && npm run build`
Expected: sạch.

- [ ] **Step 3: Commit**

```bash
git add scripts/cron/sync-shopify-orders.ts
git commit -m "feat(ops): cron auto-verify địa chỉ đơn mới (chain vào sync-orders)"
```

---

## Self-Review (đã chạy)

- **Spec coverage:** §4 lõi `buildAddressInput`/`verifyAndStoreOrderAddress`/`verifyUnverifiedAddresses` → Task 1,2; action → Task 3; nút → Task 4; cron → Task 5; refactor script → Task 2. §5 guard (rate-limit/no-address/lỗi per-đơn) → Task 2; gate → Task 3. §6 test thuần `buildAddressInput` → Task 1. Đủ.
- **Placeholder scan:** mọi step có code cụ thể. 2 chỗ "đọc page lấy đúng biến order id" / "kiểm requirePerm" (Task 3,4) là CHỦ Ý — implementer khớp tên thật trong repo, không bịa.
- **Type consistency:** `OrderAddressFields`, `buildAddressInput`, `verifyAndStoreOrderAddress`, `verifyUnverifiedAddresses` ({limit, includeVerified}), `verifyOrderAddressAction` nhất quán giữa các task.
- **Lưu ý reviewer:** Task 2/3/5 chạm db/API/cron — repo không có test DB → verify tsc/build; logic thuần (buildAddressInput) đã TDD ở Task 1.
