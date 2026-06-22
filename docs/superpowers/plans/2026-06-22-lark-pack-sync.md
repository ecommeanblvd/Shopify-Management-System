# Lark Pack Sync (mảng B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kéo dữ liệu pack (cân/dims/tracking/carrier) từ Lark Bitable → fill/tạo `shipments`, đơn không khớp order thì cảnh báo.

**Architecture:** Lark Bitable API (pull) → parse thuần → classify thuần (update/create/unmatched/skip) → apply trong transaction → lưu `lark_sync_runs`. Hai cửa gọi cùng 1 lõi: nút thủ công + cron giờ. One-way Lark → hệ thống.

**Tech Stack:** Next.js (App Router, server action + route handler), Drizzle ORM, Vitest, TypeScript, Lark Suite Bitable API.

## Global Constraints

- **Secrets chỉ ở env, KHÔNG trong code.** Env: `LARK_APP_ID`, `LARK_APP_SECRET`, `LARK_BASE_APP_TOKEN`, `LARK_TABLE_ID`, `LARK_DOMAIN` (default `https://open.larksuite.com`). Cron auth `CRON_SECRET`.
- **One-way:** chỉ đọc Lark, không ghi ngược.
- **Ghi đè có điều kiện:** chỉ ghi đè field shipment khi Lark có giá trị; Lark trống → giữ nguyên.
- **Idempotent:** re-sync cùng dữ liệu không tạo trùng (khóa `logUniqueCode`/`trackingNumber` unique).
- **Migration hand-authored, KHÔNG chạy local** (Railway chạy lúc deploy). Đánh số tiếp theo journal (hiện 72 → mới 73).
- **Field name Lark (verbatim):** `'Order Number'`, `'Log Unique code'`, `'Weights'`, `'Dimension ( điền tay)'` (có dấu cách trong ngoặc), `'Tracking Number'`, `'Couriers'`, `'Label Created Date'`.
- **carrierKey hợp lệ:** chỉ `'fedex'` | `'dhl'` | null.
- Validate trước push: `npx tsc --noEmit` + `npx vitest run` + `npm run build` xanh.

---

## File Structure

- `db/schema.ts` — thêm bảng `larkSyncRuns`.
- `db/migrations/0073_lark-sync-runs.sql` + `db/migrations/meta/_journal.json` (idx 73).
- `features/lark/parse-pack-row.ts` — THUẦN: Lark record fields → `PackRow`.
- `features/lark/classify.ts` — THUẦN: `PackRow[]` + maps → `{create, update, unmatched, skipped}`.
- `features/lark/client.ts` — Lark Bitable API (token cache + listAllRecords).
- `features/lark/sync.ts` — orchestrate (I/O): list → parse → classify → apply → lưu run.
- `features/shipments/import-actions.ts` — export `resolveOrderIds`, `resolveStoreIds` để tái dùng.
- `features/lark/actions.ts` — server action `syncLarkPacksAction`.
- `app/api/cron/sync-lark/route.ts` — cron HTTP.
- `components/shipping-reconcile/*` — nút "Đồng bộ Lark" + banner cảnh báo (hoặc trang đối soát).
- Test: `features/lark/parse-pack-row.test.ts`, `features/lark/classify.test.ts`.

---

## Task 1: Schema `lark_sync_runs` + migration

**Files:**
- Modify: `db/schema.ts` (thêm bảng cuối file, cạnh các bảng khác)
- Create: `db/migrations/0073_lark-sync-runs.sql`
- Modify: `db/migrations/meta/_journal.json` (thêm entry idx 73)

**Interfaces:**
- Produces: `schema.larkSyncRuns` với cột: `id uuid pk`, `ranAt timestamp`, `created int`, `updated int`, `unmatchedCount int`, `skippedCount int`, `unmatched jsonb`, `error text`.

- [ ] **Step 1: Thêm bảng vào `db/schema.ts`**

Thêm (đặt cuối file, sau bảng cuối cùng; giữ style `pgTable` như các bảng khác):
```ts
/** Nhật ký mỗi lần sync Lark → shipments. Bản ghi mới nhất cấp dữ liệu cho
 *  banner cảnh báo "đơn Lark không khớp order". */
export const larkSyncRuns = pgTable('lark_sync_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  ranAt: timestamp('ran_at').notNull().defaultNow(),
  created: integer('created').notNull().default(0),
  updated: integer('updated').notNull().default(0),
  unmatchedCount: integer('unmatched_count').notNull().default(0),
  skippedCount: integer('skipped_count').notNull().default(0),
  /** [{ orderNumber, reason }] — đơn Lark không tạo được shipment. */
  unmatched: jsonb('unmatched').notNull().default(sql`'[]'::jsonb`),
  error: text('error'),
});
```
Kiểm import đầu file đã có `integer`, `jsonb`, `sql`, `timestamp`, `uuid`, `text`, `pgTable` từ `drizzle-orm/pg-core` / `drizzle-orm`; thiếu cái nào thì thêm vào dòng import sẵn có.

- [ ] **Step 2: Viết migration SQL**

Tạo `db/migrations/0073_lark-sync-runs.sql`:
```sql
CREATE TABLE IF NOT EXISTS "lark_sync_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "ran_at" timestamp DEFAULT now() NOT NULL,
  "created" integer DEFAULT 0 NOT NULL,
  "updated" integer DEFAULT 0 NOT NULL,
  "unmatched_count" integer DEFAULT 0 NOT NULL,
  "skipped_count" integer DEFAULT 0 NOT NULL,
  "unmatched" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "error" text
);
```

- [ ] **Step 3: Thêm entry journal**

Trong `db/migrations/meta/_journal.json`, thêm vào cuối mảng `entries` (sau idx 72):
```json
    {
      "idx": 73,
      "version": "7",
      "when": 1782736800000,
      "tag": "0073_lark-sync-runs",
      "breakpoints": true
    }
```
(Nhớ thêm dấu `,` sau entry idx 72.)

- [ ] **Step 4: Verify tsc**

Run: `npx tsc --noEmit`
Expected: sạch.

- [ ] **Step 5: Commit**

```bash
git add db/schema.ts db/migrations/0073_lark-sync-runs.sql db/migrations/meta/_journal.json
git commit -m "feat(lark): schema lark_sync_runs + migration 0073"
```

---

## Task 2: `parse-pack-row.ts` (THUẦN)

**Files:**
- Create: `features/lark/parse-pack-row.ts`
- Test: `features/lark/parse-pack-row.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface PackRow {
    orderNumber: string;          // raw Lark "Order Number", '' nếu trống
    logUniqueCode: string | null;
    weightKg: number | null;
    dims: { l: number; w: number; h: number | null } | null;
    trackingNumber: string | null;
    carrierKey: 'fedex' | 'dhl' | null;
    labelDate: Date | null;
    warnings: string[];
  }
  export function parsePackRow(fields: Record<string, unknown>): PackRow;
  export const MAX_WEIGHT_KG = 100;
  ```

- [ ] **Step 1: Viết test thất bại**

Tạo `features/lark/parse-pack-row.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { parsePackRow } from './parse-pack-row';

describe('parsePackRow', () => {
  it('field string cơ bản → map đầy đủ', () => {
    const r = parsePackRow({
      'Order Number': '#MBLVD29149', 'Log Unique code': 'PK-20507',
      'Weights': '0.80', 'Dimension ( điền tay)': '40x31x2',
      'Tracking Number': '25G8E12S', 'Couriers': 'FedEx',
      'Label Created Date': 1781827200000,
    });
    expect(r.orderNumber).toBe('#MBLVD29149');
    expect(r.logUniqueCode).toBe('PK-20507');
    expect(r.weightKg).toBe(0.8);
    expect(r.dims).toEqual({ l: 40, w: 31, h: 2 });
    expect(r.trackingNumber).toBe('25G8E12S');
    expect(r.carrierKey).toBe('fedex');
    expect(r.labelDate?.getTime()).toBe(1781827200000);
    expect(r.warnings).toEqual([]);
  });
  it('field dạng rich [{text}] → đọc được', () => {
    const r = parsePackRow({ 'Order Number': [{ text: 'TA2017', type: 'text' }], 'Couriers': [{ text: 'DHL' }] });
    expect(r.orderNumber).toBe('TA2017');
    expect(r.carrierKey).toBe('dhl');
  });
  it('dims 2 chiều → h null', () => {
    expect(parsePackRow({ 'Dimension ( điền tay)': '28x42' }).dims).toEqual({ l: 28, w: 42, h: null });
  });
  it('dims rác → null', () => {
    expect(parsePackRow({ 'Dimension ( điền tay)': 'abc' }).dims).toBeNull();
  });
  it('cân <=0 / NaN / >100 → null + warning', () => {
    expect(parsePackRow({ 'Weights': '0' }).weightKg).toBeNull();
    expect(parsePackRow({ 'Weights': 'x' }).weightKg).toBeNull();
    const big = parsePackRow({ 'Weights': '250' });
    expect(big.weightKg).toBeNull();
    expect(big.warnings.some((w) => w.includes('cân'))).toBe(true);
  });
  it('carrier lạ → null + warning', () => {
    const r = parsePackRow({ 'Couriers': 'UPS' });
    expect(r.carrierKey).toBeNull();
    expect(r.warnings.some((w) => w.toLowerCase().includes('carrier'))).toBe(true);
  });
  it('trống hết → orderNumber rỗng, các field null', () => {
    const r = parsePackRow({});
    expect(r.orderNumber).toBe('');
    expect(r.weightKg).toBeNull();
    expect(r.dims).toBeNull();
    expect(r.carrierKey).toBeNull();
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận FAIL**

Run: `npx vitest run features/lark/parse-pack-row.test.ts`
Expected: FAIL ("parsePackRow is not a function" / module không tồn tại).

- [ ] **Step 3: Viết implementation**

Tạo `features/lark/parse-pack-row.ts`:
```ts
/**
 * THUẦN: 1 record Lark Bitable (object `fields`) → PackRow chuẩn hoá.
 * Field Lark có thể là string, số, hoặc rich array [{text,type}] → đọc cả 3.
 */
export const MAX_WEIGHT_KG = 100;

export interface PackRow {
  orderNumber: string;
  logUniqueCode: string | null;
  weightKg: number | null;
  dims: { l: number; w: number; h: number | null } | null;
  trackingNumber: string | null;
  carrierKey: 'fedex' | 'dhl' | null;
  labelDate: Date | null;
  warnings: string[];
}

/** Lark text field: string | number | [{text}] | {text} → string|null. */
function larkText(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'string') return v.trim() || null;
  if (typeof v === 'number') return String(v);
  if (Array.isArray(v)) {
    const s = v.map((x) => (x && typeof x === 'object' && 'text' in x ? String((x as { text: unknown }).text ?? '') : '')).join('').trim();
    return s || null;
  }
  if (typeof v === 'object' && 'text' in (v as object)) {
    const s = String((v as { text: unknown }).text ?? '').trim();
    return s || null;
  }
  return null;
}

function parseDims(raw: string | null): PackRow['dims'] {
  if (!raw) return null;
  const parts = raw.toLowerCase().split(/[x×]/).map((p) => Number(p.trim()));
  if (parts.length < 2 || parts.some((n, i) => i < 2 && (!Number.isFinite(n) || n <= 0))) return null;
  const [l, w, h] = parts;
  return { l, w, h: Number.isFinite(h) && h > 0 ? h : null };
}

function normalizeCourier(raw: string | null): 'fedex' | 'dhl' | null {
  if (!raw) return null;
  const s = raw.toLowerCase();
  if (s.includes('fedex')) return 'fedex';
  if (s.includes('dhl')) return 'dhl';
  return null;
}

export function parsePackRow(fields: Record<string, unknown>): PackRow {
  const warnings: string[] = [];
  const orderNumber = larkText(fields['Order Number']) ?? '';
  const logUniqueCode = larkText(fields['Log Unique code']);
  const trackingNumber = larkText(fields['Tracking Number']);

  // weight
  let weightKg: number | null = null;
  const wRaw = larkText(fields['Weights']);
  if (wRaw != null) {
    const w = Number(wRaw);
    if (!Number.isFinite(w) || w <= 0 || w > MAX_WEIGHT_KG) {
      warnings.push(`cân bất thường: "${wRaw}"`);
    } else {
      weightKg = w;
    }
  }

  const dims = parseDims(larkText(fields['Dimension ( điền tay)']));

  // carrier
  const cRaw = larkText(fields['Couriers']);
  const carrierKey = normalizeCourier(cRaw);
  if (cRaw != null && carrierKey === null) warnings.push(`carrier lạ: "${cRaw}"`);

  // date (Lark date = ms epoch number, hoặc string)
  let labelDate: Date | null = null;
  const dRaw = fields['Label Created Date'];
  if (typeof dRaw === 'number' && Number.isFinite(dRaw)) labelDate = new Date(dRaw);
  else {
    const ds = larkText(dRaw);
    if (ds) { const t = Date.parse(ds); if (!Number.isNaN(t)) labelDate = new Date(t); }
  }

  return { orderNumber, logUniqueCode, weightKg, dims, trackingNumber, carrierKey, labelDate, warnings };
}
```

- [ ] **Step 4: Chạy test, xác nhận PASS**

Run: `npx vitest run features/lark/parse-pack-row.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add features/lark/parse-pack-row.ts features/lark/parse-pack-row.test.ts
git commit -m "feat(lark): parse-pack-row thuần (Lark fields → PackRow)"
```

---

## Task 3: `classify.ts` (THUẦN)

**Files:**
- Create: `features/lark/classify.ts`
- Test: `features/lark/classify.test.ts`

**Interfaces:**
- Consumes: `PackRow` (Task 2); `lookupStorePrefix` từ `@/features/shipments/store-prefix` (đã có, trả `{kind:'matched',info:{connected}}` | `{kind:'partner_ship'}` | `{kind:'no_prefix'}`).
- Produces:
  ```ts
  export interface ClassifyMaps {
    shipmentByLogCode: Map<string, string>;   // logUniqueCode → shipmentId
    shipmentByTracking: Map<string, string>;  // trackingNumber → shipmentId
    orderIdByNumber: Map<string, string>;     // bare orderNumber → orderId
  }
  export interface ClassifyResult {
    update: Array<{ row: PackRow; shipmentId: string }>;
    create: Array<{ row: PackRow; orderId: string }>;
    unmatched: Array<{ orderNumber: string; reason: string }>;
    skipped: Array<{ orderNumber: string; reason: string }>;
  }
  export function classifyPackRows(rows: PackRow[], maps: ClassifyMaps): ClassifyResult;
  ```

- [ ] **Step 1: Viết test thất bại**

Tạo `features/lark/classify.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { classifyPackRows } from './classify';
import type { PackRow } from './parse-pack-row';

const mk = (o: Partial<PackRow>): PackRow => ({
  orderNumber: '', logUniqueCode: null, weightKg: null, dims: null,
  trackingNumber: null, carrierKey: null, labelDate: null, warnings: [], ...o,
});
const emptyMaps = () => ({ shipmentByLogCode: new Map(), shipmentByTracking: new Map(), orderIdByNumber: new Map() });

describe('classifyPackRows', () => {
  it('khớp logUniqueCode → update', () => {
    const maps = emptyMaps(); maps.shipmentByLogCode.set('PK-1', 'ship-1');
    const r = classifyPackRows([mk({ logUniqueCode: 'PK-1', orderNumber: '#MBLVD1' })], maps);
    expect(r.update).toEqual([{ row: expect.objectContaining({ logUniqueCode: 'PK-1' }), shipmentId: 'ship-1' }]);
    expect(r.create).toHaveLength(0);
  });
  it('khớp tracking (không có logCode) → update', () => {
    const maps = emptyMaps(); maps.shipmentByTracking.set('TRK9', 'ship-9');
    const r = classifyPackRows([mk({ trackingNumber: 'TRK9', orderNumber: '#MBLVD1' })], maps);
    expect(r.update[0].shipmentId).toBe('ship-9');
  });
  it('chưa có shipment + order resolve được → create', () => {
    const maps = emptyMaps(); maps.orderIdByNumber.set('MBLVD29149', 'order-1');
    const r = classifyPackRows([mk({ orderNumber: '#MBLVD29149', logUniqueCode: 'PK-new' })], maps);
    expect(r.create).toEqual([{ row: expect.objectContaining({ orderNumber: '#MBLVD29149' }), orderId: 'order-1' }]);
  });
  it('store connected nhưng order không resolve → unmatched', () => {
    const r = classifyPackRows([mk({ orderNumber: '#MIRER163', logUniqueCode: 'PK-x' })], emptyMaps());
    expect(r.unmatched).toEqual([{ orderNumber: '#MIRER163', reason: expect.any(String) }]);
  });
  it('store disconnected (MCN) → skipped', () => {
    const r = classifyPackRows([mk({ orderNumber: '#MCN26', logUniqueCode: 'PK-y' })], emptyMaps());
    expect(r.skipped).toHaveLength(1);
    expect(r.create).toHaveLength(0); expect(r.unmatched).toHaveLength(0);
  });
  it('no_prefix / DISCN → skipped', () => {
    const r = classifyPackRows([mk({ orderNumber: 'DISCN5' }), mk({ orderNumber: 'ZZZ9' })], emptyMaps());
    expect(r.skipped).toHaveLength(2);
  });
  it('idempotent: row đã update không tạo lại', () => {
    const maps = emptyMaps(); maps.shipmentByLogCode.set('PK-1', 'ship-1'); maps.orderIdByNumber.set('MBLVD1', 'order-1');
    const r = classifyPackRows([mk({ logUniqueCode: 'PK-1', orderNumber: '#MBLVD1' })], maps);
    expect(r.update).toHaveLength(1); expect(r.create).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận FAIL**

Run: `npx vitest run features/lark/classify.test.ts`
Expected: FAIL (module không tồn tại).

- [ ] **Step 3: Viết implementation**

Tạo `features/lark/classify.ts`:
```ts
/**
 * THUẦN: phân loại PackRow thành update / create / unmatched / skipped.
 * - update: đã có shipment (khớp logUniqueCode hoặc trackingNumber).
 * - create: chưa có shipment NHƯNG order resolve được → tạo mới.
 * - unmatched: store connected nhưng order không resolve (cảnh báo).
 * - skipped: store disconnected / DISCN / no_prefix.
 */
import { lookupStorePrefix } from '@/features/shipments/store-prefix';
import type { PackRow } from './parse-pack-row';

export interface ClassifyMaps {
  shipmentByLogCode: Map<string, string>;
  shipmentByTracking: Map<string, string>;
  orderIdByNumber: Map<string, string>;
}
export interface ClassifyResult {
  update: Array<{ row: PackRow; shipmentId: string }>;
  create: Array<{ row: PackRow; orderId: string }>;
  unmatched: Array<{ orderNumber: string; reason: string }>;
  skipped: Array<{ orderNumber: string; reason: string }>;
}

const bare = (n: string) => n.trim().replace(/^#/, '');

export function classifyPackRows(rows: PackRow[], maps: ClassifyMaps): ClassifyResult {
  const out: ClassifyResult = { update: [], create: [], unmatched: [], skipped: [] };
  for (const row of rows) {
    // 1. shipment đã tồn tại?
    const existingId =
      (row.logUniqueCode && maps.shipmentByLogCode.get(row.logUniqueCode)) ||
      (row.trackingNumber && maps.shipmentByTracking.get(row.trackingNumber)) ||
      null;
    if (existingId) { out.update.push({ row, shipmentId: existingId }); continue; }

    // 2. resolve store/order
    const look = lookupStorePrefix(row.orderNumber);
    if (look.kind === 'partner_ship') { out.skipped.push({ orderNumber: row.orderNumber, reason: 'DISCN partner ship' }); continue; }
    if (look.kind === 'no_prefix') { out.skipped.push({ orderNumber: row.orderNumber, reason: 'không nhận prefix store' }); continue; }
    if (!look.info.connected) { out.skipped.push({ orderNumber: row.orderNumber, reason: `store chưa kết nối (${look.info.displayName})` }); continue; }

    const orderId = maps.orderIdByNumber.get(bare(row.orderNumber));
    if (orderId) out.create.push({ row, orderId });
    else out.unmatched.push({ orderNumber: row.orderNumber, reason: 'order chưa có trong hệ thống' });
  }
  return out;
}
```

- [ ] **Step 4: Chạy test, xác nhận PASS**

Run: `npx vitest run features/lark/classify.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add features/lark/classify.ts features/lark/classify.test.ts
git commit -m "feat(lark): classify thuần (update/create/unmatched/skipped)"
```

---

## Task 4: `client.ts` — Lark Bitable API

**Files:**
- Create: `features/lark/client.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface LarkRecord { record_id: string; fields: Record<string, unknown>; }
  export async function listAllRecords(): Promise<LarkRecord[]>;
  ```
- Đọc env: `LARK_APP_ID`, `LARK_APP_SECRET`, `LARK_BASE_APP_TOKEN`, `LARK_TABLE_ID`, `LARK_DOMAIN`.

Không có DB/test mock cho I/O — verify bằng tsc + smoke script `scripts/lark-smoke.ts` đã chứng minh endpoint/token/shape.

- [ ] **Step 1: Viết implementation**

Tạo `features/lark/client.ts`:
```ts
/**
 * Lark Suite Bitable API client (read-only). Token cache trong RAM.
 * Endpoint + auth: open.larksuite.com (Bitable v1). Throw khi code !== 0.
 */
const DOMAIN = process.env.LARK_DOMAIN || 'https://open.larksuite.com';

function env(k: string): string {
  const v = process.env[k];
  if (!v) throw new Error(`[lark] thiếu env ${k}`);
  return v;
}

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getTenantToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 60_000) return cachedToken.token;
  const res = await fetch(`${DOMAIN}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: env('LARK_APP_ID'), app_secret: env('LARK_APP_SECRET') }),
  });
  const j = (await res.json()) as { code: number; msg: string; tenant_access_token?: string; expire?: number };
  if (j.code !== 0 || !j.tenant_access_token) throw new Error(`[lark] token fail: code=${j.code} msg=${j.msg}`);
  cachedToken = { token: j.tenant_access_token, expiresAt: now + (j.expire ?? 7200) * 1000 };
  return cachedToken.token;
}

export interface LarkRecord { record_id: string; fields: Record<string, unknown>; }

/** Đọc TẤT CẢ record của bảng (phân trang page_token, 500/lần). */
export async function listAllRecords(): Promise<LarkRecord[]> {
  const token = await getTenantToken();
  const appToken = env('LARK_BASE_APP_TOKEN');
  const tableId = env('LARK_TABLE_ID');
  const out: LarkRecord[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL(`${DOMAIN}/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records`);
    url.searchParams.set('page_size', '500');
    if (pageToken) url.searchParams.set('page_token', pageToken);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const j = (await res.json()) as {
      code: number; msg: string;
      data?: { items?: LarkRecord[]; page_token?: string; has_more?: boolean };
    };
    if (j.code !== 0) throw new Error(`[lark] list fail: code=${j.code} msg=${j.msg}`);
    out.push(...(j.data?.items ?? []));
    pageToken = j.data?.has_more ? j.data?.page_token : undefined;
  } while (pageToken);
  return out;
}
```

- [ ] **Step 2: Verify tsc**

Run: `npx tsc --noEmit`
Expected: sạch.

- [ ] **Step 3: Commit**

```bash
git add features/lark/client.ts
git commit -m "feat(lark): Bitable API client (token cache + listAllRecords)"
```

---

## Task 5: `sync.ts` — orchestrate + export resolvers

**Files:**
- Modify: `features/shipments/import-actions.ts` (thêm `export` cho `resolveOrderIds`, `resolveStoreIds`)
- Create: `features/lark/sync.ts`

**Interfaces:**
- Consumes: `listAllRecords` (T4), `parsePackRow` (T2), `classifyPackRows`/`ClassifyMaps` (T3), `resolveOrderIds` (import-actions), `schema.larkSyncRuns` (T1).
- Produces:
  ```ts
  export interface LarkSyncSummary { created: number; updated: number; unmatched: Array<{orderNumber:string;reason:string}>; skipped: number; warnings: string[]; }
  export async function syncLarkPacks(): Promise<LarkSyncSummary>;
  ```

Integration (chạm db) — verify tsc + build (logic phân loại đã test thuần ở T2/T3).

- [ ] **Step 1: Export resolvers từ import-actions**

Trong `features/shipments/import-actions.ts`, đổi `async function resolveOrderIds` → `export async function resolveOrderIds` (dòng ~160) và `async function resolveStoreIds` → `export async function resolveStoreIds` (dòng ~142). Không đổi thân hàm.

- [ ] **Step 2: Viết `features/lark/sync.ts`**

```ts
/**
 * Orchestrate sync Lark → shipments. Một lõi cho cả nút thủ công + cron.
 * One-way. Ghi đè field shipment chỉ khi Lark có giá trị. Idempotent.
 */
import { eq, inArray, isNotNull } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { listAllRecords } from './client';
import { parsePackRow, type PackRow } from './parse-pack-row';
import { classifyPackRows, type ClassifyMaps } from './classify';
import { resolveOrderIds } from '@/features/shipments/import-actions';

export interface LarkSyncSummary {
  created: number; updated: number;
  unmatched: Array<{ orderNumber: string; reason: string }>;
  skipped: number; warnings: string[];
}

/** Patch shipment từ PackRow — chỉ field Lark có giá trị (ghi đè có điều kiện). */
function patchFrom(row: PackRow): Record<string, unknown> {
  const p: Record<string, unknown> = { updatedAt: new Date() };
  if (row.weightKg != null) p.actualWeightKg = String(row.weightKg);
  if (row.dims) {
    p.dimLengthCm = String(row.dims.l); p.dimWidthCm = String(row.dims.w);
    if (row.dims.h != null) p.dimHeightCm = String(row.dims.h);
  }
  if (row.trackingNumber) p.trackingNumber = row.trackingNumber;
  if (row.carrierKey) p.carrierKey = row.carrierKey;
  if (row.labelDate) p.labelCreatedAt = row.labelDate;
  return p;
}

export async function syncLarkPacks(): Promise<LarkSyncSummary> {
  try {
    const records = await listAllRecords();
    const rows = records.map((r) => parsePackRow(r.fields)).filter((r) => r.orderNumber || r.logUniqueCode);

    // Maps đối chiếu
    const logCodes = rows.map((r) => r.logUniqueCode).filter((x): x is string => !!x);
    const trackings = rows.map((r) => r.trackingNumber).filter((x): x is string => !!x);
    const existing = await db
      .select({ id: schema.shipments.id, logUniqueCode: schema.shipments.logUniqueCode, trackingNumber: schema.shipments.trackingNumber })
      .from(schema.shipments)
      .where(isNotNull(schema.shipments.id));
    const shipmentByLogCode = new Map<string, string>();
    const shipmentByTracking = new Map<string, string>();
    for (const s of existing) {
      if (s.logUniqueCode) shipmentByLogCode.set(s.logUniqueCode, s.id);
      if (s.trackingNumber) shipmentByTracking.set(s.trackingNumber, s.id);
    }
    const orderIdByNumber = await resolveOrderIds(rows.map((r) => r.orderNumber).filter(Boolean));

    const maps: ClassifyMaps = { shipmentByLogCode, shipmentByTracking, orderIdByNumber };
    const cls = classifyPackRows(rows, maps);

    // Áp trong transaction
    await db.transaction(async (tx) => {
      for (const u of cls.update) {
        const patch = patchFrom(u.row);
        if (Object.keys(patch).length > 1) await tx.update(schema.shipments).set(patch).where(eq(schema.shipments.id, u.shipmentId));
      }
      for (const c of cls.create) {
        await tx.insert(schema.shipments).values({
          orderId: c.orderId,
          logUniqueCode: c.row.logUniqueCode,
          trackingNumber: c.row.trackingNumber,
          carrierKey: c.row.carrierKey,
          actualWeightKg: c.row.weightKg != null ? String(c.row.weightKg) : null,
          dimLengthCm: c.row.dims ? String(c.row.dims.l) : null,
          dimWidthCm: c.row.dims ? String(c.row.dims.w) : null,
          dimHeightCm: c.row.dims?.h != null ? String(c.row.dims.h) : null,
          labelCreatedAt: c.row.labelDate,
        }).onConflictDoNothing();
      }
    });

    const warnings = rows.flatMap((r) => r.warnings.map((w) => `${r.orderNumber || r.logUniqueCode}: ${w}`));
    const summary: LarkSyncSummary = { created: cls.create.length, updated: cls.update.length, unmatched: cls.unmatched, skipped: cls.skipped.length, warnings };

    await db.insert(schema.larkSyncRuns).values({
      created: summary.created, updated: summary.updated,
      unmatchedCount: summary.unmatched.length, skippedCount: summary.skipped,
      unmatched: summary.unmatched,
    });
    return summary;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db.insert(schema.larkSyncRuns).values({ error: msg }).catch(() => {});
    throw e;
  }
}
```

- [ ] **Step 3: Verify tsc + build**

Run: `npx tsc --noEmit && npm run build`
Expected: sạch + build OK. (Nếu `onConflictDoNothing` cần target, dùng `.onConflictDoNothing()` không tham số — đủ cho unique index tracking/logCode.)

- [ ] **Step 4: Verify suite không vỡ**

Run: `npx vitest run`
Expected: PASS (chỉ thêm test mới T2/T3; import-actions chỉ thêm `export`).

- [ ] **Step 5: Commit**

```bash
git add features/shipments/import-actions.ts features/lark/sync.ts
git commit -m "feat(lark): sync orchestrate (list→parse→classify→upsert→log run)"
```

---

## Task 6: Trigger — server action + nút UI + cron

**Files:**
- Create: `features/lark/actions.ts`
- Create: `app/api/cron/sync-lark/route.ts`
- Modify: trang đối soát ship (RSC) + 1 component client để render nút "Đồng bộ Lark" (theo pattern action hiện có trong `components/shipping-reconcile/`)

**Interfaces:**
- Consumes: `syncLarkPacks` (T5).
- Produces: `syncLarkPacksAction(): Promise<LarkSyncSummary>` (server action, gate quyền).

- [ ] **Step 1: Server action**

`requireUser` là helper CỤC BỘ trong mỗi file action (KHÔNG có module chung) — sao y pattern của `reconcile-status-actions.ts` (auth session → getRole → hasPermission, permission `'view_carrier_rates'`). Tạo `features/lark/actions.ts`:
```ts
'use server';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { syncLarkPacks, type LarkSyncSummary } from './sync';

async function requireUser(): Promise<string> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error('Unauthorized');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_carrier_rates')) throw new Error('Forbidden');
  return session.user.id;
}

export async function syncLarkPacksAction(): Promise<LarkSyncSummary> {
  await requireUser();
  const summary = await syncLarkPacks();
  revalidatePath('/f/shipping-reconcile');
  return summary;
}
```

- [ ] **Step 2: Cron route**

Tạo `app/api/cron/sync-lark/route.ts` (theo `app/api/cron/refresh-demand/route.ts`):
```ts
import { NextResponse } from 'next/server';
import { syncLarkPacks } from '@/features/lark/sync';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  const auth = req.headers.get('authorization');
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  try {
    const summary = await syncLarkPacks();
    return NextResponse.json({ ok: true, ...summary });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
```

- [ ] **Step 3: Nút "Đồng bộ Lark" trên UI**

Trong component client của trang đối soát (vd nơi có thanh action/summary của `ReconcileTable.tsx`), thêm nút gọi `syncLarkPacksAction` qua `useTransition`, hiện toast/inline `tạo X · cập nhật Y · không khớp Z` (theo cách các nút action hiện có gọi server action — copy pattern `useTransition` + `useRouter().refresh()` đang dùng). `import type` cho `LarkSyncSummary` nếu cần để tránh kéo server code vào client bundle (actions.ts là 'use server' nên import action OK).

- [ ] **Step 4: Verify tsc + build + suite**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: tất cả xanh.

- [ ] **Step 5: Commit**

```bash
git add features/lark/actions.ts "app/api/cron/sync-lark/route.ts" components/shipping-reconcile/
git commit -m "feat(lark): nút Đồng bộ Lark + cron sync-lark"
```

---

## Self-Review (đã chạy)

- **Spec coverage:** §3 mapping → T2 (parse) + T5 (patch/create). §4 client → T4; parse/classify/sync → T2/T3/T5; action+nút+cron → T6; lark_sync_runs → T1. §5 guard cân/dims/carrier → T2; ghi đè có điều kiện + idempotent → T5 (patchFrom + onConflictDoNothing); token/list fail → T4 throw + T5 ghi error. §6 test thuần → T2/T3. Đủ.
- **Placeholder scan:** mọi step có code/diff cụ thể. Hai chỗ "dùng đúng helper gate/pattern UI" (T6) là CHỦ Ý — implementer phải đọc file mẫu trong repo để khớp tên thật (không bịa), không phải placeholder logic.
- **Type consistency:** `PackRow`, `ClassifyMaps`, `ClassifyResult`, `LarkSyncSummary`, `listAllRecords`, `syncLarkPacks`, `carrierKey 'fedex'|'dhl'|null` nhất quán giữa các task.
- **Lưu ý reviewer:** T4/T5/T6 chạm I/O/UI, repo không có test DB → verify tsc/build + smoke; logic phân loại/parse (rủi ro cao nhất) đã TDD thuần ở T2/T3.
