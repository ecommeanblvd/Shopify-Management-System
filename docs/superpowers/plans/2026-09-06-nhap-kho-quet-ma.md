# Nhập kho quét mã — kế hoạch triển khai

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Một màn hình mobile cho kho nhận hàng brand bằng QR: chọn brand → chọn/quét dòng đơn → in N tem `WH-…` → quét xác nhận; đủ chiếc thì tự chốt `delivered_at`, chuyển dòng sang `in_stock`, ghi ngày nhận cho MMP và đẩy dòng lên bảng Lark "WH ngày MEAN nhận hàng".

**Architecture:** Tái dùng mô hình `goods_receipts` / `goods_receipt_items` (mã `WH-00009890` có sẵn), thêm hai mốc `printed_at` / `confirmed_at` và cờ `unplanned`. Logic thuần (đọc mã QR, luật in/quét, chữ trên tem, đồng bộ Lark) tách thành module không đụng DB để test bằng vitest; server action mỏng gọi logic + Drizzle; UI là client component gọi thẳng server action. Lark là bước best-effort: lỗi không chặn nhận hàng, cron `sync-lark` điền bù theo cột `mmp_line_received.lark_pushed_at`.

**Tech Stack:** Next.js 16.2.6 (App Router, server actions, `searchParams` là Promise), React 19.2.4, Drizzle + Supabase Postgres, vitest 4 (environment `node`, KHÔNG có jsdom → không test component React), `qrcode` 1.5.4 (sinh QR client), `@zxing/browser` 0.2.1 (đọc QR bằng camera), Lark Bitable REST.

## Global Constraints

- **Hai tầng mã, mỗi tem một khoá** (spec §2.2, §2.3): tem món = `WH-00009890` (giữ nguyên `unit_code`, KHÔNG đổi 9.890 mã cũ); tem dòng đơn = `L:<shopifyLineId>` (hiện 14 chữ số; ID Shopify là số tăng dần nên regex nhận 6–20 chữ số, mã không có trong DB bị chặn ở bước tra). Không nối Product/Order ID vào mã.
- **QR, không mã sọc** (§2.6). Phân biệt loại tem bằng tiền tố `WH-` / `L:`.
- **Không bước nào gõ SKU** (§3). Ô nhập tay chỉ nhận MÃ QR khi camera hỏng.
- **Đủ chiếc mới chốt** (§3 bước 4): `brand_order_requests.delivered_at` = lúc quét chiếc cuối; dòng `order_fulfillment_lines` chuyển `brand_confirmed → in_stock`; "đã nhận" ≠ "QC pass" (QC vẫn ở Lark).
- **Lệch** (§3.1): thiếu → còn nợ, vẫn trong danh sách chờ; thừa → in tối đa = mong đợi, phần dư là "Nhận ngoài kế hoạch" (`unplanned = true`, `fulfillment_line_id = NULL`), KHÔNG nâng số lượng đơn; quét nhầm (khác phiếu / đã xác nhận / không tồn tại) → báo đỏ + rung, KHÔNG ghi gì; in mà chưa xác nhận → hiện cảnh báo, không coi là đã nhận.
- **Tem** (§4): 50×30mm mặc định, bản A4 24 tem/trang; chữ kèm `#TA2331 · Áo X · XL · 1/2 · TINH`; sinh QR phía client; trang in nhận danh sách mã qua URL, không gọi API lúc in.
- **Bàn giao** (§5): đủ chiếc → ghi `mmp_line_received.received_at` với `source = 'sms'`; đẩy Lark bảng `HxfAw0iRViHiNgkSlbBltpVkg3f` / `tblFtdIn8H7ftfBL` các cột `order_number`, `Lineitem SKU`, `Visible - WH-Ngày MEAN nhận hàng gần nhất`, **`Mã món`** (chuỗi `WH-… | WH-…`); tên cột khai MỘT chỗ; cột "Mã món" do ops tạo → đẩy Lark gác sau env `LARK_NHAN_HANG_PUSH=1`; `syncBrandReceived` đổi thành CHỈ chèn khi chưa có, KHÔNG ghi đè.
- **SMS là nguồn sự thật cho "MEAN đã nhận"** (§2.7): dòng `source='sms'` ghi đè dòng Lark; Lark không ghi đè SMS.
- **MMP** (§6, ĐỘC LẬP): `MmpOrderLine` thêm `lineId`, `labelUrl` như trường cộng thêm, không đổi trường cũ; gác sau env `MMP_GUI_LINE_ID=1`; KHÔNG bật trước khi báo MMP.
- **Ngoài phạm vi** (§7): QC/kệ/đóng gói trong SMS; tồn kho/giá vốn theo Variant ID; tem kiện.
- **Quy ước repo:** đọc `node_modules/next/dist/docs/01-app/01-getting-started/07-mutating-data.md` và `05-server-and-client-components.md` trước khi viết page/action; `timestamp` là UTC-naive → mọi so sánh thời gian nằm trong SQL (`now()`), không round-trip qua JS Date; trước push chạy `npx tsc --noEmit` + `npx vitest run` + `npm run build` (file `'use server'` chỉ được export hàm async — tsc không bắt); `gh auth switch --user ecommeanblvd` trước `git push`; tiếng Việt cho tên hàm/ghi chú mới theo nếp các module gần đây (`tach-ma-don.ts`, `push-courier.ts`).

---

## Cấu trúc file

| File | Trách nhiệm |
|---|---|
| `db/migrations/0127_nhap-kho-quet-ma.sql` + `db/schema.ts` + `db/migrations/meta/_journal.json` | Cột `printed_at`, `confirmed_at`, `unplanned` trên `goods_receipt_items`; `lark_pushed_at` trên `mmp_line_received` |
| `features/receiving/ma-tem.ts` (+test) | Thuần: đọc chuỗi QR → `{loai:'mon'}` / `{loai:'dong'}`; dựng mã tem dòng |
| `features/receiving/nhan-nhanh-logic.ts` (+test) | Thuần: luật in tối đa, phân loại kết quả quét, đủ chiếc, chữ trên tem |
| `features/receiving/perm.ts` | Tách `requirePerm`, `withUniqueRetry` ra khỏi `actions.ts` để module mới dùng chung |
| `features/receiving/tao-mon.ts` | `taoMonTrongTx` — sinh `WH-` + insert 1 món trong transaction (dùng chung cho `addReceiptItem` và in tem) |
| `features/receiving/nhan-nhanh-queries.ts` | Đọc: brand đang chờ, dòng chờ theo brand (kèm đã in/đã xác nhận), dòng theo Line ID, phiếu hôm nay, món theo mã |
| `features/receiving/ghi-nhan-hang.ts` | Upsert `mmp_line_received` nguồn `sms` |
| `features/lark/sync-brand-received.ts` | Đổi luật: chỉ chèn khi chưa có |
| `features/lark/client.ts` | Thêm `createBrandReceivedRecord`, `updateBrandReceivedRecordFields` |
| `features/lark/push-nhan-hang.ts` (+test) | Thuần (hàm tiêm): tên cột, dựng fields, luật đối chiếu/điền/tạo |
| `features/lark/nhan-hang-backfill.ts` | Điền bù từ `mmp_line_received` chưa đẩy; chạy trong `scripts/cron/sync-lark.ts` |
| `features/jobs/registry.ts` | Khoá `push-nhan-hang` |
| `features/receiving/nhan-nhanh-actions.ts` | Server action: mở phiếu brand, đọc dữ liệu cho UI, in tem, nhận ngoài kế hoạch, xác nhận quét |
| `components/receiving/MaQR.tsx`, `TemGrid.tsx` | Client: vẽ QR (`qrcode`), lưới tem 50×30 / A4 |
| `app/(dashboard)/f/warehouse/receiving/tem/page.tsx` | Trang in: nhận `?ma=WH-…,WH-…` hoặc `?dong=<lineId,…>`, `?kho=a4` |
| `components/receiving/MayQuet.tsx`, `QuetNhanHang.tsx` | Client: camera QR + máy trạng thái 4 bước |
| `app/(dashboard)/f/warehouse/receiving/quet/page.tsx` + `app/(dashboard)/f/warehouse/layout.tsx` | Trang mobile + tab "Nhập kho nhanh" |
| `app/(dashboard)/f/warehouse/receiving/[id]/page.tsx` | Badge "Đã in, chưa xác nhận" / "Ngoài kế hoạch" |
| `features/receiving/ky-url-tem.ts` (+test), `app/tem/[orderId]/page.tsx`, `features/mmp/order-push-logic.ts`, `features/mmp/order-outbound.ts` | (Gác cổng) `lineId`, `labelUrl` cho MMP |

---

### Task 1: Migration 0127 + schema

**Files:**
- Create: `db/migrations/0127_nhap-kho-quet-ma.sql`
- Modify: `db/schema.ts:1934-1962` (`goodsReceiptItems`), `db/schema.ts:1887-1900` (`mmpLineReceived`)
- Modify: `db/migrations/meta/_journal.json` (thêm entry cuối)

**Interfaces:**
- Produces: `schema.goodsReceiptItems.printedAt`, `.confirmedAt` (`timestamp | null`), `.unplanned` (`boolean`, default false); `schema.mmpLineReceived.larkPushedAt` (`timestamp | null`); giá trị `source` mới `'sms'`.

- [ ] **Step 1: Viết migration**

```sql
-- Nhập kho quét mã (spec docs/superpowers/specs/2026-09-06-nhap-kho-quet-ma-design.md §3.2, §5).
--
-- printed_at   : lúc kho bấm "In N tem" — món tồn tại nhưng CHƯA được coi là đã nhận.
-- confirmed_at : lúc quét xác nhận tem đã dán. Đủ chiếc của dòng → chốt delivered_at.
-- unplanned    : cờ vàng "Nhận ngoài kế hoạch" (brand gửi thừa / hàng không có trong
--                danh sách chờ) — không nối dòng đơn, không tự nâng số lượng đơn.
ALTER TABLE goods_receipt_items ADD COLUMN printed_at timestamp;--> statement-breakpoint
ALTER TABLE goods_receipt_items ADD COLUMN confirmed_at timestamp;--> statement-breakpoint
ALTER TABLE goods_receipt_items ADD COLUMN unplanned boolean NOT NULL DEFAULT false;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS goods_receipt_items_line_idx ON goods_receipt_items (fulfillment_line_id);--> statement-breakpoint
-- Dòng nhận hàng do SMS ghi (source='sms') cần đẩy sang bảng Lark "WH ngày MEAN
-- nhận hàng"; NULL = chưa đẩy, cron sync-lark điền bù (cùng cách cột Couriers, D-045).
ALTER TABLE mmp_line_received ADD COLUMN lark_pushed_at timestamp;
```

- [ ] **Step 2: Sửa schema.ts**

Trong `goodsReceiptItems`, ngay sau dòng `weightKg: numeric('weight_kg', { precision: 10, scale: 3 }),` thêm:

```ts
  /** Lúc bấm "In N tem" (nhập kho quét mã). Có printed_at mà chưa có confirmed_at = tem in rồi chưa dán/quét. */
  printedAt: timestamp('printed_at'),
  /** Lúc quét xác nhận tem đã dán. Đủ chiếc của dòng → delivered_at + in_stock. */
  confirmedAt: timestamp('confirmed_at'),
  /** Cờ vàng "Nhận ngoài kế hoạch": brand gửi thừa hoặc hàng không có trong danh sách chờ. */
  unplanned: boolean('unplanned').notNull().default(false),
```

Trong `mmpLineReceived`, sửa ghi chú của `source` và thêm cột sau `source`:

```ts
  // 'lark' = ops ghi thật (bảng Lark WH) · 'estimate_fulfill' = ước từ mốc
  // fulfill Shopify (backfill đơn TA cũ 2024-2025) · 'sms' = kho quét xác nhận
  // trên SMS (nguồn sự thật từ 09/2026 — ghi đè 'lark', không bị 'lark' ghi đè).
  source: text('source').notNull().default('lark'),
  /** Chỉ dùng cho source='sms': lúc đẩy xong sang bảng Lark. NULL = chưa đẩy. */
  larkPushedAt: timestamp('lark_pushed_at'),
```

`boolean` đã có trong import `drizzle-orm/pg-core` ở dòng 1 của `db/schema.ts`.

- [ ] **Step 3: Thêm entry journal**

Trong `db/migrations/meta/_journal.json`, sau entry idx 126 thêm:

```json
    {
      "idx": 127,
      "version": "7",
      "when": 1787488800000,
      "tag": "0127_nhap-kho-quet-ma",
      "breakpoints": true
    }
```

- [ ] **Step 4: Chạy migration + tsc**

Run: `npm run db:migrate && npx tsc --noEmit`
Expected: migration áp dụng, tsc không lỗi.

- [ ] **Step 5: Commit**

```bash
git add db/migrations/0127_nhap-kho-quet-ma.sql db/migrations/meta/_journal.json db/schema.ts
git commit -m "feat(receiving): cột printed_at/confirmed_at/unplanned + lark_pushed_at cho nhập kho quét mã"
```

---

### Task 2: Đọc mã QR (`ma-tem.ts`)

**Files:**
- Create: `features/receiving/ma-tem.ts`
- Test: `features/receiving/ma-tem.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type MaTem = { loai: 'mon'; unitCode: string } | { loai: 'dong'; shopifyLineId: string };
  export function docMaTem(raw: string): MaTem | null;
  export function maTemDong(shopifyLineId: string): string; // 'L:18158666023207'
  ```

- [ ] **Step 1: Viết test**

```ts
import { describe, it, expect } from 'vitest';
import { docMaTem, maTemDong } from './ma-tem';

describe('docMaTem', () => {
  it('WH-8 số → tem món, chuẩn hoá chữ hoa và bỏ khoảng trắng', () => {
    expect(docMaTem('WH-00009890')).toEqual({ loai: 'mon', unitCode: 'WH-00009890' });
    expect(docMaTem('  wh-00009890 \n')).toEqual({ loai: 'mon', unitCode: 'WH-00009890' });
  });
  it('L:<số> → tem dòng đơn', () => {
    expect(docMaTem('L:18158666023207')).toEqual({ loai: 'dong', shopifyLineId: '18158666023207' });
    expect(docMaTem('l:18158666023207')).toEqual({ loai: 'dong', shopifyLineId: '18158666023207' });
  });
  it('chuỗi lạ → null (không đoán SKU, không đoán số trần)', () => {
    expect(docMaTem('')).toBeNull();
    expect(docMaTem('18158666023207')).toBeNull();
    expect(docMaTem('WH-123')).toBeNull();
    expect(docMaTem('SKU-ABC-XL')).toBeNull();
    expect(docMaTem('L:abc')).toBeNull();
  });
});

describe('maTemDong', () => {
  it('nối tiền tố L:', () => {
    expect(maTemDong('18158666023207')).toBe('L:18158666023207');
  });
});
```

- [ ] **Step 2: Chạy test, mong thất bại**

Run: `npx vitest run features/receiving/ma-tem.test.ts`
Expected: FAIL — "Failed to resolve import './ma-tem'".

- [ ] **Step 3: Viết module**

```ts
/**
 * THUẦN: đọc chuỗi trong QR trên tem → loại tem + khoá.
 *
 * Hai tầng mã (spec §2.2): tem MÓN `WH-00009890` (kho in lúc nhận) và tem DÒNG ĐƠN
 * `L:<shopifyLineId>` (brand in lên kiện). Mỗi tem chỉ mang MỘT khoá; Product /
 * Variant / Order tra từ DB. Không nhận chuỗi trần (không tiền tố) — quét nhầm mã
 * vạch SKU của brand phải ra null chứ không đoán.
 */
export type MaTem =
  | { loai: 'mon'; unitCode: string }
  | { loai: 'dong'; shopifyLineId: string };

const MON = /^WH-(\d{8})$/i;
const DONG = /^L:(\d{6,20})$/i;

export function docMaTem(raw: string): MaTem | null {
  const s = raw.replace(/\s+/g, '');
  if (!s) return null;
  const m = MON.exec(s);
  if (m) return { loai: 'mon', unitCode: `WH-${m[1]}` };
  const d = DONG.exec(s);
  if (d) return { loai: 'dong', shopifyLineId: d[1] };
  return null;
}

/** Chuỗi in vào QR tem dòng đơn (brand in lên kiện). */
export function maTemDong(shopifyLineId: string): string {
  return `L:${shopifyLineId}`;
}
```

- [ ] **Step 4: Chạy test, mong đạt**

Run: `npx vitest run features/receiving/ma-tem.test.ts`
Expected: PASS (4 test).

- [ ] **Step 5: Commit**

```bash
git add features/receiving/ma-tem.ts features/receiving/ma-tem.test.ts
git commit -m "feat(receiving): đọc mã QR tem món WH- và tem dòng đơn L:"
```

---

### Task 3: Luật in / quét / chữ tem (`nhan-nhanh-logic.ts`)

**Files:**
- Create: `features/receiving/nhan-nhanh-logic.ts`
- Test: `features/receiving/nhan-nhanh-logic.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface DemDong { mongDoi: number; daIn: number; daXacNhan: number }
  export function soTemDuocIn(dem: DemDong, yeuCau: number): { theoDon: number; ngoaiKeHoach: number };
  export type LyDoTuChoi = 'khong_ton_tai' | 'da_xac_nhan' | 'khac_phieu' | 'khong_phai_tem_mon';
  export function phanLoaiQuet(mon: { receiptId: string; confirmedAt: Date | null } | null, receiptId: string): LyDoTuChoi | 'khop';
  export function duChiec(dem: DemDong): boolean;
  export function chuTemMon(i: { orderNumber: string | null; productTitle: string | null; variantTitle: string | null; thuTu: number; tong: number; brand: string | null }): string;
  export function chuTemDong(i: { orderNumber: string | null; thuTuDong: number; productTitle: string | null; variantTitle: string | null; qty: number }): string;
  ```

- [ ] **Step 1: Viết test**

```ts
import { describe, it, expect } from 'vitest';
import { soTemDuocIn, phanLoaiQuet, duChiec, chuTemMon, chuTemDong } from './nhan-nhanh-logic';

describe('soTemDuocIn', () => {
  it('còn nợ đủ → in hết theo đơn', () => {
    expect(soTemDuocIn({ mongDoi: 2, daIn: 0, daXacNhan: 0 }, 2)).toEqual({ theoDon: 2, ngoaiKeHoach: 0 });
  });
  it('brand gửi thiếu: in 1, còn nợ 1 (không ép in đủ)', () => {
    expect(soTemDuocIn({ mongDoi: 2, daIn: 0, daXacNhan: 0 }, 1)).toEqual({ theoDon: 1, ngoaiKeHoach: 0 });
  });
  it('brand gửi thừa: tối đa = mong đợi, phần dư ngoài kế hoạch', () => {
    expect(soTemDuocIn({ mongDoi: 2, daIn: 0, daXacNhan: 0 }, 3)).toEqual({ theoDon: 2, ngoaiKeHoach: 1 });
  });
  it('đã in trước đó thì trừ đi', () => {
    expect(soTemDuocIn({ mongDoi: 2, daIn: 1, daXacNhan: 0 }, 2)).toEqual({ theoDon: 1, ngoaiKeHoach: 1 });
    expect(soTemDuocIn({ mongDoi: 2, daIn: 2, daXacNhan: 2 }, 1)).toEqual({ theoDon: 0, ngoaiKeHoach: 1 });
  });
  it('yêu cầu ≤ 0 → không in gì', () => {
    expect(soTemDuocIn({ mongDoi: 2, daIn: 0, daXacNhan: 0 }, 0)).toEqual({ theoDon: 0, ngoaiKeHoach: 0 });
    expect(soTemDuocIn({ mongDoi: 2, daIn: 0, daXacNhan: 0 }, -5)).toEqual({ theoDon: 0, ngoaiKeHoach: 0 });
  });
});

describe('phanLoaiQuet', () => {
  it('mã không có → khong_ton_tai', () => {
    expect(phanLoaiQuet(null, 'p1')).toBe('khong_ton_tai');
  });
  it('tem của phiếu khác → khac_phieu', () => {
    expect(phanLoaiQuet({ receiptId: 'p2', confirmedAt: null }, 'p1')).toBe('khac_phieu');
  });
  it('đã xác nhận rồi → da_xac_nhan', () => {
    expect(phanLoaiQuet({ receiptId: 'p1', confirmedAt: new Date() }, 'p1')).toBe('da_xac_nhan');
  });
  it('đúng phiếu, chưa xác nhận → khop', () => {
    expect(phanLoaiQuet({ receiptId: 'p1', confirmedAt: null }, 'p1')).toBe('khop');
  });
});

describe('duChiec', () => {
  it('đủ khi đã xác nhận ≥ mong đợi', () => {
    expect(duChiec({ mongDoi: 2, daIn: 2, daXacNhan: 2 })).toBe(true);
    expect(duChiec({ mongDoi: 2, daIn: 2, daXacNhan: 1 })).toBe(false);
    expect(duChiec({ mongDoi: 0, daIn: 0, daXacNhan: 0 })).toBe(false);
  });
});

describe('chữ trên tem', () => {
  it('tem món: #đơn · tên · size · i/n · brand, bỏ phần trống', () => {
    expect(chuTemMon({ orderNumber: 'TA2331', productTitle: 'Áo X', variantTitle: 'XL', thuTu: 1, tong: 2, brand: 'TINH' }))
      .toBe('#TA2331 · Áo X · XL · 1/2 · TINH');
    expect(chuTemMon({ orderNumber: '#MBLVD1', productTitle: 'Áo X', variantTitle: null, thuTu: 1, tong: 1, brand: null }))
      .toBe('#MBLVD1 · Áo X · 1/1');
  });
  it('tem dòng: #đơn · dòng k · tên · size × qty', () => {
    expect(chuTemDong({ orderNumber: 'TA2331', thuTuDong: 2, productTitle: 'Áo X', variantTitle: 'XL', qty: 2 }))
      .toBe('#TA2331 · dòng 2 · Áo X · XL × 2');
  });
});
```

- [ ] **Step 2: Chạy test, mong thất bại**

Run: `npx vitest run features/receiving/nhan-nhanh-logic.test.ts`
Expected: FAIL — module chưa tồn tại.

- [ ] **Step 3: Viết module**

```ts
/**
 * THUẦN: luật của màn "Nhập kho nhanh" (spec §3, §3.1, §4). Không đụng DB.
 */

export interface DemDong {
  /** qty của order_fulfillment_lines. */
  mongDoi: number;
  /** Số món đã tạo (đã in tem) nối dòng này. */
  daIn: number;
  /** Số món đã quét xác nhận. */
  daXacNhan: number;
}

/**
 * Bấm "In N tem": in theo đơn tối đa = phần còn thiếu (mongDoi − daIn); phần dư
 * đi đường "Nhận ngoài kế hoạch" — KHÔNG tự nâng số lượng đơn (spec §3.1).
 */
export function soTemDuocIn(dem: DemDong, yeuCau: number): { theoDon: number; ngoaiKeHoach: number } {
  const n = Math.max(0, Math.floor(yeuCau));
  const conThieu = Math.max(0, dem.mongDoi - dem.daIn);
  const theoDon = Math.min(n, conThieu);
  return { theoDon, ngoaiKeHoach: n - theoDon };
}

export type LyDoTuChoi = 'khong_ton_tai' | 'da_xac_nhan' | 'khac_phieu' | 'khong_phai_tem_mon';

/** Quét tem món trong phiếu đang mở: chỉ 'khop' mới được ghi; còn lại báo đỏ + rung, KHÔNG ghi. */
export function phanLoaiQuet(
  mon: { receiptId: string; confirmedAt: Date | null } | null,
  receiptId: string,
): LyDoTuChoi | 'khop' {
  if (!mon) return 'khong_ton_tai';
  if (mon.receiptId !== receiptId) return 'khac_phieu';
  if (mon.confirmedAt) return 'da_xac_nhan';
  return 'khop';
}

export function duChiec(dem: DemDong): boolean {
  return dem.mongDoi > 0 && dem.daXacNhan >= dem.mongDoi;
}

function soDon(orderNumber: string | null): string {
  const bare = (orderNumber ?? '').trim().replace(/^#/, '');
  return bare ? `#${bare}` : '#?';
}

/** `#TA2331 · Áo X · XL · 1/2 · TINH` — phần trống bỏ, không để " ·  · ". */
export function chuTemMon(i: {
  orderNumber: string | null; productTitle: string | null; variantTitle: string | null;
  thuTu: number; tong: number; brand: string | null;
}): string {
  return [soDon(i.orderNumber), i.productTitle?.trim(), i.variantTitle?.trim(), `${i.thuTu}/${i.tong}`, i.brand?.trim()]
    .filter((p): p is string => !!p)
    .join(' · ');
}

/** `#TA2331 · dòng 2 · Áo X · XL × 2` — tem brand in lên kiện. */
export function chuTemDong(i: {
  orderNumber: string | null; thuTuDong: number; productTitle: string | null; variantTitle: string | null; qty: number;
}): string {
  const ten = [i.productTitle?.trim(), i.variantTitle?.trim()].filter((p): p is string => !!p).join(' · ');
  return [soDon(i.orderNumber), `dòng ${i.thuTuDong}`, ten ? `${ten} × ${i.qty}` : `× ${i.qty}`].join(' · ');
}
```

- [ ] **Step 4: Chạy test, mong đạt**

Run: `npx vitest run features/receiving/nhan-nhanh-logic.test.ts`
Expected: PASS (12 test).

- [ ] **Step 5: Commit**

```bash
git add features/receiving/nhan-nhanh-logic.ts features/receiving/nhan-nhanh-logic.test.ts
git commit -m "feat(receiving): luật in tối đa, phân loại quét, chữ trên tem"
```

---

### Task 4: Tách `perm.ts` và `tao-mon.ts` khỏi `actions.ts`

**Files:**
- Create: `features/receiving/perm.ts`, `features/receiving/tao-mon.ts`
- Modify: `features/receiving/actions.ts:24-46` (xoá `requirePerm`, `withUniqueRetry` cục bộ), `:95-127` (`addReceiptItem` dùng `taoMonTrongTx`)

**Interfaces:**
- Produces:
  ```ts
  // perm.ts
  export async function requirePerm(perm: Permission): Promise<string>;      // trả userId; ném lỗi khi thiếu quyền
  export async function withUniqueRetry<R>(fn: () => Promise<R>, attempts?: number): Promise<R>;
  // tao-mon.ts
  export interface MonMoi { receiptId: string; sku?: string | null; productTitle?: string | null; variantTitle?: string | null; photoKey?: string | null; brandRequestId?: string | null; fulfillmentLineId?: string | null; orderId?: string | null; domPrice?: string | null; domPriceCurrency?: string | null; globalPrice?: string | null; globalPriceCurrency?: string | null; weightKg?: string | null; printedAt?: 'now' | null; unplanned?: boolean }
  export async function taoMonTrongTx(tx: Tx, mon: MonMoi): Promise<{ id: string; unitCode: string }>;
  ```

- [ ] **Step 1: Tạo `perm.ts`** — chuyển NGUYÊN VĂN hai hàm từ `actions.ts` (dòng 24–46) sang, thêm `export`:

```ts
import { headers } from 'next/headers';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission, type Permission } from '@/lib/auth/rbac';

/** Trả userId nếu có quyền; ném lỗi nếu chưa đăng nhập / thiếu quyền. Dùng chung cho mọi action nhập kho. */
export async function requirePerm(perm: Permission): Promise<string> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error('Unauthorized');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, perm)) throw new Error('Forbidden');
  return session.user.id;
}

/** Thử lại khi va unique (23505) — mã GRN/WH sinh theo "max + 1" có thể đụng khi hai người bấm cùng lúc. */
export async function withUniqueRetry<R>(fn: () => Promise<R>, attempts = 4): Promise<R> {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      const code = (e as { code?: string })?.code
        ?? (e as { cause?: { code?: string } })?.cause?.code;
      if (code === '23505' && i < attempts - 1) continue;
      throw e;
    }
  }
  throw new Error('unreachable');
}
```

Đối chiếu thân hàm với `actions.ts` hiện tại (dòng 24–46) và giữ đúng hành vi cũ nếu khác chi tiết (ví dụ thông điệp lỗi).

- [ ] **Step 2: Tạo `tao-mon.ts`**

```ts
import { desc, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { nextSeqCode, parseSeq } from './logic';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface MonMoi {
  receiptId: string;
  sku?: string | null; productTitle?: string | null; variantTitle?: string | null; photoKey?: string | null;
  brandRequestId?: string | null; fulfillmentLineId?: string | null; orderId?: string | null;
  domPrice?: string | null; domPriceCurrency?: string | null;
  globalPrice?: string | null; globalPriceCurrency?: string | null; weightKg?: string | null;
  /** 'now' = tạo bởi nút "In N tem" (đã in, chờ quét xác nhận). */
  printedAt?: 'now' | null;
  unplanned?: boolean;
}

/**
 * Sinh mã WH- kế tiếp và chèn MỘT món trong transaction đang mở. Gọi trong
 * withUniqueRetry vì "max + 1" có thể đụng khi hai người in cùng lúc.
 * Không đụng brand_order_requests — ai gọi tự quyết (addReceiptItem chốt
 * delivered_at ngay; in tem thì đợi quét đủ chiếc).
 */
export async function taoMonTrongTx(tx: Tx, mon: MonMoi): Promise<{ id: string; unitCode: string }> {
  const [last] = await tx.select({ unitCode: schema.goodsReceiptItems.unitCode })
    .from(schema.goodsReceiptItems).orderBy(desc(schema.goodsReceiptItems.unitCode)).limit(1);
  const unitCode = nextSeqCode('WH', parseSeq('WH', last?.unitCode ?? null));
  const [row] = await tx.insert(schema.goodsReceiptItems).values({
    receiptId: mon.receiptId, unitCode,
    sku: mon.sku?.trim() || null, productTitle: mon.productTitle ?? null, variantTitle: mon.variantTitle ?? null,
    photoKey: mon.photoKey ?? null,
    brandRequestId: mon.brandRequestId ?? null, fulfillmentLineId: mon.fulfillmentLineId ?? null, orderId: mon.orderId ?? null,
    domPrice: mon.domPrice ?? null, domPriceCurrency: mon.domPriceCurrency ?? null,
    globalPrice: mon.globalPrice ?? null, globalPriceCurrency: mon.globalPriceCurrency ?? null, weightKg: mon.weightKg ?? null,
    printedAt: mon.printedAt === 'now' ? sql`now()` : null,
    unplanned: mon.unplanned ?? false,
  }).returning({ id: schema.goodsReceiptItems.id });
  return { id: row.id, unitCode };
}
```

- [ ] **Step 3: Sửa `actions.ts`**

Xoá hai hàm `requirePerm`, `withUniqueRetry` cục bộ; thêm import:

```ts
import { requirePerm, withUniqueRetry } from './perm';
import { taoMonTrongTx } from './tao-mon';
```

Bỏ các import không còn dùng (`headers`, `auth`, `getRole`, `hasPermission`, `type Permission`) nếu tsc báo. Thay thân `addReceiptItem` thành:

```ts
export async function addReceiptItem(input: AddReceiptItemInput): Promise<string> {
  const userId = await requirePerm('manage_receiving');
  const id = await withUniqueRetry(() => db.transaction(async (tx) => {
    const { id } = await taoMonTrongTx(tx, input);
    // Hàng brand đã về → đóng follow-up (idempotent, chỉ set lần đầu).
    if (input.brandRequestId) {
      await tx.update(schema.brandOrderRequests)
        .set({ deliveredAt: sql`now()`, updatedAt: sql`now()` })
        .where(and(eq(schema.brandOrderRequests.id, input.brandRequestId), isNull(schema.brandOrderRequests.deliveredAt)));
    }
    return id;
  }));
  try { await recordAudit({ userId, action: 'receiving_add_item', target: id, result: 'success' }); } catch (e) { console.error('audit failed', e); }
  revalidatePath(`/f/warehouse/receiving/${input.receiptId}`);
  return id;
}
```

- [ ] **Step 4: Kiểm**

Run: `npx tsc --noEmit && npx vitest run features/receiving`
Expected: tsc sạch; test `logic.test.ts` và hai test mới đạt.

- [ ] **Step 5: Commit**

```bash
git add features/receiving/perm.ts features/receiving/tao-mon.ts features/receiving/actions.ts
git commit -m "refactor(receiving): tách requirePerm/withUniqueRetry và taoMonTrongTx dùng chung"
```

---

### Task 5: Truy vấn cho màn nhập kho nhanh (`nhan-nhanh-queries.ts`)

**Files:**
- Create: `features/receiving/nhan-nhanh-queries.ts`

**Interfaces:**
- Consumes: Task 1 cột mới.
- Produces:
  ```ts
  export interface BrandDangCho { brandSlug: string; displayName: string | null; soDong: number }
  export interface DongCho {
    lineId: string; shopifyLineId: string; orderId: string; orderNumber: string | null; brandRequestId: string;
    brandSlug: string; sku: string | null; productTitle: string | null; variantTitle: string | null;
    mongDoi: number; daIn: number; daXacNhan: number; expectedDeliveryDate: Date | null;
  }
  export async function listBrandDangCho(): Promise<BrandDangCho[]>;
  export async function listDongCho(brandSlug: string): Promise<DongCho[]>;
  export async function getDongTheoShopifyLineId(shopifyLineId: string): Promise<DongCho | null>;
  export async function getDongTheoId(lineId: string): Promise<DongCho | null>;
  export async function getPhieuHomNay(brandSlug: string): Promise<{ id: string; code: string } | null>;
  export async function getMonTheoUnitCode(unitCode: string): Promise<{ id: string; receiptId: string; fulfillmentLineId: string | null; confirmedAt: Date | null } | null>;
  export async function listMonTrongPhieu(receiptId: string): Promise<Array<{ id: string; unitCode: string; sku: string | null; productTitle: string | null; variantTitle: string | null; fulfillmentLineId: string | null; orderNumber: string | null; printedAt: Date | null; confirmedAt: Date | null; unplanned: boolean }>>;
  ```

- [ ] **Step 1: Viết module**

```ts
import { and, eq, isNull, sql, desc } from 'drizzle-orm';
import { db, schema } from '@/db/client';

export interface BrandDangCho { brandSlug: string; displayName: string | null; soDong: number }

export interface DongCho {
  lineId: string; shopifyLineId: string; orderId: string; orderNumber: string | null; brandRequestId: string;
  brandSlug: string; sku: string | null; productTitle: string | null; variantTitle: string | null;
  mongDoi: number; daIn: number; daXacNhan: number; expectedDeliveryDate: Date | null;
}

/** Điều kiện "đang chờ hàng brand" — GIỐNG listAwaitingGoods (queries.ts) để hai danh sách không lệch nhau. */
const DANG_CHO = and(
  eq(schema.orderFulfillmentLines.status, 'brand_confirmed'),
  eq(schema.brandOrderRequests.confirmStatus, 'confirmed'),
  isNull(schema.brandOrderRequests.deliveredAt),
);

const DA_IN = sql<number>`(select count(*)::int from goods_receipt_items gi where gi.fulfillment_line_id = ${schema.orderFulfillmentLines.id})`;
const DA_XAC_NHAN = sql<number>`(select count(*)::int from goods_receipt_items gi where gi.fulfillment_line_id = ${schema.orderFulfillmentLines.id} and gi.confirmed_at is not null)`;

function chonDong() {
  return db.select({
    lineId: schema.orderFulfillmentLines.id,
    shopifyLineId: schema.orderFulfillmentLines.shopifyLineId,
    orderId: schema.brandOrderRequests.orderId,
    orderNumber: schema.shopifyOrders.shopifyOrderNumber,
    brandRequestId: schema.brandOrderRequests.id,
    brandSlug: schema.brandOrderRequests.brandSlug,
    sku: schema.orderFulfillmentLines.sku,
    productTitle: schema.shopifyOrderLines.productTitle,
    variantTitle: schema.shopifyOrderLines.variantTitle,
    mongDoi: schema.orderFulfillmentLines.qty,
    daIn: DA_IN,
    daXacNhan: DA_XAC_NHAN,
    expectedDeliveryDate: schema.brandOrderRequests.expectedDeliveryDate,
  })
    .from(schema.orderFulfillmentLines)
    .innerJoin(schema.brandOrderRequests, eq(schema.brandOrderRequests.fulfillmentLineId, schema.orderFulfillmentLines.id))
    .innerJoin(schema.shopifyOrders, eq(schema.shopifyOrders.id, schema.brandOrderRequests.orderId))
    .leftJoin(schema.shopifyOrderLines, and(
      eq(schema.shopifyOrderLines.orderId, schema.brandOrderRequests.orderId),
      eq(schema.shopifyOrderLines.shopifyLineId, schema.orderFulfillmentLines.shopifyLineId),
    ));
}

/** Brand có dòng đang chờ, kèm tên hiển thị từ mmp_brands (null nếu brand chưa khai). */
export async function listBrandDangCho(): Promise<BrandDangCho[]> {
  return db.select({
    brandSlug: schema.brandOrderRequests.brandSlug,
    displayName: sql<string | null>`max(${schema.mmpBrands.displayName})`,
    soDong: sql<number>`count(*)::int`,
  })
    .from(schema.orderFulfillmentLines)
    .innerJoin(schema.brandOrderRequests, eq(schema.brandOrderRequests.fulfillmentLineId, schema.orderFulfillmentLines.id))
    .leftJoin(schema.mmpBrands, eq(schema.mmpBrands.slug, schema.brandOrderRequests.brandSlug))
    .where(DANG_CHO)
    .groupBy(schema.brandOrderRequests.brandSlug)
    .orderBy(schema.brandOrderRequests.brandSlug);
}

export async function listDongCho(brandSlug: string): Promise<DongCho[]> {
  return chonDong()
    .where(and(DANG_CHO, eq(schema.brandOrderRequests.brandSlug, brandSlug)))
    .orderBy(schema.brandOrderRequests.expectedDeliveryDate, schema.shopifyOrders.shopifyOrderNumber);
}

/** Quét tem brand `L:<id>` → dòng đơn (KHÔNG lọc đang chờ: dòng đã nhận xong vẫn trả về để UI báo "đã nhận rồi"). */
export async function getDongTheoShopifyLineId(shopifyLineId: string): Promise<DongCho | null> {
  const [r] = await chonDong().where(eq(schema.orderFulfillmentLines.shopifyLineId, shopifyLineId)).limit(1);
  return r ?? null;
}

export async function getDongTheoId(lineId: string): Promise<DongCho | null> {
  const [r] = await chonDong().where(eq(schema.orderFulfillmentLines.id, lineId)).limit(1);
  return r ?? null;
}

/**
 * Phiếu retail_for_order của brand tạo HÔM NAY theo giờ Bangkok. received_at là
 * timestamp UTC-naive → đổi múi hai bước trong SQL, không so bằng JS Date.
 */
export async function getPhieuHomNay(brandSlug: string): Promise<{ id: string; code: string } | null> {
  const [r] = await db.select({ id: schema.goodsReceipts.id, code: schema.goodsReceipts.code })
    .from(schema.goodsReceipts)
    .where(and(
      eq(schema.goodsReceipts.sourceType, 'retail_for_order'),
      eq(schema.goodsReceipts.vendor, brandSlug),
      sql`(${schema.goodsReceipts.receivedAt} AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Bangkok')::date = (now() AT TIME ZONE 'Asia/Bangkok')::date`,
    ))
    .orderBy(desc(schema.goodsReceipts.createdAt)).limit(1);
  return r ?? null;
}

export async function getMonTheoUnitCode(unitCode: string) {
  const [r] = await db.select({
    id: schema.goodsReceiptItems.id, receiptId: schema.goodsReceiptItems.receiptId,
    fulfillmentLineId: schema.goodsReceiptItems.fulfillmentLineId, confirmedAt: schema.goodsReceiptItems.confirmedAt,
  }).from(schema.goodsReceiptItems).where(eq(schema.goodsReceiptItems.unitCode, unitCode)).limit(1);
  return r ?? null;
}

export async function listMonTrongPhieu(receiptId: string) {
  return db.select({
    id: schema.goodsReceiptItems.id, unitCode: schema.goodsReceiptItems.unitCode,
    sku: schema.goodsReceiptItems.sku, productTitle: schema.goodsReceiptItems.productTitle, variantTitle: schema.goodsReceiptItems.variantTitle,
    fulfillmentLineId: schema.goodsReceiptItems.fulfillmentLineId,
    orderNumber: schema.shopifyOrders.shopifyOrderNumber,
    printedAt: schema.goodsReceiptItems.printedAt, confirmedAt: schema.goodsReceiptItems.confirmedAt,
    unplanned: schema.goodsReceiptItems.unplanned,
  })
    .from(schema.goodsReceiptItems)
    .leftJoin(schema.shopifyOrders, eq(schema.shopifyOrders.id, schema.goodsReceiptItems.orderId))
    .where(eq(schema.goodsReceiptItems.receiptId, receiptId))
    .orderBy(schema.goodsReceiptItems.unitCode);
}
```

- [ ] **Step 2: Kiểm kiểu + chạy thử một truy vấn**

Run: `npx tsc --noEmit`
Run thử (script tạm trong scratchpad, không commit):

```bash
npx dotenv -- npx tsx -e "import('./features/receiving/nhan-nhanh-queries').then(async m => { console.log(await m.listBrandDangCho()); process.exit(0); })"
```
Expected: danh sách brand có `soDong > 0`, không lỗi SQL.

- [ ] **Step 3: Commit**

```bash
git add features/receiving/nhan-nhanh-queries.ts
git commit -m "feat(receiving): truy vấn brand/dòng chờ kèm số đã in, đã xác nhận"
```

---

### Task 6: Ghi ngày nhận nguồn SMS + `syncBrandReceived` chỉ lấp chỗ trống

**Files:**
- Create: `features/receiving/ghi-nhan-hang.ts`
- Modify: `features/lark/sync-brand-received.ts:31-38`, `scripts/cron/sync-lark.ts` (đổi tên trường log `upserted` → `inserted`; `app/api/cron/sync-lark/route.ts` chỉ giữ cả object, không đọc trường này)

**Interfaces:**
- Produces:
  ```ts
  export async function ghiNhanHangTrongTx(tx: Tx, d: { orderNumber: string; sku: string; vendor: string | null }): Promise<void>;
  // sync-brand-received.ts
  export interface BrandReceivedSyncResult { fetched: number; inserted: number }
  ```

- [ ] **Step 1: Viết `ghi-nhan-hang.ts`**

```ts
import { sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Kho quét đủ chiếc một dòng → ghi ngày nhận vào mmp_line_received (nguồn cho
 * receivedAt trong payload MMP — công nợ theo kỳ nhận). source='sms' GHI ĐÈ dòng
 * 'lark'/'estimate_fulfill' cũ vì SMS là nguồn sự thật (spec §2.7); lark_pushed_at
 * về NULL để cron đẩy lại lên bảng Lark với Mã món mới.
 * Khoá theo (order_number BARE, sku) — đúng khoá bảng Lark đang dùng.
 */
export async function ghiNhanHangTrongTx(tx: Tx, d: { orderNumber: string; sku: string; vendor: string | null }): Promise<void> {
  const bare = d.orderNumber.trim().replace(/^#/, '');
  await tx.insert(schema.mmpLineReceived)
    .values({ orderNumber: bare, sku: d.sku, receivedAt: sql`now()`, vendor: d.vendor, source: 'sms', larkPushedAt: null, updatedAt: sql`now()` })
    .onConflictDoUpdate({
      target: [schema.mmpLineReceived.orderNumber, schema.mmpLineReceived.sku],
      set: { receivedAt: sql`now()`, vendor: d.vendor, source: 'sms', larkPushedAt: null, updatedAt: sql`now()` },
    });
}
```

- [ ] **Step 2: Đổi `syncBrandReceived` sang chỉ chèn**

Thay khối `for (let i = 0; ...)` trong `features/lark/sync-brand-received.ts` bằng:

```ts
  // CHỈ LẤP CHỖ TRỐNG (spec §5.3): dòng đã có — dù nguồn 'lark' cũ hay 'sms' do kho
  // quét — KHÔNG ghi đè. Từ 09/2026 SMS là nguồn sự thật cho "MEAN đã nhận";
  // Lark chỉ còn bù cho đơn kho chưa quét trên SMS.
  let inserted = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const batch = rows.slice(i, i + CHUNK);
    const ins = await db.insert(schema.mmpLineReceived)
      .values(batch.map((b) => ({ orderNumber: b.orderNumber, sku: b.sku, receivedAt: b.receivedAt, vendor: b.vendor, updatedAt: new Date() })))
      .onConflictDoNothing({ target: [schema.mmpLineReceived.orderNumber, schema.mmpLineReceived.sku] })
      .returning({ id: schema.mmpLineReceived.id });
    inserted += ins.length;
  }
  return { fetched: records.length, inserted };
```

Đổi interface thành `export interface BrandReceivedSyncResult { fetched: number; inserted: number }`; sửa dòng log trong `scripts/cron/sync-lark.ts` thành `brand-received: fetched ${br.fetched}, inserted ${br.inserted}`. Cập nhật docstring đầu file: "Idempotent (chỉ chèn khi chưa có; không ghi đè)".

- [ ] **Step 3: Kiểm**

Run: `npx tsc --noEmit && npx vitest run features/lark`
Expected: sạch.

- [ ] **Step 4: Commit**

```bash
git add features/receiving/ghi-nhan-hang.ts features/lark/sync-brand-received.ts scripts/cron/sync-lark.ts
git commit -m "feat(receiving): ghi ngày nhận nguồn sms; sync Lark→SMS chỉ lấp chỗ trống"
```

---

### Task 7: Lark client tạo/sửa record bảng nhận hàng + luật đẩy (`push-nhan-hang.ts`)

**Files:**
- Modify: `features/lark/client.ts:82-104` (tổng quát hoá PUT; thêm POST; sửa docstring "đường ghi duy nhất")
- Create: `features/lark/push-nhan-hang.ts`
- Test: `features/lark/push-nhan-hang.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // client.ts
  export async function createBrandReceivedRecord(fields: Record<string, unknown>): Promise<string>; // record_id
  export async function updateBrandReceivedRecordFields(recordId: string, fields: Record<string, unknown>): Promise<void>;
  // push-nhan-hang.ts
  export const COT_SO_DON = 'order_number'; export const COT_SKU = 'Lineitem SKU'; export const COT_VENDOR = 'vendor';
  export const COT_NGAY_NHAN = 'Visible - WH-Ngày MEAN nhận hàng gần nhất'; export const COT_MA_MON = 'Mã món';
  export interface DongNhanHang { orderNumber: string; sku: string; vendor: string | null; receivedAt: Date; maMon: string[] }
  export function dungFieldsNhanHang(d: DongNhanHang): Record<string, unknown>;
  export interface KetQuaDongBoNhanHang { doiChieu: number; daTao: number; daDien: number; boQua: number; loi: string[] }
  export async function dongBoNhanHangLark(dongs: DongNhanHang[], docRecords, taoRecord, capNhat): Promise<KetQuaDongBoNhanHang>;
  ```

- [ ] **Step 1: Viết test cho module thuần**

```ts
import { describe, it, expect, vi } from 'vitest';
import { dongBoNhanHangLark, dungFieldsNhanHang, COT_MA_MON, COT_NGAY_NHAN, COT_SKU, COT_SO_DON, COT_VENDOR } from './push-nhan-hang';

const d = (maMon: string[] = ['WH-00000001', 'WH-00000002']) => ({
  orderNumber: 'TA2331', sku: 'AO-X-XL', vendor: 'TINH', receivedAt: new Date('2026-09-06T03:00:00Z'), maMon,
});
const rec = (id: string, so: string, sku: string, extra: Record<string, unknown> = {}) => ({
  record_id: id, fields: { [COT_SO_DON]: so, [COT_SKU]: sku, ...extra },
});

describe('dungFieldsNhanHang', () => {
  it('đủ 5 cột; ngày là epoch ms; Mã món nối bằng " | "', () => {
    expect(dungFieldsNhanHang(d())).toEqual({
      [COT_SO_DON]: 'TA2331', [COT_SKU]: 'AO-X-XL', [COT_VENDOR]: 'TINH',
      [COT_NGAY_NHAN]: Date.parse('2026-09-06T03:00:00Z'), [COT_MA_MON]: 'WH-00000001 | WH-00000002',
    });
  });
});

describe('dongBoNhanHangLark', () => {
  it('chưa có dòng → tạo mới', async () => {
    const tao = vi.fn().mockResolvedValue('r-new'); const sua = vi.fn();
    const kq = await dongBoNhanHangLark([d()], async () => [], tao, sua);
    expect(kq).toEqual({ doiChieu: 1, daTao: 1, daDien: 0, boQua: 0, loi: [] });
    expect(tao).toHaveBeenCalledWith(dungFieldsNhanHang(d()));
    expect(sua).not.toHaveBeenCalled();
  });
  it('đã có dòng, Mã món trống → điền Mã món (không đụng ngày ops đã ghi)', async () => {
    const tao = vi.fn(); const sua = vi.fn().mockResolvedValue(undefined);
    const kq = await dongBoNhanHangLark([d()], async () => [rec('r1', '#TA2331', 'AO-X-XL', { [COT_NGAY_NHAN]: 1 })], tao, sua);
    expect(kq.daDien).toBe(1); expect(kq.daTao).toBe(0);
    expect(sua).toHaveBeenCalledWith('r1', { [COT_MA_MON]: 'WH-00000001 | WH-00000002' });
  });
  it('đã có dòng và Mã món đã có → bỏ qua, KHÔNG ghi đè', async () => {
    const tao = vi.fn(); const sua = vi.fn();
    const kq = await dongBoNhanHangLark([d()], async () => [rec('r1', 'TA2331', 'AO-X-XL', { [COT_MA_MON]: 'WH-00000009' })], tao, sua);
    expect(kq.boQua).toBe(1); expect(sua).not.toHaveBeenCalled(); expect(tao).not.toHaveBeenCalled();
  });
  it('khớp order bỏ dấu # và trim, đọc được order_number dạng rich-text', async () => {
    const tao = vi.fn(); const sua = vi.fn().mockResolvedValue(undefined);
    await dongBoNhanHangLark([d()], async () => [rec('r1', ' #TA2331 ', 'AO-X-XL'), { record_id: 'r2', fields: { [COT_SO_DON]: [{ text: 'TA2331' }], [COT_SKU]: [{ text: 'AO-X-XL' }] } }], tao, sua);
    expect(sua).toHaveBeenCalledTimes(2);
  });
  it('Lark ném lỗi → ghi vào loi, không ném ra ngoài', async () => {
    const tao = vi.fn().mockRejectedValue(new Error('403')); const sua = vi.fn();
    const kq = await dongBoNhanHangLark([d()], async () => [], tao, sua);
    expect(kq.loi).toEqual(['TA2331 AO-X-XL: 403']); expect(kq.daTao).toBe(0);
  });
});
```

- [ ] **Step 2: Chạy test, mong thất bại**

Run: `npx vitest run features/lark/push-nhan-hang.test.ts`
Expected: FAIL — module chưa tồn tại.

- [ ] **Step 3: Viết `push-nhan-hang.ts`**

```ts
import { larkText } from './parse-pack-row';

/** Tên cột bảng Lark "WH ngày MEAN nhận hàng". Đổi tên cột bên Lark là hỏng — để MỘT chỗ. */
export const COT_SO_DON = 'order_number';
export const COT_SKU = 'Lineitem SKU';
export const COT_VENDOR = 'vendor';
export const COT_NGAY_NHAN = 'Visible - WH-Ngày MEAN nhận hàng gần nhất';
/** Cột MỚI do ops tạo (kiểu Text) — spec §5.2. Chưa có cột này thì Lark trả lỗi field không tồn tại → rơi vào `loi`. */
export const COT_MA_MON = 'Mã món';

export interface DongNhanHang {
  orderNumber: string; sku: string; vendor: string | null; receivedAt: Date;
  /** Mã WH- các món đã xác nhận của dòng. */
  maMon: string[];
}

export function dungFieldsNhanHang(d: DongNhanHang): Record<string, unknown> {
  return {
    [COT_SO_DON]: d.orderNumber.trim().replace(/^#/, ''),
    [COT_SKU]: d.sku,
    [COT_VENDOR]: d.vendor,
    [COT_NGAY_NHAN]: d.receivedAt.getTime(),
    [COT_MA_MON]: d.maMon.join(' | '),
  };
}

export interface KetQuaDongBoNhanHang {
  /** Dòng SMS đem đi đối chiếu. */
  doiChieu: number;
  /** Lark chưa có → tạo mới. */
  daTao: number;
  /** Lark đã có, ô Mã món trống → điền. */
  daDien: number;
  /** Lark đã có Mã món → bỏ qua, KHÔNG ghi đè (ops có thể đã sửa tay). */
  boQua: number;
  loi: string[];
}

function khoa(orderNumber: string | null, sku: string | null): string | null {
  const so = orderNumber?.trim().replace(/^#/, '');
  const s = sku?.trim();
  return so && s ? `${so} ${s}` : null;
}

/**
 * Đẩy "MEAN đã nhận" từ SMS lên bảng Lark, cùng luật với cột Couriers (D-045):
 * tạo khi chưa có, CHỈ ĐIỀN Ô TRỐNG khi đã có, không ghi đè giá trị người đã ghi.
 * Hàm tiêm để test thuần; KHÔNG ném lỗi ra ngoài — kho đã quét xong rồi, Lark
 * hỏng thì cron điền bù, không được làm hỏng thao tác nhận.
 */
export async function dongBoNhanHangLark(
  dongs: DongNhanHang[],
  docRecords: () => Promise<Array<{ record_id: string; fields: Record<string, unknown> }>>,
  taoRecord: (fields: Record<string, unknown>) => Promise<string>,
  capNhat: (recordId: string, fields: Record<string, unknown>) => Promise<void>,
): Promise<KetQuaDongBoNhanHang> {
  const kq: KetQuaDongBoNhanHang = { doiChieu: dongs.length, daTao: 0, daDien: 0, boQua: 0, loi: [] };
  if (dongs.length === 0) return kq;
  const recs = await docRecords();
  const theoKhoa = new Map<string, Array<{ record_id: string; fields: Record<string, unknown> }>>();
  for (const r of recs) {
    const k = khoa(larkText(r.fields[COT_SO_DON]), larkText(r.fields[COT_SKU]));
    if (!k) continue;
    const arr = theoKhoa.get(k) ?? [];
    arr.push(r); theoKhoa.set(k, arr);
  }
  for (const d of dongs) {
    const k = khoa(d.orderNumber, d.sku)!;
    const nhan = `${k}`;
    try {
      const co = theoKhoa.get(k);
      if (!co || co.length === 0) { await taoRecord(dungFieldsNhanHang(d)); kq.daTao += 1; continue; }
      for (const r of co) {
        const hienTai = larkText(r.fields[COT_MA_MON]);
        if (hienTai && hienTai.trim() !== '') { kq.boQua += 1; continue; }
        await capNhat(r.record_id, { [COT_MA_MON]: d.maMon.join(' | ') });
        kq.daDien += 1;
      }
    } catch (e) {
      kq.loi.push(`${nhan}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return kq;
}
```

`larkText(v: unknown): string | null` (`features/lark/parse-pack-row.ts:22`) trả `null` cho trường thiếu/rỗng và đọc được cả chuỗi lẫn mảng rich-text — đúng điều `khoa()` cần.

- [ ] **Step 4: Thêm hai hàm ghi vào `client.ts`**

Thay `updateLogRecordFields` (dòng 82–104) bằng khối sau (giữ chữ ký cũ, thêm hai hàm mới):

```ts
async function putRecord(appToken: string, tableId: string, recordId: string, fields: Record<string, unknown>): Promise<void> {
  const token = await getTenantToken();
  const url = `${DOMAIN}/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records/${recordId}`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
    signal: AbortSignal.timeout(30_000),
  });
  const j = (await res.json()) as { code: number; msg: string };
  if (j.code !== 0) throw new Error(`[lark] update fail: code=${j.code} msg=${j.msg}`);
}

async function postRecord(appToken: string, tableId: string, fields: Record<string, unknown>): Promise<string> {
  const token = await getTenantToken();
  const url = `${DOMAIN}/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
    signal: AbortSignal.timeout(30_000),
  });
  const j = (await res.json()) as { code: number; msg: string; data?: { record?: { record_id?: string } } };
  if (j.code !== 0 || !j.data?.record?.record_id) throw new Error(`[lark] create fail: code=${j.code} msg=${j.msg}`);
  return j.data.record.record_id;
}

/**
 * GHI đè vài trường của MỘT record bảng logistics.
 *
 * Đường ghi vào Lark giữ HẸP có chủ đích: chỉ record_id + đúng trường cần đổi,
 * không có API xoá, để một lỗi lập trình không thể quét sạch bảng vận hành.
 * Từ 09/2026 có thêm bảng "WH ngày MEAN nhận hàng" (hai hàm dưới) — vẫn chỉ
 * sửa/tạo từng record, không xoá.
 */
export async function updateLogRecordFields(recordId: string, fields: Record<string, unknown>): Promise<void> {
  return putRecord(env('LARK_BASE_APP_TOKEN'), logTableId(), recordId, fields);
}

/** Sửa vài trường của một record bảng "WH ngày MEAN nhận hàng". */
export async function updateBrandReceivedRecordFields(recordId: string, fields: Record<string, unknown>): Promise<void> {
  return putRecord(BRAND_RECV_APP_TOKEN, BRAND_RECV_TABLE_ID, recordId, fields);
}

/** Tạo MỘT record bảng "WH ngày MEAN nhận hàng". Trả record_id. */
export async function createBrandReceivedRecord(fields: Record<string, unknown>): Promise<string> {
  return postRecord(BRAND_RECV_APP_TOKEN, BRAND_RECV_TABLE_ID, fields);
}
```

`BRAND_RECV_APP_TOKEN` / `BRAND_RECV_TABLE_ID` hiện khai ở dòng 119–120, SAU vị trí này — chuyển hai `const` đó lên ngay dưới `logTableId()` (dòng ~19) để dùng được ở đây.

- [ ] **Step 5: Chạy test + tsc**

Run: `npx vitest run features/lark && npx tsc --noEmit`
Expected: PASS toàn bộ (kể cả `push-courier.test.ts` cũ).

- [ ] **Step 6: Commit**

```bash
git add features/lark/client.ts features/lark/push-nhan-hang.ts features/lark/push-nhan-hang.test.ts
git commit -m "feat(lark): tạo/sửa record bảng nhận hàng; luật đẩy Mã món chỉ điền ô trống"
```

---

### Task 8: Điền bù Lark trong cron `sync-lark` + khoá job

**Files:**
- Create: `features/lark/nhan-hang-backfill.ts`
- Modify: `features/jobs/registry.ts:72-73` (thêm entry trước `prune-logs`), `scripts/cron/sync-lark.ts` (gọi thêm)

**Interfaces:**
- Consumes: `dongBoNhanHangLark`, `listBrandReceivedRecords`, `createBrandReceivedRecord`, `updateBrandReceivedRecordFields` (Task 7); `mmpLineReceived.larkPushedAt` (Task 1).
- Produces: `export async function backfillNhanHangLark(): Promise<KetQuaDongBoNhanHang & { skipped?: 'env' }>`; khoá job `'push-nhan-hang'`.

- [ ] **Step 1: Viết `nhan-hang-backfill.ts`**

```ts
import { and, eq, isNull, isNotNull, sql, inArray } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { listBrandReceivedRecords, createBrandReceivedRecord, updateBrandReceivedRecordFields } from './client';
import { dongBoNhanHangLark, type DongNhanHang, type KetQuaDongBoNhanHang } from './push-nhan-hang';

/** Bật đẩy khi ops đã tạo cột "Mã món" trên Lark (spec §5.2). Chưa bật → không gọi Lark. */
export function batDayNhanHang(): boolean {
  return process.env.LARK_NHAN_HANG_PUSH === '1';
}

/**
 * Điền bù bảng Lark "WH ngày MEAN nhận hàng" cho dòng kho đã quét trên SMS
 * (source='sms') mà chưa đẩy (lark_pushed_at NULL). Chạy theo nhịp sync-lark.
 * Đẩy được thì đóng dấu lark_pushed_at; lỗi thì để NULL cho lượt sau.
 */
export async function backfillNhanHangLark(): Promise<KetQuaDongBoNhanHang & { skipped?: 'env' }> {
  if (!batDayNhanHang()) return { doiChieu: 0, daTao: 0, daDien: 0, boQua: 0, loi: [], skipped: 'env' };
  const cho = await db.select({
    id: schema.mmpLineReceived.id, orderNumber: schema.mmpLineReceived.orderNumber, sku: schema.mmpLineReceived.sku,
    vendor: schema.mmpLineReceived.vendor, receivedAt: schema.mmpLineReceived.receivedAt,
  }).from(schema.mmpLineReceived)
    .where(and(eq(schema.mmpLineReceived.source, 'sms'), isNull(schema.mmpLineReceived.larkPushedAt)))
    .limit(500);
  if (cho.length === 0) return { doiChieu: 0, daTao: 0, daDien: 0, boQua: 0, loi: [] };

  // Mã món đã xác nhận của từng (order bare, sku) — nối qua orders.shopify_order_number.
  const mon = await db.select({
    orderNumber: sql<string>`ltrim(${schema.shopifyOrders.shopifyOrderNumber}, '#')`,
    sku: schema.goodsReceiptItems.sku, unitCode: schema.goodsReceiptItems.unitCode,
  }).from(schema.goodsReceiptItems)
    .innerJoin(schema.shopifyOrders, eq(schema.shopifyOrders.id, schema.goodsReceiptItems.orderId))
    .where(and(
      isNotNull(schema.goodsReceiptItems.confirmedAt),
      inArray(sql`ltrim(${schema.shopifyOrders.shopifyOrderNumber}, '#')`, [...new Set(cho.map((c) => c.orderNumber))]),
    ))
    .orderBy(schema.goodsReceiptItems.unitCode);
  const maTheoKhoa = new Map<string, string[]>();
  for (const m of mon) {
    if (!m.sku) continue;
    const k = `${m.orderNumber} ${m.sku}`;
    maTheoKhoa.set(k, [...(maTheoKhoa.get(k) ?? []), m.unitCode]);
  }
  const dongs: DongNhanHang[] = cho.map((c) => ({
    orderNumber: c.orderNumber, sku: c.sku, vendor: c.vendor,
    receivedAt: c.receivedAt instanceof Date ? c.receivedAt : new Date(c.receivedAt as unknown as string),
    maMon: maTheoKhoa.get(`${c.orderNumber} ${c.sku}`) ?? [],
  }));
  const kq = await dongBoNhanHangLark(dongs, listBrandReceivedRecords, createBrandReceivedRecord, updateBrandReceivedRecordFields);
  // Đóng dấu những dòng KHÔNG nằm trong danh sách lỗi.
  const loiKhoa = new Set(kq.loi.map((l) => l.split(':')[0]));
  const xong = cho.filter((c) => !loiKhoa.has(`${c.orderNumber} ${c.sku}`)).map((c) => c.id);
  if (xong.length) {
    await db.update(schema.mmpLineReceived).set({ larkPushedAt: sql`now()` }).where(inArray(schema.mmpLineReceived.id, xong));
  }
  return kq;
}
```

- [ ] **Step 2: Thêm khoá vào `JOB_REGISTRY`** — chèn TRƯỚC entry `prune-logs`:

```ts
  { key: 'push-nhan-hang', ten: 'Đẩy "MEAN đã nhận" + Mã món lên Lark', chuKyPhut: 1 * GIO,
    hauQua: 'QC/đóng gói trên Lark không thấy món đã về, MMP thiếu ngày nhận' },
```

- [ ] **Step 3: Gọi trong `scripts/cron/sync-lark.ts`** — thêm import và đoạn cuối `main()` (sau khối courier→lark):

```ts
import { chayCron, chayMotJob } from '@/features/jobs/run';
import { backfillNhanHangLark } from '@/features/lark/nhan-hang-backfill';
```

```ts
  // "MEAN đã nhận" từ kho quét trên SMS → bảng Lark WH (kèm Mã món). Gác env
  // LARK_NHAN_HANG_PUSH tới khi ops tạo cột "Mã món". Nhật ký riêng để trang
  // giám sát thấy nó chạy hay không.
  await chayMotJob('push-nhan-hang', backfillNhanHangLark);
```

- [ ] **Step 4: Kiểm**

Run: `npx tsc --noEmit && npx vitest run features/jobs features/lark`
Expected: PASS (test `run.test.ts` vẫn nhận `sync-lark` là khoá hợp lệ; `groups.test`/`registry` không lỗi).

- [ ] **Step 5: Commit**

```bash
git add features/lark/nhan-hang-backfill.ts features/jobs/registry.ts scripts/cron/sync-lark.ts
git commit -m "feat(lark): điền bù 'MEAN đã nhận' + Mã món theo nhịp sync-lark (job push-nhan-hang)"
```

---

### Task 9: Server action màn nhập kho nhanh (`nhan-nhanh-actions.ts`)

**Files:**
- Create: `features/receiving/nhan-nhanh-actions.ts`

**Interfaces:**
- Consumes: Task 2–8.
- Produces (tất cả `async`, file `'use server'`):
  ```ts
  export async function layBrandDangCho(): Promise<BrandDangCho[]>;
  export async function layDongCho(brandSlug: string): Promise<DongCho[]>;
  export async function layDongTheoMaQuet(maQuet: string): Promise<{ ok: true; dong: DongCho } | { ok: false; loi: string }>;
  export async function moPhieuBrand(brandSlug: string): Promise<{ id: string; code: string }>;
  export async function inTemMon(i: { receiptId: string; lineId: string; soLuong: number }): Promise<{ maTheoDon: string[]; maNgoaiKeHoach: string[] }>;
  export async function nhanNgoaiKeHoach(i: { receiptId: string; sku: string | null; productTitle: string | null; soLuong: number }): Promise<{ ma: string[] }>;
  export type KetQuaQuet = { ok: true; unitCode: string; lineId: string | null; daXacNhan: number; mongDoi: number; duChiec: boolean } | { ok: false; lyDo: LyDoTuChoi };
  export async function xacNhanQuet(i: { receiptId: string; maQuet: string }): Promise<KetQuaQuet>;
  export async function layMonTrongPhieu(receiptId: string): ReturnType<typeof listMonTrongPhieu>;
  ```

- [ ] **Step 1: Viết module**

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { recomputeRollup } from '@/features/fulfillment/rollup';
import { recordAudit } from '@/lib/logging/audit';
import { requirePerm, withUniqueRetry } from './perm';
import { taoMonTrongTx } from './tao-mon';
import { createReceipt } from './actions';
import { docMaTem } from './ma-tem';
import { soTemDuocIn, phanLoaiQuet, duChiec, type LyDoTuChoi } from './nhan-nhanh-logic';
import { ghiNhanHangTrongTx } from './ghi-nhan-hang';
import {
  listBrandDangCho, listDongCho, getDongTheoShopifyLineId, getDongTheoId, getPhieuHomNay,
  getMonTheoUnitCode, listMonTrongPhieu, type BrandDangCho, type DongCho,
} from './nhan-nhanh-queries';
import { batDayNhanHang } from '@/features/lark/nhan-hang-backfill';
import { dongBoNhanHangLark } from '@/features/lark/push-nhan-hang';
import { listBrandReceivedRecords, createBrandReceivedRecord, updateBrandReceivedRecordFields } from '@/features/lark/client';

export async function layBrandDangCho(): Promise<BrandDangCho[]> {
  await requirePerm('view_receiving');
  return listBrandDangCho();
}

export async function layDongCho(brandSlug: string): Promise<DongCho[]> {
  await requirePerm('view_receiving');
  return listDongCho(brandSlug);
}

/** Quét tem brand `L:<id>` ở bước 2 → dòng đơn. Quét tem món ở đây là nhầm chỗ. */
export async function layDongTheoMaQuet(maQuet: string): Promise<{ ok: true; dong: DongCho } | { ok: false; loi: string }> {
  await requirePerm('view_receiving');
  const ma = docMaTem(maQuet);
  if (!ma) return { ok: false, loi: 'Mã không đúng dạng tem (WH-… hoặc L:…)' };
  if (ma.loai === 'mon') return { ok: false, loi: 'Đây là tem món — quét ở bước xác nhận' };
  const dong = await getDongTheoShopifyLineId(ma.shopifyLineId);
  if (!dong) return { ok: false, loi: `Không có dòng đơn nào mang Line ID ${ma.shopifyLineId}` };
  return { ok: true, dong };
}

/** Một kiện về = một phiếu: mở phiếu retail_for_order hôm nay của brand, chưa có thì tạo. */
export async function moPhieuBrand(brandSlug: string): Promise<{ id: string; code: string }> {
  await requirePerm('manage_receiving');
  const co = await getPhieuHomNay(brandSlug);
  if (co) return co;
  const id = await createReceipt({ sourceType: 'retail_for_order', vendor: brandSlug, note: 'Nhập kho quét mã' });
  const [row] = await db.select({ code: schema.goodsReceipts.code }).from(schema.goodsReceipts).where(eq(schema.goodsReceipts.id, id)).limit(1);
  return { id, code: row.code };
}

/** Bấm "In N tem": tạo N món (đã in, chưa xác nhận). Phần vượt mong đợi → ngoài kế hoạch (spec §3.1). */
export async function inTemMon(i: { receiptId: string; lineId: string; soLuong: number }): Promise<{ maTheoDon: string[]; maNgoaiKeHoach: string[] }> {
  const userId = await requirePerm('manage_receiving');
  const dong = await getDongTheoId(i.lineId);
  if (!dong) throw new Error('Dòng đơn không tồn tại');
  const { theoDon, ngoaiKeHoach } = soTemDuocIn({ mongDoi: dong.mongDoi, daIn: dong.daIn, daXacNhan: dong.daXacNhan }, i.soLuong);
  const maTheoDon: string[] = []; const maNgoaiKeHoach: string[] = [];
  const chung = { receiptId: i.receiptId, sku: dong.sku, productTitle: dong.productTitle, variantTitle: dong.variantTitle, printedAt: 'now' as const };
  for (let k = 0; k < theoDon; k++) {
    const { unitCode } = await withUniqueRetry(() => db.transaction((tx) => taoMonTrongTx(tx, {
      ...chung, brandRequestId: dong.brandRequestId, fulfillmentLineId: dong.lineId, orderId: dong.orderId,
    })));
    maTheoDon.push(unitCode);
  }
  for (let k = 0; k < ngoaiKeHoach; k++) {
    const { unitCode } = await withUniqueRetry(() => db.transaction((tx) => taoMonTrongTx(tx, { ...chung, unplanned: true })));
    maNgoaiKeHoach.push(unitCode);
  }
  try { await recordAudit({ userId, action: 'receiving_print_labels', target: i.receiptId, requestSummary: `${dong.orderNumber ?? ''} ${dong.sku ?? ''} ×${theoDon}+${ngoaiKeHoach}`, result: 'success' }); } catch (e) { console.error('audit failed', e); }
  revalidatePath(`/f/warehouse/receiving/${i.receiptId}`);
  return { maTheoDon, maNgoaiKeHoach };
}

/** Hàng không có trong danh sách chờ: in tem, cờ vàng, không nối dòng đơn. */
export async function nhanNgoaiKeHoach(i: { receiptId: string; sku: string | null; productTitle: string | null; soLuong: number }): Promise<{ ma: string[] }> {
  const userId = await requirePerm('manage_receiving');
  const n = Math.max(0, Math.min(50, Math.floor(i.soLuong)));
  const ma: string[] = [];
  for (let k = 0; k < n; k++) {
    const { unitCode } = await withUniqueRetry(() => db.transaction((tx) => taoMonTrongTx(tx, {
      receiptId: i.receiptId, sku: i.sku, productTitle: i.productTitle, printedAt: 'now', unplanned: true,
    })));
    ma.push(unitCode);
  }
  try { await recordAudit({ userId, action: 'receiving_unplanned', target: i.receiptId, requestSummary: `${i.sku ?? i.productTitle ?? '?'} ×${n}`, result: 'success' }); } catch (e) { console.error('audit failed', e); }
  revalidatePath(`/f/warehouse/receiving/${i.receiptId}`);
  return { ma };
}

export type KetQuaQuet =
  | { ok: true; unitCode: string; lineId: string | null; daXacNhan: number; mongDoi: number; duChiec: boolean }
  | { ok: false; lyDo: LyDoTuChoi };

/**
 * Quét xác nhận tem đã dán. Chỉ ghi khi 'khop'. Đủ chiếc → delivered_at, dòng
 * brand_confirmed → in_stock, ngày nhận cho MMP, đẩy Lark (best-effort).
 */
export async function xacNhanQuet(i: { receiptId: string; maQuet: string }): Promise<KetQuaQuet> {
  const userId = await requirePerm('manage_receiving');
  const ma = docMaTem(i.maQuet);
  if (!ma || ma.loai !== 'mon') return { ok: false, lyDo: 'khong_phai_tem_mon' };
  const mon = await getMonTheoUnitCode(ma.unitCode);
  const pl = phanLoaiQuet(mon, i.receiptId);
  if (pl !== 'khop' || !mon) return { ok: false, lyDo: pl === 'khop' ? 'khong_ton_tai' : pl };

  const kq = await db.transaction(async (tx) => {
    // Idempotent: hai người quét cùng tem thì chỉ một người ghi được.
    const up = await tx.update(schema.goodsReceiptItems).set({ confirmedAt: sql`now()` })
      .where(and(eq(schema.goodsReceiptItems.id, mon.id), isNull(schema.goodsReceiptItems.confirmedAt)))
      .returning({ id: schema.goodsReceiptItems.id });
    if (up.length === 0) return { ok: false as const, lyDo: 'da_xac_nhan' as const };
    if (!mon.fulfillmentLineId) return { ok: true as const, unitCode: ma.unitCode, lineId: null, daXacNhan: 0, mongDoi: 0, duChiec: false, chot: null };

    const [line] = await tx.select({
      id: schema.orderFulfillmentLines.id, fulfillmentId: schema.orderFulfillmentLines.fulfillmentId,
      status: schema.orderFulfillmentLines.status, qty: schema.orderFulfillmentLines.qty, sku: schema.orderFulfillmentLines.sku,
    }).from(schema.orderFulfillmentLines).where(eq(schema.orderFulfillmentLines.id, mon.fulfillmentLineId)).limit(1);
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(schema.goodsReceiptItems)
      .where(and(eq(schema.goodsReceiptItems.fulfillmentLineId, line.id), sql`${schema.goodsReceiptItems.confirmedAt} is not null`));
    const dem = { mongDoi: line.qty, daIn: 0, daXacNhan: n };
    if (!duChiec(dem)) return { ok: true as const, unitCode: ma.unitCode, lineId: line.id, daXacNhan: n, mongDoi: line.qty, duChiec: false, chot: null };

    // ĐỦ CHIẾC → chốt (spec §3 bước 4, §5.1).
    if (line.status === 'brand_confirmed') {
      await tx.update(schema.orderFulfillmentLines).set({ status: 'in_stock', allocatedQty: 0, updatedAt: sql`now()` })
        .where(eq(schema.orderFulfillmentLines.id, line.id));
      await tx.insert(schema.orderFulfillmentEvents).values({
        fulfillmentId: line.fulfillmentId, lineId: line.id, fromStatus: 'brand_confirmed', toStatus: 'in_stock',
        actor: userId, note: `Nhận hàng quét mã, đủ ${n}/${line.qty}`,
      });
      await recomputeRollup(tx, line.fulfillmentId);
    }
    await tx.update(schema.brandOrderRequests).set({ deliveredAt: sql`now()`, updatedAt: sql`now()` })
      .where(and(eq(schema.brandOrderRequests.fulfillmentLineId, line.id), isNull(schema.brandOrderRequests.deliveredAt)));
    const [ctx] = await tx.select({
      orderNumber: schema.shopifyOrders.shopifyOrderNumber, vendor: schema.brandOrderRequests.brandSlug,
    }).from(schema.brandOrderRequests)
      .innerJoin(schema.shopifyOrders, eq(schema.shopifyOrders.id, schema.brandOrderRequests.orderId))
      .where(eq(schema.brandOrderRequests.fulfillmentLineId, line.id)).limit(1);
    if (ctx?.orderNumber && line.sku) await ghiNhanHangTrongTx(tx, { orderNumber: ctx.orderNumber, sku: line.sku, vendor: ctx.vendor });
    const maMon = await tx.select({ unitCode: schema.goodsReceiptItems.unitCode }).from(schema.goodsReceiptItems)
      .where(and(eq(schema.goodsReceiptItems.fulfillmentLineId, line.id), sql`${schema.goodsReceiptItems.confirmedAt} is not null`))
      .orderBy(schema.goodsReceiptItems.unitCode);
    return {
      ok: true as const, unitCode: ma.unitCode, lineId: line.id, daXacNhan: n, mongDoi: line.qty, duChiec: true,
      chot: ctx?.orderNumber && line.sku ? { orderNumber: ctx.orderNumber, sku: line.sku, vendor: ctx.vendor, maMon: maMon.map((m) => m.unitCode) } : null,
    };
  });

  if (kq.ok && kq.chot && batDayNhanHang()) {
    // Best-effort: Lark hỏng không chặn — cron push-nhan-hang điền bù theo lark_pushed_at.
    try {
      const r = await dongBoNhanHangLark([{ ...kq.chot, receivedAt: new Date() }], listBrandReceivedRecords, createBrandReceivedRecord, updateBrandReceivedRecordFields);
      if (r.loi.length === 0) {
        await db.update(schema.mmpLineReceived).set({ larkPushedAt: sql`now()` })
          .where(and(eq(schema.mmpLineReceived.orderNumber, kq.chot.orderNumber.replace(/^#/, '')), eq(schema.mmpLineReceived.sku, kq.chot.sku)));
      }
    } catch (e) { console.error('[nhan-hang] lark push failed', e); }
  }
  try { await recordAudit({ userId, action: 'receiving_confirm_scan', target: i.receiptId, requestSummary: ma.unitCode, result: kq.ok ? 'success' : 'error' }); } catch (e) { console.error('audit failed', e); }
  revalidatePath(`/f/warehouse/receiving/${i.receiptId}`);
  revalidatePath('/f/warehouse/receiving');
  if (!kq.ok) return kq;
  const { chot: _chot, ...ra } = kq;
  return ra;
}

export async function layMonTrongPhieu(receiptId: string) {
  await requirePerm('view_receiving');
  return listMonTrongPhieu(receiptId);
}
```

Lưu ý: file `'use server'` chỉ được export hàm async và `type` — KHÔNG export const/hàm đồng bộ. `createReceipt` đã có `note` trong `CreateReceiptInput` (actions.ts dòng 62).

- [ ] **Step 2: Kiểm**

Run: `npx tsc --noEmit && npm run build`
Expected: sạch (build bắt lỗi export sai trong file `'use server'` mà tsc không thấy).

- [ ] **Step 3: Commit**

```bash
git add features/receiving/nhan-nhanh-actions.ts
git commit -m "feat(receiving): server action mở phiếu, in tem, nhận ngoài kế hoạch, xác nhận quét"
```

---

### Task 10: Vẽ QR + trang in tem

**Files:**
- Modify: `package.json` (thêm `qrcode`, `@types/qrcode`, `@zxing/browser`)
- Create: `components/receiving/MaQR.tsx`, `components/receiving/TemGrid.tsx`, `app/(dashboard)/f/warehouse/receiving/tem/page.tsx`

**Interfaces:**
- Consumes: `chuTemMon`, `chuTemDong`, `maTemDong` (Task 2–3); `listMonTrongPhieu` không dùng — trang in tự truy vấn theo mã.
- Produces:
  ```ts
  // TemGrid.tsx
  export interface Tem { qr: string; chu: string; phu?: string }  // phu: dòng chữ nhỏ (mã)
  export function TemGrid({ tems, kho }: { tems: Tem[]; kho: '50x30' | 'a4' }): JSX.Element;
  ```
  URL: `/f/warehouse/receiving/tem?ma=WH-00000001,WH-00000002[&kho=a4]` hoặc `?dong=<fulfillmentLineId>,…`.

- [ ] **Step 1: Cài thư viện (ghim phiên bản)**

```bash
npm i qrcode@1.5.4 @zxing/browser@0.2.1 && npm i -D @types/qrcode@1.5.6
```

- [ ] **Step 2: `MaQR.tsx`**

```tsx
'use client';
import { useEffect, useRef } from 'react';
import QRCode from 'qrcode';

/** Vẽ QR lên canvas phía client — trang in không gọi API (spec §4). */
export function MaQR({ value, size = 96 }: { value: string; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    void QRCode.toCanvas(ref.current, value, { width: size, margin: 0, errorCorrectionLevel: 'M' });
  }, [value, size]);
  return <canvas ref={ref} width={size} height={size} aria-label={value} />;
}
```

- [ ] **Step 3: `TemGrid.tsx`**

```tsx
'use client';
import { MaQR } from './MaQR';

export interface Tem { qr: string; chu: string; phu?: string }

/**
 * Lưới tem in qua trình duyệt. '50x30' = mỗi tem một trang 50×30mm (máy in
 * nhiệt); 'a4' = 24 tem/trang (3 cột × 8 hàng, ô 70×37mm) cho máy in văn phòng.
 * Style nhúng tại chỗ để @page chỉ áp cho trang này.
 */
export function TemGrid({ tems, kho }: { tems: Tem[]; kho: '50x30' | 'a4' }) {
  const css = kho === 'a4'
    ? `@page { size: A4 portrait; margin: 0; }
       .tem-grid { display: grid; grid-template-columns: repeat(3, 70mm); grid-auto-rows: 37mm; justify-content: center; padding: 0; }
       .tem { width: 70mm; height: 37mm; padding: 3mm; box-sizing: border-box; page-break-inside: avoid; }`
    : `@page { size: 50mm 30mm; margin: 0; }
       .tem-grid { display: block; }
       .tem { width: 50mm; height: 30mm; padding: 2mm; box-sizing: border-box; page-break-after: always; }`;
  return (
    <div>
      <style>{`@media print { .no-print { display: none !important; } } ${css}
        .tem { display: flex; gap: 2mm; align-items: center; overflow: hidden; border: 0.2mm dashed #bbb; }
        .tem canvas { width: 24mm !important; height: 24mm !important; flex: none; }
        .tem .chu { font: 600 9pt/1.2 system-ui, sans-serif; word-break: break-word; }
        .tem .phu { font: 400 7.5pt/1.2 ui-monospace, monospace; color: #444; margin-top: 1mm; }`}</style>
      <div className="no-print flex items-center gap-3 p-3">
        <button type="button" onClick={() => window.print()} className="rounded-md bg-black px-4 py-2 text-sm text-white">In {tems.length} tem</button>
        <span className="text-sm text-muted-foreground">Khổ {kho === 'a4' ? 'A4 · 24 tem/trang' : '50×30mm · máy in nhiệt'}</span>
      </div>
      <div className="tem-grid">
        {tems.map((t) => (
          <div key={t.qr} className="tem">
            <MaQR value={t.qr} size={96} />
            <div>
              <div className="chu">{t.chu}</div>
              {t.phu && <div className="phu">{t.phu}</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Trang in `tem/page.tsx`** (server; `searchParams` là Promise trong Next 16 — đọc `07-mutating-data.md` và `03-api-reference/03-file-conventions/page.md` nếu cần)

```tsx
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { TemGrid, type Tem } from '@/components/receiving/TemGrid';
import { chuTemMon, chuTemDong } from '@/features/receiving/nhan-nhanh-logic';
import { maTemDong } from '@/features/receiving/ma-tem';

export const dynamic = 'force-dynamic';

function tach(v: string | string[] | undefined): string[] {
  const s = Array.isArray(v) ? v.join(',') : (v ?? '');
  return [...new Set(s.split(',').map((x) => x.trim()).filter(Boolean))].slice(0, 200);
}

/** Tem MÓN theo mã WH-: thứ tự i/n tính trong cùng dòng đơn (unit_code tăng dần). */
async function temMon(maList: string[]): Promise<Tem[]> {
  if (maList.length === 0) return [];
  const rows = await db.select({
    unitCode: schema.goodsReceiptItems.unitCode, productTitle: schema.goodsReceiptItems.productTitle, variantTitle: schema.goodsReceiptItems.variantTitle,
    lineId: schema.goodsReceiptItems.fulfillmentLineId, unplanned: schema.goodsReceiptItems.unplanned,
    orderNumber: schema.shopifyOrders.shopifyOrderNumber, brand: schema.brandOrderRequests.brandSlug,
    thuTu: sql<number>`row_number() over (partition by ${schema.goodsReceiptItems.fulfillmentLineId} order by ${schema.goodsReceiptItems.unitCode})::int`,
    tong: sql<number>`coalesce(${schema.orderFulfillmentLines.qty}, 1)`,
  }).from(schema.goodsReceiptItems)
    .leftJoin(schema.shopifyOrders, eq(schema.shopifyOrders.id, schema.goodsReceiptItems.orderId))
    .leftJoin(schema.brandOrderRequests, eq(schema.brandOrderRequests.id, schema.goodsReceiptItems.brandRequestId))
    .leftJoin(schema.orderFulfillmentLines, eq(schema.orderFulfillmentLines.id, schema.goodsReceiptItems.fulfillmentLineId))
    .where(inArray(schema.goodsReceiptItems.unitCode, maList));
  const theoMa = new Map(rows.map((r) => [r.unitCode, r]));
  return maList.flatMap((ma) => {
    const r = theoMa.get(ma);
    if (!r) return [];
    const chu = r.unplanned
      ? ['NGOÀI KẾ HOẠCH', r.productTitle, r.variantTitle].filter(Boolean).join(' · ')
      : chuTemMon({ orderNumber: r.orderNumber, productTitle: r.productTitle, variantTitle: r.variantTitle, thuTu: r.thuTu, tong: r.tong, brand: r.brand?.toUpperCase() ?? null });
    return [{ qr: ma, chu, phu: ma }];
  });
}

/** Tem DÒNG ĐƠN (`L:<shopifyLineId>`) cho brand in lên kiện; thứ tự dòng theo shopify_line_id trong đơn. */
async function temDong(lineIds: string[]): Promise<Tem[]> {
  if (lineIds.length === 0) return [];
  const rows = await db.select({
    lineId: schema.orderFulfillmentLines.id, shopifyLineId: schema.orderFulfillmentLines.shopifyLineId, qty: schema.orderFulfillmentLines.qty,
    orderNumber: schema.shopifyOrders.shopifyOrderNumber, productTitle: schema.shopifyOrderLines.productTitle, variantTitle: schema.shopifyOrderLines.variantTitle,
    thuTuDong: sql<number>`row_number() over (partition by ${schema.orderFulfillmentLines.fulfillmentId} order by ${schema.orderFulfillmentLines.shopifyLineId})::int`,
  }).from(schema.orderFulfillmentLines)
    .innerJoin(schema.orderFulfillment, eq(schema.orderFulfillment.id, schema.orderFulfillmentLines.fulfillmentId))
    .innerJoin(schema.shopifyOrders, eq(schema.shopifyOrders.id, schema.orderFulfillment.orderId))
    .leftJoin(schema.shopifyOrderLines, and(eq(schema.shopifyOrderLines.orderId, schema.orderFulfillment.orderId), eq(schema.shopifyOrderLines.shopifyLineId, schema.orderFulfillmentLines.shopifyLineId)))
    .where(inArray(schema.orderFulfillmentLines.id, lineIds));
  return rows.map((r) => ({
    qr: maTemDong(r.shopifyLineId),
    chu: chuTemDong({ orderNumber: r.orderNumber, thuTuDong: r.thuTuDong, productTitle: r.productTitle, variantTitle: r.variantTitle, qty: r.qty }),
    phu: maTemDong(r.shopifyLineId),
  }));
}

export default async function TemPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_receiving')) redirect('/');
  const sp = await searchParams;
  const kho = sp.kho === 'a4' ? 'a4' : '50x30';
  const tems = [...(await temMon(tach(sp.ma))), ...(await temDong(tach(sp.dong)))];
  if (tems.length === 0) return <p className="p-6 text-sm text-muted-foreground">Không có mã nào để in. Dùng ?ma=WH-… hoặc ?dong=&lt;lineId&gt;.</p>;
  return <TemGrid tems={tems} kho={kho} />;
}
```

`row_number()` với `partition by fulfillment_line_id` chỉ đúng khi mọi món của dòng đều nằm trong `maList`; trang in luôn được mở với đủ mã vừa in nên chấp nhận — ghi chú này vào code.

- [ ] **Step 5: Kiểm**

Run: `npx tsc --noEmit && npm run build`
Mở `http://localhost:3000/f/warehouse/receiving/tem?ma=<một unit_code có thật>` bằng `npm run dev`; xem QR hiện, bấm In → hộp thoại in báo khổ 50×30. Thử `&kho=a4`.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json components/receiving/MaQR.tsx components/receiving/TemGrid.tsx "app/(dashboard)/f/warehouse/receiving/tem/page.tsx"
git commit -m "feat(receiving): trang in tem QR 50x30 / A4 24 tem, sinh QR phía client"
```

---

### Task 11: Màn mobile "Nhập kho nhanh" (camera + 4 bước) + tab

**Files:**
- Create: `components/receiving/MayQuet.tsx`, `components/receiving/QuetNhanHang.tsx`, `app/(dashboard)/f/warehouse/receiving/quet/page.tsx`
- Modify: `app/(dashboard)/f/warehouse/layout.tsx:23-24` (thêm tab)

**Interfaces:**
- Consumes: mọi action Task 9; `docMaTem` (client-safe, module thuần).
- Produces: route `/f/warehouse/receiving/quet`.

- [ ] **Step 1: `MayQuet.tsx`** — camera QR, gọi `onMa` mỗi lần đọc được (chống lặp 1,5s), có ô nhập tay dự phòng.

```tsx
'use client';
import { useEffect, useRef, useState } from 'react';
import { BrowserQRCodeReader, type IScannerControls } from '@zxing/browser';

/**
 * Đọc QR bằng camera sau của điện thoại. Cùng một mã đọc liên tiếp trong 1,5s
 * chỉ báo một lần (camera bắn ~10 khung/giây). Ô nhập tay chỉ để dán/gõ MÃ khi
 * camera hỏng — không phải chỗ gõ SKU.
 */
export function MayQuet({ onMa, dangBan }: { onMa: (ma: string) => void; dangBan: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const cuoi = useRef<{ ma: string; luc: number }>({ ma: '', luc: 0 });
  const [loi, setLoi] = useState<string | null>(null);
  const [tay, setTay] = useState('');

  useEffect(() => {
    let controls: IScannerControls | undefined;
    const reader = new BrowserQRCodeReader(undefined, { delayBetweenScanAttempts: 150 });
    if (!video.current) return;
    reader.decodeFromConstraints({ video: { facingMode: 'environment' } }, video.current, (result) => {
      if (!result) return;
      const ma = result.getText();
      const now = Date.now();
      if (ma === cuoi.current.ma && now - cuoi.current.luc < 1500) return;
      cuoi.current = { ma, luc: now };
      onMa(ma);
    }).then((c) => { controls = c; }).catch((e: unknown) => setLoi(e instanceof Error ? e.message : 'Không mở được camera'));
    return () => { controls?.stop(); };
  }, [onMa]);

  return (
    <div className="space-y-2">
      <video ref={video} className="w-full rounded-lg bg-black aspect-[4/3] object-cover" muted playsInline />
      {loi && <p className="text-sm text-red-600">Camera: {loi}. Dùng ô dưới để nhập mã.</p>}
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (tay.trim()) { onMa(tay.trim()); setTay(''); } }}>
        <input value={tay} onChange={(e) => setTay(e.target.value)} placeholder="Dán mã WH-… / L:…" inputMode="text" autoCapitalize="characters"
          className="flex-1 rounded-md border border-input bg-input/30 px-3 py-2 text-base" disabled={dangBan} />
        <button type="submit" disabled={dangBan} className="rounded-md border px-3 py-2 text-sm">OK</button>
      </form>
    </div>
  );
}
```

`onMa` phải ổn định (bọc `useCallback` ở nơi gọi) để camera không khởi động lại mỗi render.

- [ ] **Step 2: `QuetNhanHang.tsx`** — máy trạng thái 4 bước.

```tsx
'use client';
import { useCallback, useEffect, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { MayQuet } from './MayQuet';
import type { BrandDangCho, DongCho } from '@/features/receiving/nhan-nhanh-queries';
import {
  layDongCho, layDongTheoMaQuet, moPhieuBrand, inTemMon, nhanNgoaiKeHoach, xacNhanQuet, type KetQuaQuet,
} from '@/features/receiving/nhan-nhanh-actions';

type Buoc =
  | { b: 1 }
  | { b: 2; brand: string; phieu: { id: string; code: string }; dongs: DongCho[]; loc: string }
  | { b: 3; brand: string; phieu: { id: string; code: string }; dong: DongCho; soLuong: number }
  | { b: 4; brand: string; phieu: { id: string; code: string }; dong: DongCho | null; daIn: string[]; daXacNhan: string[]; mongDoi: number };

const LOI: Record<Exclude<KetQuaQuet, { ok: true }>['lyDo'], string> = {
  khong_ton_tai: 'Mã không tồn tại', da_xac_nhan: 'Tem này đã xác nhận rồi',
  khac_phieu: 'Tem thuộc phiếu khác', khong_phai_tem_mon: 'Không phải tem món (WH-…)',
};

function rung() { try { navigator.vibrate?.(200); } catch { /* không hỗ trợ */ } }

export function QuetNhanHang({ brands }: { brands: BrandDangCho[] }) {
  const [buoc, setBuoc] = useState<Buoc>({ b: 1 });
  const [pending, start] = useTransition();
  const [do_, setDo] = useState(false);

  const baoLoi = (msg: string) => { rung(); setDo(true); toast.error(msg); setTimeout(() => setDo(false), 600); };

  const chonBrand = (brand: string) => start(async () => {
    const phieu = await moPhieuBrand(brand);
    const dongs = await layDongCho(brand);
    setBuoc({ b: 2, brand, phieu, dongs, loc: '' });
  });

  const quetBuoc2 = useCallback((ma: string) => {
    if (buoc.b !== 2) return;
    start(async () => {
      const r = await layDongTheoMaQuet(ma);
      if (!r.ok) { baoLoi(r.loi); return; }
      if (r.dong.brandSlug !== buoc.brand) { baoLoi(`Dòng này của brand ${r.dong.brandSlug}, phiếu đang mở là ${buoc.brand}`); return; }
      setBuoc({ b: 3, brand: buoc.brand, phieu: buoc.phieu, dong: r.dong, soLuong: Math.max(0, r.dong.mongDoi - r.dong.daIn) });
    });
  }, [buoc]);

  const quetBuoc4 = useCallback((ma: string) => {
    if (buoc.b !== 4) return;
    start(async () => {
      const r = await xacNhanQuet({ receiptId: buoc.phieu.id, maQuet: ma });
      if (!r.ok) { baoLoi(LOI[r.lyDo]); return; }
      toast.success(`${r.unitCode} ✓ ${r.lineId ? `${r.daXacNhan}/${r.mongDoi}` : 'ngoài kế hoạch'}`);
      setBuoc({ ...buoc, daXacNhan: [...buoc.daXacNhan, r.unitCode], mongDoi: r.mongDoi || buoc.mongDoi });
      if (r.duChiec) toast.success('Đủ chiếc — đã chốt nhận hàng dòng này');
    });
  }, [buoc]);

  // Về bước 2 sau khi quét xong, tải lại danh sách chờ (dòng đủ chiếc sẽ biến mất).
  const veDanhSach = () => { if (buoc.b === 1) return; start(async () => { const dongs = await layDongCho(buoc.brand); setBuoc({ b: 2, brand: buoc.brand, phieu: buoc.phieu, dongs, loc: '' }); }); };

  useEffect(() => { if (do_) document.body.classList.add('ring-4', 'ring-red-500'); else document.body.classList.remove('ring-4', 'ring-red-500'); }, [do_]);

  if (buoc.b === 1) return (
    <div className="p-4 space-y-3">
      <h1 className="text-xl font-semibold">Nhập kho nhanh · chọn brand</h1>
      {brands.length === 0 && <p className="text-sm text-muted-foreground">Không có dòng nào đang chờ hàng brand.</p>}
      <div className="grid grid-cols-2 gap-3">
        {brands.map((b) => (
          <button key={b.brandSlug} type="button" disabled={pending} onClick={() => chonBrand(b.brandSlug)}
            className="rounded-xl border p-4 text-left active:bg-muted">
            <div className="font-medium">{b.displayName ?? b.brandSlug}</div>
            <div className="text-xs text-muted-foreground">{b.soDong} dòng chờ</div>
          </button>
        ))}
      </div>
    </div>
  );

  if (buoc.b === 2) {
    const q = buoc.loc.trim().toLowerCase();
    const hien = q ? buoc.dongs.filter((d) => (d.orderNumber ?? '').toLowerCase().includes(q)) : buoc.dongs;
    return (
      <div className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold">{buoc.brand.toUpperCase()} · phiếu {buoc.phieu.code}</h1>
          <button type="button" className="text-sm underline" onClick={() => setBuoc({ b: 1 })}>Đóng phiếu</button>
        </div>
        <MayQuet onMa={quetBuoc2} dangBan={pending} />
        <input value={buoc.loc} onChange={(e) => setBuoc({ ...buoc, loc: e.target.value })} placeholder="Tìm theo mã đơn"
          className="w-full rounded-md border border-input bg-input/30 px-3 py-2 text-base" />
        <ul className="divide-y rounded-lg border">
          {hien.map((d) => (
            <li key={d.lineId}>
              <button type="button" className="w-full p-3 text-left active:bg-muted" onClick={() => setBuoc({ b: 3, brand: buoc.brand, phieu: buoc.phieu, dong: d, soLuong: Math.max(0, d.mongDoi - d.daIn) })}>
                <div className="flex justify-between"><span className="font-medium">{d.orderNumber}</span><span className="text-xs text-muted-foreground">{d.expectedDeliveryDate ? new Date(d.expectedDeliveryDate).toLocaleDateString('vi-VN') : ''}</span></div>
                <div className="text-sm">{d.productTitle} {d.variantTitle ? `· ${d.variantTitle}` : ''}</div>
                <div className="text-xs text-muted-foreground">mong đợi {d.mongDoi} · đã in {d.daIn} · đã xác nhận {d.daXacNhan}</div>
              </button>
            </li>
          ))}
        </ul>
        <button type="button" className="w-full rounded-lg border border-amber-500 p-3 text-amber-700" onClick={() => setBuoc({ b: 4, brand: buoc.brand, phieu: buoc.phieu, dong: null, daIn: [], daXacNhan: [], mongDoi: 0 })}>
          Nhận ngoài kế hoạch (hàng không có trong danh sách)
        </button>
      </div>
    );
  }

  if (buoc.b === 3) {
    const d = buoc.dong;
    return (
      <div className="p-4 space-y-3">
        <button type="button" className="text-sm underline" onClick={veDanhSach}>← Danh sách chờ</button>
        <div className="rounded-lg border p-3">
          <div className="font-semibold">{d.orderNumber}</div>
          <div>{d.productTitle} {d.variantTitle ? `· ${d.variantTitle}` : ''}</div>
          <div className="text-sm text-muted-foreground">mong đợi {d.mongDoi} · đã in {d.daIn} · đã xác nhận {d.daXacNhan}</div>
        </div>
        <label className="block text-sm">Số tem in
          <input type="number" min={0} max={99} value={buoc.soLuong} onChange={(e) => setBuoc({ ...buoc, soLuong: Number(e.target.value) })}
            className="mt-1 w-full rounded-md border border-input bg-input/30 px-3 py-2 text-lg" />
        </label>
        {buoc.soLuong > d.mongDoi - d.daIn && <p className="text-sm text-amber-700">Vượt mong đợi: {buoc.soLuong - (d.mongDoi - d.daIn)} tem sẽ là "ngoài kế hoạch".</p>}
        <button type="button" disabled={pending || buoc.soLuong <= 0} className="w-full rounded-lg bg-black p-3 text-white"
          onClick={() => start(async () => {
            const r = await inTemMon({ receiptId: buoc.phieu.id, lineId: d.lineId, soLuong: buoc.soLuong });
            const ma = [...r.maTheoDon, ...r.maNgoaiKeHoach];
            window.open(`/f/warehouse/receiving/tem?ma=${ma.join(',')}`, '_blank');
            setBuoc({ b: 4, brand: buoc.brand, phieu: buoc.phieu, dong: d, daIn: ma, daXacNhan: [], mongDoi: d.mongDoi });
          })}>In {buoc.soLuong} tem</button>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-3">
      <button type="button" className="text-sm underline" onClick={veDanhSach}>← Danh sách chờ</button>
      <h2 className="font-semibold">{buoc.dong ? `${buoc.dong.orderNumber} · quét xác nhận` : 'Nhận ngoài kế hoạch'}</h2>
      {buoc.dong && <p className="text-sm">Đã xác nhận {buoc.dong.daXacNhan + buoc.daXacNhan.length}/{buoc.mongDoi}</p>}
      {!buoc.dong && (
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); start(async () => {
          const r = await nhanNgoaiKeHoach({ receiptId: buoc.phieu.id, sku: String(f.get('sku') || '') || null, productTitle: String(f.get('ten') || '') || null, soLuong: Number(f.get('n') || 1) });
          window.open(`/f/warehouse/receiving/tem?ma=${r.ma.join(',')}`, '_blank');
          setBuoc({ ...buoc, daIn: [...buoc.daIn, ...r.ma] });
        }); }}>
          <input name="ten" placeholder="Tên hàng" className="flex-1 rounded-md border px-2 py-2" />
          <input name="sku" placeholder="SKU (nếu có)" className="w-28 rounded-md border px-2 py-2" />
          <input name="n" type="number" defaultValue={1} min={1} max={50} className="w-16 rounded-md border px-2 py-2" />
          <button type="submit" disabled={pending} className="rounded-md bg-amber-600 px-3 text-white">In</button>
        </form>
      )}
      <MayQuet onMa={quetBuoc4} dangBan={pending} />
      <ul className="text-sm font-mono">
        {buoc.daIn.map((m) => <li key={m} className={buoc.daXacNhan.includes(m) ? 'text-emerald-700' : 'text-muted-foreground'}>{m} {buoc.daXacNhan.includes(m) ? '✓' : '· chưa quét'}</li>)}
      </ul>
    </div>
  );
}
```

Ô "Tên hàng / SKU" chỉ xuất hiện ở đường "Nhận ngoài kế hoạch" — hàng không có trong danh sách chờ (spec §3.1 cho phép ghi SKU/tên ở đây).

- [ ] **Step 3: Trang `quet/page.tsx`**

```tsx
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { listBrandDangCho } from '@/features/receiving/nhan-nhanh-queries';
import { QuetNhanHang } from '@/components/receiving/QuetNhanHang';

export const dynamic = 'force-dynamic';

export default async function QuetPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'manage_receiving')) redirect('/f/warehouse/receiving');
  const brands = await listBrandDangCho();
  return <QuetNhanHang brands={brands} />;
}
```

- [ ] **Step 4: Tab trong `warehouse/layout.tsx`** — trong nhánh `view_receiving`, thêm sau `'Nhập kho & QC'`:

```ts
         { href: '/f/warehouse/receiving/quet', label: 'Nhập kho nhanh' },
```

- [ ] **Step 5: Kiểm tay trên điện thoại**

Run: `npx tsc --noEmit && npm run build`, rồi `npm run dev` và mở `https://<ip-máy>:3000/f/warehouse/receiving/quet` trên điện thoại cùng mạng (camera cần HTTPS hoặc `localhost`; dùng `next dev --experimental-https` nếu cần). Kịch bản kiểm:
  1. Chọn brand → phiếu `GRN-…` hôm nay được tạo (mở lại → cùng phiếu).
  2. Chọn một dòng mong đợi 2 → In 2 tem → trang in mở tab mới, 2 QR `WH-…`.
  3. Quét tem 1 → toast `1/2`; quét lại tem 1 → đỏ + rung "đã xác nhận rồi", DB không đổi.
  4. Quét tem 2 → `2/2` + "Đủ chiếc"; kiểm DB: `brand_order_requests.delivered_at` có, dòng `in_stock`, `mmp_line_received` có dòng `source='sms'`.
  5. Về danh sách → dòng đó biến mất.
  6. Nhập 3 cho dòng mong đợi 2 → cảnh báo vàng, 1 tem `NGOÀI KẾ HOẠCH`.

- [ ] **Step 6: Commit**

```bash
git add components/receiving/MayQuet.tsx components/receiving/QuetNhanHang.tsx "app/(dashboard)/f/warehouse/receiving/quet/page.tsx" "app/(dashboard)/f/warehouse/layout.tsx"
git commit -m "feat(receiving): màn mobile Nhập kho nhanh — chọn brand, quét/chọn dòng, in tem, quét xác nhận"
```

---

### Task 12: Cảnh báo trên phiếu: "Đã in, chưa xác nhận" và "Ngoài kế hoạch"

**Files:**
- Modify: `app/(dashboard)/f/warehouse/receiving/[id]/page.tsx:70-82`

**Interfaces:**
- Consumes: `getReceiptDetail` (`features/receiving/queries.ts:53`) dùng `db.select().from(goodsReceiptItems)` toàn cột → `printedAt`/`confirmedAt`/`unplanned` có sẵn sau Task 1, không cần sửa query.

- [ ] **Step 1: Thêm badge** — trong `items.map`, cạnh Badge `qcResult` (dòng 77) thêm:

```tsx
                  {it.unplanned && <Badge className="h-5 bg-amber-500/15 text-amber-700 text-[10px] uppercase tracking-wider">Ngoài kế hoạch</Badge>}
                  {it.printedAt && !it.confirmedAt && <Badge variant="outline" className="h-5 border-amber-500 text-amber-700 text-[10px] uppercase tracking-wider">Đã in, chưa xác nhận</Badge>}
```

Phía trên danh sách (trước `items.map`), thêm dòng tổng nếu có món chưa xác nhận:

```tsx
          {items.some((it) => it.printedAt && !it.confirmedAt) && (
            <p className="text-sm text-amber-700">
              {items.filter((it) => it.printedAt && !it.confirmedAt).length} tem đã in nhưng chưa quét xác nhận — chưa tính là đã nhận.
            </p>
          )}
```

- [ ] **Step 2: Kiểm**

Run: `npx tsc --noEmit`; mở phiếu vừa tạo ở Task 11 → thấy badge đúng.

- [ ] **Step 3: Commit**

```bash
git add "app/(dashboard)/f/warehouse/receiving/[id]/page.tsx"
git commit -m "feat(receiving): cảnh báo tem đã in chưa xác nhận, cờ ngoài kế hoạch trên phiếu"
```

---

### Task 13: Kiểm toàn bộ, ghi Second Brain, push

**Files:**
- Modify (ngoài repo): `/Users/macos/Obsidian/Le Minh Tiep Second Brain/Shared/Projects/Shopify-Management-System/Activity Log.md`, `Decisions.md` (D-054), `Overview.md` (mục trạng thái).

- [ ] **Step 1: Chạy đủ ba cổng**

```bash
npx tsc --noEmit && npx vitest run && npm run build
```
Expected: cả ba xanh. Đọc output tsc thật, không suy từ build.

- [ ] **Step 2: Append Activity Log** (theo template `Shared/Templates/Activity Entry.md`), tiêu đề `## 2026-09-06 · Nhập kho quét mã — định danh theo Shopify ID (D-054)`; nêu: hai tầng mã, 4 bước, cột mới, luật Lark chỉ điền ô trống, gác env `LARK_NHAN_HANG_PUSH`, phần MMP chờ báo.

- [ ] **Step 3: Thêm D-054 vào Decisions.md**

```markdown
## D-054 · Nhận hàng brand định danh bằng mã, không bằng SKU (2026-09-06)
- Tem món `WH-…` (kho in) + tem dòng đơn `L:<shopifyLineId>` (brand in). QR, một khoá/tem.
- "MEAN đã nhận" chốt khi quét ĐỦ chiếc trên SMS; SMS là nguồn sự thật (`mmp_line_received.source='sms'`), Lark→SMS chỉ lấp chỗ trống.
- Thay thế: gõ SKU + ngày nhận tay trong bảng Lark "WH ngày MEAN nhận hàng".
- Lý do: SKU đổi trên Shopify làm gãy nhận hàng/QC/đóng gói; ID Shopify đã sẵn trong DB nhưng chưa ai dùng.
```

- [ ] **Step 4: Push**

```bash
gh auth switch --user ecommeanblvd && git push
```

---

### Task 14 (GÁC CỔNG — chỉ chạy khi CEO xác nhận MMP đã sẵn sàng): `lineId` + `labelUrl` cho MMP

**Files:**
- Create: `features/receiving/ky-url-tem.ts`, `features/receiving/ky-url-tem.test.ts`, `app/tem/[orderId]/page.tsx`
- Modify: `features/mmp/order-push-logic.ts:13` (MmpOrderLine), `:118-123` (map line); `features/mmp/order-outbound.ts:12-17` (select thêm `shopifyLineId`), `:66-80` (điền hai trường)

**Interfaces:**
- Produces:
  ```ts
  export function kyUrlTem(i: { orderId: string; hetHanMs: number; secret: string }): string;   // token hex
  export function kiemUrlTem(i: { orderId: string; hetHanMs: number; token: string; secret: string; nowMs: number }): boolean;
  export function duongDanTem(i: { baseUrl: string; orderId: string; hetHanMs: number; secret: string }): string; // `${base}/tem/${orderId}?e=${hetHan}&t=${token}`
  // MmpOrderLine thêm: lineId?: string; labelUrl?: string | null
  ```
- **Quyết định cần CEO biết:** spec §6 nói "PDF"; repo không có thư viện sinh PDF phía server. Kế hoạch dùng TRANG IN (HTML, `@page`) có ký URL — brand mở link, bấm In / Lưu PDF từ trình duyệt. Nếu MMP bắt buộc file PDF nhị phân thì thêm task cài `pdfkit` sau, không đổi hợp đồng `labelUrl`.

- [ ] **Step 1: Test ký URL**

```ts
import { describe, it, expect } from 'vitest';
import { kyUrlTem, kiemUrlTem, duongDanTem } from './ky-url-tem';

const s = 'bi-mat'; const o = '11111111-1111-1111-1111-111111111111';
describe('ký URL tem', () => {
  it('token đúng + chưa hết hạn → hợp lệ', () => {
    const e = 2_000_000; const t = kyUrlTem({ orderId: o, hetHanMs: e, secret: s });
    expect(kiemUrlTem({ orderId: o, hetHanMs: e, token: t, secret: s, nowMs: 1_000_000 })).toBe(true);
  });
  it('hết hạn / sai secret / sai order / token lệch → không hợp lệ', () => {
    const e = 2_000_000; const t = kyUrlTem({ orderId: o, hetHanMs: e, secret: s });
    expect(kiemUrlTem({ orderId: o, hetHanMs: e, token: t, secret: s, nowMs: 3_000_000 })).toBe(false);
    expect(kiemUrlTem({ orderId: o, hetHanMs: e, token: t, secret: 'khac', nowMs: 1 })).toBe(false);
    expect(kiemUrlTem({ orderId: 'x', hetHanMs: e, token: t, secret: s, nowMs: 1 })).toBe(false);
    expect(kiemUrlTem({ orderId: o, hetHanMs: e, token: 'zz', secret: s, nowMs: 1 })).toBe(false);
  });
  it('đường dẫn có /tem/<orderId>?e=&t=', () => {
    expect(duongDanTem({ baseUrl: 'https://sms.example', orderId: o, hetHanMs: 5, secret: s }))
      .toMatch(new RegExp(`^https://sms\\.example/tem/${o}\\?e=5&t=[0-9a-f]{64}$`));
  });
});
```

- [ ] **Step 2: Chạy test, mong thất bại** — `npx vitest run features/receiving/ky-url-tem.test.ts`.

- [ ] **Step 3: Viết `ky-url-tem.ts`**

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';

/** HMAC-SHA256(orderId.hetHanMs) — URL tem cho brand mở không cần đăng nhập, có hạn. */
export function kyUrlTem(i: { orderId: string; hetHanMs: number; secret: string }): string {
  return createHmac('sha256', i.secret).update(`${i.orderId}.${i.hetHanMs}`).digest('hex');
}

export function kiemUrlTem(i: { orderId: string; hetHanMs: number; token: string; secret: string; nowMs: number }): boolean {
  if (!Number.isFinite(i.hetHanMs) || i.nowMs > i.hetHanMs) return false;
  const mong = Buffer.from(kyUrlTem({ orderId: i.orderId, hetHanMs: i.hetHanMs, secret: i.secret }), 'hex');
  const co = Buffer.from(/^[0-9a-f]+$/i.test(i.token) && i.token.length % 2 === 0 ? i.token : '00', 'hex');
  return mong.length === co.length && timingSafeEqual(mong, co);
}

export function duongDanTem(i: { baseUrl: string; orderId: string; hetHanMs: number; secret: string }): string {
  const t = kyUrlTem({ orderId: i.orderId, hetHanMs: i.hetHanMs, secret: i.secret });
  return `${i.baseUrl.replace(/\/$/, '')}/tem/${i.orderId}?e=${i.hetHanMs}&t=${t}`;
}
```

- [ ] **Step 4: Chạy test, mong đạt.**

- [ ] **Step 5: Trang công khai `app/tem/[orderId]/page.tsx`** (ngoài `(dashboard)`, không auth, kiểm token; `params` và `searchParams` là Promise):

```tsx
import { notFound } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { kiemUrlTem } from '@/features/receiving/ky-url-tem';
import { chuTemDong } from '@/features/receiving/nhan-nhanh-logic';
import { maTemDong } from '@/features/receiving/ma-tem';
import { TemGrid } from '@/components/receiving/TemGrid';

export const dynamic = 'force-dynamic';

export default async function TemDonPage({ params, searchParams }: {
  params: Promise<{ orderId: string }>; searchParams: Promise<{ e?: string; t?: string; kho?: string }>;
}) {
  const { orderId } = await params; const sp = await searchParams;
  const secret = process.env.LABEL_URL_SECRET ?? process.env.BETTER_AUTH_SECRET;
  if (!secret || !sp.e || !sp.t || !kiemUrlTem({ orderId, hetHanMs: Number(sp.e), token: sp.t, secret, nowMs: Date.now() })) notFound();
  const [ful] = await db.select({ id: schema.orderFulfillment.id }).from(schema.orderFulfillment).where(eq(schema.orderFulfillment.orderId, orderId)).limit(1);
  if (!ful) notFound();
  const rows = await db.select({
    shopifyLineId: schema.orderFulfillmentLines.shopifyLineId, qty: schema.orderFulfillmentLines.qty,
    orderNumber: schema.shopifyOrders.shopifyOrderNumber, productTitle: schema.shopifyOrderLines.productTitle, variantTitle: schema.shopifyOrderLines.variantTitle,
  }).from(schema.orderFulfillmentLines)
    .innerJoin(schema.shopifyOrders, eq(schema.shopifyOrders.id, orderId))
    .leftJoin(schema.shopifyOrderLines, and(eq(schema.shopifyOrderLines.orderId, orderId), eq(schema.shopifyOrderLines.shopifyLineId, schema.orderFulfillmentLines.shopifyLineId)))
    .where(eq(schema.orderFulfillmentLines.fulfillmentId, ful.id))
    .orderBy(schema.orderFulfillmentLines.shopifyLineId);
  const tems = rows.map((r, i) => ({
    qr: maTemDong(r.shopifyLineId), phu: maTemDong(r.shopifyLineId),
    chu: chuTemDong({ orderNumber: r.orderNumber, thuTuDong: i + 1, productTitle: r.productTitle, variantTitle: r.variantTitle, qty: r.qty }),
  }));
  return <TemGrid tems={tems} kho={sp.kho === 'a4' ? 'a4' : '50x30'} />;
}
```

- [ ] **Step 6: Sửa MMP payload**

`order-push-logic.ts` dòng 13:
```ts
export interface MmpOrderLine { sku: string | null; title: string; qty: number; vendor: string | null; receivedAt: string | null; unitPrice?: number | null; lineDiscount?: number | null; lineId?: string; labelUrl?: string | null }
```
Trong `lines: input.brandLines.map(...)` thêm hai dòng spread:
```ts
      ...(l.lineId ? { lineId: l.lineId } : {}),
      ...(l.labelUrl !== undefined ? { labelUrl: l.labelUrl } : {}),
```
`order-outbound.ts`: trong select `fLines` thêm `shopifyLineId: schema.orderFulfillmentLines.shopifyLineId,`; sau khi có `ord`, tính một lần:
```ts
  const guiLineId = process.env.MMP_GUI_LINE_ID === '1';
  const secret = process.env.LABEL_URL_SECRET ?? process.env.BETTER_AUTH_SECRET;
  const base = process.env.BETTER_AUTH_URL;
  const labelUrl = guiLineId && secret && base
    ? duongDanTem({ baseUrl: base, orderId, hetHanMs: Date.now() + 90 * 86400000, secret })
    : null;
```
và trong `brandLines` map thêm `...(guiLineId ? { lineId: l.shopifyLineId, labelUrl } : {}),`. Import `duongDanTem` từ `@/features/receiving/ky-url-tem`.

Lưu ý dedup: `banGiaCuoiNeuDoi`/outbox so payload để chặn bắn trùng — `labelUrl` chứa `hetHanMs` thay đổi mỗi lần dựng → có thể bị coi là "đổi". Kiểm `features/ship-ho/final-charge-emit.ts` và test `order-push-logic.test.ts`; nếu so toàn payload, làm tròn `hetHanMs` về đầu tháng kế tiếp (`new Date(y, m + 2, 1).getTime()`) để ổn định trong kỳ.

- [ ] **Step 7: Kiểm + commit**

```bash
npx tsc --noEmit && npx vitest run features/mmp features/receiving && npm run build
git add features/receiving/ky-url-tem.ts features/receiving/ky-url-tem.test.ts "app/tem/[orderId]/page.tsx" features/mmp/order-push-logic.ts features/mmp/order-outbound.ts
git commit -m "feat(mmp): lineId + labelUrl (trang tem ký URL) trong payload đơn, gác env MMP_GUI_LINE_ID"
```

KHÔNG đặt `MMP_GUI_LINE_ID=1` trên Railway cho tới khi MMP xác nhận đã nhận hợp đồng hai trường mới.

---

## Tự kiểm kế hoạch

**Phủ spec:** §2.2/2.3/2.6 → Task 2, 10; §3 bốn bước → Task 9, 11; §3.1 lệch → Task 3 (`soTemDuocIn`, `phanLoaiQuet`), 9 (`unplanned`, không ghi khi không khớp), 12 (cảnh báo chưa xác nhận); §3.2 → Task 1; §4 tem → Task 3 (chữ), 10 (50×30 / A4, QR client, không gọi API lúc in); §5.1 → Task 6 (`ghiNhanHangTrongTx`); §5.2 → Task 7–8 (cột khai một chỗ, gác env, tạo dòng mới, chỉ điền ô trống, cron điền bù); §5.3 → Task 6; §2.7 → Task 6 (`source='sms'` ghi đè); §6 → Task 14 (gác cổng, độc lập); §7 không có task nào đụng QC/kệ/tồn kho. §8 "không gõ ký tự": ô nhập tay chỉ ở đường ngoài kế hoạch và dự phòng camera.

**Lệch có chủ ý so với spec:** (1) "Đóng phiếu" chỉ đưa về bước 1 — `goods_receipts` không có cột trạng thái, phiếu retail_for_order của brand trong ngày mở lại được (Task 9 `moPhieuBrand`); (2) §6 "PDF" → trang in ký URL (Task 14, đã nêu để CEO quyết).

**Nhất quán kiểu:** `DongCho` (Task 5) dùng ở Task 9, 11; `KetQuaQuet.lyDo: LyDoTuChoi` (Task 3) khớp bảng `LOI` Task 11; `taoMonTrongTx` (Task 4) dùng ở Task 9; `DongNhanHang` (Task 7) dùng ở Task 8, 9; `BrandReceivedSyncResult.inserted` đổi ở cả route và script (Task 6).
