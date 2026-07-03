# Ship hộ — trường địa chỉ custom theo quốc gia

**Ngày:** 2026-07-03
**Trạng thái:** Đã duyệt thiết kế

## Bối cảnh

Form tạo đơn ship hộ (`app/(dashboard)/f/ship-ho/new/NewOrderForm.tsx`) hiện thu địa chỉ qua các cột chung
(`address1/address2/city/province/postcode/country`). Một số tuyến Trung Đông cần thêm thông tin định danh
địa chỉ mà bộ field chung không diễn đạt được:

- **Saudi Arabia (SA):** cần **Short Address** theo chuẩn Saudi National Address (dạng `RBMA4176` = 4 chữ + 4 số),
  hoặc nếu không có thì gửi **Google Maps link**.
- **Các nước GCC còn lại (AE, QA, KW, BH, OM):** cần **House Number** riêng.

Dữ liệu này sẽ được đẩy sang carrier/label sau, nên phải lưu có cấu trúc và validate chặt (không chỉ free-text).

## Quyết định

| Nội dung | Chốt |
|---|---|
| House Number (bắt buộc) | AE, QA, KW, BH, OM (5 nước GCC, **không** gồm SA) |
| Saudi Arabia | Short Address **hoặc** Google Maps link — bắt buộc ít nhất 1 |
| Short Address | Chuẩn hoá `trim().toUpperCase()`, khớp `^[A-Z]{4}[0-9]{4}$` |
| Google Maps link | Phải là URL `http(s)` hợp lệ |
| Lưu trữ | 3 cột dedicated `house_number`, `short_address`, `maps_url` (đúng pattern các cột địa chỉ hiện có) |
| Validate | Hàm thuần dùng chung client (UX) + server (authoritative) |

## Kiến trúc

### 1. Nguồn sự thật — `lib/geo/address-requirements.ts` (thuần, không phụ thuộc React/DB)

```ts
export interface AddressExtraReq {
  houseNumber?: true;        // house number bắt buộc
  shortAddressOrMaps?: true; // cần short address HOẶC maps url
}

export const ADDRESS_EXTRA: Record<string, AddressExtraReq> = {
  SA: { shortAddressOrMaps: true },
  AE: { houseNumber: true },
  QA: { houseNumber: true },
  KW: { houseNumber: true },
  BH: { houseNumber: true },
  OM: { houseNumber: true },
};

export interface AddressExtraInput {
  houseNumber?: string;
  shortAddress?: string;
  mapsUrl?: string;
}

// Trả về input đã chuẩn hoá + kết quả validate. Nước ngoài phạm vi → luôn ok.
export function validateAddressExtra(
  country: string,
  input: AddressExtraInput,
): { ok: boolean; error?: string; normalized: AddressExtraInput };
```

Quy tắc trong `validateAddressExtra`:
- Chuẩn hoá country `trim().toUpperCase()`; tra `ADDRESS_EXTRA`. Không có entry → `{ ok: true }`, normalized rỗng các field extra.
- `houseNumber` bắt buộc (khi `req.houseNumber`): sau `trim()` không rỗng, ngược lại `error`.
- `shortAddressOrMaps` (SA):
  - `shortAddress` (nếu có) chuẩn hoá `trim().toUpperCase()`, phải khớp `^[A-Z]{4}[0-9]{4}$`, sai → `error`.
  - `mapsUrl` (nếu có) phải parse được là URL `http(s)`, sai → `error`.
  - Phải có **ít nhất một** trong hai sau chuẩn hoá; không có → `error`.
- `normalized` chỉ chứa các field liên quan đến nước đó (nước khác trả về không kèm extra để không lưu rác).

### 2. Form — `NewOrderForm.tsx`

- Thêm vào state `f`: `houseNumber`, `shortAddress`, `mapsUrl` (mặc định `''`).
- Sau ô "Địa chỉ", render **có điều kiện** theo `ADDRESS_EXTRA[f.country]`:
  - `req.houseNumber` → hiện input **House Number** (bắt buộc).
  - `req.shortAddressOrMaps` → hiện input **Short Address** + input **Google Maps link**, kèm ghi chú "nhập ít nhất 1".
- Đổi quốc gia (`patch({ country })`) reset cả 3 field extra về `''`.
- Trước khi bấm "Confirm & tạo đơn": gọi `validateAddressExtra(f.country, …)`; nếu `!ok` hiện lỗi inline và không submit.
- Gửi `normalized` (houseNumber/shortAddress/mapsUrl) kèm vào `createShipHoOrder`.

### 3. Server — `features/ship-ho/orders-actions.ts`

- Mở rộng `CreateShipHoOrderInput`: `houseNumber?`, `shortAddress?`, `mapsUrl?`.
- Trong `createShipHoOrder`, sau các guard hiện có: gọi `validateAddressExtra(input.country, …)`; `!ok` → `return { ok: false, error }`.
- Lưu `normalized.houseNumber/shortAddress/mapsUrl` (hoặc `null`) vào 3 cột mới.

### 4. DB

- Migration `db/migrations/0085_ship-ho-address-extra.sql`:
  ```sql
  ALTER TABLE "ship_ho_orders" ADD COLUMN "house_number" text;
  ALTER TABLE "ship_ho_orders" ADD COLUMN "short_address" text;
  ALTER TABLE "ship_ho_orders" ADD COLUMN "maps_url" text;
  ```
- `db/schema.ts`: thêm `houseNumber`, `shortAddress`, `mapsUrl` (text, nullable) trong nhóm địa chỉ của `shipHoOrders`.
- Ưu tiên `drizzle-kit generate` để đồng bộ snapshot `db/migrations/meta`; nếu output lệch số/tên thì chấp nhận tên file do drizzle sinh.

### 5. Hiển thị — `app/(dashboard)/f/ship-ho/[id]/page.tsx`

- Trong block "Đến", nếu có `houseNumber/shortAddress/mapsUrl` thì hiện thêm dòng tương ứng (maps hiển thị link bấm được).

### 6. Test

- `lib/geo/address-requirements.test.ts` (thuần):
  - SA: chỉ shortAddress hợp lệ → ok; shortAddress sai format → lỗi; chỉ mapsUrl hợp lệ → ok; mapsUrl không phải URL → lỗi; cả hai rỗng → lỗi; short address thường `rbma4176` được uppercase.
  - GCC (vd AE): thiếu houseNumber → lỗi; có houseNumber → ok.
  - Nước ngoài phạm vi (vd US): luôn ok, normalized không chứa extra.

## Ngoài phạm vi (YAGNI)

- Không đẩy thật sang API carrier/label lần này (chỉ lưu có cấu trúc để sẵn sàng).
- Không thêm field cho nước ngoài GCC.
- Không sửa luồng import/reconcile (chỉ form tạo đơn thủ công).
