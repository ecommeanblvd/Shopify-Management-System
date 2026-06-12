# Spec: Importer LOG-Export dò cột theo TÊN header (hết lệ thuộc vị trí)

**Ngày:** 2026-06-12
**Module:** Shipments import (`features/shipments/parse-xlsx-row.ts`, `import-actions.ts`)
**Specs nền:** shipping-reconcile-module (import LOG-Export → shipments + shipment_charges)

## 0. Bối cảnh & quyết định (cùng operator, 2026-06-12)

Parser map cột theo **vị trí cố định** (`COL` index). File LOG-Export 2024-2025
có **cùng tên header nhưng VỊ TRÍ cột khác** bản 2026 (tracking E→W, carrier
G→D, tổng AI→X, base/fuel/… đổi cả thứ tự). → parser đọc sai toàn bộ. Đây cũng
là gốc của lỗi "lệch 4 cột" từng vá thủ công.

Quyết định:
1. **Dò cột theo TÊN header** (chuẩn hoá khoảng trắng + chữ thường, so khớp đúng
   tên gốc, tránh các cột "(look up)" trùng nghĩa). File layout nào cũng đọc đúng.
2. **Giữ map vị trí cũ làm fallback** (mặc định khi không truyền header) để test
   hiện hành + caller cũ không vỡ.
3. **Orphan = bỏ qua** (đơn không có trong `shopify_orders`): GIỮ NGUYÊN hành vi
   importer hiện tại (đã `continue` + đẩy vào `orphan_orders`). Không thêm gì.

## 1. Map tên header (`features/shipments/xlsx-columns.ts`, mới, thuần TDD)

Mỗi field LOG-Export ↔ tên header gốc (so khớp **chuẩn hoá**: trim, gộp khoảng
trắng về 1 space, `toLowerCase()`). Tránh decoy "(look up)" bằng so khớp ĐÚNG tên:

| field | header |
|---|---|
| trackingNumber | `Tracking Number` |
| originHub | `Base` |
| carrier | `Couriers` |
| orderNumber | `Order Number` |
| country | `Country` |
| labelCreatedAt | `Label Created Date` |
| packagingCode | `Select VTĐG1` |
| weightKg | `Weights` |
| dimension | `Dimension ( điền tay)` |
| totalCost | `INS \| Chi phí Tổng (đ)` |
| base | `Mức giá cơ sở` |
| fuel | `Phụ phí nhiên liệu` |
| remote | `Phụ phí vùng sâu xa` |
| demand | `EES / Theo nhu cầu` |
| directSignature | `Phí kí nhận trực tiếp` |
| vat | `VAT/Thuế phí khác` |
| gogreen | `GoGreen Plus-Basic` |
| discount | `Giá chiết khấu` |
| logUniqueCode | `Log Unique code` |
| importHandling | `Phí xử lý hàng nhập` |
| elevatedRisk | `Phí rủi ro gia tăng` |

```ts
export type ColumnKey = 'trackingNumber'|'originHub'|'carrier'|'orderNumber'|'country'
  |'labelCreatedAt'|'packagingCode'|'weightKg'|'dimension'|'totalCost'|'base'|'fuel'
  |'remote'|'demand'|'directSignature'|'vat'|'gogreen'|'discount'|'logUniqueCode'
  |'importHandling'|'elevatedRisk';
export type ColumnMap = Record<ColumnKey, number>; // -1 = không tìm thấy

/** Cột bắt buộc (thiếu ⇒ sai định dạng file). */
export const REQUIRED_COLUMNS: ColumnKey[] = ['trackingNumber','totalCost','carrier','orderNumber','country'];

/** Map vị trí cố định layout 2026 — fallback + giữ test cũ chạy. */
export const LEGACY_COLUMN_MAP: ColumnMap = { trackingNumber:4, originHub:5, carrier:6,
  orderNumber:8, country:12, labelCreatedAt:15, packagingCode:26, weightKg:27, dimension:28,
  totalCost:34, base:35, fuel:36, remote:37, demand:38, directSignature:39, vat:40, gogreen:41,
  discount:42, logUniqueCode:46, importHandling:88, elevatedRisk:74 };

export interface ResolveResult {
  ok: boolean;
  columns: ColumnMap;      // field → index (-1 nếu không thấy)
  missingRequired: ColumnKey[];
}
/** Dò index theo tên header (chuẩn hoá). */
export function resolveColumns(header: ReadonlyArray<unknown>): ResolveResult;
```

- `resolveColumns`: chuẩn hoá từng ô header, build `norm→index` (ô đầu tiên thắng
  nếu trùng), tra từng field theo tên đã chuẩn hoá; không thấy → -1. `ok =
  REQUIRED_COLUMNS đều ≥ 0`; `missingRequired` liệt kê field bắt buộc thiếu.

## 2. Parser nhận ColumnMap (`features/shipments/parse-xlsx-row.ts`)

- Thay hằng `COL` cục bộ bằng `LEGACY_COLUMN_MAP` import từ `xlsx-columns.ts`
  (giữ tương thích). `parseXlsxRow(row, cols: ColumnMap = LEGACY_COLUMN_MAP)`.
- Trong thân hàm: mọi `row[COL.x]` → `row[cols.x]` (index -1 → `row[-1]` =
  undefined → `asNumber/asString` trả null — an toàn).
- `consistentImportHandling(row, totalAmount, cols)` nhận thêm `cols`.
- Không đổi logic parse/skip/coerce. Chỉ tham số hoá nguồn index.

## 3. Importer build map từ header (`features/shipments/import-actions.ts`)

- `ImportOptions` thêm `header?: ReadonlyArray<unknown>`.
- Đầu `importLogExport`: nếu có `opts.header` → `const r = resolveColumns(header)`;
  nếu `!r.ok` → trả summary rỗng kèm 1 error `"Thiếu cột bắt buộc: <missing>"`
  (không parse tiếp). `cols = r.columns`. Nếu KHÔNG có header → `cols =
  LEGACY_COLUMN_MAP` (back-compat).
- Truyền `cols` vào `parseXlsxRow(rows[i], cols)` trong PHASE 1.
- Phần còn lại (resolve store/order, upsert 1:1, orphan skip) GIỮ NGUYÊN.

## 4. CLI truyền header (`scripts/import-ops-xlsx.ts`)

- Đang đọc `allRows`, `dataRows = allRows.slice(1)`. Truyền thêm
  `header: allRows[0]` vào `importLogExport(dataRows, { dryRun, header: allRows[0] })`.

## 5. Kiểm thử (TDD)

- `xlsx-columns.test.ts`:
  (a) resolveColumns trên header layout **2024-25** (tự dựng mảng tên đúng vị trí
  W/D/F/X…) → index khớp; (b) trên layout **2026** → index khớp; (c) chuẩn hoá:
  "Giá Chiết khấu" (hoa) vẫn khớp `discount`; (d) **decoy** "Country (look up)",
  "Couriers (look up)", "Tracking test (look up)" KHÔNG cướp field chính; (e)
  thiếu cột bắt buộc (vd bỏ "Tracking Number") → `ok=false`, `missingRequired`
  chứa `trackingNumber`; (f) cột optional thiếu → -1.
- `parse-xlsx-row.test.ts`: giữ test cũ (mặc định LEGACY map) xanh; thêm 1 test
  dựng **row layout 2024-25** + `resolveColumns(header)` → `parseXlsxRow(row, cols)`
  ra ParsedShipment đúng (tracking/carrier/total/base…).
- `tsc` + `eslint` sạch; suite xanh.

## 6. Áp dữ liệu (sau khi code lên)

- Dry-run `scripts/import-ops-xlsx.ts <file2024-25> --dry-run` → in parsed /
  imported(new) / updated / orphan; xác nhận cột đọc đúng (tổng tiền hợp lý).
- Báo operator: ~2.230 đơn khớp sẽ nạp, ~3.600 orphan bỏ qua, vài giá mẫu.
- `--apply`, verify không trùng (1 charge/shipment), cache đối soát tự xoá.

## 7. Ngoài phạm vi

- Không tự tạo đơn cho orphan (giữ skip).
- Không sửa engine/đối soát.
- Không build UI upload file (vẫn dùng CLI).
- Không suy đoán alias mờ — chỉ so khớp đúng tên đã chuẩn hoá (đủ cho cả 2 layout).
