# Ship hộ — Rate card offer FedEx (Plan B: rate card + export) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Depends on Plan A** (cần `pickBaseVnd` từ `quote-adapter.ts`). Chạy Plan A trước.

**Goal:** Sinh rate card offer (lưới zone × mức cân, ô = `base×(1+markup)`) cho từng partner từ bảng giá FedEx, kèm notes phụ phí + link fuel FedEx, export XLSX và PDF (print).

**Architecture:** Logic thuần `offer-ratecard-logic.ts` dựng lưới từ snapshot FedEx + markup partner; action `offer-ratecard-actions.ts` nạp partner + snapshot FedEx; trang `partners/[slug]/rate-card` render bảng + notes; export XLSX (client `xlsx`) và PDF (print CSS + `window.print()`).

**Tech Stack:** Next.js App Router, React client component, Drizzle, Vitest, `xlsx` (SheetJS) cho XLSX, print-to-PDF (không thêm lib).

## Global Constraints

- Ngôn ngữ UI + commit message: tiếng Việt.
- Rate card ô = `Math.round(baseVnd × (1 + markupPercent/100))`; baseVnd quy đổi bằng `pickBaseVnd` (Plan A).
- Carrier: CHỈ FedEx — account đầu tiên `enabled && carrierKey === 'fedex'`.
- Rate card generate **live**, KHÔNG lưu DB.
- Notes: link fuel FedEx (hằng số) + nhãn tiếng Việt các surcharge kind active của account.
- Fuel/phụ phí/VAT KHÔNG nằm trong ô — chỉ là notes (FedEx tính khi bill).
- Badge đỏ nếu `partner.markupPercent < MIN_MARKUP_PERCENT` (từ `offer-pricing`).
- Trước push: `npx tsc --noEmit` + `npx vitest run` xanh.
- Commit message kết thúc bằng: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

### Task 1: Logic thuần `buildRateCard`

**Files:**
- Create: `features/ship-ho/offer-ratecard-logic.ts`
- Test: `features/ship-ho/offer-ratecard-logic.test.ts`

**Interfaces:**
- Consumes: `pickBaseVnd` từ `./quote-adapter` (Plan A).
- Produces:
  - `interface RateCardCell { tierUpperKg: number; baseVnd: number; offerVnd: number }`
  - `interface RateCardZone { label: string; countries: string[]; cells: RateCardCell[] }`
  - `interface RateCard { markupPercent: number; tiers: number[]; zones: RateCardZone[]; surchargeNotes: string[] }`
  - `interface RateCardSnapshot { costCurrency: string; displayCurrency: string; fxCostPerDisplay: number; weightTiers: { upperKg: number }[]; zonesByCountry: Map<string, { label: string; rateByTierUpper: Map<number, number> }>; surcharges: { kind: string }[] }`
  - `function buildRateCard(snap: RateCardSnapshot, markupPercent: number): RateCard`

- [ ] **Step 1: Viết test thất bại**

Tạo `features/ship-ho/offer-ratecard-logic.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildRateCard, type RateCardSnapshot } from './offer-ratecard-logic';

function snap(): RateCardSnapshot {
  const zoneA = { label: 'Zone A', rateByTierUpper: new Map([[0.5, 100000], [1, 180000]]) };
  const zoneB = { label: 'Zone B', rateByTierUpper: new Map([[0.5, 120000], [1, 200000]]) };
  return {
    costCurrency: 'VND', displayCurrency: 'USD', fxCostPerDisplay: 26000,
    weightTiers: [{ upperKg: 0.5 }, { upperKg: 1 }],
    zonesByCountry: new Map([['US', zoneA], ['CA', zoneA], ['GB', zoneB]]),
    surcharges: [{ kind: 'fuel_percent' }, { kind: 'remote_fixed' }, { kind: 'fuel_percent' }],
  };
}

describe('buildRateCard', () => {
  it('tiers tăng dần, gồm mọi upperKg', () => {
    const c = buildRateCard(snap(), 30);
    expect(c.tiers).toEqual([0.5, 1]);
  });
  it('gom zone distinct theo label + danh sách nước', () => {
    const c = buildRateCard(snap(), 30);
    const zoneA = c.zones.find((z) => z.label === 'Zone A')!;
    expect(zoneA.countries.sort()).toEqual(['CA', 'US']);
    expect(c.zones).toHaveLength(2);
  });
  it('offer = round(baseVnd × (1+markup))', () => {
    const c = buildRateCard(snap(), 30);
    const zoneA = c.zones.find((z) => z.label === 'Zone A')!;
    const cell05 = zoneA.cells.find((x) => x.tierUpperKg === 0.5)!;
    expect(cell05.baseVnd).toBe(100000);
    expect(cell05.offerVnd).toBe(130000);
  });
  it('displayCurrency VND → base chia fx', () => {
    const s = snap();
    s.costCurrency = 'USD'; s.displayCurrency = 'VND'; s.fxCostPerDisplay = 0.25;
    // zoneA 0.5 base 100000 (đơn vị cost USD giả) → /0.25 = 400000 → ×1.3 = 520000
    const c = buildRateCard(s, 30);
    const cell = c.zones.find((z) => z.label === 'Zone A')!.cells.find((x) => x.tierUpperKg === 0.5)!;
    expect(cell.baseVnd).toBe(400000);
    expect(cell.offerVnd).toBe(520000);
  });
  it('surchargeNotes distinct + nhãn VN, bỏ kind lạ', () => {
    const c = buildRateCard(snap(), 30);
    expect(c.surchargeNotes).toContain('Phụ phí xăng dầu (theo tuần FedEx)');
    expect(c.surchargeNotes).toContain('Phụ phí vùng xa');
    expect(c.surchargeNotes.filter((n) => n.includes('xăng dầu'))).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Chạy test để xác nhận FAIL**

Run: `npx vitest run features/ship-ho/offer-ratecard-logic.test.ts`
Expected: FAIL — module chưa tồn tại.

- [ ] **Step 3: Viết implementation**

Tạo `features/ship-ho/offer-ratecard-logic.ts`:

```ts
/** THUẦN: dựng rate card offer (base×(1+markup)) theo zone × mức cân từ snapshot carrier. */
import { pickBaseVnd } from './quote-adapter';

export interface RateCardCell { tierUpperKg: number; baseVnd: number; offerVnd: number }
export interface RateCardZone { label: string; countries: string[]; cells: RateCardCell[] }
export interface RateCard { markupPercent: number; tiers: number[]; zones: RateCardZone[]; surchargeNotes: string[] }

export interface RateCardSnapshot {
  costCurrency: string;
  displayCurrency: string;
  fxCostPerDisplay: number;
  weightTiers: { upperKg: number }[];
  zonesByCountry: Map<string, { label: string; rateByTierUpper: Map<number, number> }>;
  surcharges: { kind: string }[];
}

// Nhãn tiếng Việt cho surcharge kind (chỉ các kind muốn hiện trên rate card).
const SURCHARGE_LABELS: Record<string, string> = {
  fuel_percent: 'Phụ phí xăng dầu (theo tuần FedEx)',
  remote_fixed: 'Phụ phí vùng xa',
  residential: 'Phụ phí địa chỉ dân cư',
  demand_per_kg: 'Phụ phí nhu cầu theo kg',
  country_fixed: 'Phí xử lý theo nước',
  peak_fixed: 'Phụ phí cao điểm',
  vat_percent: 'VAT',
};

export function buildRateCard(snap: RateCardSnapshot, markupPercent: number): RateCard {
  const tiers = snap.weightTiers.map((t) => t.upperKg).slice().sort((a, b) => a - b);

  // Gom zone distinct theo label + danh sách nước.
  const byLabel = new Map<string, { zone: { label: string; rateByTierUpper: Map<number, number> }; countries: string[] }>();
  for (const [country, zone] of snap.zonesByCountry) {
    const e = byLabel.get(zone.label) ?? { zone, countries: [] };
    e.countries.push(country);
    byLabel.set(zone.label, e);
  }

  const zones: RateCardZone[] = [];
  for (const { zone, countries } of byLabel.values()) {
    const cells: RateCardCell[] = [];
    for (const tierUpperKg of tiers) {
      const baseCost = zone.rateByTierUpper.get(tierUpperKg);
      if (baseCost === undefined) continue; // ô thiếu rate → bỏ
      const conv = pickBaseVnd(snap, { base: baseCost });
      if (!conv.ok) continue;
      const baseVnd = conv.vnd;
      cells.push({ tierUpperKg, baseVnd, offerVnd: Math.round(baseVnd * (1 + markupPercent / 100)) });
    }
    zones.push({ label: zone.label, countries: countries.slice().sort(), cells });
  }
  zones.sort((a, b) => a.label.localeCompare(b.label));

  const seen = new Set<string>();
  const surchargeNotes: string[] = [];
  for (const s of snap.surcharges) {
    const label = SURCHARGE_LABELS[s.kind];
    if (label && !seen.has(label)) { seen.add(label); surchargeNotes.push(label); }
  }

  return { markupPercent, tiers, zones, surchargeNotes };
}
```

- [ ] **Step 4: Chạy test để xác nhận PASS**

Run: `npx vitest run features/ship-ho/offer-ratecard-logic.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add features/ship-ho/offer-ratecard-logic.ts features/ship-ho/offer-ratecard-logic.test.ts
git commit -m "feat(ship-ho): offer-ratecard-logic — dựng lưới base×(1+markup) + notes phụ phí

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Action `getPartnerRateCard`

**Files:**
- Create: `features/ship-ho/offer-ratecard-actions.ts`

**Interfaces:**
- Consumes: `buildRateCard`, `RateCard` (Task 1); `requireManageShipHo`; `listAccounts` (`@/features/carrier-rates/actions`); `loadAccountSnapshot` (`@/features/carrier-rates/engine/load`); `db, schema`.
- Produces: `getPartnerRateCard(brandSlug: string): Promise<{ ok: true; card: RateCard; partnerBrandSlug: string; accountName: string } | { ok: false; error: string }>`; `FEDEX_FUEL_URL`.

- [ ] **Step 1: Viết action**

Tạo `features/ship-ho/offer-ratecard-actions.ts`:

```ts
'use server';

import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { listAccounts } from '@/features/carrier-rates/actions';
import { loadAccountSnapshot } from '@/features/carrier-rates/engine/load';
import { requireManageShipHo } from './require-manage';
import { buildRateCard, type RateCard } from './offer-ratecard-logic';

/** Link tra phụ phí xăng dầu FedEx (hiển thị trên rate card). */
export const FEDEX_FUEL_URL = 'https://www.fedex.com/en-vn/shipping/fuel-surcharge.html';

export async function getPartnerRateCard(
  brandSlug: string,
): Promise<{ ok: true; card: RateCard; partnerBrandSlug: string; accountName: string } | { ok: false; error: string }> {
  try { await requireManageShipHo(); } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }

  const [partner] = await db
    .select()
    .from(schema.shipHoPartners)
    .where(eq(schema.shipHoPartners.brandSlug, brandSlug))
    .limit(1);
  if (!partner) return { ok: false, error: 'Không tìm thấy đối tác' };

  const fedex = (await listAccounts()).find((a) => a.enabled && a.carrierKey === 'fedex');
  if (!fedex) return { ok: false, error: 'Chưa có carrier account FedEx đang bật' };

  const snap = await loadAccountSnapshot(fedex.id);
  if (!snap) return { ok: false, error: 'Không nạp được bảng giá FedEx' };

  const card = buildRateCard(snap, Number(partner.markupPercent));
  return { ok: true, card, partnerBrandSlug: brandSlug, accountName: fedex.name };
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS. (Nếu `loadAccountSnapshot` trả kiểu không khớp `RateCardSnapshot` structurally — kiểm tra field `zonesByCountry/weightTiers/surcharges/costCurrency/displayCurrency/fxCostPerDisplay` đều có trên `CarrierAccountSnapshot`; đã xác nhận ở spec. `buildRateCard` nhận structural type nên snapshot đầy đủ hơn vẫn hợp lệ.)

- [ ] **Step 3: Commit**

```bash
git add features/ship-ho/offer-ratecard-actions.ts
git commit -m "feat(ship-ho): getPartnerRateCard — nạp partner + snapshot FedEx → rate card

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Trang rate card + bảng + notes

**Files:**
- Create: `app/(dashboard)/f/ship-ho/partners/[slug]/rate-card/page.tsx`
- Create: `app/(dashboard)/f/ship-ho/partners/[slug]/rate-card/RateCardView.tsx`

**Interfaces:**
- Consumes: `getPartnerRateCard`, `FEDEX_FUEL_URL` (Task 2); `MIN_MARKUP_PERCENT` (`@/features/ship-ho/offer-pricing`); `RateCard` (Task 1).
- Produces: không có (UI).

- [ ] **Step 1: Trang server nạp dữ liệu**

Tạo `app/(dashboard)/f/ship-ho/partners/[slug]/rate-card/page.tsx`:

```tsx
import { notFound, redirect } from 'next/navigation';
import { headers } from 'next/headers';
import Link from 'next/link';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { buttonVariants } from '@/components/ui/button';
import { getPartnerRateCard, FEDEX_FUEL_URL } from '@/features/ship-ho/offer-ratecard-actions';
import { RateCardView } from './RateCardView';

export const dynamic = 'force-dynamic';

export default async function RateCardPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_ship_ho')) {
    return <div className="max-w-3xl mx-auto px-6 py-16 text-center"><h1 className="text-2xl font-semibold">Forbidden</h1></div>;
  }
  const r = await getPartnerRateCard(slug);

  return (
    <div className="px-6 md:px-10 py-8 md:py-12 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-semibold tracking-tight">Rate card · {slug}</h1>
        <Link href="/f/ship-ho/partners" className={buttonVariants({ variant: 'outline' })}>← Đối tác</Link>
      </div>
      {!r.ok ? (
        <p className="text-red-600">{r.error}</p>
      ) : (
        <RateCardView card={r.card} partnerSlug={slug} accountName={r.accountName} fuelUrl={FEDEX_FUEL_URL} />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Client view — bảng + notes + nút export**

Tạo `app/(dashboard)/f/ship-ho/partners/[slug]/rate-card/RateCardView.tsx`:

```tsx
'use client';

import { utils, writeFile } from 'xlsx';
import { Button } from '@/components/ui/button';
import { MIN_MARKUP_PERCENT } from '@/features/ship-ho/offer-pricing';
import type { RateCard } from '@/features/ship-ho/offer-ratecard-logic';

const vnd = (v: number) => v.toLocaleString('vi-VN') + ' ₫';

export function RateCardView({ card, partnerSlug, accountName, fuelUrl }: {
  card: RateCard; partnerSlug: string; accountName: string; fuelUrl: string;
}) {
  const below = card.markupPercent < MIN_MARKUP_PERCENT;

  const exportXlsx = () => {
    const header = ['Zone', 'Nước', ...card.tiers.map((t) => `≤${t}kg`)];
    const rows = card.zones.map((z) => {
      const byTier = new Map(z.cells.map((c) => [c.tierUpperKg, c.offerVnd]));
      return {
        Zone: z.label,
        'Nước': z.countries.join(', '),
        ...Object.fromEntries(card.tiers.map((t) => [`≤${t}kg`, byTier.get(t) ?? ''])),
      };
    });
    const ws = utils.json_to_sheet(rows, { header });
    const wb = utils.book_new();
    utils.book_append_sheet(wb, ws, 'Rate card');
    const notes = card.surchargeNotes.map((n) => [n]);
    utils.book_append_sheet(wb, utils.aoa_to_sheet([['Phụ phí (FedEx tính khi bill)'], ...notes, [], ['Fuel', fuelUrl]]), 'Ghi chú');
    writeFile(wb, `rate-card-${partnerSlug}.xlsx`);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 print:hidden">
        <span className="text-sm text-muted-foreground">Nguồn: {accountName} · markup {card.markupPercent}%</span>
        {below && <span className="rounded bg-red-100 text-red-700 text-xs px-1.5 py-0.5">⚠ &lt; {MIN_MARKUP_PERCENT}%</span>}
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" onClick={exportXlsx}>Export XLSX</Button>
          <Button variant="outline" size="sm" onClick={() => window.print()}>Export PDF</Button>
        </div>
      </div>

      <div className="border rounded overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40">
            <tr className="[&>th]:text-left [&>th]:p-2 [&>th]:whitespace-nowrap">
              <th>Zone</th><th>Nước</th>
              {card.tiers.map((t) => <th key={t} className="text-right">≤{t}kg</th>)}
            </tr>
          </thead>
          <tbody>
            {card.zones.map((z) => {
              const byTier = new Map(z.cells.map((c) => [c.tierUpperKg, c.offerVnd]));
              return (
                <tr key={z.label} className="border-b [&>td]:p-2 align-top">
                  <td className="font-medium whitespace-nowrap">{z.label}</td>
                  <td className="text-muted-foreground max-w-xs">{z.countries.join(', ')}</td>
                  {card.tiers.map((t) => (
                    <td key={t} className="text-right whitespace-nowrap">{byTier.has(t) ? vnd(byTier.get(t)!) : '—'}</td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="text-sm space-y-1">
        <div className="font-medium">Phụ phí (FedEx tính theo công thức của hãng khi xuất bill):</div>
        <ul className="list-disc pl-5 text-muted-foreground">
          {card.surchargeNotes.map((n) => <li key={n}>{n}</li>)}
        </ul>
        <p>Phụ phí xăng dầu FedEx: <a className="text-blue-600 underline" href={fuelUrl} target="_blank" rel="noopener noreferrer">{fuelUrl}</a></p>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add "app/(dashboard)/f/ship-ho/partners/[slug]/rate-card"
git commit -m "feat(ship-ho): trang rate card offer + bảng zone×tier + notes + export XLSX/PDF

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Link rate card từ danh sách partner

**Files:**
- Modify: `app/(dashboard)/f/ship-ho/partners/PartnersManager.tsx`

**Interfaces:**
- Consumes: route `/f/ship-ho/partners/[slug]/rate-card`.
- Produces: không có (UI).

- [ ] **Step 1: Xác định nơi render dòng partner**

Run: `grep -n "brandSlug\|Link\|<td\|map(" "app/(dashboard)/f/ship-ho/partners/PartnersManager.tsx" | head -20`
Ghi lại biến item partner (vd `p`) và chỗ render hành động mỗi dòng.

- [ ] **Step 2: Thêm link "Rate card"**

Đảm bảo có `import Link from 'next/link';` (thêm nếu thiếu). Trong mỗi dòng partner, thêm link (chỉnh `p.brandSlug` cho khớp biến ở Step 1):

```tsx
<Link href={`/f/ship-ho/partners/${p.brandSlug}/rate-card`} className="text-blue-600 underline text-sm">Rate card</Link>
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add "app/(dashboard)/f/ship-ho/partners/PartnersManager.tsx"
git commit -m "feat(ship-ho): link Rate card từ danh sách đối tác

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Verify + đẩy

- [ ] **Step 1: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 2: Full test suite**

Run: `npx vitest run`
Expected: PASS (0 failed); gồm `offer-ratecard-logic`.

- [ ] **Step 3: Đẩy nhánh (chỉ khi xanh)**

```bash
git push origin feat/ship-ho-offer-pricing
```

---

## Self-Review

**Spec coverage (Phần B):**
- B1 `buildRateCard` (lưới zone×tier + notes) → Task 1. ✅
- B2 action `getPartnerRateCard` (partner + FedEx snapshot) → Task 2. ✅
- B3 trang + bảng + notes + link fuel → Task 3. ✅
- B4 export XLSX + PDF (print) → Task 3 (nút trong `RateCardView`). ✅
- Link từ PartnersManager → Task 4. ✅
- Test `offer-ratecard-logic` → Task 1. ✅
- Không lưu DB / không lib PDF mới (print) → tôn trọng. ✅

**Placeholder scan:** không TBD/TODO; step code đầy đủ. Task 3/4 Step 1 là khảo sát UI có chủ đích. ✅

**Type consistency:**
- `buildRateCard(RateCardSnapshot, markupPercent) → RateCard` khớp Task 1/2. ✅
- `RateCard { markupPercent, tiers, zones, surchargeNotes }` render đúng ở Task 3. ✅
- `getPartnerRateCard(slug) → {ok,card,accountName}|{ok,error}` khớp page Task 3. ✅
- `pickBaseVnd` tiêu thụ trong `buildRateCard` (Plan A cung cấp). ✅
- `FEDEX_FUEL_URL`, `MIN_MARKUP_PERCENT` dùng nhất quán. ✅
