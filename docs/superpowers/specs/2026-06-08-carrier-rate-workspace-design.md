# Carrier Rate Workspace — Design

**Date:** 2026-06-08
**Status:** Approved (design)
**Topic:** Gộp Zones + Rate Matrix vào một workspace read-only, có search country → zone.

---

## Problem

Hiện tại một carrier account có hai trang tách rời:

- `/f/carrier-rates/[id]/zones` — gom country vào zone (Zone 1, Zone A…), kèm form rename / add / delete / edit-country.
- `/f/carrier-rates/[id]/matrix` — bảng cost theo (zone × tier), inline-edit từng cell + CSV import.

Người dùng phải nhảy qua lại giữa hai trang để đối chiếu "country này thuộc zone nào, và cost của zone đó ra sao". Khó xem tổng thể, khó tìm kiếm.

## Goal

Một trang **workspace** duy nhất, **read-only**, xếp dọc:

1. Rate matrix ở trên.
2. Bảng zones (zone → countries) ở dưới.
3. Một ô search theo **tên country hoặc ISO-2** → cho biết country đó thuộc zone nào, đồng thời highlight cột zone trong matrix và card zone bên dưới.

## Non-goals

- Không sửa tay bất kỳ dữ liệu carrier nào trong workspace. Toàn bộ thông tin carrier là **read-only**; nguồn dữ liệu (source of truth) là file upload (rate card PDF). Đây là quyết định sản phẩm rõ ràng từ người dùng.
- Không xây đường nạp zone + country-assignment từ upload trong task này (xem "Open dependency").
- Không đụng tới surcharges, remote-postcodes, weight-tiers, calculator, push — chúng giữ nguyên trang riêng.

---

## Architecture

### Route

- **Thêm:** `app/(dashboard)/f/carrier-rates/[id]/workspace/page.tsx` — server component, `dynamic = 'force-dynamic'`.
- **Bỏ điều hướng tới** `/zones` và `/matrix` từ UI.
  - Hai route cũ chuyển thành **redirect → `/workspace`** (giữ link/bookmark cũ không vỡ), TRỪ một ngoại lệ ở dưới.
  - **Ngoại lệ tạm:** giữ lại `/zones` như một route **admin-seed ẩn** (không link từ bất kỳ đâu trong UI) để còn cách tạo/sửa zone bằng tay cho tới khi có đường nạp zone từ upload. Xem "Open dependency".
  - Quyết định cuối: `/matrix` → redirect tới `/workspace`. `/zones` → **giữ nguyên trang sửa hiện tại nhưng gỡ mọi link trỏ tới nó** (truy cập bằng URL trực tiếp).

### Trang detail account (`[id]/page.tsx`)

- Gộp hai `SubSection` "Zones" và "Rate matrix" thành **một** `SubSection` "Rate workspace" → `/f/carrier-rates/[id]/workspace`, icon `Coins` (hoặc `LayoutGrid`), accent.
- Các SubSection khác (weight-tiers, surcharges, remote-postcodes, calculator, push) giữ nguyên.

### Workspace page — bố cục

```
┌ breadcrumb: ‹ {account.name} ────────────────────────────┐
│ header: "Rate workspace"                                  │
│   [Rate card ▾]  [Upload PDF]  [View source PDF]          │
│   effective: 28-Oct-2025 → (open)        (read-only text) │
├───────────────────────────────────────────────────────────┤
│ 🔍 Search country (name or ISO-2)                         │
│   → banner: 🇯🇵 Japan (JP) thuộc Zone 3  [cuộn tới ↓]      │
├───────────────────────────────────────────────────────────┤
│ RATE MATRIX  (read-only, cột zone khớp được highlight)    │
│   tier × zone grid                                        │
├───────────────────────────────────────────────────────────┤
│ ZONES  (read-only cards, card/country khớp được highlight)│
│   Zone 1 · 🇻🇳 🇹🇭   |   Zone 2 · 🇸🇬 🇲🇾                    │
│   Zone 3 · 🇯🇵 🇰🇷   |   Zone 4 · 🇺🇸 🇬🇧 🇩🇪                │
└───────────────────────────────────────────────────────────┘
```

---

## Components

### Tái dùng (giữ nguyên / thêm prop)

- `RateCardSelect` — chọn rate card qua `?card=` (route-relative, hoạt động sẵn).
- `RateCardUploadDialog` — đường nạp source-of-truth, giữ.
- `RateMatrix` — render với `canEdit={false}`. Thêm prop tùy chọn `highlightZoneId?: string | null` để tô viền cột zone đang khớp search. Khi `canEdit=false`, không render input, không gọi `setCellAction`/`clearCellAction`.
- `CountryChip` — tách từ `zones/page.tsx` ra file dùng chung `components/carrier-rates/CountryChip.tsx` (kèm `iso2ToFlag`, `countryName`). Cả workspace và trang `/zones` ẩn cùng import từ đây (tránh trùng lặp).

### Mới

- **`components/carrier-rates/CountrySearch.tsx`** (client component)
  - Props: `zones: { id: string; label: string; countries: string[] }[]`.
  - State: chuỗi search. Khi gõ:
    - Chuẩn hóa input: trim, upper. So khớp theo ISO-2 (`=== code`) **và** theo tên country (`countryName(code)` chứa substring, case-insensitive).
    - Tìm `{ code, zoneId, zoneLabel }` đầu tiên (một country chỉ thuộc một zone/account).
    - Phát kết quả ra ngoài qua callback / shared state để page highlight.
  - Render banner kết quả: cờ + `Country (CODE) thuộc {zoneLabel}` + nút "cuộn tới zone" (`scrollIntoView` tới `#zone-{id}`). Không khớp → "Không thuộc zone nào trong card này."
  - Chạy **hoàn toàn client-side** trên data đã load; không server round-trip.

- **`components/carrier-rates/RateWorkspace.tsx`** (client component, orchestrator)
  - Nhận `zones`, `tiers`, `cells`, `costCurrency` (đã serialize từ server).
  - Giữ state `matchedZoneId` + `matchedCode` do `CountrySearch` set.
  - Truyền `highlightZoneId={matchedZoneId}` xuống `RateMatrix`.
  - Render danh sách zone read-only; card có `id={`zone-${z.id}`}`, tô highlight khi `z.id === matchedZoneId`; trong card, `CountryChip` của country khớp được tô `<mark>`.
  - Lý do gom vào một client component: search → highlight cần shared state phía client; server component không giữ state tương tác.

### Bỏ khỏi workspace (so với trang cũ)

- Inline cell editor + `setCell`/`clearCell` wrappers.
- Form CSV import (`importCsvAction`, textarea).
- `RateCardWindowEdit` → thay bằng text read-only của effective window.
- Toàn bộ form zone: `addZone`, `renameZone`, `deleteZone`, `setCountries`.

---

## Data flow

Server component `workspace/page.tsx`:

1. Auth + RBAC: yêu cầu `view_carrier_rates`. **Không** cần `manage_carrier_rates` (read-only).
2. `getAccount(id)`; `notFound()` nếu không có.
3. `listRateCardsForAccount(id)` → chọn card (`?card=` hợp lệ → else `getCurrentCardId` → else card mới nhất). Nếu chưa có card: hiện empty state + nút upload (như matrix page hiện tại).
4. `loadMatrix(id, selectedCardId)` → `{ zones, tiers, cells }`.
5. `listZonesWithCountries(id)` → zones + countries (search dùng cái này; chứa country, trong khi `loadMatrix.zones` chỉ có label/id).
   - **Lưu ý nhất quán:** dùng `listZonesWithCountries` làm nguồn cho phần hiển thị zones + search; map `id` của nó khớp với `zones` của `loadMatrix` (cùng `carrierZones.id`).
6. Truyền xuống `RateWorkspace` (client). Mọi tương tác search/highlight ở client, không revalidate.

Không có server action ghi trong workspace.

---

## Cập nhật liên quan

- `features/carrier-rates/matrix-actions.ts` — các `setCell/clearCell/importMatrix` vẫn tồn tại (dùng bởi route `/zones` ẩn nếu cần & test), nhưng nếu chúng `revalidatePath('.../matrix')` thì giữ; `/matrix` redirect không ảnh hưởng server action. Kiểm tra lại `revalidatePath` không trỏ tới route đã xóa gây lỗi runtime (revalidate path không tồn tại chỉ là no-op, an toàn).
- `calculator/page.tsx` — nếu có link "← matrix" hoặc tương tự, đổi sang `/workspace`.
- Test: `matrix-actions.test.ts` giữ (logic không đổi). Thêm test cho `CountrySearch` matching (ISO-2 + tên, không khớp) và cho redirect route nếu khả thi.

---

## Error / edge cases

- **Chưa có rate card:** empty state, nút upload (nếu `manage_carrier_rates`), không render matrix/zones.
- **Có card nhưng chưa có zone/tier:** matrix hiện 0 cột/hàng; zones hiện empty hint. Search báo "Chưa có zone."
- **Country code không hợp lệ (không phải ISO-2):** `CountryChip` đã fallback hiện raw code; search vẫn so khớp theo raw.
- **Search khớp nhiều?** Một country chỉ thuộc một zone/account (ràng buộc DB hiện có) → chỉ một kết quả cho mỗi country. Nếu input khớp nhiều country (vd "United" → United States, United Kingdom) → hiện kết quả đầu + đếm "+N khác", hoặc list ngắn. MVP: hiện country khớp đầu tiên theo thứ tự zone/position; ghi rõ là MVP.
- **Quyền:** không `view_carrier_rates` → Forbidden (như các trang khác).

---

## Open dependency (cần làm sau, ngoài task này)

Hiện **zone + country-assignment chỉ tạo/sửa được bằng tay** qua trang `/zones`. PDF import (`buildRateCardCells`) chỉ map cost vào zone **đã tồn tại** theo label — không tạo zone, không gán country.

Do người dùng yêu cầu read-only hoàn toàn, nhưng chưa có đường nạp zone từ upload, ta **tạm giữ route `/zones` như admin-seed ẩn** (không link trong UI). Việc "nạp zone + country từ file upload (source of truth)" là **task riêng** về sau: cần parser trích zone↔country từ rate sheet, hoặc một định dạng upload riêng cho zone scheme.

→ Cần người dùng xác nhận cách tạm này khi review spec.

---

## Testing

- Unit: `CountrySearch` matching — ISO-2 exact, tên (substring, case-insensitive), không khớp, nhiều khớp.
- Unit: helper `iso2ToFlag` / `countryName` (sau khi tách file dùng chung) — giữ hành vi.
- Component/integration (nếu hạ tầng có): workspace render read-only, không có input editable, không có form.
- Regression: trang `/zones` ẩn vẫn sửa được; `/matrix` redirect tới `/workspace`.
