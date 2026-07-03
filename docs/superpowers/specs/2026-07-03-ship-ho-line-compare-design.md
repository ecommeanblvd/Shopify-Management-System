# Form ship hộ — So sánh giá line ship + confirm-to-create — Design

> Thay vì chọn carrier account rồi tự auto áp vào đơn, form tạo đơn ship hộ hiện bảng so sánh
> giá MỌI line ship (cước carrier + giá thu + margin) → user chọn 1 line + confirm mới tạo đơn.

**Ngày:** 2026-07-03
**Trạng thái:** đã duyệt thiết kế, chờ plan.
**Nhánh:** `feat/ship-ho-form-geo` (gộp PR #262).

## 1. Bối cảnh & mục tiêu

Hiện form `NewOrderForm.tsx`: chọn 1 carrier account trong dropdown → `createShipHoOrder` tự quote +
áp vào đơn ngay. Không thấy trước giá, không so sánh line.

Mục tiêu: **preview trước, tạo sau**:
1. Điền thông tin đơn (không chọn carrier trước).
2. Bấm "So sánh giá line" → bảng **các line ra giá được**, mỗi line: cước carrier · giá thu (cost+markup) · margin. Sort giá thu tăng dần.
3. Chọn 1 line + "Confirm & tạo đơn" → tạo đơn với line đó.

Ràng buộc: **không đổi schema/backend**; tái dùng `quoteShipHoOrder`/`applyMarkup`/`createShipHoOrder` đã có.

## 2. Quyết định đã chốt (brainstorm)

| Chủ đề | Quyết định |
|---|---|
| Line không quote được tuyến đó | **Ẩn** (chỉ hiện line ra giá được) |
| Cột mỗi line | **Cước carrier · Giá thu · Margin** |
| Line = ? | Mỗi **carrier account đang bật** (`enabled`) |
| Tạo đơn | Sau khi chọn line + bấm confirm (không auto) |

## 3. Server action mới

### `features/ship-ho/quote-lines-actions.ts`
```
quoteShipHoLines(input: {
  partnerBrandSlug: string; weightKg: string; country: string; city?: string;
  postcode?: string; dimLengthCm?: string; dimWidthCm?: string; dimHeightCm?: string;
  packagingType?: 'bag' | 'box' | null;
}): Promise<{ lines: LineQuote[]; error?: string }>
```
- Guard `requireManageShipHo()`.
- Validate: có `partnerBrandSlug`, `country`, `weightKg > 0` → thiếu → `{ lines: [], error }`.
- Lookup markup: `shipHoPartners.markupPercent` theo `partnerBrandSlug` (mặc định '0').
- Lấy carrier accounts **enabled** (`listAccounts()` lọc `enabled`).
- Với mỗi account: `quoteShipHoOrder({ carrierAccountId, weightKg, dimensions, packagingType, destinationCountry, destinationPostcode, destinationCity })`:
  - `ok` → `{ chargedVnd, marginVnd } = summarizeLine(carrierCostVnd, markup)`; push `LineQuote`.
  - `!ok` → **bỏ qua** (ẩn).
- Sort `lines` theo `chargedVnd` tăng dần.
- `LineQuote = { accountId: string; name: string; carrierKey: string | null; carrierCostVnd: number; chargedVnd: number; marginVnd: number }`.

### `features/ship-ho/quote-lines-logic.ts` (thuần)
```
summarizeLine(carrierCostVnd: number, markupPercent: number): { chargedVnd: number; marginVnd: number }
```
- `chargedVnd = applyMarkup(carrierCostVnd, markupPercent)` (tái dùng `applyMarkup` từ `markup.ts`).
- `marginVnd = chargedVnd - carrierCostVnd`.

## 4. Form UX (`NewOrderForm.tsx`)

- **Bỏ** dropdown "Carrier account" khỏi phần nhập.
- Thêm nút **"So sánh giá line"** — disable khi thiếu `partnerBrandSlug || country || weightKg`. Bấm → gọi `quoteShipHoLines` → set `lines` + reset `selectedAccountId`.
- **Bảng lines** (dưới nút): mỗi dòng có radio chọn + cột `Line (name · carrier)` · `Cước carrier` · `Giá thu` · `Margin`. Line đầu (rẻ nhất) không auto-chọn (user chủ động).
- Sau khi chọn 1 line → nút **"Confirm & tạo đơn"** (thay nút "Tạo đơn & tính giá"). Bấm → `createShipHoOrder({ ...fields, carrierAccountId: selectedAccountId, carrierKey })` → điều hướng detail.
- **Invalidate**: khi đổi bất kỳ input ảnh hưởng giá (partner, country, city, postcode, weight, dims, packaging) → **clear `lines` + `selectedAccountId`** (buộc so sánh lại, tránh áp giá cũ).
- **Rỗng**: `lines.length === 0` sau khi so sánh → hiện "Không line nào áp dụng cho tuyến này — kiểm tra cân/địa chỉ".

## 5. Data flow / create

- Preview: `quoteShipHoLines` chỉ tính, **không ghi DB**.
- Create: `createShipHoOrder(..., carrierAccountId = line đã chọn)` → action tự re-quote + ghi snapshot (khớp giá preview vì cùng input). Country ISO2 / city / phone như flow geo.
- **Không đổi** `orders-actions.ts`, schema, `quote-adapter.ts`.

## 6. Test

- Thuần: `summarizeLine(cost, markup)` — charged = applyMarkup, margin = charged−cost (gồm ca markup 0, lỗ khi cost>charged không xảy ra vì markup ≥ 0 → margin ≥ 0).
- I/O `quoteShipHoLines`: mỏng (loop quote + summarize + sort) — không unit-test DB; logic thuần đã test.

## 7. YAGNI / không làm

- Không lưu bảng so sánh; không cache; không tự chọn line rẻ nhất.
- Không đổi flow import lô (partner tự cấp; không quote nhiều line).
- Không thêm cột thời gian giao/ETA (chưa có dữ liệu).
