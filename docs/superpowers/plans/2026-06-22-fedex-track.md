# Theo dõi đơn FedEx Track API (hệ #4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cập nhật trạng thái giao (đang chuyển/đã giao/sự cố) cho shipment FedEx qua FedEx Track API — auto cron + nút per-đơn.

**Architecture:** Tái dùng `fedexFetch`; thêm `lib/fedex/track.ts` (parse thuần), cột delivery trên `shipments`, lõi `trackAndStoreShipment`/`trackPendingShipments`, action+nút+cron+badge. Chỉ FedEx (DHL hệ sau).

**Tech Stack:** Next.js (RSC + server action), Drizzle, FedEx Track API (qua `fedexFetch`), Vitest.

## Global Constraints

- **CHỈ FedEx** đợt này (carrierKey='fedex'). DHL tách hệ sau.
- Tái dùng `lib/fedex/client.ts` `fedexFetch`. KHÔNG đụng.
- Lưu **trạng thái mới nhất** (không event history). Status rút gọn: `in_transit | out_for_delivery | delivered | exception | unknown`.
- **Rate-limit 300ms**; cron **cap 100**; chỉ poll shipment `label_created_at >= now()-45 ngày` và **chưa delivered**.
- Gate `manage_fulfillment` cho action.
- Migration hand-authored, KHÔNG chạy local — idx tiếp theo = **75**.
- Validate trước push: `npx tsc --noEmit` + `npx vitest run` + `npm run build` xanh.

---

## File Structure
- `db/schema.ts` + `db/migrations/0075_shipment-delivery-tracking.sql` + `_journal.json` — cột delivery.
- `lib/fedex/track.ts` + `lib/fedex/track.test.ts` — `mapFedexStatus`, `parseFedexTrack` (thuần), `trackFedex`.
- `features/shipments/track.ts` — `trackAndStoreShipment`, `trackPendingShipments`.
- `features/fulfillment/actions.ts` — `trackShipmentAction`.
- `features/packing/queries.ts` — `listPacksForOrder` trả delivery fields.
- `components/fulfillment/PackPanel.tsx` (+ nút client) — badge + "Cập nhật vận chuyển".
- `scripts/cron/sync-shopify-orders.ts` — chain `trackPendingShipments`.

---

## Task 1: Migration cột delivery trên shipments

**Files:**
- Modify: `db/schema.ts` (bảng `shipments`)
- Create: `db/migrations/0075_shipment-delivery-tracking.sql`
- Modify: `db/migrations/meta/_journal.json` (idx 75)

**Interfaces:**
- Produces: `schema.shipments.{deliveryStatus, deliveredAt, lastTrackedAt, trackDetail}`.

- [ ] **Step 1: Thêm cột vào schema**

Trong `db/schema.ts`, trong `shipments` pgTable (sau `labelCreatedAt`), thêm:
```ts
  deliveryStatus: text('delivery_status'),
  deliveredAt: timestamp('delivered_at'),
  lastTrackedAt: timestamp('last_tracked_at'),
  trackDetail: text('track_detail'),
```

- [ ] **Step 2: Migration SQL**

Tạo `db/migrations/0075_shipment-delivery-tracking.sql`:
```sql
ALTER TABLE "shipments" ADD COLUMN "delivery_status" text;
ALTER TABLE "shipments" ADD COLUMN "delivered_at" timestamp;
ALTER TABLE "shipments" ADD COLUMN "last_tracked_at" timestamp;
ALTER TABLE "shipments" ADD COLUMN "track_detail" text;
```

- [ ] **Step 3: Journal entry**

Trong `db/migrations/meta/_journal.json`, thêm cuối `entries` (sau idx 74, nhớ dấu `,`):
```json
    {
      "idx": 75,
      "version": "7",
      "when": 1782909600000,
      "tag": "0075_shipment-delivery-tracking",
      "breakpoints": true
    }
```

- [ ] **Step 4: tsc**

Run: `npx tsc --noEmit`
Expected: sạch.

- [ ] **Step 5: Commit**

```bash
git add db/schema.ts db/migrations/0075_shipment-delivery-tracking.sql db/migrations/meta/_journal.json
git commit -m "feat(ops): migration shipments delivery tracking (hệ #4)"
```

---

## Task 2: `lib/fedex/track.ts` — map + parse (THUẦN) + trackFedex

**Files:**
- Create: `lib/fedex/track.ts`
- Test: `lib/fedex/track.test.ts`

**Interfaces:**
- Consumes: `fedexFetch` từ `./client`.
- Produces:
  ```ts
  export type DeliveryStatus = 'in_transit' | 'out_for_delivery' | 'delivered' | 'exception' | 'unknown';
  export function mapFedexStatus(code: string | null | undefined): DeliveryStatus;
  export interface FedexTrackResult { statusCode: string | null; status: DeliveryStatus; description: string | null; deliveredAt: Date | null }
  export function parseFedexTrack(raw: unknown): FedexTrackResult;
  export function trackFedex(trackingNumber: string): Promise<FedexTrackResult>;
  ```

- [ ] **Step 1: Viết test thất bại**

Tạo `lib/fedex/track.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { mapFedexStatus, parseFedexTrack } from './track';

describe('mapFedexStatus', () => {
  it('DL → delivered', () => expect(mapFedexStatus('DL')).toBe('delivered'));
  it('OD → out_for_delivery', () => expect(mapFedexStatus('OD')).toBe('out_for_delivery'));
  it('IT/AR/DP → in_transit', () => {
    expect(mapFedexStatus('IT')).toBe('in_transit');
    expect(mapFedexStatus('AR')).toBe('in_transit');
    expect(mapFedexStatus('DP')).toBe('in_transit');
  });
  it('DE/SE/CA → exception', () => {
    expect(mapFedexStatus('DE')).toBe('exception');
    expect(mapFedexStatus('CA')).toBe('exception');
  });
  it('code lạ / rỗng → unknown', () => {
    expect(mapFedexStatus('ZZ')).toBe('unknown');
    expect(mapFedexStatus(null)).toBe('unknown');
  });
});

describe('parseFedexTrack', () => {
  const raw = {
    output: { completeTrackResults: [{ trackingNumber: '123', trackResults: [{
      latestStatusDetail: { code: 'DL', statusByLocale: 'Delivered', description: 'Delivered' },
      dateAndTimes: [{ type: 'ACTUAL_DELIVERY', dateTime: '2026-06-20T14:00:00-07:00' }],
    }] }] },
  };
  it('delivered → status + deliveredAt', () => {
    const r = parseFedexTrack(raw);
    expect(r.statusCode).toBe('DL');
    expect(r.status).toBe('delivered');
    expect(r.description).toBe('Delivered');
    expect(r.deliveredAt?.toISOString()).toBe('2026-06-20T21:00:00.000Z');
  });
  it('in transit (không có delivery date) → deliveredAt null', () => {
    const r = parseFedexTrack({ output: { completeTrackResults: [{ trackResults: [{ latestStatusDetail: { code: 'IT', statusByLocale: 'In transit' } }] }] } });
    expect(r.status).toBe('in_transit');
    expect(r.deliveredAt).toBeNull();
  });
  it('rỗng / thiếu field → unknown, null', () => {
    expect(parseFedexTrack({})).toEqual({ statusCode: null, status: 'unknown', description: null, deliveredAt: null });
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận FAIL**

Run: `npx vitest run lib/fedex/track.test.ts`
Expected: FAIL (module chưa có).

- [ ] **Step 3: Viết implementation**

Tạo `lib/fedex/track.ts`:
```ts
import { fedexFetch } from './client';

export type DeliveryStatus = 'in_transit' | 'out_for_delivery' | 'delivered' | 'exception' | 'unknown';

const STATUS_BY_CODE: Record<string, DeliveryStatus> = {
  DL: 'delivered',
  OD: 'out_for_delivery', OF: 'out_for_delivery',
  IT: 'in_transit', IN: 'in_transit', AR: 'in_transit', DP: 'in_transit', PU: 'in_transit', AF: 'in_transit', AP: 'in_transit',
  DE: 'exception', SE: 'exception', CA: 'exception', RS: 'exception',
};

export function mapFedexStatus(code: string | null | undefined): DeliveryStatus {
  if (!code) return 'unknown';
  return STATUS_BY_CODE[code.toUpperCase()] ?? 'unknown';
}

export interface FedexTrackResult {
  statusCode: string | null;
  status: DeliveryStatus;
  description: string | null;
  deliveredAt: Date | null;
}

interface TrackRaw {
  output?: { completeTrackResults?: Array<{ trackResults?: Array<{
    latestStatusDetail?: { code?: string; statusByLocale?: string; description?: string };
    dateAndTimes?: Array<{ type?: string; dateTime?: string }>;
  }> }> };
}

export function parseFedexTrack(raw: unknown): FedexTrackResult {
  const tr = (raw as TrackRaw)?.output?.completeTrackResults?.[0]?.trackResults?.[0];
  const code = tr?.latestStatusDetail?.code ?? null;
  const description = tr?.latestStatusDetail?.statusByLocale ?? tr?.latestStatusDetail?.description ?? null;
  const delISO = tr?.dateAndTimes?.find((d) => d.type === 'ACTUAL_DELIVERY')?.dateTime ?? null;
  const deliveredAt = delISO ? new Date(delISO) : null;
  return { statusCode: code, status: mapFedexStatus(code), description, deliveredAt: deliveredAt && !Number.isNaN(deliveredAt.getTime()) ? deliveredAt : null };
}

/** Gọi FedEx Track API cho 1 tracking number. */
export async function trackFedex(trackingNumber: string): Promise<FedexTrackResult> {
  const raw = await fedexFetch<unknown>('/track/v1/trackingnumbers', {
    method: 'POST',
    json: { includeDetailedScans: false, trackingInfo: [{ trackingNumberInfo: { trackingNumber } }] },
  });
  return parseFedexTrack(raw);
}
```

- [ ] **Step 4: Chạy test, xác nhận PASS**

Run: `npx vitest run lib/fedex/track.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/fedex/track.ts lib/fedex/track.test.ts
git commit -m "feat(fedex): track lib — mapFedexStatus + parseFedexTrack (thuần) + trackFedex"
```

---

## Task 3: Lõi `features/shipments/track.ts`

**Files:**
- Create: `features/shipments/track.ts`

**Interfaces:**
- Consumes: `trackFedex`, `DeliveryStatus` (Task 2); `db, schema`.
- Produces:
  ```ts
  export async function trackAndStoreShipment(shipmentId: string): Promise<{ ok: boolean; status?: DeliveryStatus; error?: string }>;
  export async function trackPendingShipments(opts?: { limit?: number }): Promise<{ tracked: number; delivered: number; failed: number }>;
  ```

Integration (db + FedEx API). Verify tsc/build; lib pure đã test ở Task 2.

- [ ] **Step 1: Viết file**

Tạo `features/shipments/track.ts`:
```ts
import { and, eq, isNull, ne, or, gte, asc, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { trackFedex, type DeliveryStatus } from '@/lib/fedex/track';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function trackAndStoreShipment(
  shipmentId: string,
): Promise<{ ok: boolean; status?: DeliveryStatus; error?: string }> {
  const [s] = await db
    .select({ tracking: schema.shipments.trackingNumber, carrier: schema.shipments.carrierKey })
    .from(schema.shipments).where(eq(schema.shipments.id, shipmentId)).limit(1);
  if (!s) return { ok: false, error: 'shipment not found' };
  if (s.carrier !== 'fedex') return { ok: false, error: 'not fedex' };
  if (!s.tracking) return { ok: false, error: 'no tracking' };
  try {
    const r = await trackFedex(s.tracking);
    await db.update(schema.shipments).set({
      deliveryStatus: r.status,
      trackDetail: r.description,
      deliveredAt: r.deliveredAt ?? undefined, // chỉ set khi có
      lastTrackedAt: new Date(),
      updatedAt: sql`now()`,
    }).where(eq(schema.shipments.id, shipmentId));
    return { ok: true, status: r.status };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'track failed' };
  }
}

/** Poll shipment FedEx chưa giao, label ≤45 ngày. Rate-limit 300ms. */
export async function trackPendingShipments(
  opts?: { limit?: number },
): Promise<{ tracked: number; delivered: number; failed: number }> {
  const limit = opts?.limit ?? 100;
  const cutoff = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({ id: schema.shipments.id })
    .from(schema.shipments)
    .where(and(
      eq(schema.shipments.carrierKey, 'fedex'),
      sql`${schema.shipments.trackingNumber} is not null`,
      or(isNull(schema.shipments.deliveryStatus), ne(schema.shipments.deliveryStatus, 'delivered')),
      gte(schema.shipments.labelCreatedAt, cutoff),
    ))
    .orderBy(asc(schema.shipments.lastTrackedAt))
    .limit(limit);
  let tracked = 0, delivered = 0, failed = 0;
  for (const r of rows) {
    const res = await trackAndStoreShipment(r.id);
    if (res.ok) { tracked++; if (res.status === 'delivered') delivered++; }
    else if (res.error !== 'no tracking' && res.error !== 'not fedex') failed++;
    await sleep(300);
  }
  return { tracked, delivered, failed };
}
```
> Implementer: `orderBy(asc(lastTrackedAt))` — Postgres mặc định NULLS LAST với ASC, nhưng ta muốn đơn chưa-track (null) TRƯỚC. Dùng `sql\`${schema.shipments.lastTrackedAt} asc nulls first\`` thay cho `asc(...)` nếu drizzle không có helper nullsFirst. Kiểm import: nếu `or/ne/gte/asc` chưa cần thì bỏ; giữ cái dùng.

- [ ] **Step 2: tsc + build + suite**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: xanh hết.

- [ ] **Step 3: Commit**

```bash
git add features/shipments/track.ts
git commit -m "feat(ops): trackAndStoreShipment + trackPendingShipments (FedEx, poll chưa-giao)"
```

---

## Task 4: Server action + nút UI + listPacksForOrder trả delivery

**Files:**
- Modify: `features/fulfillment/actions.ts` (`trackShipmentAction`)
- Modify: `features/packing/queries.ts` (`listPacksForOrder` thêm delivery fields)
- Modify: `components/fulfillment/PackPanel.tsx` (badge + nút)

**Interfaces:**
- Consumes: `trackAndStoreShipment` (Task 3).
- Produces: `trackShipmentAction(shipmentId: string): Promise<{ ok; status?; error? }>`.

- [ ] **Step 1: Server action**

Trong `features/fulfillment/actions.ts`, thêm import `import { trackAndStoreShipment } from '@/features/shipments/track';` và cuối file:
```ts
export async function trackShipmentAction(
  shipmentId: string,
): Promise<{ ok: boolean; status?: string; error?: string }> {
  await requirePerm('manage_fulfillment');
  const r = await trackAndStoreShipment(shipmentId);
  revalidatePath('/f/fulfillment', 'layout');
  return r;
}
```

- [ ] **Step 2: listPacksForOrder trả delivery fields**

Trong `features/packing/queries.ts`, `listPacksForOrder` select, thêm:
```ts
    deliveryStatus: schema.shipments.deliveryStatus,
    deliveredAt: schema.shipments.deliveredAt,
    trackDetail: schema.shipments.trackDetail,
    lastTrackedAt: schema.shipments.lastTrackedAt,
```

- [ ] **Step 3: PackPanel badge + nút**

Trong `components/fulfillment/PackPanel.tsx`:
- Mở rộng type pack (prop) thêm `deliveryStatus: string | null; deliveredAt: Date | string | null; trackDetail: string | null; lastTrackedAt: Date | string | null;`. (Trang `[orderId]` map thêm các field này từ `packs` — sửa cả map ở page: `deliveryStatus: p.deliveryStatus, deliveredAt: p.deliveredAt, trackDetail: p.trackDetail, lastTrackedAt: p.lastTrackedAt`.)
- Với pack có `trackingNumber`: hiện **badge** trạng thái giao (map nhãn: delivered→"✓ Đã giao", in_transit→"🚚 Đang chuyển", out_for_delivery→"Đang giao", exception→"⚠ Sự cố", null/unknown→"Chưa rõ"; màu theo trạng thái) + nếu `canManage` thêm nút "Cập nhật vận chuyển" (client, `useTransition` → `trackShipmentAction(pack.id)` → `router.refresh()`).
> Implementer: đọc `PackPanel.tsx` (client component) — thêm 1 nút nhỏ + badge cạnh tracking number mỗi pack. Nếu PackPanel là 'use client', import `trackShipmentAction` ('use server') trực tiếp OK. Map nhãn badge bằng object record nội bộ. Cũng cập nhật `app/(dashboard)/f/fulfillment/[orderId]/page.tsx` chỗ `packs={packs.map((p) => ({ ... }))}` để truyền 4 field mới.

- [ ] **Step 4: tsc + build + suite**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: xanh hết.

- [ ] **Step 5: Commit**

```bash
git add features/fulfillment/actions.ts features/packing/queries.ts components/fulfillment/PackPanel.tsx "app/(dashboard)/f/fulfillment/[orderId]/page.tsx"
git commit -m "feat(ops): nút Cập nhật vận chuyển + badge trạng thái giao (FedEx)"
```

---

## Task 5: Cron auto-track

**Files:**
- Modify: `scripts/cron/sync-shopify-orders.ts`

**Interfaces:**
- Consumes: `trackPendingShipments` (Task 3).

- [ ] **Step 1: Chain vào cron (sau addr-verify)**

Trong `scripts/cron/sync-shopify-orders.ts`:
- Thêm import: `import { trackPendingShipments } from '@/features/shipments/track';`
- Sau block `addr-verify` (try/catch của `verifyUnverifiedAddresses`), thêm:
```ts
  // Cập nhật trạng thái giao FedEx cho shipment chưa giao (cap 100 + rate-limit trong hàm).
  try {
    const tk = await trackPendingShipments({ limit: 100 });
    process.stdout.write(`track-fedex: tracked ${tk.tracked}, delivered ${tk.delivered}, failed ${tk.failed}\n`);
  } catch (e) {
    process.stderr.write(`track-fedex: ${e instanceof Error ? e.message : String(e)}\n`);
  }
```

- [ ] **Step 2: tsc + build**

Run: `npx tsc --noEmit && npm run build`
Expected: sạch.

- [ ] **Step 3: Commit**

```bash
git add scripts/cron/sync-shopify-orders.ts
git commit -m "feat(ops): cron auto-track FedEx (chain vào sync-orders)"
```

---

## Self-Review (đã chạy)

- **Spec coverage:** §4 storage → Task 1; lib map/parse/trackFedex → Task 2; trackAndStoreShipment/trackPendingShipments → Task 3; action+nút+listPacks → Task 4; cron → Task 5; badge UI → Task 4. §5 guard (rate-limit/cap/45 ngày/chưa-giao/lỗi per-đơn/code lạ→unknown) → Task 2,3. §6 test thuần map/parse → Task 2. Đủ.
- **Placeholder scan:** code cụ thể. Chỗ "đọc PackPanel" / "nulls first" (Task 3,4) là CHỦ Ý — implementer khớp thật.
- **Type consistency:** `DeliveryStatus`, `parseFedexTrack`/`FedexTrackResult`, `trackFedex`, `trackAndStoreShipment`, `trackPendingShipments`, `trackShipmentAction` nhất quán giữa task.
- **Lưu ý reviewer:** Task 1/3/4/5 chạm db/API/UI — repo không test DB → verify tsc/build; logic thuần (map/parse) TDD ở Task 2.
