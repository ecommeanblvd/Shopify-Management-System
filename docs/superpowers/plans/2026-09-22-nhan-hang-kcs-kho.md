# Màn "Nhận hàng & KCS" cho kho — kế hoạch triển khai

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kho mở SMS, chọn đơn, nhập số lượng / cân / kết quả kiểm / hướng xử lý cho từng món; SMS tạo dòng mới hoặc cập nhật dòng có sẵn trên bảng Lark "WH - Inventory".

**Architecture:** Màn `/f/warehouse/nhan-kcs` đọc món của đơn từ bảng `lark_mon_don` (cron đã đồng bộ sẵn). Kho lưu → SMS ghi vào bảng `wh_nhan_kcs` của mình TRƯỚC (nguồn để hiện lại + hàng đợi), rồi đẩy sang Lark qua `features/lark/wh-inventory.ts`. Đẩy trượt thì dòng ở trạng thái `loi` và cron thử lại. Lark vẫn là sổ cái; SMS không xoá dòng nào.

**Tech Stack:** Next.js (đọc `node_modules/next/dist/docs/` trước khi viết route/page/server action), Drizzle + Postgres, vitest, Lark Bitable REST, Railway.

**Spec:** `docs/superpowers/specs/2026-09-22-nhan-hang-kcs-kho-design.md` (CEO duyệt 22/09/2026).

## Global Constraints

- **Bảng Lark kho:** `tblfnOiEwzcXmemM` (hằng số `WH_INVENTORY_TABLE_ID` đã có trong `features/lark/client.ts`), cùng `LARK_BASE_APP_TOKEN` với bảng LOG-Export.
- **13 cột khi TẠO dòng:** `Import (select order)` (link tới record món), `Lineitem SKU final`, `Lineitem Name`, `Order Number final`, `Store final`, `Vendor final`, `Warehouse`, `Import - Inventory type` = `Retail`, `Ngày Import - tiếp nhận đồ tại kho` (epoch ms, nửa đêm giờ VN), `Quantity tiếp nhận trước QC`, `Weight (kg)`, `QC Check`, `WH - Action`. Thêm `Lý do QC failed` khi không đạt.
- **5 cột khi CẬP NHẬT dòng có sẵn:** `Quantity tiếp nhận trước QC`, `Weight (kg)`, `QC Check`, `WH - Action`, `Lý do QC failed`. KHÔNG đụng cột khác.
- **KHÔNG có lệnh xoá** trên bảng kho — một lỗi lập trình không được phép quét sạch bảng vận hành.
- **Giá trị cột chọn phải khớp Lark, không đoán:** `QC Check` ∈ `QC Pass` | `QC Failed` | `Gửi dư`; `WH - Action` ∈ `Tạm nhập (đi đơn)` | `Lưu kho` | `Gửi trả Vendor (QC fail)` | `Hoàn trả brand (return)` | `Trả lại Vendor (đồ mượn)`; `Warehouse` ∈ `HN | GVM` | `SG | AP` | `TQ | CG` | `PHSG`; `Import - Inventory type` = `Retail`.
- **Ràng buộc nhập:** `QC Failed` bắt buộc lý do (chữ) và ảnh. `QC Pass` mặc định `WH - Action` = `Tạm nhập (đi đơn)`.
- **Ảnh lưu ở SMS** (`uploadReceiptImage`), Lark chỉ nhận `Lý do QC failed` bằng chữ.
- **Chống tạo trùng:** tìm dòng kho theo LIÊN KẾT MÓN (record id của món), không theo mã đơn.
- **Quyền:** xem `view_receiving`; nhập và lưu `manage_qc`.
- **Env:** `WH_GHI_LARK=dry` → không gọi Lark, chỉ ghi log và để dòng ở `cho`.
- **Quy ước repo:** tiếng Việt cho tên hàm/ghi chú mới; `sql` template với mảng JS dùng `IN ${arr}` không `= ANY`; file `'use server'` chỉ export hàm async; không top-level await trong `scripts/`; migration = file SQL trong `db/migrations/` áp bằng script tạm `sql.raw` (journal drizzle không cập nhật từ 0139); `npx tsc --noEmit && npx vitest run` xanh, **`npx next build` xanh trước khi push** (hook không chạy build); commit kết bằng `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`; làm trên `main`; **KHÔNG** `git checkout/stash/reset` (cây làm việc dùng chung).

---

## Cấu trúc file

| File | Trách nhiệm |
|---|---|
| `db/migrations/0155_nhan-kcs.sql`, `db/schema.ts` | cột `record_id` cho `lark_mon_don`; bảng `wh_nhan_kcs` |
| `features/lark/huy-mon.ts` (sửa) | `docMonLark` trả thêm `recordId`, `lineitemName`, `store`, `vendor` |
| `features/lark/sync-brand-received.ts` (sửa) | lưu các trường mới |
| `features/kho-nhan/gia-tri-lark.ts` (mới) | THUẦN: danh sách giá trị hợp lệ + dựng bộ cột gửi Lark (tạo/cập nhật) |
| `features/kho-nhan/luat.ts` (mới) | THUẦN: kiểm dữ liệu kho nhập, mặc định hướng xử lý |
| `features/lark/wh-inventory.ts` (mới) | đọc/tạo/sửa dòng bảng kho trên Lark |
| `features/kho-nhan/queries.ts` (mới) | món của đơn + dòng đã xử lý hôm nay |
| `features/kho-nhan/actions.ts` (mới, 'use server') | `ghiNhanKcs`, `dayLaiDongLoi` |
| `features/kho-nhan/day-lark.ts` (mới) | đẩy một dòng `wh_nhan_kcs` sang Lark, dùng chung cho action và cron |
| `app/(dashboard)/f/warehouse/nhan-kcs/page.tsx`, `components/kho-nhan/BangNhanKcs.tsx`, `app/(dashboard)/f/warehouse/layout.tsx` (sửa) | màn hình + tab |
| `features/jobs/registry.ts`, `groups.ts`, `scripts/cron/run-group.ts` (sửa) | job `day-nhan-kcs-lark` |
| `docs/integrations/lark-wh-inventory.md` (mới) | cột, giá trị hợp lệ, env, cách kiểm |

---

### Task 1: Món Lark mang đủ thông tin để tạo dòng kho

**Files:**
- Modify: `features/lark/huy-mon.ts`
- Modify: `features/lark/sync-brand-received.ts`
- Modify: `db/schema.ts`, Create: `db/migrations/0155_nhan-kcs.sql`
- Test: `features/lark/huy-mon.test.ts`

**Interfaces:**
- Produces: `MonLark` thêm `recordId: string`, `lineitemName: string | null`, `store: string | null`, `vendor: string | null`; `docMonLark(fields, recordId)`; cột `lark_mon_don.record_id`, `lineitem_name`, `store`, `vendor`.

- [ ] **Bước 1: Migration** `db/migrations/0155_nhan-kcs.sql`:

```sql
-- Màn "Nhận hàng & KCS" (spec 22/09/2026): SMS tạo dòng trên bảng kho Lark, cần record id của
-- MÓN để nối link "Import (select order)", và tên/store/vendor để điền dòng mới.
ALTER TABLE lark_mon_don ADD COLUMN IF NOT EXISTS record_id text;
ALTER TABLE lark_mon_don ADD COLUMN IF NOT EXISTS lineitem_name text;
ALTER TABLE lark_mon_don ADD COLUMN IF NOT EXISTS store text;
ALTER TABLE lark_mon_don ADD COLUMN IF NOT EXISTS vendor text;
CREATE INDEX IF NOT EXISTS lark_mon_don_record_idx ON lark_mon_don (record_id);

-- Việc kho nhận + kiểm hàng, ghi ở SMS TRƯỚC rồi mới đẩy Lark (Lark hỏng không làm mất việc).
CREATE TABLE IF NOT EXISTS wh_nhan_kcs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mon_dinh_danh text NOT NULL,
  mon_record_id text,
  order_number text NOT NULL,
  sku text,
  so_luong integer NOT NULL,
  can_kg numeric(10,3),
  qc_check text NOT NULL,
  wh_action text NOT NULL,
  ly_do_fail text,
  anh_key text,
  warehouse text NOT NULL,
  nguoi_lam text,
  luc timestamp NOT NULL DEFAULT now(),
  lark_record_id text,
  trang_thai_day text NOT NULL DEFAULT 'cho',
  loi text,
  lan_day_cuoi timestamp
);
CREATE INDEX IF NOT EXISTS wh_nhan_kcs_don_idx ON wh_nhan_kcs (order_number);
CREATE INDEX IF NOT EXISTS wh_nhan_kcs_trang_thai_idx ON wh_nhan_kcs (trang_thai_day);
```

- [ ] **Bước 2: `db/schema.ts`** — trong `larkMonDon` thêm:

```ts
  /** Record id của món trên bảng Lark — để nối link "Import (select order)" khi tạo dòng kho. */
  recordId: text('record_id'),
  lineitemName: text('lineitem_name'),
  store: text('store'),
  vendor: text('vendor'),
```

Thêm bảng mới sau `larkMonDon`:

```ts
/** Việc kho nhận + kiểm một món, ghi ở SMS trước rồi đẩy sang bảng kho Lark. */
export const whNhanKcs = pgTable('wh_nhan_kcs', {
  id: uuid('id').defaultRandom().primaryKey(),
  monDinhDanh: text('mon_dinh_danh').notNull(),
  monRecordId: text('mon_record_id'),
  orderNumber: text('order_number').notNull(),
  sku: text('sku'),
  soLuong: integer('so_luong').notNull(),
  canKg: numeric('can_kg', { precision: 10, scale: 3 }),
  qcCheck: text('qc_check').notNull(),
  whAction: text('wh_action').notNull(),
  lyDoFail: text('ly_do_fail'),
  anhKey: text('anh_key'),
  warehouse: text('warehouse').notNull(),
  nguoiLam: text('nguoi_lam'),
  luc: timestamp('luc').notNull().defaultNow(),
  /** Record id dòng kho trên Lark sau khi đẩy thành công. */
  larkRecordId: text('lark_record_id'),
  /** 'cho' | 'da_day' | 'loi'. */
  trangThaiDay: text('trang_thai_day').notNull().default('cho'),
  loi: text('loi'),
  lanDayCuoi: timestamp('lan_day_cuoi'),
}, (t) => [index('wh_nhan_kcs_don_idx').on(t.orderNumber), index('wh_nhan_kcs_trang_thai_idx').on(t.trangThaiDay)]);
```

- [ ] **Bước 3: Test thất bại** — thêm vào `features/lark/huy-mon.test.ts`:

```ts
describe('docMonLark mang đủ thông tin tạo dòng kho', () => {
  it('đọc record id, tên hàng, store, vendor', () => {
    const m = docMonLark({
      'Định danh': '#MBLVD30426-Tracy-V1416-XS-WBRM-PLA-PDL-1',
      order_number: '#MBLVD30426',
      'Lineitem SKU': 'Tracy-V1416-XS-WBRM-PLA',
      'Lineitem name': 'Vianne Straight Across Maxi Dress - Buttercream',
      Store: '#MBLVD',
      vendor: 'TRACY STUDIO',
    }, 'recABC');
    expect(m).toMatchObject({
      recordId: 'recABC',
      lineitemName: 'Vianne Straight Across Maxi Dress - Buttercream',
      store: '#MBLVD',
      vendor: 'TRACY STUDIO',
    });
  });
  it('thiếu record id vẫn đọc được (dòng cũ), chỉ không tạo link được', () => {
    const m = docMonLark({ 'Định danh': 'x', order_number: 'TA1' }, '');
    expect(m?.recordId).toBe('');
  });
});
```

- [ ] **Bước 4: Chạy** `npx vitest run features/lark/huy-mon.test.ts` — FAIL (`docMonLark` nhận 1 tham số).

- [ ] **Bước 5: Sửa `huy-mon.ts`** — interface `MonLark` thêm 4 trường; đổi chữ ký:

```ts
export function docMonLark(fields: Record<string, unknown>, recordId: string): MonLark | null {
  const dinhDanh = larkText(fields['Định danh']);
  const orderNumber = larkText(fields['order_number'])?.replace(/^#/, '') ?? null;
  if (!dinhDanh || !orderNumber) return null;
  const dieuPhoi = larkText(fields['WH-Điều phối đơn']);
  const procu = larkText(fields['PROCU - Final Order Stt']);
  const lyDo = laGiaTriHuy(dieuPhoi) ? dieuPhoi : laGiaTriHuy(procu) ? procu : null;
  return {
    dinhDanh, recordId, orderNumber,
    sku: larkText(fields['Lineitem SKU']),
    lineitemName: larkText(fields['Lineitem name']),
    store: larkText(fields['Store']),
    vendor: larkText(fields['vendor']),
    huy: lyDo != null, lyDo,
  };
}
```

- [ ] **Bước 6: `sync-brand-received.ts`** — truyền record id và lưu trường mới:

```ts
    const mon = records.map((r) => docMonLark(r.fields, r.record_id)).filter((m): m is NonNullable<typeof m> => m != null);
```

trong `.values(...)` thêm `recordId: m.recordId, lineitemName: m.lineitemName, store: m.store, vendor: m.vendor,` và trong `set` của `onConflictDoUpdate` thêm `recordId: sql\`excluded.record_id\`, lineitemName: sql\`excluded.lineitem_name\`, store: sql\`excluded.store\`, vendor: sql\`excluded.vendor\`,`.

`listBrandReceivedRecords()` đã trả `record_id` (kiểu `LarkRecord`), không cần sửa client.

- [ ] **Bước 7:** `npx vitest run features/lark && npx tsc --noEmit` — xanh.

- [ ] **Bước 8: Áp migration + nạp dữ liệu** — script tạm `scripts/_mig.ts` (xoá sau khi chạy):

```ts
import { readFileSync } from 'node:fs';
import { db } from '@/db/client';
import { sql } from 'drizzle-orm';
async function main() {
  await db.execute(sql.raw(readFileSync('db/migrations/0155_nhan-kcs.sql', 'utf8')));
  const r = await db.execute(sql`select count(*)::int n from wh_nhan_kcs`);
  console.log('wh_nhan_kcs:', (r as { rows: Array<{ n: number }> }).rows[0].n);
  process.exit(0);
}
main();
```

Chạy `npx tsx --env-file=.env scripts/_mig.ts`, xoá script. Rồi chạy đồng bộ để điền record id:
`railway run --service "sync Lark operation" npx tsx -e "import('./features/lark/sync-brand-received').then(m=>m.syncBrandReceived()).then(r=>{console.log(r);process.exit(0)})"`
— nếu lệnh một dòng không chạy được thì tạo `scripts/_sync.ts` gọi `syncBrandReceived()` rồi xoá. Kiểm `select count(*) from lark_mon_don where record_id is not null` > 7000.

- [ ] **Bước 9: Commit** `feat(lark): món Lark mang record id, tên hàng, store, vendor; bảng wh_nhan_kcs`

---

### Task 2: Luật thuần — giá trị hợp lệ và bộ cột gửi Lark

**Files:**
- Create: `features/kho-nhan/gia-tri-lark.ts`, `features/kho-nhan/luat.ts`
- Test: `features/kho-nhan/gia-tri-lark.test.ts`, `features/kho-nhan/luat.test.ts`

**Interfaces:**
- Produces:

```ts
export const QC_CHECK = ['QC Pass', 'QC Failed', 'Gửi dư'] as const;
export const WH_ACTION = ['Tạm nhập (đi đơn)', 'Lưu kho', 'Gửi trả Vendor (QC fail)', 'Hoàn trả brand (return)', 'Trả lại Vendor (đồ mượn)'] as const;
export const WAREHOUSE = ['HN | GVM', 'SG | AP', 'TQ | CG', 'PHSG'] as const;
export type QcCheck = typeof QC_CHECK[number];
export type WhAction = typeof WH_ACTION[number];
export type Warehouse = typeof WAREHOUSE[number];
export interface ViecNhanKcs {
  monDinhDanh: string; monRecordId: string | null; orderNumber: string; sku: string | null;
  lineitemName: string | null; store: string | null; vendor: string | null;
  soLuong: number; canKg: number | null; qcCheck: QcCheck; whAction: WhAction;
  lyDoFail: string | null; warehouse: Warehouse;
}
export function cotTaoDong(v: ViecNhanKcs, ngay: Date): Record<string, unknown>;
export function cotCapNhat(v: ViecNhanKcs): Record<string, unknown>;
export function kiemViec(v: Partial<ViecNhanKcs> & { coAnh?: boolean }): { ok: true; viec: ViecNhanKcs } | { ok: false; loi: string };
export function actionMacDinh(qc: QcCheck): WhAction;
```

- [ ] **Bước 1: Test thất bại** `features/kho-nhan/gia-tri-lark.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { cotTaoDong, cotCapNhat, QC_CHECK, WH_ACTION, WAREHOUSE, type ViecNhanKcs } from './gia-tri-lark';

const viec: ViecNhanKcs = {
  monDinhDanh: '#MBLVD30426-Tracy-PDL-1', monRecordId: 'recMON', orderNumber: '#MBLVD30426',
  sku: 'Tracy-V1416-XS-WBRM-PLA', lineitemName: 'Vianne Maxi Dress', store: '#MBLVD', vendor: 'TRACY STUDIO',
  soLuong: 1, canKg: 1.5, qcCheck: 'QC Pass', whAction: 'Tạm nhập (đi đơn)', lyDoFail: null, warehouse: 'HN | GVM',
};

describe('cotTaoDong', () => {
  it('đủ 13 cột kho đang dùng, ngày là epoch nửa đêm giờ VN', () => {
    const c = cotTaoDong(viec, new Date('2026-09-22T05:00:00Z'));
    expect(c).toEqual({
      'Import (select order)': ['recMON'],
      'Lineitem SKU final': 'Tracy-V1416-XS-WBRM-PLA',
      'Lineitem Name': 'Vianne Maxi Dress',
      'Order Number final': '#MBLVD30426',
      'Store final': '#MBLVD',
      'Vendor final': 'TRACY STUDIO',
      Warehouse: 'HN | GVM',
      'Import - Inventory type': 'Retail',
      'Ngày Import - tiếp nhận đồ tại kho': Date.UTC(2026, 8, 22),
      'Quantity tiếp nhận trước QC': 1,
      'Weight (kg)': 1.5,
      'QC Check': 'QC Pass',
      'WH - Action': 'Tạm nhập (đi đơn)',
    });
  });

  it('không đạt → thêm lý do; thiếu record món thì bỏ link chứ không gửi rỗng', () => {
    const c = cotTaoDong({ ...viec, qcCheck: 'QC Failed', whAction: 'Gửi trả Vendor (QC fail)', lyDoFail: 'bung chỉ', monRecordId: null }, new Date('2026-09-22T05:00:00Z'));
    expect(c['Lý do QC failed']).toBe('bung chỉ');
    expect('Import (select order)' in c).toBe(false);
  });

  it('không có cân thì bỏ cột cân, không gửi 0', () => {
    expect('Weight (kg)' in cotTaoDong({ ...viec, canKg: null }, new Date())).toBe(false);
  });
});

describe('cotCapNhat', () => {
  it('CHỈ 5 cột, không đụng cột định danh của dòng cũ', () => {
    expect(Object.keys(cotCapNhat(viec)).sort()).toEqual(
      ['QC Check', 'Quantity tiếp nhận trước QC', 'WH - Action', 'Weight (kg)'].sort(),
    );
    expect(cotCapNhat({ ...viec, qcCheck: 'QC Failed', lyDoFail: 'bẩn' })['Lý do QC failed']).toBe('bẩn');
  });
});

describe('danh sách giá trị', () => {
  it('khớp đúng tên đang có trên Lark, không đặt tên mới', () => {
    expect(QC_CHECK).toEqual(['QC Pass', 'QC Failed', 'Gửi dư']);
    expect(WH_ACTION[0]).toBe('Tạm nhập (đi đơn)');
    expect(WH_ACTION).toContain('Gửi trả Vendor (QC fail)');
    expect(WAREHOUSE).toContain('HN | GVM');
  });
});
```

- [ ] **Bước 2:** `npx vitest run features/kho-nhan` — FAIL (không có module).

- [ ] **Bước 3: Viết `features/kho-nhan/gia-tri-lark.ts`:**

```ts
/**
 * Bộ cột gửi sang bảng Lark "WH - Inventory" và danh sách giá trị hợp lệ.
 *
 * Các cột QC Check / WH - Action / Warehouse / Store final / Vendor final là cột CHỌN: ghi một
 * giá trị lạ thì Lark đẻ thêm lựa chọn mới, làm hỏng bộ lọc và báo cáo của cả đội. Nên tên ở
 * đây lấy NGUYÊN của Lark (khảo sát 22/09/2026), không đặt tên mới cho đẹp.
 */
export const QC_CHECK = ['QC Pass', 'QC Failed', 'Gửi dư'] as const;
export const WH_ACTION = [
  'Tạm nhập (đi đơn)', 'Lưu kho', 'Gửi trả Vendor (QC fail)', 'Hoàn trả brand (return)', 'Trả lại Vendor (đồ mượn)',
] as const;
export const WAREHOUSE = ['HN | GVM', 'SG | AP', 'TQ | CG', 'PHSG'] as const;

export type QcCheck = typeof QC_CHECK[number];
export type WhAction = typeof WH_ACTION[number];
export type Warehouse = typeof WAREHOUSE[number];

export interface ViecNhanKcs {
  monDinhDanh: string;
  monRecordId: string | null;
  orderNumber: string;
  sku: string | null;
  lineitemName: string | null;
  store: string | null;
  vendor: string | null;
  soLuong: number;
  canKg: number | null;
  qcCheck: QcCheck;
  whAction: WhAction;
  lyDoFail: string | null;
  warehouse: Warehouse;
}

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
/** Epoch của NỬA ĐÊM NGÀY-LỊCH VN — Lark lưu ngày kiểu này (xem parse-pack-row.ts). */
function nuaDemVn(d: Date): number {
  const vn = new Date(d.getTime() + VN_OFFSET_MS);
  return Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth(), vn.getUTCDate());
}

/** THUẦN: bộ cột TẠO dòng kho mới — đúng những cột kho đang tự điền tay. */
export function cotTaoDong(v: ViecNhanKcs, ngay: Date): Record<string, unknown> {
  const c: Record<string, unknown> = {
    'Lineitem SKU final': v.sku ?? '',
    'Order Number final': v.orderNumber,
    Warehouse: v.warehouse,
    'Import - Inventory type': 'Retail',
    'Ngày Import - tiếp nhận đồ tại kho': nuaDemVn(ngay),
    'Quantity tiếp nhận trước QC': v.soLuong,
    'QC Check': v.qcCheck,
    'WH - Action': v.whAction,
  };
  // Cột trống thì BỎ HẲN, không gửi chuỗi rỗng: Lark coi '' là một lựa chọn mới ở cột chọn.
  if (v.monRecordId) c['Import (select order)'] = [v.monRecordId];
  if (v.lineitemName) c['Lineitem Name'] = v.lineitemName;
  if (v.store) c['Store final'] = v.store;
  if (v.vendor) c['Vendor final'] = v.vendor;
  if (v.canKg != null) c['Weight (kg)'] = v.canKg;
  if (v.lyDoFail) c['Lý do QC failed'] = v.lyDoFail;
  return c;
}

/** THUẦN: bộ cột CẬP NHẬT dòng có sẵn — chỉ kết quả kho vừa nhập, không đụng định danh. */
export function cotCapNhat(v: ViecNhanKcs): Record<string, unknown> {
  const c: Record<string, unknown> = {
    'Quantity tiếp nhận trước QC': v.soLuong,
    'QC Check': v.qcCheck,
    'WH - Action': v.whAction,
  };
  if (v.canKg != null) c['Weight (kg)'] = v.canKg;
  if (v.lyDoFail) c['Lý do QC failed'] = v.lyDoFail;
  return c;
}
```

- [ ] **Bước 4:** `npx vitest run features/kho-nhan/gia-tri-lark.test.ts` — PASS.

- [ ] **Bước 5: Test thất bại** `features/kho-nhan/luat.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { kiemViec, actionMacDinh } from './luat';

const co = {
  monDinhDanh: 'dd', monRecordId: 'recMON', orderNumber: '#MBLVD1', sku: 'A-1',
  lineitemName: 'Áo', store: '#MBLVD', vendor: 'TRACY', soLuong: 1, canKg: 1.2,
  qcCheck: 'QC Pass' as const, whAction: 'Tạm nhập (đi đơn)' as const, lyDoFail: null, warehouse: 'HN | GVM' as const,
};

describe('kiemViec', () => {
  it('dữ liệu đủ → ok', () => {
    const r = kiemViec(co);
    expect(r.ok).toBe(true);
  });
  it('QC Failed thiếu lý do hoặc thiếu ảnh → chặn', () => {
    expect(kiemViec({ ...co, qcCheck: 'QC Failed', whAction: 'Gửi trả Vendor (QC fail)', lyDoFail: null, coAnh: true }))
      .toEqual({ ok: false, loi: 'Không đạt thì phải ghi lý do' });
    expect(kiemViec({ ...co, qcCheck: 'QC Failed', whAction: 'Gửi trả Vendor (QC fail)', lyDoFail: 'bẩn', coAnh: false }))
      .toEqual({ ok: false, loi: 'Không đạt thì phải có ảnh lỗi' });
    expect(kiemViec({ ...co, qcCheck: 'QC Failed', whAction: 'Gửi trả Vendor (QC fail)', lyDoFail: 'bẩn', coAnh: true }).ok).toBe(true);
  });
  it('số lượng phải là số nguyên dương', () => {
    expect(kiemViec({ ...co, soLuong: 0 })).toEqual({ ok: false, loi: 'Số lượng phải lớn hơn 0' });
    expect(kiemViec({ ...co, soLuong: 1.5 })).toEqual({ ok: false, loi: 'Số lượng phải là số nguyên' });
  });
  it('cân âm hoặc quá lớn → chặn; bỏ trống thì được', () => {
    expect(kiemViec({ ...co, canKg: -1 })).toEqual({ ok: false, loi: 'Cân không hợp lệ' });
    expect(kiemViec({ ...co, canKg: 200 })).toEqual({ ok: false, loi: 'Cân không hợp lệ' });
    expect(kiemViec({ ...co, canKg: null }).ok).toBe(true);
  });
  it('giá trị lạ ở cột chọn → chặn, KHÔNG để Lark đẻ lựa chọn mới', () => {
    expect(kiemViec({ ...co, qcCheck: 'Pass' as never })).toEqual({ ok: false, loi: 'Kết quả kiểm không hợp lệ' });
    expect(kiemViec({ ...co, whAction: 'Nhập kho' as never })).toEqual({ ok: false, loi: 'Hướng xử lý không hợp lệ' });
    expect(kiemViec({ ...co, warehouse: 'HN' as never })).toEqual({ ok: false, loi: 'Kho không hợp lệ' });
  });
  it('thiếu mã đơn → chặn', () => {
    expect(kiemViec({ ...co, orderNumber: '  ' })).toEqual({ ok: false, loi: 'Thiếu mã đơn' });
  });
});

describe('actionMacDinh', () => {
  it('đạt thì tạm nhập đi đơn (gần 2/3 số dòng), không đạt thì trả vendor', () => {
    expect(actionMacDinh('QC Pass')).toBe('Tạm nhập (đi đơn)');
    expect(actionMacDinh('QC Failed')).toBe('Gửi trả Vendor (QC fail)');
    expect(actionMacDinh('Gửi dư')).toBe('Lưu kho');
  });
});
```

- [ ] **Bước 6:** `npx vitest run features/kho-nhan/luat.test.ts` — FAIL.

- [ ] **Bước 7: Viết `features/kho-nhan/luat.ts`:**

```ts
/** THUẦN: luật kiểm dữ liệu kho nhập, trước khi đụng tới DB hay Lark. */
import { QC_CHECK, WH_ACTION, WAREHOUSE, type QcCheck, type WhAction, type ViecNhanKcs } from './gia-tri-lark';

/** Cân một món vượt mức này là gõ nhầm (cùng ngưỡng parse-pack-row.ts dùng cho kiện). */
const CAN_TOI_DA = 100;

export function actionMacDinh(qc: QcCheck): WhAction {
  if (qc === 'QC Failed') return 'Gửi trả Vendor (QC fail)';
  if (qc === 'Gửi dư') return 'Lưu kho';
  return 'Tạm nhập (đi đơn)';
}

export function kiemViec(v: Partial<ViecNhanKcs> & { coAnh?: boolean }): { ok: true; viec: ViecNhanKcs } | { ok: false; loi: string } {
  if (!v.orderNumber?.trim()) return { ok: false, loi: 'Thiếu mã đơn' };
  if (!v.monDinhDanh?.trim()) return { ok: false, loi: 'Thiếu món' };
  if (!QC_CHECK.includes(v.qcCheck as QcCheck)) return { ok: false, loi: 'Kết quả kiểm không hợp lệ' };
  if (!WH_ACTION.includes(v.whAction as WhAction)) return { ok: false, loi: 'Hướng xử lý không hợp lệ' };
  if (!WAREHOUSE.includes(v.warehouse as never)) return { ok: false, loi: 'Kho không hợp lệ' };
  if (typeof v.soLuong !== 'number' || v.soLuong <= 0) return { ok: false, loi: 'Số lượng phải lớn hơn 0' };
  if (!Number.isInteger(v.soLuong)) return { ok: false, loi: 'Số lượng phải là số nguyên' };
  if (v.canKg != null && (!(v.canKg > 0) || v.canKg > CAN_TOI_DA)) return { ok: false, loi: 'Cân không hợp lệ' };
  if (v.qcCheck === 'QC Failed') {
    if (!v.lyDoFail?.trim()) return { ok: false, loi: 'Không đạt thì phải ghi lý do' };
    if (!v.coAnh) return { ok: false, loi: 'Không đạt thì phải có ảnh lỗi' };
  }
  return {
    ok: true,
    viec: {
      monDinhDanh: v.monDinhDanh, monRecordId: v.monRecordId ?? null, orderNumber: v.orderNumber.trim(),
      sku: v.sku ?? null, lineitemName: v.lineitemName ?? null, store: v.store ?? null, vendor: v.vendor ?? null,
      soLuong: v.soLuong, canKg: v.canKg ?? null, qcCheck: v.qcCheck as QcCheck, whAction: v.whAction as WhAction,
      lyDoFail: v.lyDoFail?.trim() || null, warehouse: v.warehouse as never,
    },
  };
}
```

- [ ] **Bước 8:** `npx vitest run features/kho-nhan && npx tsc --noEmit` — xanh.

- [ ] **Bước 9: Commit** `feat(kho-nhan): luật thuần cho việc nhận + kiểm hàng và bộ cột gửi Lark`

---

### Task 3: Đọc, tạo, sửa dòng trên bảng kho Lark

**Files:**
- Modify: `features/lark/client.ts`
- Create: `features/lark/wh-inventory.ts`
- Test: `features/lark/wh-inventory.test.ts`

**Interfaces:**
- Consumes: `cotTaoDong`, `cotCapNhat`, `ViecNhanKcs` (Task 2); `postRecord`, `putRecord`, `searchAllRecords` (đã có, private trong client.ts).
- Produces:

```ts
// client.ts
export async function searchWhInventoryByDon(orderNumber: string): Promise<LarkRecord[]>;
export async function createWhInventoryRecord(fields: Record<string, unknown>): Promise<string>;
export async function updateWhInventoryRecord(recordId: string, fields: Record<string, unknown>): Promise<void>;
// wh-inventory.ts
export function locDongTheoMon(recs: LarkRecord[], monRecordId: string): string | null;  // THUẦN
export async function ghiDongKho(v: ViecNhanKcs, ngay?: Date): Promise<{ larkRecordId: string; tao: boolean }>;
```

- [ ] **Bước 1: `client.ts`** — thêm sau `getTenHopVtdg`:

```ts
/**
 * Dòng bảng kho của MỘT đơn. Lọc theo mã đơn (cột text) chứ không đọc cả bảng 9.000 dòng —
 * lọc theo liên kết món thì Lark không hỗ trợ, nên SMS lọc tiếp phía mình (locDongTheoMon).
 */
export async function searchWhInventoryByDon(orderNumber: string): Promise<LarkRecord[]> {
  const bare = orderNumber.replace(/^#/, '');
  if (!bare) return [];
  return searchAllRecords(WH_INVENTORY_TABLE_ID, {
    filter: {
      conjunction: 'or',
      conditions: [bare, `#${bare}`].map((v) => ({ field_name: 'Order Number final', operator: 'is', value: [v] })),
    },
    automatic_fields: true, page_size: 500,
  });
}

/** Tạo MỘT dòng bảng kho. Trả record id. */
export async function createWhInventoryRecord(fields: Record<string, unknown>): Promise<string> {
  return postRecord(env('LARK_BASE_APP_TOKEN'), WH_INVENTORY_TABLE_ID, fields);
}

/** Sửa vài cột của MỘT dòng bảng kho. KHÔNG có hàm xoá — cố ý. */
export async function updateWhInventoryRecord(recordId: string, fields: Record<string, unknown>): Promise<void> {
  return putRecord(env('LARK_BASE_APP_TOKEN'), WH_INVENTORY_TABLE_ID, recordId, fields);
}
```

- [ ] **Bước 2: Test thất bại** `features/lark/wh-inventory.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { locDongTheoMon } from './wh-inventory';

const rec = (id: string, monIds: string[]) => ({
  record_id: id,
  fields: { 'Import (select order)': { link_record_ids: monIds } },
});

describe('locDongTheoMon', () => {
  it('chọn ĐÚNG dòng nối tới món này, không lấy nhầm dòng khác của cùng đơn', () => {
    const recs = [rec('recA', ['recMON1']), rec('recB', ['recMON2'])];
    expect(locDongTheoMon(recs, 'recMON2')).toBe('recB');
  });
  it('chưa có dòng nào của món → null (sẽ tạo mới)', () => {
    expect(locDongTheoMon([rec('recA', ['recMON1'])], 'recMONX')).toBeNull();
  });
  it('dòng không có link thì bỏ qua, không nổ', () => {
    expect(locDongTheoMon([{ record_id: 'recC', fields: {} }], 'recMON1')).toBeNull();
  });
  it('nhiều dòng cùng món → lấy dòng ĐẦU, để không tạo thêm bản sao', () => {
    const recs = [rec('recA', ['recMON1']), rec('recB', ['recMON1'])];
    expect(locDongTheoMon(recs, 'recMON1')).toBe('recA');
  });
});
```

- [ ] **Bước 3:** `npx vitest run features/lark/wh-inventory.test.ts` — FAIL.

- [ ] **Bước 4: Viết `features/lark/wh-inventory.ts`:**

```ts
/**
 * Ghi việc nhận + kiểm hàng của kho sang bảng Lark "WH - Inventory".
 *
 * Đường ghi HẸP có chủ đích: chỉ tạo dòng và sửa đúng những cột ở gia-tri-lark.ts, KHÔNG có
 * hàm xoá — một lỗi lập trình không được phép quét sạch bảng vận hành của kho (D-045).
 */
import { searchWhInventoryByDon, createWhInventoryRecord, updateWhInventoryRecord, type LarkRecord } from './client';
import { cotTaoDong, cotCapNhat, type ViecNhanKcs } from '@/features/kho-nhan/gia-tri-lark';

/** THUẦN: trong các dòng kho của một ĐƠN, dòng nào nối tới đúng món này. */
export function locDongTheoMon(recs: readonly LarkRecord[], monRecordId: string): string | null {
  for (const r of recs) {
    const v = r.fields['Import (select order)'] as { link_record_ids?: unknown } | undefined;
    const ids = Array.isArray(v?.link_record_ids) ? (v!.link_record_ids as unknown[]) : [];
    if (ids.some((x) => x === monRecordId)) return r.record_id;
  }
  return null;
}

/**
 * Tạo dòng mới hoặc cập nhật dòng có sẵn của món. Tìm theo LIÊN KẾT MÓN (không theo mã đơn —
 * một đơn có nhiều món), nên hai người cùng nhận một món thì người sau rơi vào nhánh cập nhật
 * chứ không đẻ dòng thứ hai.
 */
export async function ghiDongKho(v: ViecNhanKcs, ngay: Date = new Date()): Promise<{ larkRecordId: string; tao: boolean }> {
  const dsDon = await searchWhInventoryByDon(v.orderNumber);
  const daCo = v.monRecordId ? locDongTheoMon(dsDon, v.monRecordId) : null;
  if (daCo) {
    await updateWhInventoryRecord(daCo, cotCapNhat(v));
    return { larkRecordId: daCo, tao: false };
  }
  const id = await createWhInventoryRecord(cotTaoDong(v, ngay));
  return { larkRecordId: id, tao: true };
}
```

- [ ] **Bước 5:** `npx vitest run features/lark && npx tsc --noEmit` — xanh.

- [ ] **Bước 6: Kiểm thật một dòng nháp** — script tạm `scripts/_wh.ts`:

```ts
import { ghiDongKho } from '@/features/lark/wh-inventory';
async function main() {
  const r = await ghiDongKho({
    monDinhDanh: 'nhap-test', monRecordId: null, orderNumber: '#SMS-TEST-KHO', sku: 'TEST-SKU',
    lineitemName: 'Dòng nháp do SMS tạo — xoá được', store: null, vendor: null,
    soLuong: 1, canKg: 0.5, qcCheck: 'QC Pass', whAction: 'Lưu kho', lyDoFail: null, warehouse: 'HN | GVM',
  });
  console.log('đã ghi:', r);
  process.exit(0);
}
main();
```

Chạy `railway run --service "sync Lark operation" npx tsx scripts/_wh.ts`. Mở bảng Lark kiểm đúng cột, rồi **xoá dòng nháp bằng tay trên Lark** (SMS không có lệnh xoá). Xoá script; ghi kết quả vào report.

- [ ] **Bước 7: Commit** `feat(lark): tạo và cập nhật dòng bảng kho WH - Inventory (không có lệnh xoá)`

---

### Task 4: Lưu ở SMS trước, đẩy Lark sau — truy vấn, action, hàng đợi

**Files:**
- Create: `features/kho-nhan/queries.ts`, `features/kho-nhan/day-lark.ts`, `features/kho-nhan/actions.ts`
- Modify: `features/jobs/registry.ts`, `features/jobs/groups.ts`, `scripts/cron/run-group.ts`
- Test: `features/kho-nhan/day-lark.test.ts`

**Interfaces:**
- Consumes: `kiemViec`, `actionMacDinh`, `ViecNhanKcs` (Task 2); `ghiDongKho` (Task 3); `requirePerm` (`features/receiving/perm.ts`), `uploadReceiptImage` (`features/receiving/actions.ts`).
- Produces:

```ts
// queries.ts
export interface MonCuaDon {
  dinhDanh: string; recordId: string | null; sku: string | null; lineitemName: string | null;
  store: string | null; vendor: string | null; huy: boolean; lyDoHuy: string | null;
  daNhan: { luc: string; qcCheck: string; whAction: string; soLuong: number; canKg: number | null; trangThaiDay: string } | null;
}
export async function timMonCuaDon(orderNumber: string): Promise<MonCuaDon[]>;
export async function listDaXuLyHomNay(): Promise<Array<{ id: string; orderNumber: string; sku: string | null; qcCheck: string; whAction: string; nguoiLam: string | null; luc: string; trangThaiDay: string; larkRecordId: string | null; loi: string | null }>>;
// day-lark.ts
export function laDry(env: string | undefined): boolean;                       // THUẦN
export async function dayMotDong(id: string): Promise<{ ok: boolean; loi?: string }>;
export async function dayLaiDongCho(gioiHan?: number): Promise<{ da: number; loi: number }>;
// actions.ts ('use server')
export async function ghiNhanKcs(formData: FormData): Promise<{ ok: boolean; loi?: string; larkRecordId?: string; tao?: boolean }>;
export async function dayLaiDongLoi(id: string): Promise<{ ok: boolean; loi?: string }>;
```

- [ ] **Bước 1: Test thất bại** `features/kho-nhan/day-lark.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { laDry } from './day-lark';

describe('laDry', () => {
  it('chỉ bật chế độ thử khi env đúng chữ dry', () => {
    expect(laDry('dry')).toBe(true);
    expect(laDry('DRY')).toBe(true);
    expect(laDry('1')).toBe(false);
    expect(laDry(undefined)).toBe(false);
    expect(laDry('')).toBe(false);
  });
});
```

- [ ] **Bước 2:** `npx vitest run features/kho-nhan/day-lark.test.ts` — FAIL.

- [ ] **Bước 3: Viết `features/kho-nhan/day-lark.ts`:**

```ts
/**
 * Đẩy một dòng wh_nhan_kcs sang Lark. SMS đã lưu việc của kho TRƯỚC, nên Lark hỏng chỉ làm
 * chậm chứ không làm mất việc: dòng nằm ở trạng thái 'loi' và cron thử lại.
 */
import { eq, inArray } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { ghiDongKho } from '@/features/lark/wh-inventory';
import type { ViecNhanKcs, QcCheck, WhAction, Warehouse } from './gia-tri-lark';

/** THUẦN: env có bật chế độ thử không (ghi log, không gọi Lark). */
export function laDry(env: string | undefined): boolean {
  return (env ?? '').trim().toLowerCase() === 'dry';
}

export async function dayMotDong(id: string): Promise<{ ok: boolean; loi?: string }> {
  const [d] = await db.select().from(schema.whNhanKcs).where(eq(schema.whNhanKcs.id, id)).limit(1);
  if (!d) return { ok: false, loi: 'không thấy dòng' };
  if (d.trangThaiDay === 'da_day') return { ok: true };

  if (laDry(process.env.WH_GHI_LARK)) {
    console.log('[kho-nhan] DRY — không gửi Lark:', { don: d.orderNumber, sku: d.sku, qc: d.qcCheck });
    return { ok: true };
  }

  const viec: ViecNhanKcs = {
    monDinhDanh: d.monDinhDanh, monRecordId: d.monRecordId, orderNumber: d.orderNumber, sku: d.sku,
    lineitemName: null, store: null, vendor: null,
    soLuong: d.soLuong, canKg: d.canKg != null ? Number(d.canKg) : null,
    qcCheck: d.qcCheck as QcCheck, whAction: d.whAction as WhAction,
    lyDoFail: d.lyDoFail, warehouse: d.warehouse as Warehouse,
  };
  // Tên hàng / store / vendor lấy lại từ món để dòng mới trên Lark đủ thông tin.
  const [mon] = await db.select({
    lineitemName: schema.larkMonDon.lineitemName, store: schema.larkMonDon.store, vendor: schema.larkMonDon.vendor,
  }).from(schema.larkMonDon).where(eq(schema.larkMonDon.dinhDanh, d.monDinhDanh)).limit(1);
  if (mon) Object.assign(viec, mon);

  try {
    const r = await ghiDongKho(viec, d.luc);
    await db.update(schema.whNhanKcs)
      .set({ trangThaiDay: 'da_day', larkRecordId: r.larkRecordId, loi: null, lanDayCuoi: new Date() })
      .where(eq(schema.whNhanKcs.id, id));
    return { ok: true };
  } catch (e) {
    const loi = e instanceof Error ? e.message : String(e);
    await db.update(schema.whNhanKcs)
      .set({ trangThaiDay: 'loi', loi: loi.slice(0, 500), lanDayCuoi: new Date() })
      .where(eq(schema.whNhanKcs.id, id));
    return { ok: false, loi };
  }
}

/** Cron: đẩy lại các dòng còn 'cho' hoặc 'loi'. */
export async function dayLaiDongCho(gioiHan = 100): Promise<{ da: number; loi: number }> {
  const ds = await db.select({ id: schema.whNhanKcs.id }).from(schema.whNhanKcs)
    .where(inArray(schema.whNhanKcs.trangThaiDay, ['cho', 'loi']))
    .limit(gioiHan);
  let da = 0, loi = 0;
  for (const d of ds) {
    const r = await dayMotDong(d.id);
    if (r.ok) da++; else loi++;
  }
  return { da, loi };
}
```

- [ ] **Bước 4:** `npx vitest run features/kho-nhan/day-lark.test.ts` — PASS.

- [ ] **Bước 5: Viết `features/kho-nhan/queries.ts`:**

```ts
/** Truy vấn cho màn "Nhận hàng & KCS": món của đơn + việc đã làm hôm nay. */
import { desc, eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';

export interface MonCuaDon {
  dinhDanh: string;
  recordId: string | null;
  sku: string | null;
  lineitemName: string | null;
  store: string | null;
  vendor: string | null;
  huy: boolean;
  lyDoHuy: string | null;
  /** Kết quả kho đã ghi cho món này (nếu có) — nhập tiếp là SỬA, không tạo dòng hai. */
  daNhan: { luc: string; qcCheck: string; whAction: string; soLuong: number; canKg: number | null; trangThaiDay: string } | null;
}

export async function timMonCuaDon(orderNumber: string): Promise<MonCuaDon[]> {
  const bare = orderNumber.trim().replace(/^#/, '');
  if (!bare) return [];
  const m = schema.larkMonDon, w = schema.whNhanKcs;
  const rows = await db.select({
    dinhDanh: m.dinhDanh, recordId: m.recordId, sku: m.sku, lineitemName: m.lineitemName,
    store: m.store, vendor: m.vendor, huy: m.huy, lyDoHuy: m.lyDo,
    wLuc: w.luc, wQc: w.qcCheck, wAction: w.whAction, wSl: w.soLuong, wCan: w.canKg, wTrangThai: w.trangThaiDay,
  }).from(m)
    .leftJoin(w, eq(w.monDinhDanh, m.dinhDanh))
    .where(eq(m.orderNumber, bare))
    .orderBy(m.sku);

  return rows.map((r) => ({
    dinhDanh: r.dinhDanh, recordId: r.recordId, sku: r.sku, lineitemName: r.lineitemName,
    store: r.store, vendor: r.vendor, huy: r.huy, lyDoHuy: r.lyDoHuy,
    daNhan: r.wLuc
      ? { luc: r.wLuc.toISOString(), qcCheck: r.wQc!, whAction: r.wAction!, soLuong: r.wSl!, canKg: r.wCan != null ? Number(r.wCan) : null, trangThaiDay: r.wTrangThai! }
      : null,
  }));
}

export async function listDaXuLyHomNay() {
  const w = schema.whNhanKcs;
  const rows = await db.select().from(w)
    // Ngày VN = UTC+7 (xem lib/timezone.ts).
    .where(sql`(${w.luc} + interval '7 hours')::date = (now() + interval '7 hours')::date`)
    .orderBy(desc(w.luc))
    .limit(200);
  return rows.map((r) => ({
    id: r.id, orderNumber: r.orderNumber, sku: r.sku, qcCheck: r.qcCheck, whAction: r.whAction,
    nguoiLam: r.nguoiLam, luc: r.luc.toISOString(), trangThaiDay: r.trangThaiDay,
    larkRecordId: r.larkRecordId, loi: r.loi,
  }));
}
```

- [ ] **Bước 6: Viết `features/kho-nhan/actions.ts`** (`'use server'`, CHỈ export hàm async):

```ts
'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db, schema } from '@/db/client';
import { requirePerm } from '@/features/receiving/perm';
import { uploadReceiptImage } from '@/features/receiving/actions';
import { kiemViec } from './luat';
import { dayMotDong } from './day-lark';

/**
 * Kho lưu việc nhận + kiểm MỘT món. Ghi vào SMS trước rồi mới đẩy Lark: Lark hỏng thì việc
 * vẫn còn, cron đẩy lại sau (spec §5).
 */
export async function ghiNhanKcs(formData: FormData): Promise<{ ok: boolean; loi?: string; larkRecordId?: string; tao?: boolean }> {
  const userId = await requirePerm('manage_qc');

  const anh = formData.get('anh');
  let anhKey: string | null = null;
  if (anh instanceof File && anh.size > 0) {
    const fd = new FormData();
    fd.set('file', anh);
    fd.set('scope', String(formData.get('monDinhDanh') ?? 'kho'));
    anhKey = await uploadReceiptImage(fd);
  }

  const soRaw = formData.get('canKg');
  const v = kiemViec({
    monDinhDanh: String(formData.get('monDinhDanh') ?? ''),
    monRecordId: String(formData.get('monRecordId') ?? '') || null,
    orderNumber: String(formData.get('orderNumber') ?? ''),
    sku: String(formData.get('sku') ?? '') || null,
    soLuong: Number(formData.get('soLuong') ?? 0),
    canKg: soRaw != null && String(soRaw).trim() !== '' ? Number(soRaw) : null,
    qcCheck: String(formData.get('qcCheck') ?? '') as never,
    whAction: String(formData.get('whAction') ?? '') as never,
    lyDoFail: String(formData.get('lyDoFail') ?? '') || null,
    warehouse: String(formData.get('warehouse') ?? '') as never,
    coAnh: !!anhKey,
  });
  if (!v.ok) return { ok: false, loi: v.loi };

  // Một món một dòng: nhập lại là SỬA dòng cũ, không đẻ dòng hai (khớp cách Lark làm).
  const [cu] = await db.select({ id: schema.whNhanKcs.id })
    .from(schema.whNhanKcs).where(eq(schema.whNhanKcs.monDinhDanh, v.viec.monDinhDanh)).limit(1);

  const giaTri = {
    monDinhDanh: v.viec.monDinhDanh, monRecordId: v.viec.monRecordId, orderNumber: v.viec.orderNumber,
    sku: v.viec.sku, soLuong: v.viec.soLuong, canKg: v.viec.canKg != null ? String(v.viec.canKg) : null,
    qcCheck: v.viec.qcCheck, whAction: v.viec.whAction, lyDoFail: v.viec.lyDoFail,
    anhKey, warehouse: v.viec.warehouse, nguoiLam: userId, luc: new Date(),
    trangThaiDay: 'cho' as const, loi: null,
  };
  const id = cu
    ? (await db.update(schema.whNhanKcs).set(giaTri).where(eq(schema.whNhanKcs.id, cu.id)).returning({ id: schema.whNhanKcs.id }))[0].id
    : (await db.insert(schema.whNhanKcs).values(giaTri).returning({ id: schema.whNhanKcs.id }))[0].id;

  const day = await dayMotDong(id);
  revalidatePath('/f/warehouse/nhan-kcs');
  if (!day.ok) return { ok: true, loi: `Đã lưu ở SMS nhưng chưa ghi được lên Lark: ${day.loi}` };
  const [sau] = await db.select({ larkRecordId: schema.whNhanKcs.larkRecordId })
    .from(schema.whNhanKcs).where(eq(schema.whNhanKcs.id, id)).limit(1);
  return { ok: true, larkRecordId: sau?.larkRecordId ?? undefined, tao: !cu };
}

/** Bấm thử lại một dòng đang lỗi. */
export async function dayLaiDongLoi(id: string): Promise<{ ok: boolean; loi?: string }> {
  await requirePerm('manage_qc');
  const r = await dayMotDong(id);
  revalidatePath('/f/warehouse/nhan-kcs');
  return r;
}
```

- [ ] **Bước 7: Job đẩy lại.** `features/jobs/registry.ts` thêm sau `ghi-nguoc-lark`:

```ts
  { key: 'day-nhan-kcs-lark', ten: 'Đẩy việc nhận + KCS của kho lên Lark', chuKyPhut: 15 * PHUT,
    hauQua: 'Việc kho đã làm trên SMS không lên bảng kho Lark' },
```

`features/jobs/groups.ts` thêm khoá vào nhóm `'moi-15-phut'`:

```ts
  'moi-15-phut': ['retry-mmp-orders', 'retry-ship-ho-events', 'day-nhan-kcs-lark'],
```

`scripts/cron/run-group.ts` thêm import `import { dayLaiDongCho } from '@/features/kho-nhan/day-lark';` và một dòng trong `CHAY`:

```ts
  'day-nhan-kcs-lark': () => dayLaiDongCho(),
```

- [ ] **Bước 8:** `npx vitest run features/kho-nhan features/jobs && npx tsc --noEmit` — xanh.

- [ ] **Bước 9: Commit** `feat(kho-nhan): lưu việc kho ở SMS trước rồi đẩy Lark, kèm hàng đợi thử lại`

---

### Task 5: Màn hình `/f/warehouse/nhan-kcs`

**Files:**
- Create: `app/(dashboard)/f/warehouse/nhan-kcs/page.tsx`, `components/kho-nhan/BangNhanKcs.tsx`
- Modify: `app/(dashboard)/f/warehouse/layout.tsx`

**Interfaces:**
- Consumes: `timMonCuaDon`, `listDaXuLyHomNay` (Task 4); `ghiNhanKcs`, `dayLaiDongLoi` (Task 4); `QC_CHECK`, `WH_ACTION`, `WAREHOUSE`, `actionMacDinh` (Task 2).

- [ ] **Bước 1: Tab.** `app/(dashboard)/f/warehouse/layout.tsx` — trong nhánh `view_receiving`, thêm ngay trước mục "Chờ KCS":

```ts
         { href: '/f/warehouse/nhan-kcs', label: 'Nhận hàng & KCS' },
```

- [ ] **Bước 2: Page** `app/(dashboard)/f/warehouse/nhan-kcs/page.tsx`:

```tsx
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { timMonCuaDon, listDaXuLyHomNay } from '@/features/kho-nhan/queries';
import { BangNhanKcs } from '@/components/kho-nhan/BangNhanKcs';

export const dynamic = 'force-dynamic';

export default async function NhanKcsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_receiving')) {
    return <div className="px-6 py-16 text-center text-sm text-muted-foreground">Không có quyền.</div>;
  }
  const sp = await searchParams;
  const don = typeof sp.don === 'string' ? sp.don : '';
  const [mon, homNay] = await Promise.all([don ? timMonCuaDon(don) : Promise.resolve([]), listDaXuLyHomNay()]);

  return (
    <div className="space-y-5 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Nhận hàng &amp; KCS</h1>
        <p className="text-sm text-muted-foreground">
          Gõ hoặc quét mã đơn, nhập số lượng, cân và kết quả kiểm cho từng món. SMS ghi thẳng sang bảng kho trên Lark.
        </p>
      </div>
      <BangNhanKcs don={don} mon={mon} homNay={homNay} coQuyenNhap={hasPermission(role, 'manage_qc')} />
    </div>
  );
}
```

- [ ] **Bước 3: Component** `components/kho-nhan/BangNhanKcs.tsx` (`'use client'`). Yêu cầu:
  - **Ô tìm đơn:** form GET `action="/f/warehouse/nhan-kcs"`, input `name="don"` `defaultValue={don}` placeholder "Mã đơn — gõ hoặc quét", nút "Tìm". Có `autoFocus` để máy quét bắn thẳng vào ô.
  - **Danh sách món:** mỗi món một khối viền: dòng trên là mã hàng, tên hàng, nhà cung cấp; dòng dưới là các ô nhập.
    - Món `huy` → nền đỏ nhạt, chữ "Đã huỷ ({lyDoHuy}) — không nhận vào kho", khoá mọi ô nhập.
    - Món có `daNhan` → dòng xám ghi "Đã nhận {gioVn(luc)} · {qcCheck} · {whAction} · SL {soLuong}{canKg ? ` · ${canKg} kg` : ''}" và chữ "nhập tiếp là sửa dòng này".
  - **Ô nhập mỗi món:** số lượng (number, min 1, mặc định 1), cân kg (number, step 0.01, mặc định `daNhan?.canKg ?? ''`), kết quả kiểm (select từ `QC_CHECK`, mặc định `QC Pass`), hướng xử lý (select từ `WH_ACTION`, tự đổi theo `actionMacDinh(qc)` mỗi khi đổi kết quả kiểm, người vẫn sửa tay được), kho (select từ `WAREHOUSE`, nhớ lựa chọn gần nhất bằng `localStorage` khoá `kho-nhan-warehouse`).
    - Chọn `QC Failed` → hiện thêm ô lý do (bắt buộc) và ô chọn ảnh (bắt buộc, `accept="image/*"`).
  - **Nút "Lưu"** mỗi món: gọi `ghiNhanKcs(formData)` trong `useTransition`, khoá nút khi đang gửi. Kết quả hiện ngay dưới món: thành công `tao` → "Đã tạo dòng kho trên Lark"; `tao === false` → "Đã cập nhật dòng kho trên Lark"; có `loi` → chữ vàng nguyên văn `loi` (trường hợp lưu được ở SMS nhưng Lark trượt); `ok === false` → chữ đỏ.
    - Lỗi của món này KHÔNG ảnh hưởng món khác.
  - **Khối "Đã xử lý hôm nay":** bảng gọn gồm giờ, mã đơn, mã hàng, kết quả, hướng xử lý, người làm, trạng thái đẩy. Dòng `trangThaiDay === 'loi'` hiện chữ đỏ kèm `loi` và nút "Thử lại" gọi `dayLaiDongLoi(id)`.
  - Dùng lớp Tailwind như `components/dong-hang/BangDongHang.tsx` (chip `rounded-md border px-2 py-0.5 text-[11px]`, nút chính `bg-amber-500 text-amber-950`). Giờ hiển thị theo `MUI_GIO_KINH_DOANH` như file đó.

- [ ] **Bước 4:** `npx tsc --noEmit`, `npx vitest run`, `npx next build` — xanh. Chạy dev (`preview_start` theo `.claude/launch.json`) mở `/f/warehouse/nhan-kcs?don=%23MBLVD30426`: thấy các món của đơn, nhập thử rồi bấm Lưu với `WH_GHI_LARK=dry` trong `.env` — kết quả báo đã lưu, không gọi Lark. Chụp màn hình vào report.

- [ ] **Bước 5: Commit** `feat(kho-nhan): màn Nhận hàng & KCS — nhập số lượng, cân, kết quả kiểm, hướng xử lý theo từng món`

---

### Task 6: Tài liệu, bật thật, Second Brain

**Files:**
- Create: `docs/integrations/lark-wh-inventory.md`
- Modify: `.env.example`
- Modify: Second Brain `Shared/Projects/Shopify-Management-System/Activity Log.md`, `Decisions.md`

- [ ] **Bước 1: `docs/integrations/lark-wh-inventory.md`:**

```markdown
# SMS ghi sang bảng Lark "WH - Inventory (Nhập, QC, Pack)"

Spec: docs/superpowers/specs/2026-09-22-nhan-hang-kcs-kho-design.md

Bảng `tblfnOiEwzcXmemM`, cùng `LARK_BASE_APP_TOKEN` với LOG-Export. Mỗi dòng = một món của một đơn.

## Env
- `WH_GHI_LARK=dry` — chạy thử: ghi vào SMS, KHÔNG gọi Lark. Bỏ biến khi chạy thật.

## Cột SMS ghi
Tạo dòng mới (13 cột): `Import (select order)` · `Lineitem SKU final` · `Lineitem Name` · `Order Number final` · `Store final` · `Vendor final` · `Warehouse` · `Import - Inventory type` (= Retail) · `Ngày Import - tiếp nhận đồ tại kho` · `Quantity tiếp nhận trước QC` · `Weight (kg)` · `QC Check` · `WH - Action`; thêm `Lý do QC failed` khi không đạt.

Cập nhật dòng có sẵn (5 cột): `Quantity tiếp nhận trước QC` · `Weight (kg)` · `QC Check` · `WH - Action` · `Lý do QC failed`.

**SMS KHÔNG có lệnh xoá trên bảng này.**

## Giá trị hợp lệ (cột chọn — ghi giá trị lạ là Lark đẻ lựa chọn mới, hỏng bộ lọc của cả đội)
- `QC Check`: QC Pass · QC Failed · Gửi dư
- `WH - Action`: Tạm nhập (đi đơn) · Lưu kho · Gửi trả Vendor (QC fail) · Hoàn trả brand (return) · Trả lại Vendor (đồ mượn)
- `Warehouse`: HN | GVM · SG | AP · TQ | CG · PHSG

## Khi Lark hỏng
Việc kho đã lưu ở bảng `wh_nhan_kcs` của SMS. Dòng đẩy trượt có `trang_thai_day = 'loi'`; job `day-nhan-kcs-lark` (15 phút một lần) thử lại, và màn có nút "Thử lại" từng dòng.

## Kiểm tay
Đặt `WH_GHI_LARK=dry`, nhập một món trên `/f/warehouse/nhan-kcs`, xem log. Bỏ biến, nhập lại, mở Lark kiểm đúng cột.
```

- [ ] **Bước 2: `.env.example`** — thêm cạnh `LARK_PACK_DRY`:

```
# Chạy thử ghi bảng kho Lark: 'dry' = chỉ lưu ở SMS, không gọi Lark
WH_GHI_LARK=
```

- [ ] **Bước 3: Second Brain** — `Activity Log.md` thêm entry 22/09 (template `Shared/Templates/Activity Entry.md`): màn Nhận hàng & KCS, lý do (9.007 dòng Lark so với 757 dòng SMS; không tồn tại hàng chờ QC nên phải làm cả nhận lẫn kiểm), việc CEO cần làm (bật env khi chạy thật). `Decisions.md` thêm **D-093**: "Kho nhập số lượng/cân/kết quả kiểm/hướng xử lý trên SMS; SMS tạo hoặc cập nhật dòng bảng kho Lark qua liên kết món; ảnh lưu ở SMS; không có lệnh xoá. Thay thế: quy trình phiếu nhận của SMS (kho không dùng, 757/9.007 dòng)." Chỉ ghi zone `Shared/`.

- [ ] **Bước 4: Kiểm trước push** — `npx tsc --noEmit && npx vitest run && npx next build` xanh.

- [ ] **Bước 5: Commit** `docs(kho-nhan): hướng dẫn ghi bảng kho Lark + env chạy thử`

---

## Sau khi xong (người điều phối)

1. Push `main`; nếu Railway không tự deploy thì `railway up --detach --service Shopify-Management-System` (auto-deploy từ GitHub đang trục trặc, xem 22/09).
2. Đặt `WH_GHI_LARK=dry` trên Railway (service web + service cron), nhờ kho nhập thử một đơn, xem `/f/jobs` và bảng `wh_nhan_kcs`.
3. Bỏ biến `WH_GHI_LARK`, redeploy, nhập lại một món thật, mở bảng Lark kiểm đúng cột rồi mới giao cho kho dùng.
4. Hỏi CEO ba cột Lark chưa ai dùng (`WH - CURRENT (final location)`, `FINANCE đã nhận BB`, `WH - Check Packed`, đều 0 dòng) có bỏ khỏi bảng không.
