# Manual Shipping rates (Functions hub) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Trang "Manual Shipping rates" trong Functions hub: xem ma trận giá ship flat (zone × bậc cân) của từng store + apply backup lên Shopify, tái dùng data Markets + luồng apply sẵn có.

**Architecture:** Helper thuần `flattenShippingMatrix` (TDD) + bảng server component; trang đọc `listOverridesForStore` và apply qua `previewMarketsApply`/`executeMarketsApply` (tái dùng `ApplyModal`); card trong `/f/functions`.

**Tech Stack:** Next.js 16 App Router, React, Tailwind, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-12-manual-shipping-rates-design.md`

---

### Task 1: Helper flatten (TDD) + bảng component

**Files:**
- Create: `features/markets/domain/shipping-matrix-view.ts` (+ test)
- Create: `components/functions/ShippingMatrixTable.tsx`

- [ ] **Step 1: Test `shipping-matrix-view.test.ts` (fail trước)**
```ts
import { describe, it, expect } from 'vitest';
import { flattenShippingMatrix } from './shipping-matrix-view';
import type { MarketShipping } from '../types';

const ship = (zones: MarketShipping['zones']): MarketShipping => ({ zones });

describe('flattenShippingMatrix', () => {
  it('null/rỗng → []', () => {
    expect(flattenShippingMatrix(null)).toEqual([]);
    expect(flattenShippingMatrix(ship({}))).toEqual([]);
  });
  it('rate sắp theo cận trên kg', () => {
    const z = flattenShippingMatrix(ship({
      'Zone A': { countries: ['US'], rates: {
        'FedEx IP (1–2 kg)': { type: 'flat', price: 80, currency: 'USD' },
        'FedEx IP (0–0.5 kg)': { type: 'flat', price: 54.5, currency: 'USD' },
        'FedEx IP (0.5–1 kg)': { type: 'flat', price: 64, currency: 'USD' },
      } },
    }));
    expect(z).toHaveLength(1);
    expect(z[0].zoneName).toBe('Zone A');
    expect(z[0].countries).toEqual(['US']);
    expect(z[0].rates.map((r) => r.price)).toEqual([54.5, 64, 80]);
  });
  it('label không khớp regex đẩy cuối', () => {
    const z = flattenShippingMatrix(ship({
      'Z': { countries: [], rates: {
        'FedEx IP (0–0.5 kg)': { type: 'flat', price: 10, currency: 'USD' },
        'Đồng giá': { type: 'flat', price: 99, currency: 'USD' },
      } },
    }));
    expect(z[0].rates.map((r) => r.label)).toEqual(['FedEx IP (0–0.5 kg)', 'Đồng giá']);
  });
  it('giữ thứ tự zone', () => {
    const z = flattenShippingMatrix(ship({
      'B': { countries: [], rates: {} }, 'A': { countries: [], rates: {} },
    }));
    expect(z.map((x) => x.zoneName)).toEqual(['B', 'A']);
  });
});
```
Run `npx vitest run features/markets/domain/shipping-matrix-view.test.ts` → FAIL.

- [ ] **Step 2: Viết `features/markets/domain/shipping-matrix-view.ts`**
```ts
import type { MarketShipping } from '../types';

export interface RateRow { label: string; price: number; currency: string; }
export interface ZoneView { zoneName: string; countries: string[]; rates: RateRow[]; }

/** Cận trên (kg) trích từ label "… (a–b kg)" — en-dash U+2013. null nếu không khớp. */
function upperKg(label: string): number | null {
  const m = label.match(/–\s*([\d.]+)\s*kg/);
  return m ? Number(m[1]) : null;
}

/** Phẳng hoá shipping → list zone (giữ thứ tự key), rate sắp theo cận trên kg;
 *  label không khớp đẩy cuối (giữ thứ tự gốc). */
export function flattenShippingMatrix(shipping: MarketShipping | null): ZoneView[] {
  if (!shipping || !shipping.zones) return [];
  return Object.entries(shipping.zones).map(([zoneName, zone]) => {
    const entries = Object.entries(zone.rates);
    const rates: RateRow[] = entries
      .map(([label, r], i) => ({ label, price: r.price, currency: r.currency, _i: i, _k: upperKg(label) }))
      .sort((a, b) => {
        if (a._k === null && b._k === null) return a._i - b._i;
        if (a._k === null) return 1;
        if (b._k === null) return -1;
        return a._k - b._k;
      })
      .map(({ label, price, currency }) => ({ label, price, currency }));
    return { zoneName, countries: zone.countries ?? [], rates };
  });
}
```
Run test → PASS.

- [ ] **Step 3: `components/functions/ShippingMatrixTable.tsx` (server component)**
```tsx
import type { ZoneView } from '@/features/markets/domain/shipping-matrix-view';

function fmtPrice(price: number, currency: string): string {
  if (currency === 'USD') return `$${price.toFixed(2)}`;
  return `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(price)} ${currency}`;
}

export function ShippingMatrixTable({ zones }: { zones: ZoneView[] }) {
  if (zones.length === 0) {
    return <p className="text-sm text-muted-foreground">Chưa có giá ship cho market này.</p>;
  }
  return (
    <div className="space-y-4">
      {zones.map((z) => (
        <div key={z.zoneName} className="rounded-md border border-border">
          <div className="border-b border-border px-3 py-2">
            <div className="text-sm font-medium">{z.zoneName}</div>
            {z.countries.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {z.countries.map((c) => (
                  <span key={c} className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-mono text-muted-foreground">{c}</span>
                ))}
              </div>
            )}
          </div>
          {z.rates.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">Chưa có bậc giá.</p>
          ) : (
            <table className="w-full text-sm">
              <tbody className="font-mono tabular-nums">
                {z.rates.map((r) => (
                  <tr key={r.label} className="border-t border-border first:border-t-0">
                    <td className="px-3 py-1 font-sans">{r.label}</td>
                    <td className="px-3 py-1 text-right">{fmtPrice(r.price, r.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4:** `npx tsc --noEmit` + `npx vitest run features/markets/domain/shipping-matrix-view.test.ts` xanh. **Commit**
```bash
git add features/markets/domain/shipping-matrix-view.ts features/markets/domain/shipping-matrix-view.test.ts components/functions/ShippingMatrixTable.tsx
git commit -m "feat(functions): helper flattenShippingMatrix + bảng ma trận giá ship (TDD)"
```

---

### Task 2: Trang manual-shipping-rates + card Functions hub

**Files:**
- Create: `app/(dashboard)/f/functions/manual-shipping-rates/page.tsx`
- Modify: `app/(dashboard)/f/functions/page.tsx`

- [ ] **Step 1: Trang `app/(dashboard)/f/functions/manual-shipping-rates/page.tsx`**

Tham khảo `app/(dashboard)/f/markets/apply/page.tsx` cho pattern auth + ApplyModal wrapper. Viết:
```tsx
import Link from 'next/link';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { db, schema } from '@/db/client';
import { listOverridesForStore, previewMarketsApply, executeMarketsApply } from '@/features/markets/actions';
import { flattenShippingMatrix } from '@/features/markets/domain/shipping-matrix-view';
import { ShippingMatrixTable } from '@/components/functions/ShippingMatrixTable';
import { ApplyModal } from '@/components/markets/ApplyModal';

export const dynamic = 'force-dynamic';

export default async function ManualShippingRatesPage({ searchParams }: { searchParams: Promise<{ store?: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_markets_history')) {
    return <div className="px-6 py-16 text-center"><h1 className="text-3xl">Forbidden</h1></div>;
  }
  const canApply = hasPermission(role, 'apply_markets');

  const stores = (await db.select().from(schema.stores))
    .map((s) => ({ id: s.id, name: s.name, shopDomain: s.shopDomain }));
  const sp = await searchParams;
  const activeId = stores.find((s) => s.id === sp.store)?.id ?? stores[0]?.id ?? null;
  const overrides = activeId ? await listOverridesForStore(activeId) : [];

  async function preview(storeId: string) {
    'use server';
    const s = await auth.api.getSession({ headers: await headers() });
    if (!s) throw new Error('unauthenticated');
    const r = await previewMarketsApply(storeId);
    return { ops: r.ops };
  }
  async function apply(storeId: string) {
    'use server';
    const s = await auth.api.getSession({ headers: await headers() });
    if (!s) throw new Error('unauthenticated');
    const r = await executeMarketsApply(storeId, s.user.id);
    return { errors: r.kind === 'applied' ? r.errors : [] };
  }

  return (
    <div className="px-6 md:px-10 py-8 md:py-12 space-y-8">
      <Link href="/f/functions" className="text-sm text-muted-foreground hover:text-foreground">← Functions</Link>
      <div>
        <h1 className="text-4xl font-semibold tracking-tight">Manual Shipping rates</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Bảng giá ship flat (theo zone × bậc cân) đang cấu hình cho từng store — đây là rate
          backup Shopify dùng khi API FedEx/DHL gãy. Apply để đẩy lại lên Shopify khi cần.
        </p>
      </div>

      {stores.length === 0 ? (
        <div className="rounded-md border border-border p-4 text-sm text-muted-foreground">Chưa có store nào kết nối.</div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {stores.map((s) => (
              <Link key={s.id} href={`/f/functions/manual-shipping-rates?store=${s.id}`}
                className={`rounded border px-3 py-1 text-sm ${s.id === activeId ? 'border-foreground font-medium' : 'border-border text-muted-foreground hover:bg-muted'}`}>
                {s.name}
              </Link>
            ))}
          </div>

          {canApply && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
              <p className="mb-2 text-amber-700 dark:text-amber-400">
                Apply đẩy <strong>toàn bộ cấu hình market</strong> của store lên Shopify (gồm flat rates). Dùng khi carrier API gãy.
              </p>
              <ApplyModal stores={stores} onPreview={preview} onApply={apply} />
            </div>
          )}

          <div className="space-y-8">
            {overrides.length === 0 && (
              <p className="text-sm text-muted-foreground">Store này chưa có cấu hình market/giá ship.</p>
            )}
            {overrides.map((o) => (
              <section key={o.marketHandle} className="space-y-3">
                <h2 className="text-lg font-medium">{o.marketHandle}</h2>
                <ShippingMatrixTable zones={flattenShippingMatrix(o.shipping)} />
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
```
Lưu ý: xác minh field `store.name`/`shopDomain` tồn tại (trang markets/apply dùng đúng vậy). `ApplyModal` Props: `{ stores, onPreview, onApply }` — khớp.

- [ ] **Step 2: Card trong `app/(dashboard)/f/functions/page.tsx`**
- Thêm `Truck` vào import `lucide-react` (dòng đầu).
- Sau lưới storefront FUNCTIONS (hoặc trên đầu, tách rõ), thêm 1 card chỉ hiện khi
  `hasPermission(role, 'view_markets_history')`:
```tsx
{hasPermission(role, 'view_markets_history') && (
  <Link href="/f/functions/manual-shipping-rates" className="block">
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <span className="rounded-lg bg-sky-500/10 p-2 text-sky-600 dark:text-sky-400"><Truck className="h-5 w-5" /></span>
        <span className="min-w-0">
          <span className="block text-sm font-medium">Manual Shipping rates</span>
          <span className="block text-xs text-muted-foreground">Bảng giá ship flat backup — apply khi carrier API FedEx/DHL gãy.</span>
        </span>
      </CardContent>
    </Card>
  </Link>
)}
```
Đặt trong 1 khối có tiêu đề nhỏ "Ops tools" (hoặc ngay dưới phần storefront), TÁCH khỏi `FUNCTIONS.map(...)` grid. Giữ JSX cân bằng.

- [ ] **Step 3: Tổng kiểm** `npx tsc --noEmit && npx vitest run && npx eslint . && npx next build` — xanh (eslint 0 error).

- [ ] **Step 4: Commit + push**
```bash
git add "app/(dashboard)/f/functions/manual-shipping-rates/page.tsx" "app/(dashboard)/f/functions/page.tsx"
git commit -m "feat(functions): trang Manual Shipping rates (xem ma trận + apply backup) + card hub"
git push origin main
```

---

## Self-Review
- **Spec coverage:** §1 helper→T1; §2 bảng→T1; §3 trang→T2; §4 card→T2; §5 test→T1. Đủ.
- **Type consistency:** `flattenShippingMatrix`, `ZoneView`/`RateRow`, `ShippingMatrixTable`, ApplyModal props nhất quán.
- **Placeholder scan:** không có TBD.
