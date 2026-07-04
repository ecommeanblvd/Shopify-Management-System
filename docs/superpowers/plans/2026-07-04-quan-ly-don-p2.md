# Quản lí đơn P2 — trang chi tiết hợp nhất (4 lớp/point) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Trang chi tiết đơn hợp nhất: mỗi giai đoạn hiện 4 lớp (cần làm gì · thông tin gì · estimate · thực-vs-dự-kiến), pill "việc hiện tại" từ worklist, hấp thụ address-verify + Lark; rồi trỏ worklist list + fulfillment detail về trang này.

**Architecture:** 2 module thuần mới (`playbook.ts`, `stage-timing.ts`) + 1 query gom (`getOrderDossier`) tái dùng query sẵn có + rewrite `/f/lifecycle/[orderId]` render 4 lớp. Đọc-thuần, KHÔNG migration.

**Tech Stack:** Next.js App Router, Drizzle, React 19, Tailwind, Vitest.

## Global Constraints

- KHÔNG migration, KHÔNG ghi DB mới (address-verify server action đã có sẵn, chỉ render lại card).
- Tái dùng query sẵn (map từ Explore): `getLifecycle`, `getFulfillmentDetail`, `listBrandRequestsForOrder`, `listPacksForOrder`, `getMmpPushInfo`, `getLarkRecordsForOrder`, `deriveOrderStage`, `computeDurations`, `buildTimeline`, `statusLabel`, `stageProgress`, `nextStage`, `MAIN_CHAIN`, `STAGE_LABELS`, `fmtDuration`.
- RBAC `view_fulfillment` giữ nguyên.
- Current-stage on-track/late: DÙNG `lifecycle.deadline`+`delayStatus`+`statusLabel` (đã đúng), KHÔNG tự tính lại.
- Tiếng Việt, sentence case, lucide tên chuẩn.

---

### Task 1: `features/lifecycle/playbook.ts` — playbook static + test

**Files:** Create `features/lifecycle/playbook.ts`, Test `features/lifecycle/playbook.test.ts`

**Interfaces:**
- Produces: `InfoKey`, `StagePlaybook`, `STAGE_PLAYBOOK`, `stagePlaybook(stage)`.

- [ ] **Step 1: Test (FAIL)**

```ts
// features/lifecycle/playbook.test.ts
import { describe, it, expect } from 'vitest';
import { STAGE_PLAYBOOK, stagePlaybook } from './playbook';
import { STAGE_ORDER } from './display';

describe('STAGE_PLAYBOOK', () => {
  it('có entry cho mọi StageKey trong STAGE_ORDER', () => {
    for (const s of STAGE_ORDER) {
      const p = stagePlaybook(s);
      expect(p.whatToDo.length).toBeGreaterThan(0);
      expect(Array.isArray(p.infoKeys)).toBe(true);
    }
  });
  it('production nhắc brand + KCS', () => {
    expect(stagePlaybook('production').infoKeys).toContain('brand');
    expect(stagePlaybook('production').infoKeys).toContain('brandEta');
  });
  it('shipped có carrier + tracking', () => {
    expect(stagePlaybook('shipped').infoKeys).toContain('tracking');
  });
});
```

- [ ] **Step 2: FAIL** — `npx vitest run features/lifecycle/playbook.test.ts`

- [ ] **Step 3: Implement**

```ts
// features/lifecycle/playbook.ts
/** THUẦN: playbook vận hành tĩnh theo giai đoạn vòng đời. */
import type { StageKey } from './derive';

export type InfoKey =
  | 'address' | 'items' | 'brand' | 'brandEta' | 'brandRequests'
  | 'kcs' | 'packs' | 'carrier' | 'tracking' | 'deliveryStatus' | 'refund';

export interface StagePlaybook { whatToDo: string; infoKeys: InfoKey[] }

export const STAGE_PLAYBOOK: Record<StageKey, StagePlaybook> = {
  placed: { whatToDo: 'Xác nhận đơn, kiểm tồn kho, quyết định lấy từ kho hay push brand.', infoKeys: ['address', 'items'] },
  production: { whatToDo: 'Theo dõi brand xác nhận + gửi hàng về kho; giục KCS ngay khi hàng tới.', infoKeys: ['brand', 'brandEta', 'brandRequests', 'kcs'] },
  qc: { whatToDo: 'Đối chiếu KCS pass/fail; xử lý hàng lỗi trước khi đóng gói.', infoKeys: ['kcs', 'items', 'packs'] },
  packed: { whatToDo: 'Lên vận đơn, cân kiện, bàn giao carrier.', infoKeys: ['packs', 'carrier', 'address'] },
  shipped: { whatToDo: 'Theo dõi tracking; xử lý sự cố; báo khách khi cần.', infoKeys: ['carrier', 'tracking', 'deliveryStatus', 'address'] },
  in_transit: { whatToDo: 'Theo dõi hành trình carrier; can thiệp nếu kẹt.', infoKeys: ['carrier', 'tracking', 'deliveryStatus'] },
  out_for_delivery: { whatToDo: 'Giao trong ngày; sẵn sàng xử lý giao thất bại.', infoKeys: ['carrier', 'tracking', 'deliveryStatus', 'address'] },
  post_delivery: { whatToDo: 'Theo dõi return/refund trong 30 ngày trước khi đóng đơn.', infoKeys: ['deliveryStatus', 'refund'] },
  completed: { whatToDo: 'Đơn đã hoàn tất — không còn việc.', infoKeys: [] },
  refunded_full: { whatToDo: 'Đơn đã hoàn tiền toàn phần.', infoKeys: ['refund'] },
  cancelled: { whatToDo: 'Đơn đã huỷ.', infoKeys: [] },
};

export function stagePlaybook(stage: StageKey): StagePlaybook {
  return STAGE_PLAYBOOK[stage];
}
```

- [ ] **Step 4: PASS** — `npx vitest run features/lifecycle/playbook.test.ts`
- [ ] **Step 5: tsc + commit**

```bash
git add features/lifecycle/playbook.ts features/lifecycle/playbook.test.ts
git commit -m "feat(orders): playbook static theo giai đoạn (cần làm gì + info keys)"
```

---

### Task 2: `features/lifecycle/stage-timing.ts` — estimate/actual theo đoạn + test

**Files:** Create `features/lifecycle/stage-timing.ts`, Test `features/lifecycle/stage-timing.test.ts`

**Interfaces:**
- Consumes: `computeDurations`, `SLA_SEGMENTS`, `type SlaKey`, `type DurationMilestones` (`./stats-logic`); `type StageKey` (`./derive`).
- Produces: `STAGE_SEGMENT`, `SegmentTiming`, `segmentTimings(m, sla)`, `stageEstimateHrs(stage, sla)`.

- [ ] **Step 1: Test (FAIL)**

```ts
// features/lifecycle/stage-timing.test.ts
import { describe, it, expect } from 'vitest';
import { segmentTimings, stageEstimateHrs, STAGE_SEGMENT } from './stage-timing';
import type { SlaKey } from './stats-logic';

const SLA: Record<SlaKey, number> = {
  placed_to_production: 24, production: 240, qc: 48, pack: 48, ship: 24, deliver: 168,
};
const H = 3600_000;
const base = new Date('2026-01-01T00:00:00Z').getTime();
const at = (h: number) => new Date(base + h * H);

describe('segmentTimings', () => {
  it('đủ mốc → actual + verdict đúng/trễ theo SLA', () => {
    const rows = segmentTimings({
      placedAt: at(0), productionStartAt: at(10), goodsReceivedAt: at(300),
      qcPassAt: at(310), packedAt: at(320), shippedAt: at(330), deliveredAt: at(400),
    }, SLA);
    const by = Object.fromEntries(rows.map((r) => [r.segment, r]));
    expect(by.placed_to_production.actualHrs).toBe(10);
    expect(by.placed_to_production.verdict).toBe('đúng'); // 10 <= 24
    expect(by.production.actualHrs).toBe(290);
    expect(by.production.verdict).toBe('trễ');            // 290 > 240
  });
  it('thiếu mốc → actual null + verdict null', () => {
    const rows = segmentTimings({
      placedAt: at(0), productionStartAt: null, goodsReceivedAt: null,
      qcPassAt: null, packedAt: null, shippedAt: null, deliveredAt: null,
    }, SLA);
    const by = Object.fromEntries(rows.map((r) => [r.segment, r]));
    expect(by.production.actualHrs).toBeNull();
    expect(by.production.verdict).toBeNull();
    expect(by.production.estimateHrs).toBe(240);
  });
});

describe('stageEstimateHrs', () => {
  it('map stage → SLA đoạn tương ứng', () => {
    expect(stageEstimateHrs('qc', SLA)).toBe(48);
    expect(stageEstimateHrs('shipped', SLA)).toBe(24);
    expect(stageEstimateHrs('completed', SLA)).toBeNull();
  });
  it('STAGE_SEGMENT có mọi stage', () => {
    expect(STAGE_SEGMENT.placed).toBe('placed_to_production');
    expect(STAGE_SEGMENT.completed).toBeNull();
  });
});
```

- [ ] **Step 2: FAIL** — `npx vitest run features/lifecycle/stage-timing.test.ts`

- [ ] **Step 3: Implement**

```ts
// features/lifecycle/stage-timing.ts
/** THUẦN: đối chiếu thời gian thực từng đoạn với SLA + estimate cho stage. */
import { computeDurations, SLA_SEGMENTS, type SlaKey, type DurationMilestones } from './stats-logic';
import type { StageKey } from './derive';

export interface SegmentTiming {
  segment: SlaKey;
  actualHrs: number | null;
  estimateHrs: number;
  verdict: 'đúng' | 'trễ' | null;
}

/** Thực tế từng đoạn (từ mốc) so SLA → verdict. */
export function segmentTimings(m: DurationMilestones, sla: Record<SlaKey, number>): SegmentTiming[] {
  const dur = computeDurations(m);
  return SLA_SEGMENTS.map((seg) => {
    const actualHrs = dur[seg];
    const estimateHrs = sla[seg];
    const verdict: SegmentTiming['verdict'] = actualHrs == null ? null : actualHrs > estimateHrs ? 'trễ' : 'đúng';
    return { segment: seg, actualHrs, estimateHrs, verdict };
  });
}

/** Stage → đoạn SLA để hiện "dự kiến" ở point (preview stage chưa tới). */
export const STAGE_SEGMENT: Record<StageKey, SlaKey | null> = {
  placed: 'placed_to_production',
  production: 'production',
  qc: 'qc',
  packed: 'pack',
  shipped: 'ship',
  in_transit: 'deliver',
  out_for_delivery: 'deliver',
  post_delivery: null,
  completed: null,
  refunded_full: null,
  cancelled: null,
};

export function stageEstimateHrs(stage: StageKey, sla: Record<SlaKey, number>): number | null {
  const seg = STAGE_SEGMENT[stage];
  return seg ? sla[seg] : null;
}
```

- [ ] **Step 4: PASS** — `npx vitest run features/lifecycle/stage-timing.test.ts`
- [ ] **Step 5: tsc + commit**

```bash
git add features/lifecycle/stage-timing.ts features/lifecycle/stage-timing.test.ts
git commit -m "feat(orders): stage-timing — thực vs SLA từng đoạn + estimate theo stage"
```

---

### Task 3: `features/orders/dossier.ts` — `getOrderDossier` gom dữ liệu

**Files:** Create `features/orders/dossier.ts`

**Interfaces:**
- Consumes (chữ ký từ Explore): `getLifecycle(orderId)` (`@/features/lifecycle/queries`), `getFulfillmentDetail(orderId)` (`@/features/fulfillment/queries` → `{ address, lines }`), `listBrandRequestsForOrder(orderId)` (`@/features/fulfillment/brand-queries`), `listPacksForOrder(orderId)` (`@/features/packing/queries`), `getMmpPushInfo(orderId)` (`@/features/mmp/order-push-query`), `getLarkRecordsForOrder(orderId)` (`@/features/lark/detail`), `deriveOrderStage`, `type StageSignals`, `type OrderStage` (`@/features/fulfillment/order-stage`).
- Produces: `interface OrderDossier`, `getOrderDossier(orderId): Promise<OrderDossier | null>`.

- [ ] **Step 1: Implement**

```ts
// features/orders/dossier.ts
import { getLifecycle } from '@/features/lifecycle/queries';
import { getFulfillmentDetail } from '@/features/fulfillment/queries';
import { listBrandRequestsForOrder } from '@/features/fulfillment/brand-queries';
import { listPacksForOrder } from '@/features/packing/queries';
import { getMmpPushInfo } from '@/features/mmp/order-push-query';
import { getLarkRecordsForOrder } from '@/features/lark/detail';
import { deriveOrderStage, type StageSignals, type OrderStage } from '@/features/fulfillment/order-stage';

type Lifecycle = NonNullable<Awaited<ReturnType<typeof getLifecycle>>>;
type FulfillmentDetail = Awaited<ReturnType<typeof getFulfillmentDetail>>;
type Pack = Awaited<ReturnType<typeof listPacksForOrder>>[number];
type BrandReq = Awaited<ReturnType<typeof listBrandRequestsForOrder>>[number];
type LarkRecord = Awaited<ReturnType<typeof getLarkRecordsForOrder>>[number];

export interface OrderDossier {
  lifecycle: Lifecycle;
  address: NonNullable<FulfillmentDetail>['address'] | null;
  lines: NonNullable<FulfillmentDetail>['lines'];
  brandRequests: BrandReq[];
  packs: Pack[];
  larkRecords: LarkRecord[];
  currentAction: OrderStage; // deriveOrderStage — "việc hiện tại"
}

export async function getOrderDossier(orderId: string): Promise<OrderDossier | null> {
  const lifecycle = await getLifecycle(orderId);
  if (!lifecycle) return null;

  // Lark best-effort (lỗi → []).
  const larkSafe = getLarkRecordsForOrder(orderId).catch(() => []);
  const [detail, brandRequests, packs, mmp, larkRecords] = await Promise.all([
    getFulfillmentDetail(orderId),
    listBrandRequestsForOrder(orderId),
    listPacksForOrder(orderId),
    getMmpPushInfo(orderId),
    larkSafe,
  ]);

  // Build StageSignals cho "việc hiện tại".
  const ship = {
    packs: packs.length,
    withTracking: packs.filter((p) => p.trackingNumber).length,
    delivered: packs.filter((p) => p.deliveryStatus === 'delivered').length,
    exception: packs.filter((p) => p.deliveryStatus === 'exception').length,
    inTransit: packs.filter((p) => p.deliveryStatus === 'in_transit').length,
    outForDelivery: packs.filter((p) => p.deliveryStatus === 'out_for_delivery').length,
  };
  const larkQc = lifecycle.qcPassAt ? 'pass' : null; // KCS: lifecycle đã stamp qcPass; fallback null
  const signals: StageSignals = {
    pushedMmp: mmp?.status === 'sent',
    larkQc,
    larkDispatch: null,
    ship,
    allInStock: (detail?.lines ?? []).every((l) => (l.warehouseCode ?? null) != null),
  };
  const currentAction = deriveOrderStage(signals);

  return {
    lifecycle,
    address: detail?.address ?? null,
    lines: detail?.lines ?? [],
    brandRequests,
    packs,
    larkRecords,
    currentAction,
  };
}
```

> Ghi chú: shape `ship`/`allInStock` là best-effort — implementer kiểm field thực tế của `listPacksForOrder`/`getFulfillmentDetail` (từ Explore: pack có `deliveryStatus`,`trackingNumber`; line có `warehouseCode`,`brandExpectedDeliveryDate`). Nếu tên field lệch, chỉnh cho khớp; giữ đúng ý nghĩa signal.

- [ ] **Step 2: tsc**

Run: `npx tsc --noEmit` → 0. (Sửa field name nếu lệch theo lỗi tsc.)

- [ ] **Step 3: Smoke test prod (đọc-thuần)**

Run: `railway run npx tsx -e "import('./features/orders/dossier.ts').then(async m => { const d = await m.getOrderDossier((await import('./db/client')).db && '00000000-0000-0000-0000-000000000000'); console.log('null?', d); process.exit(0); })" 2>&1 | tail -5` — chấp nhận null (id giả); mục đích: import + tsc runtime OK, không lỗi query. Nếu muốn id thật, lấy 1 orderId từ order_lifecycle trước.

- [ ] **Step 4: Commit**

```bash
git add features/orders/dossier.ts
git commit -m "feat(orders): getOrderDossier gom lifecycle+address+lines+brand+packs+lark+việc hiện tại"
```

---

### Task 4: Trang chi tiết hợp nhất — render 4 lớp/point + address/Lark

**Files:** Modify `app/(dashboard)/f/lifecycle/[orderId]/page.tsx`

**Interfaces:**
- Consumes: `getOrderDossier` (T3); `buildTimeline`, `fmtDuration`, `STAGE_LABELS`, `MAIN_CHAIN`, `nextStage`, `stageProgress`, `statusLabel`, `type StageKey` (display/derive); `stagePlaybook`, `type InfoKey` (T1); `segmentTimings`, `stageEstimateHrs` (T2); `AddressVerifyCard`, `LarkDetailCard` (components/fulfillment); auth/getRole/hasPermission như hiện tại.

- [ ] **Step 1: Rewrite page**

Giữ RBAC gate + `notFound` như hiện tại nhưng đổi `getLifecycle` → `getOrderDossier`. Render (dựa mockup đã duyệt):
1. Header: order# (+⚠ exception) · store · "hiện tại [stage] → chờ [nextStage]" · chip `statusLabel(delayStatus, delayHours)` · pill "việc hiện tại" = `dossier.currentAction.label`.
2. Stepper ngang `MAIN_CHAIN` (giữ code stepper hiện có).
3. **Hành trình** — timeline `buildTimeline(lifecycle, syncedAt)` + `segmentTimings(lifecycle, sla)`:
   - Mỗi point đã-đạt: mốc thật + (nếu là mốc kết đoạn) badge `đúng/trễ` từ `segmentTimings` + duration thực; nhãn ≈ nếu approx.
   - **Point hiện tại** (stage): card mở rộng — pill việc worklist · "Cần làm" = `stagePlaybook(stage).whatToDo` · lưới **Thông tin** (render theo `infoKeys`, map sang dữ liệu dossier) · dòng estimate: dùng `lifecycle.deadline`/`statusLabel` (đã đúng) + "đã ở [fmtDuration timeInStage]".
   - **Point chưa tới**: `STAGE_LABELS` + "dự kiến [fmtDuration stageEstimateHrs(stage, sla)]" + preview playbook.
4. **Panel thông tin bổ trợ**: `<AddressVerifyCard address={dossier.address} orderId={orderId} />` + `<LarkDetailCard records={dossier.larkRecords} />`.

`sla` dựng từ `listSla()` như trang stats (`Record<SlaKey, number>`, default 0 cho key thiếu — nhưng thực tế đủ 6 seed).

Lưới "Thông tin" map `InfoKey` → dossier:
- `address` → dossier.address (tỉnh/thành/nước)
- `items` → dossier.lines (số dòng, SKU)
- `brand`/`brandEta`/`brandRequests` → dossier.brandRequests (vendor, expectedDeliveryDate, count confirmed/delivered)
- `kcs` → lifecycle.qcPassAt ? 'pass' : 'chưa có'
- `packs`/`carrier`/`tracking`/`deliveryStatus` → dossier.packs (số kiện, carrierKey, trackingNumber, deliveryStatus)
- `refund` → lifecycle.refundedAt / returnProcessingAt

> Code JSX đầy đủ dài — implementer viết theo cấu trúc trên, bám mockup đã duyệt (stepper + timeline card). Giữ `dynamic='force-dynamic'`. Dùng lucide `TriangleAlert` cho exception (bản này không có AlertTriangle). Số hiển thị qua `fmtDuration`. Không tạo helper tính toán trong page — mọi verdict/estimate từ T1/T2.

- [ ] **Step 2: tsc + eslint**

Run: `npx tsc --noEmit` → 0.
Run: `npx eslint "app/(dashboard)/f/lifecycle/[orderId]/page.tsx"` → 0.

- [ ] **Step 3: Commit**

```bash
git add "app/(dashboard)/f/lifecycle/[orderId]/page.tsx"
git commit -m "feat(orders): trang chi tiết hợp nhất — 4 lớp/point + việc hiện tại + address/Lark"
```

---

### Task 5: Trỏ worklist list + fulfillment detail → trang hợp nhất

**Files:** Modify `components/fulfillment/WorklistTable.tsx`, Modify `app/(dashboard)/f/fulfillment/[orderId]/page.tsx`

**Interfaces:** none mới.

- [ ] **Step 1: WorklistTable link → unified**

Trong `components/fulfillment/WorklistTable.tsx`, đổi `href={`/f/fulfillment/${row.orderId}`}` → `href={`/f/lifecycle/${row.orderId}`}` (trỏ về trang chi tiết hợp nhất).

- [ ] **Step 2: fulfillment detail → redirect**

Thay TRỌN nội dung `app/(dashboard)/f/fulfillment/[orderId]/page.tsx` bằng redirect (giữ RBAC nhẹ hoặc redirect thẳng — trang đích tự gate):

```tsx
import { redirect } from 'next/navigation';

export default async function FulfillmentDetailRedirect({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  redirect(`/f/lifecycle/${orderId}`);
}
```

> Xoá import không dùng (AddressVerifyCard/LarkDetailCard/queries) trong file này — chúng đã chuyển sang trang hợp nhất ở Task 4.

- [ ] **Step 3: tsc + eslint + commit**

Run: `npx tsc --noEmit` → 0.
Run: `npx eslint "app/(dashboard)/f/fulfillment/[orderId]/page.tsx" components/fulfillment/WorklistTable.tsx` → 0.
```bash
git add "app/(dashboard)/f/fulfillment/[orderId]/page.tsx" components/fulfillment/WorklistTable.tsx
git commit -m "feat(orders): trỏ worklist + fulfillment detail về trang chi tiết hợp nhất"
```

---

## Self-Review (đã chạy)

- **Spec coverage:** playbook static (T1) ✓ · estimate/actual từng đoạn (T2) ✓ · dossier gom + việc hiện tại (T3) ✓ · trang 4 lớp/point + address/Lark (T4) ✓ · gộp link detail (T5) ✓ · không migration ✓.
- **Placeholder scan:** T1/T2/T3 code đầy đủ; T4 mô tả cấu trúc + mapping cụ thể (JSX dài — implementer bám mockup + T1/T2 output), không TODO.
- **Type consistency:** `StageKey` dùng chung; `DurationMilestones` (7 mốc) khớp `lifecycle` fields; `segmentTimings` nhận lifecycle (có đủ 7 mốc); `statusLabel`/`stageProgress`/`nextStage` từ display (đã có 'stale'); `getOrderDossier` type từ ReturnType của query thật (không bịa field).
- **Rủi ro:** field name pack/line có thể lệch → T3 note kiểm theo tsc; current-stage estimate DÙNG lifecycle.deadline (không tự tính, tránh sai qc/pack); redirect fulfillment detail chỉ ở T5 (sau khi T4 đã hấp thụ address/Lark) — không mất chức năng.
