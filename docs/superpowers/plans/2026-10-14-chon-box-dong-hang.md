# Chọn box khi đóng hàng — Kế hoạch triển khai

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nhân sự kho chọn một box trong màn đóng kiện của SMS là có sẵn dài-rộng-cao (sửa được), nhập cân tại đó, và SMS đẩy cân + kích thước ngược lên Lark.

**Architecture:** Nâng cấp màn đã có (`/f/warehouse/dong-goi` → `ModalDongKien`), không dựng màn mới. Danh mục box dựng từ `lark_wh_inventory` (dòng `VTĐG1`) cộng một bảng `box_dong_goi` của SMS cho bản sửa tay; bản sửa tay thắng và khoá. Đẩy ngược Lark đi qua đúng đường ghi đã có (`features/lark/ghi-nguoc/`), giữ luật chỉ-điền-ô-trống.

**Tech Stack:** Next.js 16.2.6, React 19.2.4, Drizzle + Postgres, Tailwind 4, vitest 4.

**Spec:** `docs/superpowers/specs/2026-10-14-chon-box-dong-hang-design.md`

## Global Constraints

- **vitest chỉ bắt `lib|features|components/**/*.test.ts` — KHÔNG bắt `.tsx`.** Mọi luật phải nằm trong module `.ts`; `.tsx` chỉ còn việc vẽ.
- Di trú **áp tay**, `npm run db:migrate` báo thành công nhưng không làm gì — thủ tục ở `db/migrations/README.md`. Áp xong mới được push.
- Lark **không có undo**. Đường ghi Lark chỉ có MỘT: `features/lark/ghi-nguoc/`. Thêm cột thì thêm vào `cot.ts`, không mở đường thứ hai.
- Luật ghi Lark: **chỉ điền ô trống, không đè** — dùng `oLarkTrong` có sẵn trong `dung-patch.ts`.
- Quyền: màn đóng kiện dùng `view_receiving` (đã có); hành động ghi dùng `requirePerm` như `dongKien` hiện tại.
- Khoá Lark **chỉ trên Railway**: dò bảng bằng `railway run npm run probe:lark-table`.
- Không chạm `components/dong-hang/BangDongHang.tsx` — màn chọn line của Đức, việc khác.

## Review Focus

- **Túi chỉ có hai số** (`28x42`, `35x45`): ô Cao phải **trống**, tuyệt đối không điền `0` — `0` chui vào công thức cân quy đổi là ra cước sai.
- **Chuỗi kích thước không đọc được** (`160x60` của giấy nến, ô trống, chữ lạ): box đó không hiện trong lưới chọn, nhưng **phải liệt kê được** ở màn quản lý để người ta vào sửa.
- **Một loại box có nhiều dòng kho** (mỗi lô nhập một dòng `VTĐG1`): lưới phải hiện MỘT thẻ cho mỗi loại, không hiện trùng.
- **Ô Lark đã có số người gõ**: cả `Weights` lẫn `Dimension ( điền tay)` đều không được đè, kể cả khi số của SMS khác.
- **Đổi box sau khi đã sửa dim**: dim điền lại theo box mới và xoá dấu "đã sửa" — người ta chủ động đổi box thì ý định là lấy số của box mới.

---

### Task 1: Kéo cột `Kích thước` của kho về SMS

**Files:**
- Create: `db/migrations/0206_wh-inventory-kich-thuoc.sql`
- Modify: `db/schema.ts` (`larkWhInventory`), `features/kho-nhan/dong-bo-wh-lark.ts`

**Interfaces:**
- Produces: cột `larkWhInventory.kichThuoc` (`text`, nullable) mang **nguyên văn** chữ trên Lark.

- [ ] **Step 1:** Viết di trú thêm `ALTER TABLE lark_wh_inventory ADD COLUMN IF NOT EXISTS kich_thuoc text;` kèm ghi chú vì sao giữ nguyên chữ tự do (Task 2 mới đọc thành số).
- [ ] **Step 2:** Thêm `kichThuoc: text('kich_thuoc')` vào `larkWhInventory` trong `db/schema.ts`.
- [ ] **Step 3:** Trong `dong-bo-wh-lark.ts` thêm `kichThuoc: chuoi(f['Kích thước'])` vào chỗ dựng dòng (cạnh `dinhDanh`, dòng ~61) và `kichThuoc: sql\`excluded.kich_thuoc\`` vào `onConflictDoUpdate` (dòng ~104). Tên cột Lark là **`Kích thước`** nguyên văn, có dấu — sai một ký tự là Lark trả `undefined` và im lặng.
- [ ] **Step 4:** Áp di trú bằng tay, rồi `railway run npm run cron:sync-lark` hoặc chạy lượt đồng bộ kho; kiểm `SELECT count(*) FROM lark_wh_inventory WHERE inventory_type='VTĐG1' AND kich_thuoc IS NOT NULL` ra **38**.
- [ ] **Step 5:** Commit.

---

### Task 2: Đọc chuỗi kích thước thành số

**Files:**
- Create: `features/dong-goi/kich-thuoc.ts`, `features/dong-goi/kich-thuoc.test.ts`

**Interfaces:**
- Produces: `export interface BaChieu { daiCm: number; rongCm: number; caoCm: number | null }`
- Produces: `export function docKichThuoc(raw: string | null | undefined): BaChieu | null`

- [ ] **Step 1: Viết test trước**

```ts
test('ba số → đủ ba chiều', () => {
  expect(docKichThuoc('40x30x20')).toEqual({ daiCm: 40, rongCm: 30, caoCm: 20 });
  expect(docKichThuoc('37x30x9.5')).toEqual({ daiCm: 37, rongCm: 30, caoCm: 9.5 });
});
test('HAI số → caoCm null, KHÔNG phải 0', () => {
  expect(docKichThuoc('28x42')).toEqual({ daiCm: 28, rongCm: 42, caoCm: null });
  expect(docKichThuoc('15x10.7')).toEqual({ daiCm: 15, rongCm: 10.7, caoCm: null });
});
test('chấp nhận dấu nhân và khoảng trắng người gõ', () => {
  expect(docKichThuoc('40 × 30 × 20')).toEqual({ daiCm: 40, rongCm: 30, caoCm: 20 });
  expect(docKichThuoc('40X30X20')).toEqual({ daiCm: 40, rongCm: 30, caoCm: 20 });
});
test('không đọc được → null', () => {
  for (const x of [null, undefined, '', '  ', 'to', '40', '40x30x20x10', '40xabc']) {
    expect(docKichThuoc(x)).toBeNull();
  }
});
```

- [ ] **Step 2:** Chạy test, phải FAIL vì chưa có hàm.
- [ ] **Step 3:** Viết `docKichThuoc` trong `features/dong-goi/kich-thuoc.ts`. Chỉ nhận đúng 2 hoặc 3 số dương; số âm, số 0 và quá 3 số đều trả `null`.
- [ ] **Step 4:** Chạy test, phải PASS.
- [ ] **Step 5:** Commit.

---

### Task 3: Dựng danh mục box từ dòng kho

**Files:**
- Create: `features/dong-goi/danh-muc-box.ts`, `features/dong-goi/danh-muc-box.test.ts`

**Interfaces:**
- Consumes: `docKichThuoc`, `BaChieu` (Task 2)
- Produces:
```ts
export type LoaiBox = 'thung' | 'tui' | 'khac';
export interface Box { ten: string; loai: LoaiBox; kichThuoc: BaChieu; larkRecordIds: string[] }
export interface DongKho { recordId: string; lineitemName: string | null; kichThuoc: string | null }
export function gomBox(rows: DongKho[]): { box: Box[]; boLai: { ten: string; lyDo: string; recordIds: string[] }[] }
export function loaiTheoTen(ten: string): LoaiBox
```

- [ ] **Step 1: Viết test trước**

```ts
test('nhiều dòng kho cùng một loại → MỘT box, gom record id', () => {
  const r = gomBox([
    { recordId: 'r1', lineitemName: 'Thùng Carton 5kg', kichThuoc: '40x25x25' },
    { recordId: 'r2', lineitemName: 'Thùng Carton 5kg', kichThuoc: '40x25x25' },
  ]);
  expect(r.box).toHaveLength(1);
  expect(r.box[0].larkRecordIds).toEqual(['r1', 'r2']);
});
test('tên quyết định loại', () => {
  expect(loaiTheoTen('Thùng Carton 5kg')).toBe('thung');
  expect(loaiTheoTen('Hộp MEAN Ver 2')).toBe('thung');
  expect(loaiTheoTen('Túi FedEx Nhỏ')).toBe('tui');
  expect(loaiTheoTen('Giấy Nến Trắng')).toBe('khac');
});
test('không đọc được kích thước thì KHÔNG mất, rơi sang boLai kèm lý do', () => {
  const r = gomBox([{ recordId: 'r9', lineitemName: 'Hộp lạ', kichThuoc: null }]);
  expect(r.box).toHaveLength(0);
  expect(r.boLai[0]).toMatchObject({ ten: 'Hộp lạ', recordIds: ['r9'] });
});
test('cùng tên mà hai dòng ghi hai kích thước → giữ dòng đầu, dòng sau vào boLai', () => { /* … */ });
```

- [ ] **Step 2:** Chạy test, phải FAIL.
- [ ] **Step 3:** Viết `gomBox` và `loaiTheoTen`. `loaiTheoTen` nhận dạng theo chữ đầu tên (`Thùng`/`Hộp` → `thung`, `Túi` → `tui`, còn lại `khac`), không phân biệt hoa thường và dấu.
- [ ] **Step 4:** Chạy test, phải PASS.
- [ ] **Step 5:** Commit.

---

### Task 4: Bảng box của SMS và luật bản-sửa-tay-thắng

**Files:**
- Create: `db/migrations/0207_box-dong-goi.sql`, `features/dong-goi/tron-box.ts`, `features/dong-goi/tron-box.test.ts`
- Modify: `db/schema.ts`

**Interfaces:**
- Consumes: `Box`, `BaChieu`
- Produces: bảng `box_dong_goi` (`id` uuid, `ten` text unique, `loai` text, `dai_cm`/`rong_cm`/`cao_cm` numeric nullable, `lark_record_id` text nullable, `sua_tay` boolean default false, `an` boolean default false, `cap_nhat_luc` timestamp, `nguoi_sua` text)
- Produces:
```ts
export interface BoxHien extends Box { id: string | null; suaTay: boolean; an: boolean; lech: BaChieu | null }
export function tronBox(tuLark: Box[], tuSms: BoxSms[]): BoxHien[]
```
`lech` khác `null` nghĩa là Lark đang ghi số khác với ô SMS đã khoá — chỉ để hiện cảnh báo, KHÔNG dùng để ghi đè.

- [ ] **Step 1: Viết test trước**

```ts
test('box chưa ai sửa → lấy số của Lark', () => { /* suaTay=false ⇒ kichThuoc = số Lark, lech=null */ });
test('box ĐÃ sửa tay → giữ số SMS, Lark đổi chỉ hiện lech', () => {
  const r = tronBox(
    [{ ten: 'Thùng Carton 5kg', loai: 'thung', kichThuoc: { daiCm: 40, rongCm: 25, caoCm: 28 }, larkRecordIds: ['r1'] }],
    [{ id: 'x', ten: 'Thùng Carton 5kg', loai: 'thung', daiCm: 40, rongCm: 25, caoCm: 30, suaTay: true, an: false }],
  );
  expect(r[0].kichThuoc).toEqual({ daiCm: 40, rongCm: 25, caoCm: 30 });
  expect(r[0].lech).toEqual({ daiCm: 40, rongCm: 25, caoCm: 28 });
});
test('box chỉ có trong SMS (người tự thêm) vẫn hiện', () => { /* … */ });
test('box bị ẩn không biến mất khỏi danh sách, chỉ mang cờ an=true', () => { /* … */ });
```

- [ ] **Step 2:** Chạy test, phải FAIL.
- [ ] **Step 3:** Viết di trú + schema + `tronBox`. Khớp hai bên theo `ten`.
- [ ] **Step 4:** Chạy test, phải PASS. Áp di trú bằng tay.
- [ ] **Step 5:** Commit.

---

### Task 5: Lưới chọn box có ô tìm, tự điền kích thước

**Files:**
- Create: `features/dong-goi/loc-box.ts`, `features/dong-goi/loc-box.test.ts`, `components/dong-goi/ChonBox.tsx`
- Modify: `components/dong-goi/ModalDongKien.tsx:226-237` (bỏ `<select>`), `features/dong-goi/queries.ts:97-114` (`vatTuDongGoi` → trả `BoxHien[]`)

**Interfaces:**
- Consumes: `BoxHien` (Task 4), `tronBox`, `gomBox`
- Produces:
```ts
export function locBox(ds: BoxHien[], tuKhoa: string): BoxHien[]
export function daSuaDim(box: BaChieu | null, dang: { dai: string; rong: string; cao: string }): boolean
```

- [ ] **Step 1: Viết test trước**

```ts
test('tìm theo tên, không phân biệt hoa thường và dấu', () => {
  expect(locBox(DS, 'fedex').map(b => b.ten)).toContain('Túi FedEx Nhỏ');
  expect(locBox(DS, 'THUNG CARTON 5').map(b => b.ten)).toContain('Thùng Carton 5kg');
});
test('tìm theo số đo', () => { expect(locBox(DS, '40x25').map(b => b.ten)).toContain('Thùng Carton 5kg'); });
test('từ khoá rỗng → trả nguyên danh sách, trừ box bị ẩn', () => { /* … */ });
test('daSuaDim: giống box thì false, lệch một chiều thì true', () => { /* … */ });
test('daSuaDim: box hai số, người điền ô Cao → true', () => { /* … */ });
```

- [ ] **Step 2:** Chạy test, phải FAIL.
- [ ] **Step 3:** Viết `locBox` và `daSuaDim` trong `features/dong-goi/loc-box.ts`.
- [ ] **Step 4:** Chạy test, phải PASS.
- [ ] **Step 5:** Viết `components/dong-goi/ChonBox.tsx`: ô tìm ở trên, dưới là lưới thẻ chia khối **Thùng** / **Túi** (box `loai='khac'` không hiện). Thẻ hiện tên và số đo. Props: `{ ds: BoxHien[]; chon: string | null; onChon: (b: BoxHien) => void }`.
- [ ] **Step 6:** Nối vào `ModalDongKien`: thay `<select>` bằng `<ChonBox>`; `onChon` đặt `dai/rong/cao` theo `box.kichThuoc` (`caoCm === null` thì để **chuỗi rỗng**, không phải `'0'`); hiện dấu "đã sửa" khi `daSuaDim(...)`; **đổi box thì điền lại theo box mới và xoá dấu**. Màu theo bộ pastel đã dùng ở `HopThoaiVanDon.tsx`.
- [ ] **Step 7:** Chạy `npx tsc --noEmit` và `npx eslint` cho các file vừa sửa — cả hai phải sạch.
- [ ] **Step 8:** Commit.

---

### Task 6: Màn quản lý danh mục box trong SMS

**Files:**
- Create: `components/dong-goi/QuanLyBox.tsx`
- Modify: `features/dong-goi/actions.ts` (thêm `luuBox`, `anBox`)

**Interfaces:**
- Consumes: `BoxHien`
- Produces: `export async function luuBox(v: { id?: string; ten: string; loai: LoaiBox; daiCm: number; rongCm: number; caoCm: number | null }): Promise<{ ok: boolean; loi?: string }>` — ghi `box_dong_goi` với `sua_tay = true`; `export async function anBox(id: string, an: boolean): Promise<{ ok: boolean }>`

- [ ] **Step 1:** Viết test cho luật kiểm đầu vào trong `features/dong-goi/logic.ts` (`kiemBox`): tên rỗng, số âm, số 0, trùng tên → trả lỗi đọc được bằng tiếng Việt.
- [ ] **Step 2:** Chạy test, phải FAIL.
- [ ] **Step 3:** Viết `kiemBox`, rồi `luuBox`/`anBox` dùng nó. Hai action đều `requirePerm` như `dongKien`.
- [ ] **Step 4:** Chạy test, phải PASS.
- [ ] **Step 5:** Viết `QuanLyBox.tsx` — mở từ màn đóng kiện, liệt kê **cả** box đọc được **và** danh sách `boLai` của Task 3 (những dòng kho chưa có kích thước), cho sửa tại chỗ. Box có `lech` hiện cảnh báo "Lark đang ghi …, khác ô này".
- [ ] **Step 6:** `npx tsc --noEmit` + eslint sạch. Commit.

---

### Task 7: Đẩy cân và kích thước lên Lark

**Files:**
- Create: `features/lark/ghi-nguoc/patch-can-dim.ts`, `features/lark/ghi-nguoc/patch-can-dim.test.ts`, `features/dong-goi/ghi-can-dim-len-lark.ts`
- Modify: `features/lark/ghi-nguoc/cot.ts`, `features/dong-goi/actions.ts` (cuối `dongKien`)

**Interfaces:**
- Consumes: `oLarkTrong` từ `dung-patch.ts`
- Produces:
```ts
export function xemTruocGhiCanDim(
  kien: { canKg: number | null; daiCm: number | null; rongCm: number | null; caoCm: number | null },
  oLark: Record<string, unknown>,
): { patch: Record<string, unknown>; canhBao: string[] }
export async function ghiCanDimLenLark(shipmentId: string): Promise<{ daGhi: boolean; canhBao?: string }>
```

- [ ] **Step 1:** Thêm vào `COT` trong `cot.ts`: `weights: 'Weights'` và `dimensionDienTay: 'Dimension ( điền tay)'` — hai tên nguyên văn, `Dimension ( điền tay)` có khoảng trắng sau dấu mở ngoặc, chép đúng.
- [ ] **Step 2: Viết test trước**

```ts
test('ô Lark trống → điền cả cân lẫn kích thước', () => {
  const { patch } = xemTruocGhiCanDim({ canKg: 2.4, daiCm: 40, rongCm: 30, caoCm: 12 }, {});
  expect(patch).toEqual({ 'Weights': 2.4, 'Dimension ( điền tay)': '40x30x12' });
});
test('ô Lark ĐÃ có số người gõ → KHÔNG đè, và báo', () => {
  const { patch, canhBao } = xemTruocGhiCanDim(
    { canKg: 2.4, daiCm: 40, rongCm: 30, caoCm: 12 },
    { 'Weights': 2.0, 'Dimension ( điền tay)': '39x29x9' },
  );
  expect(patch).toEqual({});
  expect(canhBao).toHaveLength(2);
});
test('thiếu chiều cao → chuỗi hai số, không chèn 0', () => {
  const { patch } = xemTruocGhiCanDim({ canKg: 1, daiCm: 28, rongCm: 42, caoCm: null }, {});
  expect(patch['Dimension ( điền tay)']).toBe('28x42');
});
test('không có gì để ghi → patch rỗng, không gọi Lark', () => { /* … */ });
```

- [ ] **Step 3:** Chạy test, phải FAIL.
- [ ] **Step 4:** Viết `xemTruocGhiCanDim`. Ô nào `oLarkTrong` mới điền; ô đã có thì bỏ qua và đẩy một câu vào `canhBao`.
- [ ] **Step 5:** Chạy test, phải PASS.
- [ ] **Step 6:** Viết `ghiCanDimLenLark(shipmentId)` theo đúng khuôn `features/dong-hang/ghi-gia-uoc-tinh-len-lark.ts`: đọc kiện + `larkRecordId`, `getLogRecordById`, dựng patch, `updateLogRecordFields`. Kiện chưa có dòng Lark thì trả `{ daGhi: false, canhBao }` chứ không ném lỗi.
- [ ] **Step 7:** Gọi `ghiCanDimLenLark` ở cuối `dongKien`, **ngoài transaction** và trong `try` riêng: Lark hỏng không được làm hỏng việc đóng kiện. Kết quả báo bằng toast.
- [ ] **Step 8:** Chạy **toàn bộ** `npm test` + `npx tsc --noEmit`. Commit.

---

## Tự soát

**Phủ spec:** §3 năm việc thiếu → Task 5 (việc 1,2,3), Task 7 (việc 4), Task 4+6 (việc 5). §2 nguồn dữ liệu → Task 1. §4 luật ghi Lark → Task 7. §4 luật sửa-tay-thắng → Task 4.

**Chưa phủ, cố ý:** §3 dặn "việc đầu tiên không phải viết mã mà là hỏi kho vì sao chưa dùng màn này" — việc của người, không phải của kế hoạch. Phải hỏi xong mới bắt đầu Task 1.

**Còn để ngỏ cho người dựng:** chỗ đặt nút mở `QuanLyBox`; thứ tự box trong lưới; có giữ dropdown cũ làm đường lùi không.
