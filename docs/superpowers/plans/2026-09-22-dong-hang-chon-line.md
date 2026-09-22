# Màn "Đóng hàng" + webhook Lark pack — kế hoạch triển khai

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kiện đóng xong trên Lark LOG-Export về SMS trong vài giây (Lark Automation → `POST /api/lark/pack`), hiện trên màn "Đóng hàng" để Đức so cước theo cân thực + kích thước và chọn line ship; SMS ghi hãng lên cột `Couriers` Lark như hiện nay.

**Architecture:** Endpoint chỉ nhận `record_id`, đọc lại record qua Lark API rồi chạy đúng luật cron đang có (`parsePackRow` → `classifyPackRows` → `patchFrom`) cho MỘT dòng (`features/lark/nhan-mot-dong.ts`, dùng chung với cron). Kiện không khớp đơn nằm ở bảng `lark_pack_cho_khop`. Màn `/f/dong-hang` đọc `shipments` có `log_unique_code`, quote qua `quoteOrderAcrossCarriers` (cân thực + kích thước kiện), chọn hãng qua `assignOrderCarrier` sẵn có. Cron `sync-lark` hàng giờ giữ nguyên làm lưới bù.

**Tech Stack:** Next.js (đọc `node_modules/next/dist/docs/` trước khi viết route/page), Drizzle + Postgres, vitest, Lark Bitable REST, Railway.

**Spec:** `docs/superpowers/specs/2026-09-22-dong-hang-chon-line-design.md` (CEO duyệt 22/09/2026).

## Global Constraints

- **Endpoint:** `POST /api/lark/pack`; header `X-Lark-Pack-Secret` so **timing-safe** với env `LARK_PACK_WEBHOOK_SECRET`; sai → **401**, thiếu env → **503** `{ error: 'chưa cấu hình LARK_PACK_WEBHOOK_SECRET' }`; body JSON `{ record_id, log_unique_code? }` tối đa **4 KB** (quá → 413), thiếu `record_id` → **400**; mọi kết quả nghiệp vụ → **200** `{ ketQua: 'tao'|'cap_nhat'|'khong_khop'|'bo_qua', shipmentId?, logUniqueCode?, lyDo?, ms }`; Lark API lỗi/timeout → **502**; DB lỗi → **500**; env `LARK_PACK_DRY=1` → không ghi DB, `job_runs.summary.dry = true`.
- **Không tin dữ liệu Lark gửi kèm** — chỉ dùng `record_id` để đọc lại; `log_unique_code` trong body chỉ để log.
- **Một luật cho cả cron và webhook:** `patchFrom` chuyển sang `features/lark/patch-kien.ts` và cả `sync.ts` lẫn `nhan-mot-dong.ts` import từ đó. Không viết luật phân loại thứ hai.
- **Idempotent:** khớp theo `log_unique_code` → lần sau là `cap_nhat`; khoá trong bộ nhớ tiến trình theo `record_id` + `onConflictDoNothing`.
- **Job:** mỗi request một dòng `job_runs` khoá **`lark-pack-webhook`**; registry `chuKyPhut: 1 * NGAY`, `hauQua: 'Kiện đóng xong không về SMS tức thì — Đức phải chọn line trên Lark'`.
- **Cột Lark đọc thêm:** `Select VTĐG1` → `shipments.lark_hop` (text), `SKU(s)` → `shipments.sku_text`, `Total pieces per pack` → `shipments.pieces` (integer). KHÔNG dùng lại enum `packaging_type` (bag|box) cho hộp.
- **Bảng mới** `lark_pack_cho_khop` (PK `record_id`): `log_unique_code, order_number, weight_kg numeric(10,3), dims text, hop, sku_text, pieces integer, ly_do text NOT NULL, nhan_luc timestamp NOT NULL DEFAULT now()`. Xoá khi kiện khớp (webhook lần sau hoặc cron).
- **Màn:** route `/f/dong-hang`, nav "Đóng hàng" ngay sau "Quản lí đơn", quyền xem `view_fulfillment`, chọn hãng `manage_fulfillment`. Mỗi dòng một **kiện**, nhóm theo ngày đóng (`coalesce(label_created_at, created_at)` theo giờ VN), mới nhất trên. Bộ lọc `loc=chua_tracking` (mặc định) | `hom_nay` | `7_ngay` | `tat_ca`, ô tìm `q` (mã đơn / log code). Khối đỏ "Không khớp đơn SMS" đầu trang.
- **Quote:** `quoteOrderAcrossCarriers({ country, weightKg: cân thực kiện, postcode, city, dimensions (chỉ khi đủ 3 chiều), effectiveDate: ngày đóng, isResidential: laNhaDan(addr_class, country) })`; cache 10 phút trong bộ nhớ tiến trình theo `shipmentId|cân|DxRxC`; "So cước cả trang" tối đa **50** kiện, `Promise.all`. Rẻ nhất = rẻ nhất trong nhóm **chọn được** (không tạm ngưng), tô đậm; tạm ngưng mờ + lý do.
- **Chọn hãng:** gọi `assignOrderCarrier(orderId, key)` (sẵn có) — áp cho mọi kiện của đơn; UI báo "Đã ghi Lark ✓ (n dòng)" hoặc "Lark lỗi — điền tay: …".
- **Trạng thái kiện:** *Chờ chọn line* (chưa `selected_carrier_key`, chưa tracking) → *Đã chọn: X · người · giờ* → *Đã lên nhãn* (có tracking).
- **Cân quy đổi hiển thị:** `max(cân thực, D×R×C/5000)`; làm tròn 0,1 rồi trần lên bậc 0,5 (đúng luật FedEx trong engine). Chỉ để hiển thị — cước lấy từ engine.
- **Quy ước repo:** tiếng Việt cho tên hàm/ghi chú mới; `sql` template với mảng JS dùng `IN ${arr}` không `= ANY`; file `'use server'` chỉ export hàm async (type để file riêng); không top-level await trong `scripts/`; migration = file SQL `db/migrations/0148_dong-hang.sql` áp bằng script tạm `sql.raw` (journal drizzle không cập nhật từ 0139 — theo nếp); `npx tsc --noEmit && npx vitest run` xanh trước mỗi push (hook), **`npx next build` trước khi push** (hook không chạy build); commit kết bằng `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`; làm trên `main`; **KHÔNG** `git checkout/stash/reset` (cây làm việc dùng chung).
- Đọc `node_modules/next/dist/docs/` (route handlers, server actions, searchParams là Promise) trước khi viết code Next.

---

## Cấu trúc file

| File | Trách nhiệm |
|---|---|
| `features/lark/parse-pack-row.ts` (sửa) | thêm `hop`, `skuText`, `pieces` vào `PackRow` |
| `features/lark/patch-kien.ts` (mới) | `patchFrom(row)` (chuyển từ sync.ts) + `giaTriTaoKien(row, orderId)` |
| `features/lark/sync.ts` (sửa) | import từ patch-kien; nạp thêm 3 cột mới; xoá `lark_pack_cho_khop` khi cron tạo được kiện |
| `db/migrations/0148_dong-hang.sql`, `db/schema.ts` | 3 cột `shipments` + bảng `lark_pack_cho_khop` |
| `features/lark/client.ts` (sửa) | `getLogRecordById(recordId)` |
| `features/lark/nhan-mot-dong.ts` (mới) | lõi xử lý một record: đọc, phân loại, ghi, khoá theo record_id |
| `features/lark/pack-webhook/xac-thuc.ts` (mới) | THUẦN: `kiemTraSecret`, `docBodyPack` |
| `app/api/lark/pack/route.ts` (mới) | route handler POST |
| `features/jobs/registry.ts`, `groups.ts` (sửa) | khoá `lark-pack-webhook` |
| `features/dong-hang/logic.ts` (mới) | THUẦN: `canQuyDoi`, `trangThaiKien`, `nhomTheoNgay`, `xepQuote` |
| `features/dong-hang/types.ts` (mới) | kiểu dùng chung (queries/actions/UI) |
| `features/dong-hang/queries.ts` (mới) | `listKienDongHang`, `listKienChoKhop` |
| `features/dong-hang/actions.ts` (mới, 'use server') | `baoGiaKien`, `chonHangChoDon` |
| `app/(dashboard)/f/dong-hang/page.tsx` (mới), `components/dong-hang/BangDongHang.tsx` (mới), `lib/nav.ts` (sửa) | màn hình |
| `docs/integrations/lark-pack-webhook.md` (mới) | hướng dẫn cấu hình Lark + env |

---

### Task 1: `parsePackRow` đọc thêm hộp, SKU, số món

**Files:**
- Modify: `features/lark/parse-pack-row.ts`
- Modify: `features/lark/classify.test.ts` (helper `mk` phải có đủ trường mới)
- Test: `features/lark/parse-pack-row.test.ts`

**Interfaces:**
- Produces: `PackRow` thêm `hop: string | null; skuText: string | null; pieces: number | null`.

- [ ] **Bước 1: Test thất bại** — thêm vào `features/lark/parse-pack-row.test.ts`:

```ts
  it('đọc hộp (Select VTĐG1), SKU(s), Total pieces per pack', () => {
    const r = parsePackRow({
      'Order Number': '#MBLVD1', 'Log Unique code': 'PK-1',
      'Select VTĐG1': 'Box 25x20x10', 'SKU(s)': 'ABC-1 x2, DEF-2', 'Total pieces per pack': 3,
    });
    expect(r.hop).toBe('Box 25x20x10');
    expect(r.skuText).toBe('ABC-1 x2, DEF-2');
    expect(r.pieces).toBe(3);
  });
  it('pieces không phải số nguyên dương → null', () => {
    expect(parsePackRow({ 'Total pieces per pack': 'abc' }).pieces).toBeNull();
    expect(parsePackRow({ 'Total pieces per pack': 0 }).pieces).toBeNull();
    expect(parsePackRow({}).hop).toBeNull();
  });
```

- [ ] **Bước 2: Chạy** `npx vitest run features/lark/parse-pack-row.test.ts` — FAIL (`r.hop` undefined).

- [ ] **Bước 3: Sửa `parse-pack-row.ts`** — interface thêm 3 trường; cuối `parsePackRow`:

```ts
  // Hộp đóng gói / SKU / số món — màn "Đóng hàng" (spec 22/09) cần để Đức nhìn
  // kiện mà không mở Lark. Lark select trả string; số món có thể là số hoặc text.
  const hop = larkText(fields['Select VTĐG1']);
  const skuText = larkText(fields['SKU(s)']);
  const piecesRaw = larkText(fields['Total pieces per pack']);
  const piecesNum = piecesRaw != null ? Number(piecesRaw) : NaN;
  const pieces = Number.isInteger(piecesNum) && piecesNum > 0 ? piecesNum : null;
  return { orderNumber, logUniqueCode, weightKg, dims, trackingNumber, carrierKey, labelDate, hop, skuText, pieces, warnings };
```

Sửa `mk` trong `classify.test.ts`: thêm `hop: null, skuText: null, pieces: null,` vào object mặc định.

- [ ] **Bước 4:** `npx vitest run features/lark` — PASS; `npx tsc --noEmit` xanh.

- [ ] **Bước 5: Commit** `feat(lark): PackRow đọc thêm hộp VTĐG1, SKU(s), số món`

---

### Task 2: Migration 0148 + `patch-kien.ts` dùng chung cho cron

**Files:**
- Create: `db/migrations/0148_dong-hang.sql`
- Modify: `db/schema.ts` (bảng `shipments`, thêm `larkPackChoKhop`)
- Create: `features/lark/patch-kien.ts`
- Modify: `features/lark/sync.ts` (bỏ `patchFrom` nội bộ; import; nạp thêm cột; insert dùng `giaTriTaoKien`)
- Test: `features/lark/patch-kien.test.ts`

**Interfaces:**
- Consumes: `PackRow` (Task 1).
- Produces: `patchFrom(row: PackRow): Record<string, unknown>`; `giaTriTaoKien(row: PackRow, orderId: string): typeof schema.shipments.$inferInsert`; `schema.shipments.skuText/pieces/larkHop`; `schema.larkPackChoKhop`.

- [ ] **Bước 1: Migration** `db/migrations/0148_dong-hang.sql`:

```sql
-- Màn "Đóng hàng" (spec 22/09/2026): kiện đóng xong về SMS tức thì từ Lark.
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS sku_text text;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS pieces integer;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS lark_hop text;
-- Dòng Lark đã đóng xong nhưng SMS chưa khớp được đơn — hiện đỏ trên màn Đóng hàng, xoá khi khớp.
CREATE TABLE IF NOT EXISTS lark_pack_cho_khop (
  record_id text PRIMARY KEY,
  log_unique_code text,
  order_number text,
  weight_kg numeric(10,3),
  dims text,
  hop text,
  sku_text text,
  pieces integer,
  ly_do text NOT NULL,
  nhan_luc timestamp NOT NULL DEFAULT now()
);
```

- [ ] **Bước 2: `db/schema.ts`** — trong `shipments` sau `note`:

```ts
  /** Cột Lark LOG-Export cho màn "Đóng hàng" (22/09/2026): hộp `Select VTĐG1`, `SKU(s)`, `Total pieces per pack`. */
  skuText: text('sku_text'),
  pieces: integer('pieces'),
  larkHop: text('lark_hop'),
```

Sau `larkSyncRuns`:

```ts
/** Dòng Lark đóng xong (webhook /api/lark/pack) mà SMS chưa khớp được đơn. Xoá khi khớp. */
export const larkPackChoKhop = pgTable('lark_pack_cho_khop', {
  recordId: text('record_id').primaryKey(),
  logUniqueCode: text('log_unique_code'),
  orderNumber: text('order_number'),
  weightKg: numeric('weight_kg', { precision: 10, scale: 3 }),
  dims: text('dims'),
  hop: text('hop'),
  skuText: text('sku_text'),
  pieces: integer('pieces'),
  lyDo: text('ly_do').notNull(),
  nhanLuc: timestamp('nhan_luc').notNull().defaultNow(),
});
```

- [ ] **Bước 3: Test thất bại** `features/lark/patch-kien.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { patchFrom, giaTriTaoKien } from './patch-kien';
import type { PackRow } from './parse-pack-row';

const mk = (o: Partial<PackRow>): PackRow => ({
  orderNumber: '#MBLVD1', logUniqueCode: 'PK-1', weightKg: null, dims: null, trackingNumber: null,
  carrierKey: null, labelDate: null, hop: null, skuText: null, pieces: null, warnings: [], ...o,
});

describe('patchFrom', () => {
  it('chỉ ghi trường Lark có giá trị; cân/kích thước thành chuỗi numeric', () => {
    const p = patchFrom(mk({ weightKg: 1.6, dims: { l: 40, w: 30, h: 2 }, hop: 'Box A', skuText: 'X x1', pieces: 2 }));
    expect(p).toMatchObject({ actualWeightKg: '1.6', dimLengthCm: '40', dimWidthCm: '30', dimHeightCm: '2', larkHop: 'Box A', skuText: 'X x1', pieces: 2 });
    expect(p.trackingNumber).toBeUndefined();
    expect(p.updatedAt).toBeInstanceOf(Date);
  });
  it('dòng trống → chỉ có updatedAt', () => {
    expect(Object.keys(patchFrom(mk({})))).toEqual(['updatedAt']);
  });
});

describe('giaTriTaoKien', () => {
  it('đủ cột cron đang insert + 3 cột mới', () => {
    const v = giaTriTaoKien(mk({ weightKg: 0.5, dims: { l: 10, w: 10, h: null }, trackingNumber: 'T1', carrierKey: 'ups', hop: 'Bag', pieces: 1 }), 'order-1');
    expect(v).toEqual({
      orderId: 'order-1', logUniqueCode: 'PK-1', trackingNumber: 'T1', carrierKey: 'ups',
      actualWeightKg: '0.5', dimLengthCm: '10', dimWidthCm: '10', dimHeightCm: null,
      labelCreatedAt: null, larkHop: 'Bag', skuText: null, pieces: 1,
    });
  });
});
```

- [ ] **Bước 4:** `npx vitest run features/lark/patch-kien.test.ts` — FAIL (module không tồn tại).

- [ ] **Bước 5: Viết `features/lark/patch-kien.ts`:**

```ts
/**
 * Một chỗ duy nhất biến PackRow (dòng Lark) thành giá trị ghi vào `shipments`.
 * Cron `sync-lark` và webhook `/api/lark/pack` cùng dùng — hai đường vào, một luật.
 */
import type { schema } from '@/db/client';
import type { PackRow } from './parse-pack-row';

/** Patch shipment từ PackRow — chỉ field Lark có giá trị (ghi đè có điều kiện). */
export function patchFrom(row: PackRow): Record<string, unknown> {
  const p: Record<string, unknown> = { updatedAt: new Date() };
  if (row.weightKg != null) p.actualWeightKg = String(row.weightKg);
  if (row.dims) {
    p.dimLengthCm = String(row.dims.l); p.dimWidthCm = String(row.dims.w);
    if (row.dims.h != null) p.dimHeightCm = String(row.dims.h);
  }
  if (row.trackingNumber) p.trackingNumber = row.trackingNumber;
  if (row.carrierKey) p.carrierKey = row.carrierKey;
  if (row.labelDate) p.labelCreatedAt = row.labelDate;
  if (row.hop) p.larkHop = row.hop;
  if (row.skuText) p.skuText = row.skuText;
  if (row.pieces != null) p.pieces = row.pieces;
  return p;
}

/** Giá trị insert kiện mới từ dòng Lark đã khớp đơn. */
export function giaTriTaoKien(row: PackRow, orderId: string): typeof schema.shipments.$inferInsert {
  return {
    orderId,
    logUniqueCode: row.logUniqueCode,
    trackingNumber: row.trackingNumber,
    carrierKey: row.carrierKey,
    actualWeightKg: row.weightKg != null ? String(row.weightKg) : null,
    dimLengthCm: row.dims ? String(row.dims.l) : null,
    dimWidthCm: row.dims ? String(row.dims.w) : null,
    dimHeightCm: row.dims?.h != null ? String(row.dims.h) : null,
    labelCreatedAt: row.labelDate,
    larkHop: row.hop,
    skuText: row.skuText,
    pieces: row.pieces,
  };
}
```

- [ ] **Bước 6: Sửa `sync.ts`:** xoá hàm `patchFrom` nội bộ, `import { patchFrom, giaTriTaoKien } from './patch-kien';`; trong `existing` select thêm `skuText: schema.shipments.skuText, pieces: schema.shipments.pieces, larkHop: schema.shipments.larkHop,` (để `coThayDoi` so được cột mới); vòng insert `create` thay object literal bằng `.values(giaTriTaoKien(c.row, c.orderId)).onConflictDoNothing()`.

- [ ] **Bước 7:** `npx vitest run features/lark && npx tsc --noEmit` — xanh.

- [ ] **Bước 8: Áp migration lên prod** — script tạm `scripts/_mig.ts` (xoá sau khi chạy):

```ts
import { readFileSync } from 'node:fs';
import { db } from '@/db/client';
import { sql } from 'drizzle-orm';
async function main() {
  await db.execute(sql.raw(readFileSync('db/migrations/0148_dong-hang.sql', 'utf8')));
  const r = await db.execute(sql`select table_name, column_name from information_schema.columns where (table_name = 'shipments' and column_name in ('sku_text','pieces','lark_hop')) or table_name = 'lark_pack_cho_khop' order by 1, 2`);
  console.log((r as { rows: unknown[] }).rows);
  process.exit(0);
}
main();
```

Chạy `npx tsx --env-file=.env scripts/_mig.ts` → in 3 cột shipments + 10 cột bảng mới. Xoá `scripts/_mig.ts`.

- [ ] **Bước 9: Commit** `feat(lark): cột hộp/SKU/số món trên shipments, bảng lark_pack_cho_khop; patchFrom tách ra patch-kien.ts` (gồm migration, schema, patch-kien, sync, test).

---

### Task 3: `getLogRecordById` + lõi `nhanMotDongLark`

**Files:**
- Modify: `features/lark/client.ts`
- Create: `features/lark/nhan-mot-dong.ts`
- Modify: `features/lark/sync.ts` (xoá `lark_pack_cho_khop` khi cron tạo được kiện)
- Test: `features/lark/nhan-mot-dong.test.ts`

**Interfaces:**
- Consumes: `parsePackRow`, `classifyPackRows(rows, maps: ClassifyMaps)`, `resolveOrderIds(orderNumbers)`, `patchFrom`, `giaTriTaoKien`, `schema.larkPackChoKhop`.
- Produces:

```ts
export type KetQuaNhanDong =
  | { ketQua: 'tao' | 'cap_nhat'; shipmentId: string; logUniqueCode: string | null }
  | { ketQua: 'khong_khop' | 'bo_qua'; logUniqueCode: string | null; lyDo: string };
export class LoiLarkApi extends Error {}
export function docKetQuaPhanLoai(cls: ClassifyResult): PhanLoaiMotDong;  // THUẦN
export async function nhanMotDongLark(recordId: string, opts?: { dry?: boolean }): Promise<KetQuaNhanDong>;
```

- [ ] **Bước 1: `client.ts`** — thêm sau `listAllRecords`:

```ts
/** Mã lỗi Lark khi record_id không tồn tại (đã xoá) — coi là "không có", không phải lỗi API. */
const LARK_RECORD_NOT_FOUND = 1254043;

/**
 * Đọc MỘT record bảng logistics theo record_id (webhook /api/lark/pack). Trả null nếu
 * record không còn. Lỗi mạng/API khác → throw (caller trả 502 để Lark thử lại).
 */
export async function getLogRecordById(recordId: string): Promise<LarkRecord | null> {
  const token = await getTenantToken();
  const url = `${DOMAIN}/open-apis/bitable/v1/apps/${env('LARK_BASE_APP_TOKEN')}/tables/${logTableId()}/records/${encodeURIComponent(recordId)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) });
  const j = (await res.json()) as { code: number; msg: string; data?: { record?: LarkRecord } };
  if (j.code === LARK_RECORD_NOT_FOUND) return null;
  if (j.code !== 0) throw new Error(`[lark] get record fail: code=${j.code} msg=${j.msg}`);
  return j.data?.record ?? null;
}
```

- [ ] **Bước 2: Test thất bại** `features/lark/nhan-mot-dong.test.ts` (chỉ phần THUẦN):

```ts
import { describe, it, expect } from 'vitest';
import { docKetQuaPhanLoai } from './nhan-mot-dong';
import type { ClassifyResult } from './classify';
import type { PackRow } from './parse-pack-row';

const row: PackRow = { orderNumber: '#MBLVD1', logUniqueCode: 'PK-1', weightKg: 1, dims: null, trackingNumber: null,
  carrierKey: null, labelDate: null, hop: null, skuText: null, pieces: null, warnings: [] };
const trong = (): ClassifyResult => ({ update: [], create: [], unmatched: [], skipped: [] });

describe('docKetQuaPhanLoai', () => {
  it('update → cap_nhat với shipmentId', () => {
    const c = trong(); c.update.push({ row, shipmentId: 's1' });
    expect(docKetQuaPhanLoai(c)).toEqual({ loai: 'update', shipmentId: 's1' });
  });
  it('create → tao với orderId', () => {
    const c = trong(); c.create.push({ row, orderId: 'o1' });
    expect(docKetQuaPhanLoai(c)).toEqual({ loai: 'create', orderId: 'o1' });
  });
  it('unmatched → khong_khop kèm lý do', () => {
    const c = trong(); c.unmatched.push({ orderNumber: '#MBLVD1', reason: 'order chưa có trong hệ thống' });
    expect(docKetQuaPhanLoai(c)).toEqual({ loai: 'unmatched', lyDo: 'order chưa có trong hệ thống' });
  });
  it('skipped → bo_qua kèm lý do; rỗng → bo_qua', () => {
    const c = trong(); c.skipped.push({ orderNumber: 'DISCN5', reason: 'DISCN partner ship' });
    expect(docKetQuaPhanLoai(c)).toEqual({ loai: 'skipped', lyDo: 'DISCN partner ship' });
    expect(docKetQuaPhanLoai(trong())).toEqual({ loai: 'skipped', lyDo: 'không phân loại được' });
  });
});
```

- [ ] **Bước 3:** `npx vitest run features/lark/nhan-mot-dong.test.ts` — FAIL.

- [ ] **Bước 4: Viết `features/lark/nhan-mot-dong.ts`:**

```ts
/**
 * Nhận MỘT dòng Lark LOG-Export (webhook /api/lark/pack) và ghi vào shipments bằng
 * ĐÚNG luật của cron sync-lark: parsePackRow → classifyPackRows → patchFrom/giaTriTaoKien.
 * Không tin dữ liệu Lark gửi kèm — đọc lại record theo record_id.
 *
 * Idempotent: khớp theo log_unique_code → lần bắn lại là 'cap_nhat'. Hai request cùng
 * record_id chạy đồng thời dùng chung một Promise (khoá trong tiến trình) + onConflictDoNothing.
 */
import { eq, or } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { getLogRecordById } from './client';
import { parsePackRow } from './parse-pack-row';
import { classifyPackRows, type ClassifyMaps, type ClassifyResult } from './classify';
import { patchFrom, giaTriTaoKien } from './patch-kien';
import { resolveOrderIds } from '@/features/shipments/import-actions';

export type KetQuaNhanDong =
  | { ketQua: 'tao' | 'cap_nhat'; shipmentId: string; logUniqueCode: string | null }
  | { ketQua: 'khong_khop' | 'bo_qua'; logUniqueCode: string | null; lyDo: string };

/** Lark API lỗi/timeout — route trả 502 để Lark thử lại. */
export class LoiLarkApi extends Error {}

export type PhanLoaiMotDong =
  | { loai: 'update'; shipmentId: string }
  | { loai: 'create'; orderId: string }
  | { loai: 'unmatched'; lyDo: string }
  | { loai: 'skipped'; lyDo: string };

/** THUẦN: kết quả classifyPackRows cho đúng MỘT dòng → một nhánh. */
export function docKetQuaPhanLoai(cls: ClassifyResult): PhanLoaiMotDong {
  if (cls.update[0]) return { loai: 'update', shipmentId: cls.update[0].shipmentId };
  if (cls.create[0]) return { loai: 'create', orderId: cls.create[0].orderId };
  if (cls.unmatched[0]) return { loai: 'unmatched', lyDo: cls.unmatched[0].reason };
  return { loai: 'skipped', lyDo: cls.skipped[0]?.reason ?? 'không phân loại được' };
}

const dangXuLy = new Map<string, Promise<KetQuaNhanDong>>();

export async function nhanMotDongLark(recordId: string, opts?: { dry?: boolean }): Promise<KetQuaNhanDong> {
  const dang = dangXuLy.get(recordId);
  if (dang) return dang;
  const p = xuLy(recordId, opts?.dry === true).finally(() => dangXuLy.delete(recordId));
  dangXuLy.set(recordId, p);
  return p;
}

async function xuLy(recordId: string, dry: boolean): Promise<KetQuaNhanDong> {
  let rec: Awaited<ReturnType<typeof getLogRecordById>>;
  try { rec = await getLogRecordById(recordId); }
  catch (e) { throw new LoiLarkApi(e instanceof Error ? e.message : String(e)); }
  if (!rec) return { ketQua: 'bo_qua', logUniqueCode: null, lyDo: 'record không còn trên Lark' };

  const row = parsePackRow(rec.fields);
  if (!row.logUniqueCode) return { ketQua: 'bo_qua', logUniqueCode: null, lyDo: 'dòng chưa có Log Unique code' };
  if (!row.orderNumber) return { ketQua: 'bo_qua', logUniqueCode: row.logUniqueCode, lyDo: 'dòng chưa có Order Number' };

  // Map đối chiếu chỉ cho dòng này (cron nạp cả bảng; ở đây 1 dòng → 2 truy vấn nhỏ).
  const dieuKien = row.trackingNumber
    ? or(eq(schema.shipments.logUniqueCode, row.logUniqueCode), eq(schema.shipments.trackingNumber, row.trackingNumber))
    : eq(schema.shipments.logUniqueCode, row.logUniqueCode);
  const daCo = await db.select({ id: schema.shipments.id, logUniqueCode: schema.shipments.logUniqueCode, trackingNumber: schema.shipments.trackingNumber })
    .from(schema.shipments).where(dieuKien);
  const maps: ClassifyMaps = { shipmentByLogCode: new Map(), shipmentByTracking: new Map(), orderIdByNumber: await resolveOrderIds([row.orderNumber]) };
  for (const s of daCo) {
    if (s.logUniqueCode) maps.shipmentByLogCode.set(s.logUniqueCode, s.id);
    if (s.trackingNumber) maps.shipmentByTracking.set(s.trackingNumber, s.id);
  }
  const pl = docKetQuaPhanLoai(classifyPackRows([row], maps));

  if (pl.loai === 'skipped') return { ketQua: 'bo_qua', logUniqueCode: row.logUniqueCode, lyDo: pl.lyDo };
  if (pl.loai === 'unmatched') {
    if (!dry) {
      const gt = {
        logUniqueCode: row.logUniqueCode, orderNumber: row.orderNumber,
        weightKg: row.weightKg != null ? String(row.weightKg) : null,
        dims: row.dims ? `${row.dims.l}x${row.dims.w}${row.dims.h != null ? `x${row.dims.h}` : ''}` : null,
        hop: row.hop, skuText: row.skuText, pieces: row.pieces, lyDo: pl.lyDo, nhanLuc: new Date(),
      };
      await db.insert(schema.larkPackChoKhop).values({ recordId, ...gt })
        .onConflictDoUpdate({ target: schema.larkPackChoKhop.recordId, set: gt });
    }
    return { ketQua: 'khong_khop', logUniqueCode: row.logUniqueCode, lyDo: pl.lyDo };
  }
  if (dry) {
    return pl.loai === 'update'
      ? { ketQua: 'cap_nhat', shipmentId: pl.shipmentId, logUniqueCode: row.logUniqueCode }
      : { ketQua: 'tao', shipmentId: '(dry)', logUniqueCode: row.logUniqueCode };
  }

  let shipmentId: string;
  let ketQua: 'tao' | 'cap_nhat';
  if (pl.loai === 'update') {
    await db.update(schema.shipments).set(patchFrom(row)).where(eq(schema.shipments.id, pl.shipmentId));
    shipmentId = pl.shipmentId; ketQua = 'cap_nhat';
  } else {
    const [ins] = await db.insert(schema.shipments).values(giaTriTaoKien(row, pl.orderId)).onConflictDoNothing().returning({ id: schema.shipments.id });
    if (ins) { shipmentId = ins.id; ketQua = 'tao'; }
    else {
      // Đụng unique tracking (request song song vừa tạo) → tìm lại kiện theo log code.
      const [s] = await db.select({ id: schema.shipments.id }).from(schema.shipments).where(eq(schema.shipments.logUniqueCode, row.logUniqueCode)).limit(1);
      if (!s) return { ketQua: 'bo_qua', logUniqueCode: row.logUniqueCode, lyDo: 'không tạo được kiện (đụng mã vận đơn đã có)' };
      shipmentId = s.id; ketQua = 'cap_nhat';
    }
  }
  await db.delete(schema.larkPackChoKhop).where(eq(schema.larkPackChoKhop.recordId, recordId));
  return { ketQua, shipmentId, logUniqueCode: row.logUniqueCode };
}
```

- [ ] **Bước 5: `sync.ts`** — sau vòng insert `create`, xoá dòng chờ khớp mà cron vừa khớp được:

```ts
    // Kiện từng nằm ở "chờ khớp" (webhook /api/lark/pack) nay cron tạo được → gỡ khỏi màn Đóng hàng.
    const maVuaTao = cls.create.map((c) => c.row.logUniqueCode).filter((x): x is string => !!x);
    if (maVuaTao.length > 0) {
      await db.delete(schema.larkPackChoKhop).where(inArray(schema.larkPackChoKhop.logUniqueCode, maVuaTao));
    }
```

(thêm `inArray` vào import drizzle-orm).

- [ ] **Bước 6:** `npx vitest run features/lark && npx tsc --noEmit` — xanh.

- [ ] **Bước 7: Kiểm thật (dry) bằng script tạm** `scripts/_pack.ts`:

```ts
import { nhanMotDongLark } from '@/features/lark/nhan-mot-dong';
import { listAllRecords } from '@/features/lark/client';
async function main() {
  const recs = await listAllRecords();
  const r = recs.find((x) => x.fields['Weights'] != null && x.fields['Tracking Number'] == null) ?? recs[recs.length - 1];
  console.log('record', r.record_id, r.fields['Log Unique code'], r.fields['Order Number']);
  console.log(await nhanMotDongLark(r.record_id, { dry: true }));
  process.exit(0);
}
main();
```

Chạy `railway run --service "sync Lark operation" npx tsx scripts/_pack.ts` (Lark keys ở service này; chạy nền, Railway CLI có thể treo >120s). Ghi kết quả vào report. Xoá script.

- [ ] **Bước 8: Commit** `feat(lark): nhận một dòng LOG-Export theo record_id (lõi webhook), getLogRecordById`

---

### Task 4: Endpoint `POST /api/lark/pack` + xác thực + job

**Files:**
- Create: `features/lark/pack-webhook/xac-thuc.ts`
- Create: `app/api/lark/pack/route.ts`
- Modify: `features/jobs/registry.ts`, `features/jobs/groups.ts`
- Test: `features/lark/pack-webhook/xac-thuc.test.ts`

**Interfaces:**
- Consumes: `nhanMotDongLark`, `LoiLarkApi`, `batDauJob`, `ketThucJob` (`features/jobs/record.ts`).
- Produces: `kiemTraSecret(header, env)`, `docBodyPack(raw)`.

- [ ] **Bước 1: Test thất bại** `features/lark/pack-webhook/xac-thuc.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { kiemTraSecret, docBodyPack, GIOI_HAN_BODY } from './xac-thuc';

describe('kiemTraSecret', () => {
  it('đúng secret → ok', () => expect(kiemTraSecret('abc123', 'abc123')).toEqual({ ok: true }));
  it('sai / thiếu header → 401', () => {
    expect(kiemTraSecret('abc124', 'abc123')).toEqual({ ok: false, status: 401, error: 'sai secret' });
    expect(kiemTraSecret(null, 'abc123')).toEqual({ ok: false, status: 401, error: 'sai secret' });
    expect(kiemTraSecret('abc12', 'abc123').ok).toBe(false); // khác độ dài, không throw
  });
  it('thiếu env → 503', () => {
    expect(kiemTraSecret('abc', undefined)).toEqual({ ok: false, status: 503, error: 'chưa cấu hình LARK_PACK_WEBHOOK_SECRET' });
    expect(kiemTraSecret('abc', '')).toEqual({ ok: false, status: 503, error: 'chưa cấu hình LARK_PACK_WEBHOOK_SECRET' });
  });
});

describe('docBodyPack', () => {
  it('JSON có record_id → ok', () => {
    expect(docBodyPack('{"record_id":"recXYZ","log_unique_code":"PK-1"}')).toEqual({ ok: true, recordId: 'recXYZ', logUniqueCode: 'PK-1' });
  });
  it('thiếu record_id / không phải JSON / quá 4KB → lỗi', () => {
    expect(docBodyPack('{}')).toEqual({ ok: false, status: 400, error: 'thiếu record_id' });
    expect(docBodyPack('xx')).toEqual({ ok: false, status: 400, error: 'body không phải JSON' });
    expect(docBodyPack('{"record_id":"' + 'a'.repeat(GIOI_HAN_BODY) + '"}')).toEqual({ ok: false, status: 413, error: 'body quá 4KB' });
  });
});
```

- [ ] **Bước 2:** `npx vitest run features/lark/pack-webhook` — FAIL.

- [ ] **Bước 3: Viết `xac-thuc.ts`:**

```ts
/** THUẦN: xác thực + đọc body cho webhook /api/lark/pack (Lark Automation → SMS). */
import { timingSafeEqual } from 'node:crypto';

export const GIOI_HAN_BODY = 4096;

export type KetQuaSecret = { ok: true } | { ok: false; status: 401 | 503; error: string };

export function kiemTraSecret(header: string | null, env: string | undefined): KetQuaSecret {
  if (!env) return { ok: false, status: 503, error: 'chưa cấu hình LARK_PACK_WEBHOOK_SECRET' };
  const a = Buffer.from(header ?? '', 'utf8'), b = Buffer.from(env, 'utf8');
  // timingSafeEqual ném lỗi khi khác độ dài → so độ dài trước, vẫn trả 401.
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, status: 401, error: 'sai secret' };
  return { ok: true };
}

export type KetQuaBody = { ok: true; recordId: string; logUniqueCode: string | null } | { ok: false; status: 400 | 413; error: string };

export function docBodyPack(raw: string): KetQuaBody {
  if (Buffer.byteLength(raw, 'utf8') > GIOI_HAN_BODY) return { ok: false, status: 413, error: 'body quá 4KB' };
  let j: unknown;
  try { j = JSON.parse(raw); } catch { return { ok: false, status: 400, error: 'body không phải JSON' }; }
  const o = (j && typeof j === 'object' ? j : {}) as Record<string, unknown>;
  const recordId = typeof o.record_id === 'string' ? o.record_id.trim() : '';
  if (!recordId) return { ok: false, status: 400, error: 'thiếu record_id' };
  const logUniqueCode = typeof o.log_unique_code === 'string' && o.log_unique_code.trim() ? o.log_unique_code.trim() : null;
  return { ok: true, recordId, logUniqueCode };
}
```

- [ ] **Bước 4: Route `app/api/lark/pack/route.ts`:**

```ts
/**
 * POST /api/lark/pack — Lark Automation gọi khi một dòng LOG-Export đóng xong
 * (Weights · Dimension · Select VTĐG1 · Attachment có, Tracking Number trống).
 * Body { record_id }. SMS đọc lại record và ghi kiện (features/lark/nhan-mot-dong.ts).
 * Mã HTTP theo "Lark có nên thử lại không": 200 mọi kết quả nghiệp vụ, 502 khi Lark API lỗi.
 */
import { NextResponse } from 'next/server';
import { kiemTraSecret, docBodyPack } from '@/features/lark/pack-webhook/xac-thuc';
import { nhanMotDongLark, LoiLarkApi } from '@/features/lark/nhan-mot-dong';
import { batDauJob, ketThucJob } from '@/features/jobs/record';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  const xt = kiemTraSecret(req.headers.get('x-lark-pack-secret'), process.env.LARK_PACK_WEBHOOK_SECRET);
  if (!xt.ok) return NextResponse.json({ error: xt.error }, { status: xt.status });
  const body = docBodyPack(await req.text());
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status });

  const dry = process.env.LARK_PACK_DRY === '1';
  const batDau = Date.now();
  const jobId = await batDauJob('lark-pack-webhook');
  try {
    const kq = await nhanMotDongLark(body.recordId, { dry });
    const ms = Date.now() - batDau;
    await ketThucJob(jobId, { ok: true, summary: { recordId: body.recordId, logCodeTuLark: body.logUniqueCode, ...kq, dry, ms }, batDau });
    return NextResponse.json({ ...kq, dry, ms });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await ketThucJob(jobId, { ok: false, error: `${body.recordId}: ${msg}`.slice(0, 2000), batDau });
    const status = e instanceof LoiLarkApi ? 502 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
```

- [ ] **Bước 5: Registry + nhóm.** `registry.ts` thêm sau `ghi-nguoc-lark`:

```ts
  { key: 'lark-pack-webhook', ten: 'Nhận kiện đóng xong từ Lark (webhook)', chuKyPhut: 1 * NGAY,
    hauQua: 'Kiện đóng xong không về SMS tức thì — Đức phải chọn line trên Lark' },
```

`groups.ts` thêm nhóm (kèm ghi chú): 

```ts
  // Không phải cron: Lark Automation gọi /api/lark/pack, mỗi request một dòng job_runs.
  // Khai nhóm để test "mọi tác vụ đều có nhóm" không kêu; run-group sẽ báo "chưa nối" nếu ai chạy nhầm.
  'tu-lark': ['lark-pack-webhook'],
```

- [ ] **Bước 6:** `npx vitest run features/lark features/jobs && npx tsc --noEmit` — xanh. `npx next build` xanh (route mới).

- [ ] **Bước 7: Commit** `feat(lark): endpoint POST /api/lark/pack nhận kiện đóng xong từ Lark Automation; job lark-pack-webhook`

---

### Task 5: Lõi màn Đóng hàng — logic thuần, truy vấn, actions

**Files:**
- Create: `features/dong-hang/types.ts`, `features/dong-hang/logic.ts`, `features/dong-hang/queries.ts`, `features/dong-hang/actions.ts`
- Test: `features/dong-hang/logic.test.ts`

**Interfaces:**
- Consumes: `quoteOrderAcrossCarriers`, `CarrierQuoteRow` (`features/carrier-rates/compare/quote-order-carriers.ts`), `laNhaDan` (`features/carrier-rates/residential-from-class.ts`), `assignOrderCarrier` (`features/shopify-orders/carrier-select-actions.ts`), `hasPermission`, `getRole`, `auth`.
- Produces (types.ts):

```ts
import type { CarrierQuoteRow } from '@/features/carrier-rates/compare/quote-order-carriers';
export type BoLocDongHang = 'chua_tracking' | 'hom_nay' | '7_ngay' | 'tat_ca';
export const BO_LOC: readonly BoLocDongHang[] = ['chua_tracking', 'hom_nay', '7_ngay', 'tat_ca'];
export interface KienDongHang {
  shipmentId: string; orderId: string; orderNumber: string; storeName: string; country: string | null;
  weightKg: number | null; dims: { l: number; w: number; h: number | null } | null;
  hop: string | null; skuText: string | null; pieces: number | null;
  trackingNumber: string | null; hangKhachTra: string | null;
  selectedCarrierKey: string | null; selectedCarrierBy: string | null; selectedCarrierAt: string | null;
  /** ISO — coalesce(label_created_at, created_at). */
  ngayDong: string;
  soKienCungDon: number;
}
export interface KienChoKhop {
  recordId: string; logUniqueCode: string | null; orderNumber: string | null; weightKg: number | null;
  dims: string | null; hop: string | null; skuText: string | null; pieces: number | null; lyDo: string; nhanLuc: string;
}
export interface BaoGiaKien { rows: CarrierQuoteRow[]; reNhatKey: string | null; error?: string; luc: string }
export type TrangThaiKien =
  | { ma: 'cho_chon' }
  | { ma: 'da_chon'; hang: string; nguoi: string | null; luc: string | null }
  | { ma: 'da_len_nhan'; tracking: string };
```

- [ ] **Bước 1: Test thất bại** `features/dong-hang/logic.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { canQuyDoi, trangThaiKien, nhomTheoNgay, xepQuote } from './logic';
import type { CarrierQuoteRow } from '@/features/carrier-rates/compare/quote-order-carriers';

describe('canQuyDoi', () => {
  it('thể tích/5000, làm tròn 0,1 rồi trần 0,5 (luật FedEx)', () => {
    // 40×30×20 = 24000 / 5000 = 4.8 → 5.0; cân thực 1.2 → tính cước 5.0
    expect(canQuyDoi(1.2, { l: 40, w: 30, h: 20 })).toEqual({ quyDoi: 4.8, tinhCuoc: 5 });
    // 2.355 → 2.4 → 2.5
    expect(canQuyDoi(2.355, null)).toEqual({ quyDoi: null, tinhCuoc: 2.5 });
  });
  it('thiếu chiều cao → không quy đổi; thiếu cân → null', () => {
    expect(canQuyDoi(1, { l: 40, w: 30, h: null })).toEqual({ quyDoi: null, tinhCuoc: 1 });
    expect(canQuyDoi(null, null)).toEqual({ quyDoi: null, tinhCuoc: null });
  });
});

describe('trangThaiKien', () => {
  it('có tracking → đã lên nhãn (thắng mọi trạng thái)', () => {
    expect(trangThaiKien({ trackingNumber: '1Z1', selectedCarrierKey: 'ups', selectedCarrierBy: 'duc', selectedCarrierAt: '2026-09-22T03:00:00Z' })).toEqual({ ma: 'da_len_nhan', tracking: '1Z1' });
  });
  it('đã chọn hãng → da_chon kèm người/giờ; chưa gì → cho_chon', () => {
    expect(trangThaiKien({ trackingNumber: null, selectedCarrierKey: 'ups', selectedCarrierBy: 'duc', selectedCarrierAt: '2026-09-22T03:00:00Z' })).toEqual({ ma: 'da_chon', hang: 'ups', nguoi: 'duc', luc: '2026-09-22T03:00:00Z' });
    expect(trangThaiKien({ trackingNumber: null, selectedCarrierKey: null, selectedCarrierBy: null, selectedCarrierAt: null })).toEqual({ ma: 'cho_chon' });
  });
});

describe('nhomTheoNgay', () => {
  it('nhóm theo ngày VN, ngày mới trước, giữ thứ tự trong nhóm', () => {
    const r = nhomTheoNgay([
      { id: 'a', ngayDong: '2026-09-22T17:30:00Z' }, // 00:30 23/09 VN
      { id: 'b', ngayDong: '2026-09-22T03:00:00Z' }, // 22/09 VN
      { id: 'c', ngayDong: '2026-09-22T05:00:00Z' }, // 22/09 VN
    ]);
    expect(r.map((g) => [g.ngay, g.kien.map((k) => k.id)])).toEqual([['2026-09-23', ['a']], ['2026-09-22', ['b', 'c']]]);
  });
});

describe('xepQuote', () => {
  const q = (o: Partial<CarrierQuoteRow>): CarrierQuoteRow => ({ carrierKey: 'x', carrierName: 'X', accountId: 'a', ok: true, vndCost: 0, ...o });
  it('ok trước theo cước tăng dần, lỗi cuối; rẻ nhất bỏ qua hãng tạm ngưng', () => {
    const r = xepQuote([
      q({ carrierKey: 'fedex', accountId: '1', vndCost: 300 }),
      q({ carrierKey: 'dhl', accountId: '2', ok: false, error: 'no zone' }),
      q({ carrierKey: 'aramex', accountId: '3', vndCost: 100, suspendedAt: '2026-01-01T00:00:00Z' }),
      q({ carrierKey: 'ups', accountId: '4', vndCost: 200 }),
    ]);
    expect(r.rows.map((x) => x.carrierKey)).toEqual(['aramex', 'ups', 'fedex', 'dhl']);
    expect(r.reNhatKey).toBe('ups');
  });
});
```

- [ ] **Bước 2:** `npx vitest run features/dong-hang` — FAIL.

- [ ] **Bước 3: Viết `types.ts`** (khối Interfaces ở trên, y nguyên) và **`logic.ts`:**

```ts
/** THUẦN: luật hiển thị màn "Đóng hàng". Không đụng DB. */
import type { CarrierQuoteRow } from '@/features/carrier-rates/compare/quote-order-carriers';
import type { TrangThaiKien } from './types';

const DIM_DIVISOR = 5000;

/** Cân quy đổi (D×R×C/5000) và cân tính cước = max(thực, quy đổi) làm tròn 0,1 rồi trần 0,5 —
 *  đúng luật FedEx trong engine. CHỈ để hiển thị, cước vẫn lấy từ engine. */
export function canQuyDoi(weightKg: number | null, dims: { l: number; w: number; h: number | null } | null): { quyDoi: number | null; tinhCuoc: number | null } {
  const quyDoi = dims && dims.h != null ? Math.round((dims.l * dims.w * dims.h / DIM_DIVISOR) * 1000) / 1000 : null;
  if (weightKg == null) return { quyDoi, tinhCuoc: null };
  const raw = Math.max(weightKg, quyDoi ?? 0);
  const tinhCuoc = Math.ceil((Math.round(raw * 10) / 10 - 1e-9) / 0.5) * 0.5;
  return { quyDoi, tinhCuoc: Math.round(tinhCuoc * 1000) / 1000 };
}

export function trangThaiKien(k: { trackingNumber: string | null; selectedCarrierKey: string | null; selectedCarrierBy: string | null; selectedCarrierAt: string | null }): TrangThaiKien {
  if (k.trackingNumber) return { ma: 'da_len_nhan', tracking: k.trackingNumber };
  if (k.selectedCarrierKey) return { ma: 'da_chon', hang: k.selectedCarrierKey, nguoi: k.selectedCarrierBy, luc: k.selectedCarrierAt };
  return { ma: 'cho_chon' };
}

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
export function ngayVn(iso: string): string {
  return new Date(new Date(iso).getTime() + VN_OFFSET_MS).toISOString().slice(0, 10);
}

/** Nhóm theo ngày-lịch VN, ngày mới trước; trong nhóm giữ thứ tự đầu vào. */
export function nhomTheoNgay<T extends { ngayDong: string }>(rows: T[]): Array<{ ngay: string; kien: T[] }> {
  const m = new Map<string, T[]>();
  for (const r of rows) { const d = ngayVn(r.ngayDong); m.set(d, [...(m.get(d) ?? []), r]); }
  return [...m.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([ngay, kien]) => ({ ngay, kien }));
}

export const conChonDuoc = (r: { suspendedAt?: string | null }, now = Date.now()) => !r.suspendedAt || new Date(r.suspendedAt).getTime() > now;

/** ok trước theo cước tăng dần, lỗi cuối. Rẻ nhất = rẻ nhất trong nhóm CHỌN được. */
export function xepQuote(rows: CarrierQuoteRow[], now = Date.now()): { rows: CarrierQuoteRow[]; reNhatKey: string | null } {
  const ok = rows.filter((r) => r.ok).sort((a, b) => (a.vndCost ?? Infinity) - (b.vndCost ?? Infinity));
  const loi = rows.filter((r) => !r.ok);
  const reNhat = ok.find((r) => conChonDuoc(r, now)) ?? null;
  return { rows: [...ok, ...loi], reNhatKey: reNhat?.carrierKey ?? null };
}
```

- [ ] **Bước 4:** `npx vitest run features/dong-hang` — PASS.

- [ ] **Bước 5: `queries.ts`:**

```ts
/** Truy vấn màn "Đóng hàng": mỗi dòng một kiện Lark (shipments có log_unique_code). */
import { and, desc, eq, ilike, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import type { BoLocDongHang, KienDongHang, KienChoKhop } from './types';

const GIOI_HAN = 500;

export async function listKienDongHang(loc: BoLocDongHang, q?: string): Promise<KienDongHang[]> {
  const s = schema.shipments, o = schema.shopifyOrders, st = schema.stores;
  const ngayDong = sql<Date>`coalesce(${s.labelCreatedAt}, ${s.createdAt})`;
  const dk = [isNotNull(s.logUniqueCode)];
  if (loc === 'chua_tracking') dk.push(isNull(s.trackingNumber));
  // Ngày VN = UTC+7; so theo ngày-lịch VN của mốc đóng.
  if (loc === 'hom_nay') dk.push(sql`(${ngayDong} + interval '7 hours')::date = (now() + interval '7 hours')::date`);
  if (loc === '7_ngay') dk.push(sql`${ngayDong} >= now() - interval '7 days'`);
  const tim = q?.trim();
  if (tim) dk.push(or(ilike(o.shopifyOrderNumber, `%${tim}%`), ilike(s.logUniqueCode, `%${tim}%`))!);

  const rows = await db.select({
    shipmentId: s.id, orderId: o.id, orderNumber: o.shopifyOrderNumber, storeName: st.name, country: o.shipCountry,
    weightKg: s.actualWeightKg, l: s.dimLengthCm, w: s.dimWidthCm, h: s.dimHeightCm,
    hop: s.larkHop, skuText: s.skuText, pieces: s.pieces, trackingNumber: s.trackingNumber,
    hangKhachTra: o.shippingCarrierKey, selectedCarrierKey: o.selectedCarrierKey, selectedCarrierBy: o.selectedCarrierBy, selectedCarrierAt: o.selectedCarrierAt,
    ngayDong,
    soKienCungDon: sql<number>`(select count(*)::int from shipments s2 where s2.order_id = ${o.id} and s2.log_unique_code is not null)`,
  }).from(s).innerJoin(o, eq(o.id, s.orderId)).innerJoin(st, eq(st.id, o.storeId))
    .where(and(...dk)).orderBy(desc(ngayDong), desc(s.createdAt)).limit(GIOI_HAN);

  return rows.map((r) => ({
    shipmentId: r.shipmentId, orderId: r.orderId, orderNumber: r.orderNumber, storeName: r.storeName, country: r.country,
    weightKg: r.weightKg != null ? Number(r.weightKg) : null,
    dims: r.l != null && r.w != null ? { l: Number(r.l), w: Number(r.w), h: r.h != null ? Number(r.h) : null } : null,
    hop: r.hop, skuText: r.skuText, pieces: r.pieces, trackingNumber: r.trackingNumber, hangKhachTra: r.hangKhachTra,
    selectedCarrierKey: r.selectedCarrierKey, selectedCarrierBy: r.selectedCarrierBy,
    selectedCarrierAt: r.selectedCarrierAt ? r.selectedCarrierAt.toISOString() : null,
    ngayDong: new Date(r.ngayDong).toISOString(), soKienCungDon: Number(r.soKienCungDon),
  }));
}

export async function listKienChoKhop(): Promise<KienChoKhop[]> {
  const t = schema.larkPackChoKhop;
  const rows = await db.select().from(t).orderBy(desc(t.nhanLuc)).limit(200);
  return rows.map((r) => ({
    recordId: r.recordId, logUniqueCode: r.logUniqueCode, orderNumber: r.orderNumber,
    weightKg: r.weightKg != null ? Number(r.weightKg) : null, dims: r.dims, hop: r.hop, skuText: r.skuText, pieces: r.pieces,
    lyDo: r.lyDo, nhanLuc: r.nhanLuc.toISOString(),
  }));
}
```

- [ ] **Bước 6: `actions.ts`** (`'use server'`, CHỈ export hàm async):

```ts
'use server';

import { eq } from 'drizzle-orm';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { db, schema } from '@/db/client';
import { quoteOrderAcrossCarriers } from '@/features/carrier-rates/compare/quote-order-carriers';
import { laNhaDan } from '@/features/carrier-rates/residential-from-class';
import { assignOrderCarrier } from '@/features/shopify-orders/carrier-select-actions';
import { xepQuote } from './logic';
import type { BaoGiaKien } from './types';

const CACHE_MS = 10 * 60 * 1000;
const cache = new Map<string, BaoGiaKien>();

/** Báo giá MỘT kiện qua mọi hãng theo cân thực + kích thước kiện (không phải cân đơn). Cache 10 phút. */
export async function baoGiaKien(shipmentId: string): Promise<BaoGiaKien> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { rows: [], reNhatKey: null, error: 'Chưa đăng nhập', luc: new Date().toISOString() };
  const role = await getRole(session.user.id);
  if (!hasPermission(role, 'view_fulfillment')) return { rows: [], reNhatKey: null, error: 'Không có quyền', luc: new Date().toISOString() };

  const [k] = await db.select({
    weightKg: schema.shipments.actualWeightKg, l: schema.shipments.dimLengthCm, w: schema.shipments.dimWidthCm, h: schema.shipments.dimHeightCm,
    labelCreatedAt: schema.shipments.labelCreatedAt, createdAt: schema.shipments.createdAt,
    country: schema.shopifyOrders.shipCountry, postcode: schema.shopifyOrders.shipPostcode, city: schema.shopifyOrders.shipCity, addrClass: schema.shopifyOrders.addrClass,
  }).from(schema.shipments).innerJoin(schema.shopifyOrders, eq(schema.shopifyOrders.id, schema.shipments.orderId))
    .where(eq(schema.shipments.id, shipmentId)).limit(1);
  const luc = new Date().toISOString();
  if (!k) return { rows: [], reNhatKey: null, error: 'Không tìm thấy kiện', luc };
  const weightKg = k.weightKg != null ? Number(k.weightKg) : null;
  if (!k.country || !weightKg) return { rows: [], reNhatKey: null, error: 'Kiện thiếu nước hoặc cân — chưa so cước được', luc };
  const dims = k.l != null && k.w != null && k.h != null ? { lengthCm: Number(k.l), widthCm: Number(k.w), heightCm: Number(k.h) } : null;

  const key = `${shipmentId}|${weightKg}|${dims ? `${dims.lengthCm}x${dims.widthCm}x${dims.heightCm}` : ''}`;
  const hit = cache.get(key);
  if (hit && Date.now() - new Date(hit.luc).getTime() < CACHE_MS) return hit;

  const rows = await quoteOrderAcrossCarriers({
    country: k.country, weightKg, postcode: k.postcode, city: k.city, dimensions: dims,
    effectiveDate: k.labelCreatedAt ?? k.createdAt,
    isResidential: laNhaDan(k.addrClass, k.country),
  });
  const xep = xepQuote(rows);
  const kq: BaoGiaKien = { rows: xep.rows, reNhatKey: xep.reNhatKey, luc };
  cache.set(key, kq);
  return kq;
}

/** Chọn hãng cho ĐƠN (áp cho mọi kiện của đơn — Lark ghi mọi dòng của đơn). Cần manage_fulfillment. */
export async function chonHangChoDon(orderId: string, carrierKey: string): Promise<Awaited<ReturnType<typeof assignOrderCarrier>>> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { ok: false, error: 'Chưa đăng nhập' };
  const role = await getRole(session.user.id);
  if (!hasPermission(role, 'manage_fulfillment')) return { ok: false, error: 'Không có quyền chọn hãng' };
  const r = await assignOrderCarrier(orderId, carrierKey);
  revalidatePath('/f/dong-hang');
  return r;
}
```

- [ ] **Bước 7:** `npx tsc --noEmit && npx vitest run features/dong-hang` — xanh.

- [ ] **Bước 8: Commit** `feat(dong-hang): logic thuần, truy vấn kiện đã đóng, báo giá theo kiện và chọn hãng`

---

### Task 6: Trang `/f/dong-hang` + bảng + nav

**Files:**
- Create: `app/(dashboard)/f/dong-hang/page.tsx`
- Create: `components/dong-hang/BangDongHang.tsx`
- Modify: `lib/nav.ts`

**Interfaces:**
- Consumes: `listKienDongHang`, `listKienChoKhop`, `baoGiaKien`, `chonHangChoDon`, `canQuyDoi`, `trangThaiKien`, `nhomTheoNgay`, `conChonDuoc`, `chiTietCuoc`/`dichGhiChu` (`features/carrier-rates/compare/chi-tiet-cuoc.ts`), `BO_LOC`, `BoLocDongHang`, `KienDongHang`, `KienChoKhop`, `BaoGiaKien`.

- [ ] **Bước 1: Nav** — `lib/nav.ts`: import `PackageCheck` từ lucide-react; sau dòng "Quản lí đơn" thêm:

```ts
  { href: '/f/dong-hang',     label: 'Đóng hàng',     icon: PackageCheck,    requires: 'view_fulfillment' },
```

- [ ] **Bước 2: Page** `app/(dashboard)/f/dong-hang/page.tsx` (mẫu theo `app/(dashboard)/f/fulfillment/page.tsx`):

```tsx
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { listKienDongHang, listKienChoKhop } from '@/features/dong-hang/queries';
import { BO_LOC, type BoLocDongHang } from '@/features/dong-hang/types';
import { BangDongHang } from '@/components/dong-hang/BangDongHang';

export const dynamic = 'force-dynamic';

export default async function DongHangPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_fulfillment')) redirect('/');
  const sp = await searchParams;
  const locRaw = typeof sp.loc === 'string' ? sp.loc : '';
  const loc: BoLocDongHang = (BO_LOC as readonly string[]).includes(locRaw) ? (locRaw as BoLocDongHang) : 'chua_tracking';
  const q = typeof sp.q === 'string' ? sp.q : '';
  const [kien, choKhop] = await Promise.all([listKienDongHang(loc, q), listKienChoKhop()]);
  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-xl font-semibold">Đóng hàng</h1>
        <p className="text-sm text-muted-foreground">Kiện đóng xong trên Lark về đây trong vài giây. So cước theo cân thực + kích thước rồi chọn line ship; hãng được ghi lên cột Couriers của Lark.</p>
      </div>
      <BangDongHang kien={kien} choKhop={choKhop} loc={loc} q={q} coQuyenChon={hasPermission(role, 'manage_fulfillment')} />
    </div>
  );
}
```

- [ ] **Bước 3: Bảng** `components/dong-hang/BangDongHang.tsx` (`'use client'`). Yêu cầu:
  - Thanh lọc: 4 `Link` `?loc=…&q=…` (nhãn: Chưa có tracking · Hôm nay · 7 ngày · Tất cả; đang chọn tô đậm) + form GET ô `q` placeholder "Mã đơn / PK-…"; nút "So cước cả trang" (disabled khi >50 kiện hiển thị hoặc đang chạy) gọi `Promise.all(kien.slice(0,50).map(k => baoGiaKien(k.shipmentId)))` rồi ghi vào state `Map<shipmentId, BaoGiaKien>`.
  - Khối đỏ (nếu `choKhop.length > 0`): tiêu đề "Không khớp đơn SMS ({n})", mỗi dòng `logUniqueCode · orderNumber · weightKg kg · dims · hop · lyDo · nhanLuc (giờ VN)` — chữ đỏ, nền `bg-red-50`.
  - Danh sách: `nhomTheoNgay(kien)` → mỗi nhóm một tiêu đề ngày (dd/mm/yyyy) + bảng cột: **Đơn** (orderNumber, storeName, cờ/nước) · **Cân** (`weightKg kg`, dưới: `D×R×C`, `quy đổi X → tính cước Y` từ `canQuyDoi`) · **Hộp / SKU** (hop; skuText; `pieces món`) · **Khách trả** (hangKhachTra) · **So cước** (chưa quote: nút "So cước"; đang: "…"; có: dãy chip mỗi hãng `KEY — 1.234.567₫`, chip `reNhatKey` tô đậm xanh, chip tạm ngưng mờ với title lý do, chip lỗi xám "KEY — không báo giá được"; bấm chip mở dòng chi tiết dưới bằng `chiTietCuoc(row.breakdown, heSo)` với `heSo = row.costCurrency !== 'VND' && b.carrierCost ? (row.vndCost ?? 0) / b.carrierCost : 1` — liệt kê `ct.dong` (nhãn · số₫) + `ct.tong` + `row.notes.map(dichGhiChu)`) · **Chọn** (nếu `coQuyenChon` và chưa `da_len_nhan`: mỗi hãng ok + chọn được một nút "Chọn"; đơn nhiều kiện ghi "áp cho {soKienCungDon} kiện"; bấm → `chonHangChoDon(orderId, key)`; xong hiện dưới dòng: ok → "Đã ghi Lark ✓ ({lark.daGhi} dòng)" xanh, lark lỗi → "Lark lỗi — điền tay: {lark.error}" vàng, ok=false → error đỏ; nếu không có quyền: chữ "Chỉ xem") · **Trạng thái** (`trangThaiKien`: cho_chon → badge vàng "Chờ chọn line"; da_chon → badge xanh "Đã chọn: {hang} · {nguoi} · {giờ VN hh:mm dd/mm}"; da_len_nhan → badge xám "Đã lên nhãn · {tracking}").
  - Sau khi chọn thành công, cập nhật state cục bộ `selectedCarrierKey` cho MỌI kiện cùng `orderId` (không đợi reload).
  - Dùng class Tailwind như `CarrierComparePanel.tsx` (bảng `text-sm tabular-nums`, badge `rounded bg-emerald-500/15 px-1.5 py-px`…). `useTransition` cho quote/chọn. Số VND: `Math.round(n).toLocaleString('vi-VN') + '₫'`.
  - Rỗng: "Không có kiện nào theo bộ lọc này."

- [ ] **Bước 4: Kiểm** — `npx tsc --noEmit`, `npx vitest run`, `npx next build` xanh. Chạy dev (`preview_start` theo `.claude/launch.json`, hoặc `npm run dev`) mở `/f/dong-hang?loc=tat_ca`: thấy danh sách kiện nhóm theo ngày, bấm "So cước" một kiện ra chip giá, khối chờ khớp (rỗng cũng được). Chụp màn hình vào report.

- [ ] **Bước 5: Commit** `feat(dong-hang): màn Đóng hàng — kiện Lark đã đóng, so cước theo kiện, chọn line ship`

---

### Task 7: Tài liệu, Second Brain, kiểm trước push

**Files:**
- Create: `docs/integrations/lark-pack-webhook.md`
- Modify: Second Brain `Shared/Projects/Shopify-Management-System/Activity Log.md`, `Decisions.md` (D-092), `Overview.md` (nếu đổi trạng thái)

- [ ] **Bước 1: `docs/integrations/lark-pack-webhook.md`:**

```markdown
# Webhook Lark → SMS: kiện đóng xong (`POST /api/lark/pack`)

Spec: docs/superpowers/specs/2026-09-22-dong-hang-chon-line-design.md

## Env (Railway, service Shopify-Management-System)
- `LARK_PACK_WEBHOOK_SECRET` — chuỗi ngẫu nhiên 32 ký tự (`openssl rand -hex 16`), cùng giá trị điền vào rule Lark.
- `LARK_PACK_DRY=1` — chạy thử: đọc + phân loại, KHÔNG ghi DB. Bỏ biến khi chạy thật.
- Cần sẵn `LARK_APP_ID`, `LARK_APP_SECRET`, `LARK_BASE_APP_TOKEN`, `LARK_LOG_TABLE_ID` (đã có trên service web).

## Cấu hình Lark (base "Operation Work files 2026 (NEW)" → bảng LOG-Export → Automation)
1. Trigger: **When record matches conditions** — `Weights` is not empty AND `Dimension ( điền tay)` is not empty AND `Select VTĐG1` is not empty AND `Attachment` is not empty AND `Tracking Number` is empty.
2. Action: **Send HTTP request** — Method POST, URL `https://shopify-management-system-production.up.railway.app/api/lark/pack`,
   Headers: `Content-Type: application/json`, `X-Lark-Pack-Secret: <secret>`,
   Body: `{"record_id": "{{record_id}}", "log_unique_code": "{{Log Unique code}}"}`.
3. Bật rule. Kiểm: sửa một dòng đã đủ điều kiện → trang /f/jobs thấy `lark-pack-webhook` chạy, /f/dong-hang thấy kiện.

## Mã HTTP
200 mọi kết quả nghiệp vụ (`tao` / `cap_nhat` / `khong_khop` / `bo_qua`) · 400 thiếu record_id · 401 sai secret · 413 body >4KB · 502 Lark API lỗi (Lark thử lại) · 503 thiếu env · 500 DB lỗi.

## Kiểm tay
curl -sS -X POST "$URL/api/lark/pack" -H "Content-Type: application/json" -H "X-Lark-Pack-Secret: $SECRET" -d '{"record_id":"recXXXX"}'

## Lưới bù
Cron `sync-lark` mỗi giờ vẫn chạy: rule tắt thì kiện vẫn về, chậm 1–4 giờ. Kiện không khớp đơn nằm ở bảng `lark_pack_cho_khop` (khối đỏ trên màn), tự xoá khi khớp.
```

- [ ] **Bước 2: Second Brain** — `Activity Log.md` thêm entry 22/09 (template `Shared/Templates/Activity Entry.md`): màn Đóng hàng + webhook Lark pack, lý do (lag 2,3h/4,3h; Đức chọn line ngay lúc đóng), việc CEO cần làm (đặt secret, tạo rule). `Decisions.md` thêm **D-092**: "Kiện đóng xong về SMS qua Lark Automation → `/api/lark/pack` (không tin dữ liệu Lark gửi, chỉ record_id); Đức chọn line trên SMS; cron hàng giờ là lưới bù. Thay thế: đọc từ cron rồi chọn (vô dụng vì lag)." Chỉ ghi zone `Shared/`.

- [ ] **Bước 3: Kiểm trước push** — `npx tsc --noEmit && npx vitest run && npx next build` xanh.

- [ ] **Bước 4: Commit** `docs(dong-hang): hướng dẫn cấu hình Lark Automation + env webhook`

---

## Sau khi xong (người điều phối)

1. Push `main` → Railway deploy web.
2. CEO: đặt `LARK_PACK_WEBHOOK_SECRET` (+ `LARK_PACK_DRY=1` lúc đầu) trên service web; tạo rule Lark theo `docs/integrations/lark-pack-webhook.md`.
3. Kiểm dry: sửa 1 dòng đủ điều kiện → `/f/jobs` thấy `lark-pack-webhook` với `summary.dry = true`. Bỏ `LARK_PACK_DRY`, redeploy, bắn lại → kiện hiện ở `/f/dong-hang`.
4. Đức chọn hãng thử một đơn → Lark cột Couriers đổi.
