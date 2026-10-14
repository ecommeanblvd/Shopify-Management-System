# Chọn box khi đóng hàng — Kế hoạch triển khai

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trong khối "Đóng thùng" của `/f/dong-hang`, nhân sự chọn một box là có sẵn dài-rộng-cao (sửa được), nhập cân tại đó; số đó dùng được NGAY để báo giá, và SMS đẩy cân + kích thước ngược lên Lark.

**Architecture:** Nâng cấp khối đã có (`components/dong-hang/KhoiDongThung.tsx`, action `ghiDongThung`), dùng lại luật thuần `features/dong-hang/dong-thung.ts`. Danh mục box dựng từ `lark_wh_inventory` (dòng `VTĐG1`) cộng bảng `box_dong_goi` của SMS cho bản sửa tay — bản sửa tay thắng và khoá. Giá ước tính đổi sang ưu tiên `sms_*`. Đẩy ngược Lark đi qua `features/lark/ghi-nguoc/`, kèm dấu lưu vết từng ô để SMS sửa lại được chính ô nó đã ghi.

**Tech Stack:** Next.js 16.2.6, React 19.2.4, Drizzle + Postgres, Tailwind 4, vitest 4.

**Spec:** `docs/superpowers/specs/2026-10-14-chon-box-dong-hang-design.md`

## Global Constraints

- **vitest chỉ bắt `lib|features|components/**/*.test.ts` — KHÔNG bắt `.tsx`.** Mọi luật nằm trong `.ts`; `.tsx` chỉ còn việc vẽ.
- Di trú **áp tay** (`npm run db:migrate` báo thành công nhưng không làm gì) — thủ tục `db/migrations/README.md`. Áp xong mới push.
- Lark **không có undo**. Đường ghi Lark chỉ có MỘT: `features/lark/ghi-nguoc/`. Thêm cột thì thêm vào `cot.ts`.
- **Chỉ kiện mới** được đẩy lên Lark, tính từ khi cả kế hoạch xong (spec §3b.4). Không đẩy bù 418 kiện lịch sử.
- Dùng lại `kiemNhapDongThung`, `CAN_KIEN_TOI_DA_KG = 70`, `KICH_THUOC_TOI_DA_CM = 300`, `canhBaoLechCan` (`NGUONG_CANH_BAO = 0.5`) — **không viết luật kiểm thứ hai**.
- Ô hộp giữ nguyên dạng **mã vật tư** (`MEAN-BOX-30x25x20…`): `parsePackagingType` suy BOX/PAK/BAG từ chữ trong mã, và ô "Loại hộp" của modal vận đơn đọc ô này (test khoá D-247).
- Màu theo bộ pastel đã dùng ở `components/dong-hang/HopThoaiVanDon.tsx`.
- Không chạm `/f/warehouse/dong-goi` trong kế hoạch này, trừ Task 9.

## Review Focus

- **Túi chỉ có hai số** (`28x42`, `35x45`): ô Cao để **trống**, không điền `0` — `0` chui vào cân quy đổi là sai cước, và "thiếu cao" là tín hiệu chọn hạng **Pak**.
- **Chuỗi kích thước không đọc được** (`160x60` giấy nến, ô trống, chữ lạ): box không hiện trong lưới, nhưng phải **liệt kê được** ở màn quản lý.
- **Một loại box có nhiều dòng kho**: lưới hiện MỘT thẻ mỗi loại.
- **Ô Lark người khác đã gõ**: không đè. Ô do **chính SMS** điền: đè lại được (spec §3b.3) — phân biệt bằng dấu lưu vết, không bằng so sánh giá trị.
- **Đổi box sau khi đã sửa dim**: điền lại theo box mới và xoá dấu "đã sửa".

---

### Task 1: Kéo cột `Kích thước` của kho về SMS

**Files:** Create `db/migrations/0206_wh-inventory-kich-thuoc.sql` · Modify `db/schema.ts` (`larkWhInventory`), `features/kho-nhan/dong-bo-wh-lark.ts`

**Interfaces:** Produces `larkWhInventory.kichThuoc` (`text`, nullable) — **nguyên văn** chữ trên Lark.

- [ ] **Step 1:** Di trú `ALTER TABLE lark_wh_inventory ADD COLUMN IF NOT EXISTS kich_thuoc text;`, ghi chú vì sao giữ chữ tự do (Task 2 mới đọc thành số).
- [ ] **Step 2:** `kichThuoc: text('kich_thuoc')` vào `larkWhInventory`.
- [ ] **Step 3:** Trong `dong-bo-wh-lark.ts` thêm `kichThuoc: chuoi(f['Kích thước'])` cạnh `dinhDanh` (~dòng 61) và `kichThuoc: sql\`excluded.kich_thuoc\`` vào `onConflictDoUpdate` (~dòng 104). Tên cột Lark là `Kích thước` nguyên văn có dấu — sai một ký tự là Lark trả `undefined` và im lặng.
- [ ] **Step 4:** Áp di trú tay, chạy lượt đồng bộ kho, kiểm `SELECT count(*) FROM lark_wh_inventory WHERE inventory_type='VTĐG1' AND kich_thuoc IS NOT NULL` ra **38**.
- [ ] **Step 5:** Commit.

---

### Task 2: Đọc chuỗi kích thước thành số

**Files:** Create `features/dong-hang/kich-thuoc-box.ts` + `.test.ts`

**Interfaces:** Produces
```ts
export interface BaChieu { daiCm: number; rongCm: number; caoCm: number | null }
export function docKichThuoc(raw: string | null | undefined): BaChieu | null
```

- [ ] **Step 1: Test trước**
```ts
test('ba số', () => {
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
  for (const x of [null, undefined, '', '  ', 'to', '40', '40x30x20x10', '40xabc', '0x30x20', '-4x3x2']) {
    expect(docKichThuoc(x)).toBeNull();
  }
});
```
- [ ] **Step 2:** Chạy test → FAIL.
- [ ] **Step 3:** Viết `docKichThuoc`. Chỉ nhận đúng 2 hoặc 3 số **dương**; quá 3 số, số 0, số âm đều `null`. Hiểu dấu `x`/`X`/`×`, dấu phẩy thập phân, khoảng trắng thừa.
- [ ] **Step 4:** Chạy test → PASS. **Step 5:** Commit.

---

### Task 3: Gom dòng kho thành danh mục box

**Files:** Create `features/dong-hang/danh-muc-box.ts` + `.test.ts`

**Interfaces:** Consumes `docKichThuoc`, `BaChieu` · Produces
```ts
export type LoaiBox = 'thung' | 'tui' | 'khac';
export interface Box { ten: string; ma: string; loai: LoaiBox; kichThuoc: BaChieu; larkRecordIds: string[] }
export interface DongKho { recordId: string; lineitemName: string | null; dinhDanh: string | null; kichThuoc: string | null }
export function loaiTheoTen(ten: string): LoaiBox
export function gomBox(rows: DongKho[]): { box: Box[]; boLai: { ten: string; lyDo: string; recordIds: string[] }[] }
```
`ma` là **`dinhDanh`** của dòng kho đầu tiên — đây là chuỗi sẽ ghi vào ô hộp, giữ dạng mã vật tư cho `parsePackagingType`.

- [ ] **Step 1: Test trước**
```ts
test('nhiều dòng kho cùng loại → MỘT box, gom record id', () => {
  const r = gomBox([
    { recordId: 'r1', lineitemName: 'Thùng Carton 5kg', dinhDanh: 'MEAN-CAR-40x25x25-VTĐG1-WH-1', kichThuoc: '40x25x25' },
    { recordId: 'r2', lineitemName: 'Thùng Carton 5kg', dinhDanh: 'MEAN-CAR-40x25x25-VTĐG1-WH-2', kichThuoc: '40x25x25' },
  ]);
  expect(r.box).toHaveLength(1);
  expect(r.box[0].larkRecordIds).toEqual(['r1', 'r2']);
  expect(r.box[0].ma).toBe('MEAN-CAR-40x25x25-VTĐG1-WH-1');
});
test('tên quyết định loại', () => {
  expect(loaiTheoTen('Thùng Carton 5kg')).toBe('thung');
  expect(loaiTheoTen('Hộp MEAN Ver 2')).toBe('thung');
  expect(loaiTheoTen('Túi FedEx Nhỏ')).toBe('tui');
  expect(loaiTheoTen('Giấy Nến Trắng')).toBe('khac');
});
test('không đọc được kích thước thì KHÔNG mất, rơi sang boLai kèm lý do', () => {
  const r = gomBox([{ recordId: 'r9', lineitemName: 'Hộp lạ', dinhDanh: 'X', kichThuoc: null }]);
  expect(r.box).toHaveLength(0);
  expect(r.boLai[0]).toMatchObject({ ten: 'Hộp lạ', recordIds: ['r9'] });
});
test('cùng tên hai kích thước khác nhau → giữ dòng đầu, dòng sau vào boLai kèm lý do', () => { /* … */ });
```
- [ ] **Step 2:** FAIL. **Step 3:** Viết `gomBox`, `loaiTheoTen` (nhận dạng theo chữ đầu tên, bỏ dấu, không phân biệt hoa thường). **Step 4:** PASS. **Step 5:** Commit.

---

### Task 4: Bảng box của SMS và luật bản-sửa-tay-thắng

**Files:** Create `db/migrations/0207_box-dong-goi.sql`, `features/dong-hang/tron-box.ts` + `.test.ts` · Modify `db/schema.ts`

**Interfaces:** Produces bảng `box_dong_goi` (`id` uuid, `ten` text **unique**, `ma` text, `loai` text, `dai_cm`/`rong_cm`/`cao_cm` numeric nullable, `sua_tay` boolean default false, `an` boolean default false, `cap_nhat_luc`, `nguoi_sua`) và
```ts
export interface BoxSms { id: string; ten: string; ma: string; loai: LoaiBox; daiCm: number; rongCm: number; caoCm: number | null; suaTay: boolean; an: boolean }
export interface BoxHien extends Box { id: string | null; suaTay: boolean; an: boolean; lech: BaChieu | null }
export function tronBox(tuLark: Box[], tuSms: BoxSms[]): BoxHien[]
```
Khớp hai bên theo **`ten`** — không theo `record_id`, vì mirror kho **xoá** dòng của lô cũ và record_id biến mất theo lô. `lech ≠ null` nghĩa là Lark đang ghi số khác ô SMS đã khoá; chỉ để hiện cảnh báo, KHÔNG dùng để ghi đè.

- [ ] **Step 1: Test trước**
```ts
test('box chưa ai sửa → lấy số của Lark, lech null', () => { /* … */ });
test('box ĐÃ sửa tay → giữ số SMS, Lark đổi chỉ hiện lech', () => {
  const r = tronBox(
    [{ ten: 'Thùng Carton 5kg', ma: 'M1', loai: 'thung', kichThuoc: { daiCm: 40, rongCm: 25, caoCm: 28 }, larkRecordIds: ['r1'] }],
    [{ id: 'x', ten: 'Thùng Carton 5kg', ma: 'M1', loai: 'thung', daiCm: 40, rongCm: 25, caoCm: 30, suaTay: true, an: false }],
  );
  expect(r[0].kichThuoc).toEqual({ daiCm: 40, rongCm: 25, caoCm: 30 });
  expect(r[0].lech).toEqual({ daiCm: 40, rongCm: 25, caoCm: 28 });
});
test('box Lark đã xoá mà SMS đã sở hữu → VẪN còn trong danh sách', () => { /* … */ });
test('box chỉ có trong SMS (người tự thêm) vẫn hiện', () => { /* … */ });
test('box bị ẩn không biến mất, chỉ mang cờ an=true', () => { /* … */ });
```
- [ ] **Step 2:** FAIL. **Step 3:** Viết di trú + schema + `tronBox`. **Step 4:** PASS, áp di trú tay. **Step 5:** Commit.

---

### Task 5: Nới luật kiểm cho túi hai chiều

**Files:** Modify `features/dong-hang/dong-thung.ts`, `features/dong-hang/dong-thung.test.ts`

**Interfaces:** `kiemNhapDongThung` giữ nguyên chữ ký; đổi **hành vi**: hôm nay bắt "đủ ba chiều hoặc không chiều nào", sau task này chấp nhận thêm "đủ **dài + rộng**, thiếu cao".

- [ ] **Step 1: Test trước**
```ts
test('dài+rộng, KHÔNG cao → hợp lệ, cao giữ null', () => {
  const r = kiemNhapDongThung({ hop: 'M', canKg: '1', dai: '28', rong: '42', cao: '' });
  expect(r.ok).toBe(true);
  expect(r.sach?.cao).toBeNull();
});
test('chỉ có cao mà thiếu dài hoặc rộng → vẫn là lỗi', () => { /* … */ });
test('cao = 0 → lỗi, không được coi là "bỏ trống"', () => { /* … */ });
```
- [ ] **Step 2:** FAIL. **Step 3:** Sửa `kiemNhapDongThung`, kèm ghi chú vì sao nới (túi niêm phong/zip trong kho chỉ có hai số) và cảnh báo rằng thiếu cao là tín hiệu `inferPackagingFromDims` chọn hạng **Pak** — cố ý, không phải tai nạn.
- [ ] **Step 4:** Chạy **cả** `features/dong-hang/dong-thung.test.ts` lẫn `features/shipments/parse-packaging.test.ts` → PASS. **Step 5:** Commit.

---

### Task 6: Lưới chọn box có ô tìm, tự điền kích thước

**Files:** Create `features/dong-hang/loc-box.ts` + `.test.ts`, `components/dong-hang/ChonBox.tsx` · Modify `components/dong-hang/KhoiDongThung.tsx:68-69`, `features/dong-hang/queries.ts`

**Interfaces:** Consumes `BoxHien`, `tronBox`, `gomBox` · Produces
```ts
export function locBox(ds: BoxHien[], tuKhoa: string): BoxHien[]
export function daSuaDim(box: BaChieu | null, dang: { dai: string; rong: string; cao: string }): boolean
export async function danhSachBox(): Promise<BoxHien[]>   // trong queries.ts
```

- [ ] **Step 1: Test trước**
```ts
test('tìm theo tên, bỏ dấu, không phân biệt hoa thường', () => {
  expect(locBox(DS, 'fedex').map(b => b.ten)).toContain('Túi FedEx Nhỏ');
  expect(locBox(DS, 'THUNG CARTON 5').map(b => b.ten)).toContain('Thùng Carton 5kg');
});
test('tìm theo số đo', () => { expect(locBox(DS, '40x25').map(b => b.ten)).toContain('Thùng Carton 5kg'); });
test('từ khoá rỗng → nguyên danh sách trừ box ẩn và box loai="khac"', () => { /* … */ });
test('daSuaDim: giống box → false; lệch một chiều → true', () => { /* … */ });
test('daSuaDim: box hai số, người điền ô Cao → true', () => { /* … */ });
```
- [ ] **Step 2:** FAIL. **Step 3:** Viết `locBox`, `daSuaDim`. **Step 4:** PASS.
- [ ] **Step 5:** `ChonBox.tsx` — ô tìm trên, dưới là lưới thẻ chia khối **Thùng** / **Túi** (`loai='khac'` không hiện). Thẻ hiện tên và số đo. Props `{ ds: BoxHien[]; chon: string | null; onChon: (b: BoxHien) => void }`.
- [ ] **Step 6:** Nối vào `KhoiDongThung`: thay ô "Thùng đã dùng" gõ tự do bằng `<ChonBox>`; `onChon` đặt `hop = b.ma` (**mã vật tư**, không phải tên) và `dai/rong/cao` theo `b.kichThuoc` — `caoCm === null` thì để **chuỗi rỗng**, không phải `'0'`. Hiện dấu "đã sửa" khi `daSuaDim(...)`. **Đổi box thì điền lại theo box mới và xoá dấu.** Giữ một đường gõ tay cho box lạ (spec §6: box lạ không được chặn việc đóng hàng).
- [ ] **Step 7:** `npx tsc --noEmit` + eslint sạch. **Step 8:** Commit.

---

### Task 7: Siết quyền ghi đóng thùng

**Files:** Modify `features/dong-hang/actions.ts:170`

- [ ] **Step 1:** Đổi `hasPermission(role, 'view_fulfillment')` thành `'manage_fulfillment'` trong `ghiDongThung`, kèm ghi chú: đo 14/10/2026 — 7 người, `operator` (3, có người đóng hàng), `OC`, `admin` có quyền này; vai `logistics` (2) KHÔNG, vì `manage_fulfillment` còn đòi `fulfillment.brand_requests:edit`. Muốn Đức sửa được thì cấp quyền cho vai `logistics` trong màn phân quyền, **không nới cổng ở đây**. Gỡ ghi chú "lỗi đã biết, sẽ sửa riêng" ở `actions.ts:457-459` nếu nó trỏ vào đúng chỗ này.
- [ ] **Step 2:** `npm test` + `npx tsc --noEmit` xanh. **Step 3:** Commit.

---

### Task 8: Giá ước tính ưu tiên số gõ trong SMS

**Files:** Modify `features/dong-hang/lay-gia-uoc-tinh.ts:105-115` · Create `features/dong-hang/nguon-can-dim.ts` + `.test.ts`

**Interfaces:** Produces
```ts
export interface CanDim { canKg: number | null; daiCm: number | null; rongCm: number | null; caoCm: number | null; nguon: 'sms' | 'lark' | null }
export function nguonCanDim(sms: {...}, lark: {...}): CanDim
```
Theo đúng cách `nguonCanKien` (`features/dong-hang/van-don.ts:100`) đã làm cho modal vận đơn — **không viết luật thứ ba**.

- [ ] **Step 1: Test trước**
```ts
test('có số SMS → dùng số SMS, nguon="sms"', () => { /* … */ });
test('không có số SMS → rơi về số Lark, nguon="lark"', () => { /* … */ });
test('SMS có cân nhưng thiếu dim → cân SMS + dim Lark, nguon="sms"', () => { /* … */ });
test('không bên nào có → nguon=null, mọi ô null', () => { /* … */ });
```
- [ ] **Step 2:** FAIL. **Step 3:** Viết `nguonCanDim`; nạp thêm `smsWeightKg`, `smsDim*` vào `db.select` của `layGiaUocTinh` và cho nó đi qua hàm này. **Step 4:** PASS.
- [ ] **Step 5:** Kiểm tay: gõ cân vào một kiện trong `/f/dong-hang`, mở "Lên vận đơn" → giá ước tính phải hiện **ngay**, không chờ vòng Lark. **Step 6:** Commit.

---

### Task 9: Đẩy cân và kích thước lên Lark

**Files:** Create `db/migrations/0208_o-lark-do-sms-ghi.sql`, `features/lark/ghi-nguoc/patch-can-dim.ts` + `.test.ts`, `features/dong-hang/ghi-can-dim-len-lark.ts` · Modify `features/lark/ghi-nguoc/cot.ts`, `features/dong-hang/actions.ts` (cuối `ghiDongThung`)

**Interfaces:** Consumes `oLarkTrong` (`dung-patch.ts`) · Produces cột `shipments.o_lark_do_sms_ghi` (`jsonb`, mặc định `[]` — danh sách tên cột SMS đã điền) và
```ts
export function xemTruocGhiCanDim(
  kien: { canKg: number | null; daiCm: number | null; rongCm: number | null; caoCm: number | null },
  oLark: Record<string, unknown>,
  doSmsGhi: string[],
): { patch: Record<string, unknown>; canhBao: string[] }
export async function ghiCanDimLenLark(shipmentId: string): Promise<{ daGhi: boolean; canhBao?: string }>
```

- [ ] **Step 1:** Dò kiểu dữ liệu thật của ô `Weights`: `railway run npm run probe:lark-table -- tblF32k3qUhEcK5x PnFJb4IDPaIkCAssi2VlD0jNgng --cot --chitiet --loc=Weight`. Gửi sai kiểu là Lark từ chối cả bản vá. Ghi kết quả vào ghi chú của `cot.ts`.
- [ ] **Step 2:** Thêm vào `COT`: `weights: 'Weights'`, `dimensionDienTay: 'Dimension ( điền tay)'` — nguyên văn, `Dimension ( điền tay)` có khoảng trắng sau dấu mở ngoặc.
- [ ] **Step 3: Test trước**
```ts
test('ô Lark trống → điền cả hai', () => {
  const { patch } = xemTruocGhiCanDim({ canKg: 2.4, daiCm: 40, rongCm: 30, caoCm: 12 }, {}, []);
  expect(patch).toEqual({ 'Weights': 2.4, 'Dimension ( điền tay)': '40x30x12' });
});
test('ô NGƯỜI KHÁC đã gõ → không đè, có cảnh báo', () => {
  const { patch, canhBao } = xemTruocGhiCanDim(
    { canKg: 2.4, daiCm: 40, rongCm: 30, caoCm: 12 },
    { 'Weights': 2.0, 'Dimension ( điền tay)': '39x29x9' }, []);
  expect(patch).toEqual({});
  expect(canhBao).toHaveLength(2);
});
test('ô CHÍNH SMS đã ghi → ĐƯỢC đè lại, không cảnh báo', () => {
  const { patch, canhBao } = xemTruocGhiCanDim(
    { canKg: 2.1, daiCm: 40, rongCm: 30, caoCm: 12 },
    { 'Weights': 2.4, 'Dimension ( điền tay)': '40x30x12' }, ['Weights', 'Dimension ( điền tay)']);
  expect(patch['Weights']).toBe(2.1);
  expect(canhBao).toEqual([]);
});
test('thiếu chiều cao → chuỗi hai số, không chèn 0', () => {
  const { patch } = xemTruocGhiCanDim({ canKg: 1, daiCm: 28, rongCm: 42, caoCm: null }, {}, []);
  expect(patch['Dimension ( điền tay)']).toBe('28x42');
});
test('không có gì để ghi → patch rỗng', () => { /* … */ });
```
- [ ] **Step 4:** FAIL. **Step 5:** Viết `xemTruocGhiCanDim`: điền khi `oLarkTrong(ô)` **hoặc** tên cột nằm trong `doSmsGhi`; ô người khác gõ thì bỏ qua kèm một câu cảnh báo.
- [ ] **Step 6:** PASS.
- [ ] **Step 7:** Viết `ghiCanDimLenLark` theo khuôn `features/dong-hang/ghi-gia-uoc-tinh-len-lark.ts`: đọc kiện + `larkRecordId` + `oLarkDoSmsGhi`, `getLogRecordById`, dựng patch, `updateLogRecordFields`, rồi **ghi thêm tên các cột vừa gửi vào `o_lark_do_sms_ghi`**. Kiện chưa có dòng Lark → `{ daGhi: false, canhBao }`, không ném lỗi.
- [ ] **Step 8:** Gọi ở cuối `ghiDongThung`, **ngoài transaction**, trong `try` riêng — Lark hỏng không được làm hỏng việc lưu. Kết quả báo bằng toast.
- [ ] **Step 9:** Gỡ (hoặc trỏ về cùng đường ghi) ô nhập cân/dim trong `components/dong-goi/ModalDongKien.tsx` để không còn hai chỗ nhập ba con số vào hai bộ cột — spec §3.
- [ ] **Step 10:** `npm test` đầy đủ + `npx tsc --noEmit`. Áp di trú tay. **Step 11:** Commit.

---

## Tự soát

**Phủ spec:** §3 năm việc thiếu → Task 6 (việc 1,2,3), Task 9 (việc 4), Task 4+Task 10 quản lý danh mục… — **thiếu màn quản lý danh mục box**, xem dưới. §3b.1 → Task 6. §3b.2 → Task 8. §3b.3 → Task 9 (cột `o_lark_do_sms_ghi`). §3b.4 → Global Constraints. §3b.5 → Task 7. §2 nguồn dữ liệu → Task 1. Túi hai số → Task 5.

**Gap đã tìm thấy và vá:** màn quản lý danh mục box (spec §3 việc 5, §5) chưa có task. Thêm **Task 10** dưới đây.

**Chưa phủ, cố ý:** §3 dặn "việc đầu tiên không phải viết mã mà là hỏi kho vì sao hai chỗ nhập đã có gần như không ai dùng" — việc của người, phải xong trước Task 1.

---

### Task 10: Màn quản lý danh mục box

**Files:** Create `components/dong-hang/QuanLyBox.tsx` · Modify `features/dong-hang/dong-thung.ts` (thêm `kiemBox`), `features/dong-hang/actions.ts` (`luuBox`, `anBox`)

**Interfaces:** Produces
```ts
export function kiemBox(v: { ten: string; daiCm: string; rongCm: string; caoCm: string }): { ok: true; sach: {...} } | { ok: false; loi: string[] }
export async function luuBox(v: { id?: string; ten: string; ma: string; loai: LoaiBox; daiCm: number; rongCm: number; caoCm: number | null }): Promise<{ ok: boolean; loi?: string[] }>
export async function anBox(id: string, an: boolean): Promise<{ ok: boolean }>
```
`luuBox` luôn đặt `sua_tay = true` — đó chính là cái khoá của §3b.

- [ ] **Step 1:** Test `kiemBox`: tên rỗng, số âm, số 0, quá `KICH_THUOC_TOI_DA_CM`, trùng tên → lỗi đọc được bằng tiếng Việt; dài+rộng thiếu cao → hợp lệ.
- [ ] **Step 2:** FAIL. **Step 3:** Viết `kiemBox`, rồi `luuBox`/`anBox` dùng nó; cả hai gác `manage_fulfillment` như Task 7. **Step 4:** PASS.
- [ ] **Step 5:** `QuanLyBox.tsx` — liệt kê **cả** box đọc được **và** danh sách `boLai` của Task 3 (dòng kho chưa có kích thước), cho sửa tại chỗ. Box có `lech` hiện cảnh báo "Lark đang ghi …, khác ô này".
- [ ] **Step 6:** `npx tsc --noEmit` + eslint sạch. **Step 7:** Commit.
