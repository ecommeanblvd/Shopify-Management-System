# Ship hộ Brand Self-Service — SMS backend (Phase 1+2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Xây phía SMS cho brand self-service ship hộ: API estimate giá (theo bảng giá brand + fuel tuần ship + VAT) và API nhận đơn từ MMP (SMS sinh mã, giá dự kiến), chỉ cho brand được approve.

**Architecture:** Core thuần `computeBrandCharge` (công thức Option A: fuel/VAT trên base đã markup) + `estimateForBrand` (I/O: quote FedEx Express → giá brand minh bạch) làm nguồn sự thật; 2 route API `app/api/mmp/ship-ho/{estimate,orders}` ký HMAC như các route MMP hiện có; DB thêm cờ approve + source/mmp_ref/service; danh sách ship hộ lọc theo nguồn.

**Tech Stack:** Next.js App Router (breaking-changes fork — đọc `node_modules/next/dist/docs/` nếu chạm API Next), Drizzle ORM (PostgreSQL), Vitest, HMAC SHA-256 (`features/mmp/hmac.ts`).

## Global Constraints

- Ngôn ngữ UI + commit message: tiếng Việt.
- **Định danh trung tính**: brand chỉ thấy `Express Delivery`/`Standard Delivery` + nhãn phụ phí trung tính. **KHÔNG** lộ tên hãng (FedEx), `carrierCostVnd`, `marginVnd`, `markupPercent` trong bất kỳ response nào.
- **Công thức giá brand (Option A)**: `margin = baseVnd × (markup/100) × (1 + fuelPercent/100) × (1 + vatPercent/100)`; `chargedVnd = round(carrierCostVnd) + round(margin)`. markup lấy từ partner, sàn ≥ 30 đã enforce sẵn.
- Service: `express` build ngay; `standard` → trả `service_unavailable`.
- Approve: chỉ brand có `ship_ho_partners.self_service_enabled = true` + `status='active'` mới dùng được.
- Auth API: HMAC qua `verifyMmpSignature` (secret `MMP_WEBHOOK_SECRET`), đọc `rawBody` text trước khi parse.
- Mã đơn brand: SMS sinh **dãy số tuần tự tạm** qua sequence Postgres; lưu seq để backfill sau.
- Idempotency nhận đơn: `ship_ho_orders.mmp_ref` unique.
- KHÔNG dùng `computeOffer` cho đơn brand (đó là giá nội bộ). Đơn nội bộ giữ nguyên.
- Trước push: `npx tsc --noEmit` + `npx vitest run` xanh.
- Commit message kết thúc bằng: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

Migration kế tiếp: **0086** (viết tay SQL + append `db/migrations/meta/_journal.json`, KHÔNG chạy `db:generate` — snapshot meta đã stale từ 0061).

---

## PHASE 1 — Pricing core + Estimate API

### Task 1: DB — cờ approve + source/mmp_ref/service + sequence mã đơn

**Files:**
- Create: `db/migrations/0086_ship-ho-brand-self-service.sql`
- Modify: `db/schema.ts` (khối `shipHoPartners` và `shipHoOrders`)
- Modify: `db/migrations/meta/_journal.json`

**Interfaces:**
- Produces: cột `shipHoPartners.selfServiceEnabled` (boolean); `shipHoOrders.source` (text), `shipHoOrders.mmpRef` (text, unique khi not null), `shipHoOrders.service` (text), `shipHoOrders.mmpOrderSeq` (bigint); sequence `ship_ho_mmp_order_seq`.

- [ ] **Step 1: Viết migration SQL**

Tạo `db/migrations/0086_ship-ho-brand-self-service.sql`:

```sql
ALTER TABLE "ship_ho_partners" ADD COLUMN "self_service_enabled" boolean NOT NULL DEFAULT false;

ALTER TABLE "ship_ho_orders" ADD COLUMN "source" text NOT NULL DEFAULT 'internal';
ALTER TABLE "ship_ho_orders" ADD COLUMN "mmp_ref" text;
ALTER TABLE "ship_ho_orders" ADD COLUMN "service" text;
ALTER TABLE "ship_ho_orders" ADD COLUMN "mmp_order_seq" bigint;

CREATE UNIQUE INDEX "ship_ho_orders_mmp_ref_unique" ON "ship_ho_orders" ("mmp_ref") WHERE "mmp_ref" IS NOT NULL;
CREATE SEQUENCE IF NOT EXISTS "ship_ho_mmp_order_seq" START 1000;
```

- [ ] **Step 2: Thêm cột vào schema Drizzle**

Trong `db/schema.ts`, khối `shipHoPartners`, sau `status: shipHoPartnerStatusEnum(...)` thêm:

```ts
  selfServiceEnabled: boolean('self_service_enabled').notNull().default(false),
```

Trong khối `shipHoOrders`, sau `packagingType: text('packaging_type'),` thêm:

```ts
  // Brand self-service (MMP)
  source: text('source').notNull().default('internal'), // 'internal' | 'mmp'
  mmpRef: text('mmp_ref'),
  service: text('service'), // 'express' | 'standard'
  mmpOrderSeq: bigint('mmp_order_seq', { mode: 'number' }),
```

Đảm bảo `boolean` và `bigint` có trong import drizzle-orm/pg-core ở đầu `db/schema.ts` (thêm nếu thiếu).

- [ ] **Step 3: Append journal entry**

Trong `db/migrations/meta/_journal.json`, sau entry `0085_ship-ho-address-extra` thêm:

```json
    },{
      "idx": 86,
      "version": "7",
      "when": 1783860000000,
      "tag": "0086_ship-ho-brand-self-service",
      "breakpoints": true
```

(Chèn trước `]` đóng mảng entries, giữ JSON hợp lệ — kiểm bằng `node -e "JSON.parse(require('fs').readFileSync('db/migrations/meta/_journal.json','utf8'))"`.)

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add db/migrations/0086_ship-ho-brand-self-service.sql db/migrations/meta/_journal.json db/schema.ts
git commit -m "feat(ship-ho): migration self_service_enabled + source/mmp_ref/service + sequence mã đơn brand

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 6: Apply migration + approve Kalisa (DB thật, khi sẵn sàng)**

Run: `npm run db:migrate`
Sau đó set approve cho Kalisa (một lần):
Run: `npx dotenv -- node -e "const {Client}=require('pg');(async()=>{const c=new Client({connectionString:process.env.DATABASE_URL});await c.connect();await c.query(\"update ship_ho_partners set self_service_enabled=true where brand_slug='kalisa'\");console.log('kalisa approved');await c.end();})()"`
Expected: `migrations applied successfully` + `kalisa approved`.

---

### Task 2: Core thuần `computeBrandCharge` (Option A)

**Files:**
- Create: `features/ship-ho/brand-pricing.ts`
- Test: `features/ship-ho/brand-pricing.test.ts`

**Interfaces:**
- Produces:
  - `interface BrandChargeParts { surchargesVnd: number; fuelRealVnd: number; vatRealVnd: number }`
  - `interface BrandChargeLine { label: string; amountVnd: number }`
  - `function computeBrandCharge(input: { carrierCostVnd: number; baseVnd: number; fuelPercent: number; vatPercent: number; markupPercent: number; parts: BrandChargeParts; serviceLabel: string }): { chargedVnd: number; lines: BrandChargeLine[] }`

- [ ] **Step 1: Viết test thất bại**

Tạo `features/ship-ho/brand-pricing.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeBrandCharge } from './brand-pricing';

describe('computeBrandCharge (Option A: fuel/VAT trên base đã markup)', () => {
  it('khớp ví dụ chuẩn: base 100k markup 30% fuel 17% vat 8%', () => {
    // carrierCost = base(100k) + surcharges(20k) + fuelReal(20.4k) + vatReal(11.232k) = 151.632k
    const r = computeBrandCharge({
      carrierCostVnd: 151632, baseVnd: 100000, fuelPercent: 17, vatPercent: 8, markupPercent: 30,
      parts: { surchargesVnd: 20000, fuelRealVnd: 20400, vatRealVnd: 11232 },
      serviceLabel: 'Express Delivery',
    });
    expect(r.chargedVnd).toBe(189540); // 151632 + round(30000×1.17×1.08=37908)
  });
  it('tổng lines == chargedVnd', () => {
    const r = computeBrandCharge({
      carrierCostVnd: 151632, baseVnd: 100000, fuelPercent: 17, vatPercent: 8, markupPercent: 30,
      parts: { surchargesVnd: 20000, fuelRealVnd: 20400, vatRealVnd: 11232 },
      serviceLabel: 'Express Delivery',
    });
    expect(r.lines.reduce((s, l) => s + l.amountVnd, 0)).toBe(r.chargedVnd);
  });
  it('line đầu là markedBase = base×(1+markup), nhãn service', () => {
    const r = computeBrandCharge({
      carrierCostVnd: 151632, baseVnd: 100000, fuelPercent: 17, vatPercent: 8, markupPercent: 30,
      parts: { surchargesVnd: 20000, fuelRealVnd: 20400, vatRealVnd: 11232 },
      serviceLabel: 'Express Delivery',
    });
    expect(r.lines[0]).toEqual({ label: 'Cước cơ bản (Express Delivery)', amountVnd: 130000 });
  });
  it('markup 0 → charged = carrierCost', () => {
    const r = computeBrandCharge({
      carrierCostVnd: 151632, baseVnd: 100000, fuelPercent: 17, vatPercent: 8, markupPercent: 0,
      parts: { surchargesVnd: 20000, fuelRealVnd: 20400, vatRealVnd: 11232 },
      serviceLabel: 'Express Delivery',
    });
    expect(r.chargedVnd).toBe(151632);
  });
  it('fuel 0, vat 0 → margin = base×markup thuần', () => {
    const r = computeBrandCharge({
      carrierCostVnd: 120000, baseVnd: 100000, fuelPercent: 0, vatPercent: 0, markupPercent: 30,
      parts: { surchargesVnd: 20000, fuelRealVnd: 0, vatRealVnd: 0 },
      serviceLabel: 'Express Delivery',
    });
    expect(r.chargedVnd).toBe(150000); // 120000 + 30000
  });
});
```

- [ ] **Step 2: Chạy test để xác nhận FAIL**

Run: `npx vitest run features/ship-ho/brand-pricing.test.ts`
Expected: FAIL — module chưa tồn tại.

- [ ] **Step 3: Viết implementation**

Tạo `features/ship-ho/brand-pricing.ts`:

```ts
/**
 * THUẦN: giá brand-facing ship hộ (Option A) — fuel & VAT áp trên base ĐÃ markup.
 *   margin     = baseVnd × markup% × (1+fuel%) × (1+vat%)
 *   chargedVnd = round(carrierCostVnd) + round(margin)
 * Lines (minh bạch, tổng == chargedVnd): markedBase, phụ phí, xăng dầu, VAT (dòng cuối là residual).
 * KHÔNG lộ carrierCost/margin/markup ra ngoài — chỉ trả chargedVnd + lines trung tính.
 */
export interface BrandChargeParts { surchargesVnd: number; fuelRealVnd: number; vatRealVnd: number }
export interface BrandChargeLine { label: string; amountVnd: number }

export function computeBrandCharge(input: {
  carrierCostVnd: number; baseVnd: number;
  fuelPercent: number; vatPercent: number; markupPercent: number;
  parts: BrandChargeParts; serviceLabel: string;
}): { chargedVnd: number; lines: BrandChargeLine[] } {
  const { carrierCostVnd, baseVnd, fuelPercent, vatPercent, markupPercent, parts, serviceLabel } = input;
  const f = fuelPercent / 100, v = vatPercent / 100, m = markupPercent / 100;

  const deltaBase = baseVnd * m;
  const margin = Math.max(0, Math.round(deltaBase * (1 + f) * (1 + v)));
  const chargedVnd = Math.round(carrierCostVnd) + margin;

  const markedBase = Math.round(baseVnd * (1 + m));
  const surLine = Math.round(parts.surchargesVnd);
  const fuelLine = Math.round(parts.fuelRealVnd + f * deltaBase);
  const vatLine = chargedVnd - markedBase - surLine - fuelLine; // residual → tổng khớp tuyệt đối

  const lines: BrandChargeLine[] = [
    { label: `Cước cơ bản (${serviceLabel})`, amountVnd: markedBase },
    { label: 'Phụ phí vùng/địa chỉ', amountVnd: surLine },
    { label: 'Phụ phí xăng dầu', amountVnd: fuelLine },
    { label: 'VAT', amountVnd: vatLine },
  ];
  return { chargedVnd, lines };
}
```

- [ ] **Step 4: Chạy test để xác nhận PASS**

Run: `npx vitest run features/ship-ho/brand-pricing.test.ts`
Expected: PASS toàn bộ.

- [ ] **Step 5: Commit**

```bash
git add features/ship-ho/brand-pricing.ts features/ship-ho/brand-pricing.test.ts
git commit -m "feat(ship-ho): computeBrandCharge — giá brand Option A (fuel/VAT trên base markup) + lines

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `estimateForBrand` (I/O) + nhãn phụ phí trung tính

**Files:**
- Create: `features/ship-ho/brand-estimate.ts`
- Test: `features/ship-ho/brand-estimate-labels.test.ts`

**Interfaces:**
- Consumes: `computeBrandCharge` (Task 2); `quoteShipHoOrder`/`pickBaseVnd` (`./quote-adapter`); `db, schema`; `listAccounts`/`loadAccountSnapshot` (carrier-rates).
- Produces:
  - `type ShipHoService = 'express' | 'standard'`
  - `interface EstimateParcel { country: string; city?: string; postcode?: string; weightKg: number; dimLengthCm?: number; dimWidthCm?: number; dimHeightCm?: number; packagingType?: 'bag'|'box'|null; service?: ShipHoService }`
  - `interface BrandEstimate { chargedVnd: number; currency: 'VND'; provisional: true; service: ShipHoService; lines: {label:string;amountVnd:number}[]; notes: string[] }`
  - `type EstimateResult = { ok: true; estimate: BrandEstimate } | { ok: false; code: 'brand_not_approved'|'no_carrier'|'quote_failed'|'service_unavailable'|'bad_input'; error: string }`
  - `function neutralNotes(): string[]`
  - `async function estimateForBrand(brandSlug: string, parcel: EstimateParcel): Promise<EstimateResult>`

- [ ] **Step 1: Viết test thất bại (phần thuần: nhãn trung tính)**

Tạo `features/ship-ho/brand-estimate-labels.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { neutralNotes } from './brand-estimate';

describe('neutralNotes — không lộ tên hãng', () => {
  it('không chứa "FedEx"/"DHL"', () => {
    const joined = neutralNotes().join(' ');
    expect(joined).not.toMatch(/fedex|dhl/i);
  });
  it('nêu phụ phí xăng dầu theo tuần + giá dự kiến theo cân/kích thước', () => {
    const joined = neutralNotes().join(' ');
    expect(joined).toMatch(/xăng dầu/i);
    expect(joined).toMatch(/dự kiến|cân|kích thước/i);
  });
});
```

- [ ] **Step 2: Chạy test để xác nhận FAIL**

Run: `npx vitest run features/ship-ho/brand-estimate-labels.test.ts`
Expected: FAIL — module chưa tồn tại.

- [ ] **Step 3: Viết implementation**

Tạo `features/ship-ho/brand-estimate.ts`:

```ts
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { listAccounts } from '@/features/carrier-rates/actions';
import { loadAccountSnapshot } from '@/features/carrier-rates/engine/load';
import { quote } from '@/features/carrier-rates/engine/quote';
import { pickCarrierCostVnd, pickBaseVnd } from './quote-adapter';
import { computeBrandCharge } from './brand-pricing';

export type ShipHoService = 'express' | 'standard';

export interface EstimateParcel {
  country: string; city?: string; postcode?: string;
  weightKg: number;
  dimLengthCm?: number; dimWidthCm?: number; dimHeightCm?: number;
  packagingType?: 'bag' | 'box' | null;
  service?: ShipHoService;
}

export interface BrandEstimate {
  chargedVnd: number; currency: 'VND'; provisional: true; service: ShipHoService;
  lines: { label: string; amountVnd: number }[];
  notes: string[];
}

export type EstimateResult =
  | { ok: true; estimate: BrandEstimate }
  | { ok: false; code: 'brand_not_approved' | 'no_carrier' | 'quote_failed' | 'service_unavailable' | 'bad_input'; error: string };

const SERVICE_LABEL: Record<ShipHoService, string> = { express: 'Express Delivery', standard: 'Standard Delivery' };

export function neutralNotes(): string[] {
  return [
    'Giá dự kiến theo cân nặng & kích thước khai báo; hóa đơn cuối tính theo cân & phụ phí thực tế.',
    'Phụ phí xăng dầu áp theo tuần giao hàng của đơn vị vận chuyển.',
    'Đã gồm VAT.',
  ];
}

/** Quy field breakdown (cost currency) về VND theo currency của account. */
function toVndFactor(snap: { costCurrency: string; displayCurrency: string; fxCostPerDisplay: number }): number | null {
  if (snap.costCurrency === 'VND') return 1;
  if (snap.displayCurrency === 'VND') return 1 / snap.fxCostPerDisplay;
  return null;
}

export async function estimateForBrand(brandSlug: string, parcel: EstimateParcel): Promise<EstimateResult> {
  const service: ShipHoService = parcel.service ?? 'express';
  if (service === 'standard') return { ok: false, code: 'service_unavailable', error: 'Standard Delivery chưa khả dụng' };
  if (!parcel.country?.trim() || !Number.isFinite(parcel.weightKg) || parcel.weightKg <= 0) {
    return { ok: false, code: 'bad_input', error: 'Thiếu quốc gia hoặc cân nặng không hợp lệ' };
  }

  const [partner] = await db.select().from(schema.shipHoPartners)
    .where(eq(schema.shipHoPartners.brandSlug, brandSlug)).limit(1);
  if (!partner || partner.status !== 'active' || !partner.selfServiceEnabled) {
    return { ok: false, code: 'brand_not_approved', error: 'Brand chưa được kích hoạt dịch vụ này' };
  }

  // Express = account FedEx đang bật (map service→account chốt khi có nhiều line; hiện lấy FedEx enabled đầu tiên).
  const account = (await listAccounts()).find((a) => a.enabled && a.carrierKey === 'fedex');
  if (!account) return { ok: false, code: 'no_carrier', error: 'Chưa cấu hình đơn vị vận chuyển' };
  const snap = await loadAccountSnapshot(account.id);
  if (!snap) return { ok: false, code: 'no_carrier', error: 'Chưa nạp được bảng giá' };

  const dims = parcel.dimLengthCm && parcel.dimWidthCm && parcel.dimHeightCm
    ? { lengthCm: parcel.dimLengthCm, widthCm: parcel.dimWidthCm, heightCm: parcel.dimHeightCm } : null;

  const res = quote(snap, {
    weightKg: parcel.weightKg, dimensions: dims, packagingType: parcel.packagingType ?? null,
    destinationCountry: parcel.country.trim().toUpperCase(),
    destinationPostcode: parcel.postcode, destinationCity: parcel.city,
  });
  if (!res.ok) return { ok: false, code: 'quote_failed', error: 'Không tính được cước cho tuyến này' };

  const carrierCost = pickCarrierCostVnd(snap, res.breakdown);
  const base = pickBaseVnd(snap, res.breakdown);
  const factor = toVndFactor(snap);
  if (!carrierCost.ok || !base.ok || factor === null) {
    return { ok: false, code: 'quote_failed', error: 'Cấu hình tiền tệ không hỗ trợ' };
  }

  const b = res.breakdown;
  const surchargesVnd = Math.round(
    (b.remote + b.residential + b.perKg + b.demand + b.countryFixed + b.perStep + b.peak + b.addons) * factor,
  );
  const parts = { surchargesVnd, fuelRealVnd: Math.round(b.fuel * factor), vatRealVnd: Math.round(b.vat * factor) };

  const { chargedVnd, lines } = computeBrandCharge({
    carrierCostVnd: carrierCost.vnd, baseVnd: base.vnd,
    fuelPercent: b.fuelPercent, vatPercent: b.vatPercent, markupPercent: Number(partner.markupPercent),
    parts, serviceLabel: SERVICE_LABEL[service],
  });

  return { ok: true, estimate: { chargedVnd, currency: 'VND', provisional: true, service, lines, notes: neutralNotes() } };
}
```

- [ ] **Step 4: Chạy test + type-check**

Run: `npx vitest run features/ship-ho/brand-estimate-labels.test.ts`
Expected: PASS.
Run: `npx tsc --noEmit`
Expected: PASS. (Nếu `quote`/`loadAccountSnapshot` import path khác — kiểm bằng `grep -n "export function quote\|export.*loadAccountSnapshot" features/carrier-rates/engine/*.ts` và sửa import cho đúng.)

- [ ] **Step 5: Commit**

```bash
git add features/ship-ho/brand-estimate.ts features/ship-ho/brand-estimate-labels.test.ts
git commit -m "feat(ship-ho): estimateForBrand — quote FedEx Express → giá brand minh bạch, nhãn trung tính

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: API estimate `POST /api/mmp/ship-ho/estimate`

**Files:**
- Create: `app/api/mmp/ship-ho/estimate/route.ts`

**Interfaces:**
- Consumes: `estimateForBrand`, `EstimateParcel` (Task 3); `verifyMmpSignature` (`@/features/mmp/hmac`).

- [ ] **Step 1: Viết route**

Tạo `app/api/mmp/ship-ho/estimate/route.ts`:

```ts
/**
 * POST /api/mmp/ship-ho/estimate
 * MMP → SMS: brand estimate giá 1 kiện. HMAC SHA-256 (x-mean-signature, x-mean-timestamp).
 * Body: { brandSlug, parcel: { country, city?, postcode?, weightKg, dimLengthCm?, dimWidthCm?, dimHeightCm?, packagingType?, service? } }
 */
import { NextResponse, type NextRequest } from 'next/server';
import { verifyMmpSignature } from '@/features/mmp/hmac';
import { estimateForBrand, type EstimateParcel } from '@/features/ship-ho/brand-estimate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CODE_STATUS: Record<string, number> = {
  brand_not_approved: 403, no_carrier: 422, quote_failed: 422, service_unavailable: 422, bad_input: 400,
};

export async function POST(req: NextRequest): Promise<Response> {
  const secret = process.env.MMP_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: 'MMP_WEBHOOK_SECRET not configured' }, { status: 500 });

  const rawBody = await req.text();
  const hmac = verifyMmpSignature({
    secret, rawBody,
    signatureHeader: req.headers.get('x-mean-signature'),
    timestampHeader: req.headers.get('x-mean-timestamp'),
  });
  if (!hmac.ok) return NextResponse.json({ error: 'signature verification failed', reason: hmac.reason }, { status: 401 });

  let body: { brandSlug?: string; parcel?: EstimateParcel };
  try { body = JSON.parse(rawBody); } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }); }
  if (!body.brandSlug || !body.parcel?.country || !(Number(body.parcel?.weightKg) > 0)) {
    return NextResponse.json({ error: 'brandSlug + parcel.country + parcel.weightKg(>0) required' }, { status: 400 });
  }

  const r = await estimateForBrand(body.brandSlug, body.parcel);
  if (!r.ok) return NextResponse.json({ error: r.error, code: r.code }, { status: CODE_STATUS[r.code] ?? 400 });
  return NextResponse.json({ ok: true, estimate: r.estimate });
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Smoke test HMAC (thủ công, tùy chọn)**

Với `MMP_WEBHOOK_SECRET` set, ký `${ts}.${body}` bằng HMAC-SHA256 và gọi route; thiếu chữ ký → 401; body thiếu → 400; brand chưa approve → 403. (Nếu chưa có công cụ ký, bỏ qua — verify ở tầng tích hợp.)

- [ ] **Step 4: Commit**

```bash
git add "app/api/mmp/ship-ho/estimate/route.ts"
git commit -m "feat(ship-ho): API POST /api/mmp/ship-ho/estimate (HMAC) — brand estimate giá

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## PHASE 2 — Nhận đơn + surface cho MEAN

### Task 5: Sinh mã đơn brand (sequence) — I/O + thuần format

**Files:**
- Create: `features/ship-ho/brand-order-code.ts`
- Test: `features/ship-ho/brand-order-code.test.ts`

**Interfaces:**
- Produces:
  - `function formatBrandOrderCode(seq: number): string` (thuần)
  - `async function nextBrandOrderCode(): Promise<{ code: string; seq: number }>` (I/O: `nextval` sequence)

- [ ] **Step 1: Viết test thất bại (phần thuần)**

Tạo `features/ship-ho/brand-order-code.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { formatBrandOrderCode } from './brand-order-code';

describe('formatBrandOrderCode (tạm — dãy số)', () => {
  it('prefix SH + số', () => {
    expect(formatBrandOrderCode(1000)).toBe('SH1000');
    expect(formatBrandOrderCode(1234)).toBe('SH1234');
  });
});
```

- [ ] **Step 2: Chạy test để xác nhận FAIL**

Run: `npx vitest run features/ship-ho/brand-order-code.test.ts`
Expected: FAIL — module chưa tồn tại.

- [ ] **Step 3: Viết implementation**

Tạo `features/ship-ho/brand-order-code.ts`:

```ts
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';

/** THUẦN: format mã đơn brand (tạm dùng dãy số; backfill format chính thức sau). */
export function formatBrandOrderCode(seq: number): string {
  return `SH${seq}`;
}

/** I/O: lấy số tiếp theo từ sequence Postgres → { code, seq }. */
export async function nextBrandOrderCode(): Promise<{ code: string; seq: number }> {
  const rows = await db.execute<{ seq: string }>(sql`SELECT nextval('ship_ho_mmp_order_seq') AS seq`);
  const seq = Number((rows as unknown as { rows: { seq: string }[] }).rows?.[0]?.seq ?? (rows as { seq: string }[])[0]?.seq);
  return { code: formatBrandOrderCode(seq), seq };
}
```

*(Ghi chú impl: `db.execute` shape kết quả tùy driver — kiểm bằng cách log 1 lần khi build; điều chỉnh cách đọc `seq` cho khớp. Chỉ `formatBrandOrderCode` cần test thuần.)*

- [ ] **Step 4: Chạy test + type-check**

Run: `npx vitest run features/ship-ho/brand-order-code.test.ts`
Expected: PASS.
Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add features/ship-ho/brand-order-code.ts features/ship-ho/brand-order-code.test.ts
git commit -m "feat(ship-ho): sinh mã đơn brand tạm (sequence SH{n}) + format thuần

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: API nhận đơn `POST /api/mmp/ship-ho/orders`

**Files:**
- Create: `features/ship-ho/brand-order-intake.ts`
- Create: `app/api/mmp/ship-ho/orders/route.ts`

**Interfaces:**
- Consumes: `estimateForBrand` (Task 3); `nextBrandOrderCode` (Task 5); `validateAddressExtra` (`@/lib/geo/address-requirements`); `db, schema`; `verifyMmpSignature`.
- Produces: `async function intakeBrandOrder(input: BrandOrderInput): Promise<{ ok: true; orderId: string; code: string; idempotent?: boolean; estimate: BrandEstimate } | { ok: false; code: string; error: string }>`.

- [ ] **Step 1: Viết core intake (I/O)**

Tạo `features/ship-ho/brand-order-intake.ts`:

```ts
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { validateAddressExtra } from '@/lib/geo/address-requirements';
import { estimateForBrand, type EstimateParcel, type BrandEstimate } from './brand-estimate';
import { nextBrandOrderCode } from './brand-order-code';

export interface BrandOrderInput {
  brandSlug: string;
  mmpRef: string;
  recipient?: { name?: string; phone?: string };
  address: {
    country: string; city?: string; province?: string; postcode?: string;
    address1?: string; address2?: string;
    houseNumber?: string; shortAddress?: string; mapsUrl?: string;
  };
  parcel: EstimateParcel;
}

export type IntakeResult =
  | { ok: true; orderId: string; code: string; idempotent?: boolean; estimate: BrandEstimate }
  | { ok: false; code: 'brand_not_approved' | 'bad_input' | 'quote_failed' | 'no_carrier' | 'service_unavailable'; error: string };

export async function intakeBrandOrder(input: BrandOrderInput): Promise<IntakeResult> {
  if (!input.brandSlug || !input.mmpRef || !input.address?.country) {
    return { ok: false, code: 'bad_input', error: 'brandSlug + mmpRef + address.country required' };
  }

  // Idempotency theo mmp_ref.
  const [existing] = await db.select().from(schema.shipHoOrders)
    .where(eq(schema.shipHoOrders.mmpRef, input.mmpRef)).limit(1);

  // Estimate (cũng là guard approve + quote). Đơn brand luôn Express ở phase này.
  const est = await estimateForBrand(input.brandSlug, { ...input.parcel, country: input.address.country, service: 'express' });
  if (!est.ok) return { ok: false, code: est.code, error: est.error };

  if (existing) {
    return { ok: true, orderId: existing.id, code: existing.code, idempotent: true, estimate: est.estimate };
  }

  // Validate địa chỉ theo nước (SA short-address/maps, GCC house-number).
  const extra = validateAddressExtra(input.address.country, {
    houseNumber: input.address.houseNumber, shortAddress: input.address.shortAddress, mapsUrl: input.address.mapsUrl,
  });
  if (!extra.ok) return { ok: false, code: 'bad_input', error: extra.error ?? 'Thiếu thông tin địa chỉ' };

  const { code, seq } = await nextBrandOrderCode();

  const [row] = await db.insert(schema.shipHoOrders).values({
    code, partnerBrandSlug: input.brandSlug,
    source: 'mmp', mmpRef: input.mmpRef, mmpOrderSeq: seq, service: 'express',
    recipientName: input.recipient?.name || null, recipientPhone: input.recipient?.phone || null,
    country: input.address.country.trim().toUpperCase(), city: input.address.city || null,
    province: input.address.province || null, postcode: input.address.postcode || null,
    address1: input.address.address1 || null, address2: input.address.address2 || null,
    houseNumber: extra.normalized.houseNumber ?? null, shortAddress: extra.normalized.shortAddress ?? null, mapsUrl: extra.normalized.mapsUrl ?? null,
    weightKg: String(input.parcel.weightKg),
    dimLengthCm: input.parcel.dimLengthCm != null ? String(input.parcel.dimLengthCm) : null,
    dimWidthCm: input.parcel.dimWidthCm != null ? String(input.parcel.dimWidthCm) : null,
    dimHeightCm: input.parcel.dimHeightCm != null ? String(input.parcel.dimHeightCm) : null,
    packagingType: input.parcel.packagingType ?? null,
    chargedVnd: String(est.estimate.chargedVnd), quotedAt: new Date(),
    status: 'draft', createdBy: `mmp:${input.brandSlug}`,
  }).returning({ id: schema.shipHoOrders.id });

  return { ok: true, orderId: row.id, code, estimate: est.estimate };
}
```

- [ ] **Step 2: Viết route**

Tạo `app/api/mmp/ship-ho/orders/route.ts`:

```ts
/**
 * POST /api/mmp/ship-ho/orders
 * MMP → SMS: brand tạo đơn ship hộ. HMAC SHA-256 (x-mean-signature, x-mean-timestamp).
 * SMS sinh mã order mới; idempotent theo mmpRef.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { verifyMmpSignature } from '@/features/mmp/hmac';
import { intakeBrandOrder, type BrandOrderInput } from '@/features/ship-ho/brand-order-intake';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CODE_STATUS: Record<string, number> = {
  brand_not_approved: 403, bad_input: 400, quote_failed: 422, no_carrier: 422, service_unavailable: 422,
};

export async function POST(req: NextRequest): Promise<Response> {
  const secret = process.env.MMP_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: 'MMP_WEBHOOK_SECRET not configured' }, { status: 500 });

  const rawBody = await req.text();
  const hmac = verifyMmpSignature({
    secret, rawBody,
    signatureHeader: req.headers.get('x-mean-signature'),
    timestampHeader: req.headers.get('x-mean-timestamp'),
  });
  if (!hmac.ok) return NextResponse.json({ error: 'signature verification failed', reason: hmac.reason }, { status: 401 });

  let body: BrandOrderInput;
  try { body = JSON.parse(rawBody); } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }); }

  const r = await intakeBrandOrder(body);
  if (!r.ok) return NextResponse.json({ error: r.error, code: r.code }, { status: CODE_STATUS[r.code] ?? 400 });
  return NextResponse.json({ ok: true, orderId: r.orderId, code: r.code, idempotent: r.idempotent ?? false, estimate: r.estimate });
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add features/ship-ho/brand-order-intake.ts "app/api/mmp/ship-ho/orders/route.ts"
git commit -m "feat(ship-ho): API POST /api/mmp/ship-ho/orders — nhận đơn brand, SMS sinh mã, idempotent

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Surface nguồn 'mmp' cho MEAN (danh sách ship hộ)

**Files:**
- Modify: `app/(dashboard)/f/ship-ho/page.tsx`
- Modify: `features/ship-ho/queries.ts` (nếu list query chọn cột tường minh)

**Interfaces:**
- Consumes: cột `source` (Task 1).

- [ ] **Step 1: Xác minh list query trả `source`**

Run: `grep -n "shipHoOrders\|source\|select" features/ship-ho/queries.ts | head`
Nếu list orders dùng `db.select().from(shipHoOrders)` (toàn bộ) → `source` tự có. Nếu chọn cột tường minh → thêm `source: schema.shipHoOrders.source` vào select.

- [ ] **Step 2: Hiện nhãn nguồn + đọc filter từ query param**

Trong `app/(dashboard)/f/ship-ho/page.tsx`, thêm nhãn "Nguồn" cho mỗi đơn: hiển thị badge `MMP` khi `o.source === 'mmp'` (cạnh mã đơn), và hỗ trợ lọc qua `?source=mmp` (đọc `searchParams.source`, nếu `='mmp'` thì filter danh sách còn đơn brand). Ví dụ badge:

```tsx
{o.source === 'mmp' && <span className="ml-2 rounded bg-indigo-100 text-indigo-700 text-xs px-1.5 py-0.5">MMP</span>}
```

(Điều chỉnh tên biến đơn `o` + chỗ render mã cho khớp trang hiện tại — khảo sát ở Step 1.)

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add "app/(dashboard)/f/ship-ho/page.tsx" features/ship-ho/queries.ts
git commit -m "feat(ship-ho): danh sách hiện nhãn nguồn MMP cho đơn brand tạo

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Verify toàn bộ + đẩy nhánh

- [ ] **Step 1: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 2: Full test suite**

Run: `npx vitest run`
Expected: PASS (0 failed); gồm `brand-pricing`, `brand-estimate-labels`, `brand-order-code`.

- [ ] **Step 3: Đẩy nhánh (chỉ khi xanh)**

```bash
git push -u origin docs/ship-ho-brand-self-service
```

---

## Self-Review

**Spec coverage (Phase 1+2 của spec):**
- Cổng approve (`self_service_enabled`) + source/mmp_ref/service + sequence mã → Task 1. ✅
- Công thức giá brand Option A (`computeBrandCharge`) → Task 2. ✅
- `estimateForBrand` + nhãn trung tính + service Express/Standard → Task 3. ✅
- API estimate HMAC → Task 4. ✅
- Mã đơn SMS sinh (dãy số tạm, backfill sau) → Task 5. ✅
- API nhận đơn (idempotency mmp_ref, validate địa chỉ theo nước, giá dự kiến, source='mmp') → Task 6. ✅
- Surface nguồn cho MEAN → Task 7. ✅
- Không lộ tên hãng/cước gốc/margin/markup → ràng buộc global + Task 2/3 (nhãn trung tính, chỉ trả chargedVnd+lines). ✅

**Ngoài phạm vi plan này (Phase 3 — plan sau):** webhook SMS→MMP (catalog sự kiện), rate card push sang MMP, backfill `updatedSince`, rebill sau bill carrier, service Standard. (Đã nêu trong spec.)

**Placeholder scan:** không TBD; các bước "chốt khi build" (đọc shape `db.execute`, map service→account) là ghi chú khảo sát có chủ đích, kèm lệnh kiểm tra cụ thể — không phải placeholder logic.

**Type consistency:**
- `computeBrandCharge(input{carrierCostVnd,baseVnd,fuelPercent,vatPercent,markupPercent,parts,serviceLabel}) → {chargedVnd,lines}` nhất quán Task 2↔3. ✅
- `estimateForBrand(brandSlug, EstimateParcel) → EstimateResult` dùng ở Task 4/6. ✅
- `EstimateParcel`/`BrandEstimate`/`ShipHoService` khai ở Task 3, tiêu thụ ở Task 4/6. ✅
- `nextBrandOrderCode() → {code,seq}` (Task 5) dùng ở Task 6. ✅
- `validateAddressExtra(country,{houseNumber,shortAddress,mapsUrl}) → {ok,error?,normalized}` (đã có) dùng ở Task 6. ✅
- Cột `source/mmpRef/service/mmpOrderSeq/selfServiceEnabled` (Task 1) dùng ở Task 3/6/7. ✅
