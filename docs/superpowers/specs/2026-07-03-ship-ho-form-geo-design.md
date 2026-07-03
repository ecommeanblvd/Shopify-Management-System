# Form ship hộ — Country/City search-dropdown + Phone dial-code — Design

> Nâng UX form tạo đơn ship hộ: country + thành phố từ ô text → searchable dropdown (pick);
> thêm ô số điện thoại có mã vùng tự set theo country. Không API, không dep mới, không đổi backend.

**Ngày:** 2026-07-03
**Trạng thái:** đã duyệt thiết kế, chờ plan.
**Nhánh:** `feat/ship-ho-form-geo`

## 1. Bối cảnh & mục tiêu

Form `app/(dashboard)/f/ship-ho/new/NewOrderForm.tsx` hiện để country + thành phố dạng **text tự do**,
chưa có ô số điện thoại (dù cột `recipient_phone` + field `recipientPhone` trong action đã tồn tại).

Mục tiêu:
1. **Country**: text → searchable dropdown (search + pick), vẫn lưu **ISO2**.
2. **Thành phố**: text → searchable dropdown lọc theo country đã chọn (bundle major cities), cho **free-entry** khi không có trong list.
3. **Số điện thoại** (mới): mã vùng (dial code) **tự set theo country** + ô số → lưu `recipientPhone`.

Ràng buộc: **không API ngoài, không thêm dependency, không đổi schema/backend** (action đã nhận `country`/`city`/`recipientPhone`).

## 2. Quyết định đã chốt (brainstorm)

| Chủ đề | Quyết định |
|---|---|
| Nguồn country + dial code | Dataset tĩnh đầy đủ (~250 nước) bundle trong repo |
| Nguồn thành phố | **Bundle major cities theo country** (curate cho các nước hay ship) + **free-entry** fallback |
| Combobox | **Component nhẹ tự viết** (codebase chưa có cmdk/Command) — không thêm dep |
| Backend | Không đổi — chỉ sửa UI + thêm data + component |

## 3. Dữ liệu (tĩnh, không dep/API)

### 3.1 `lib/geo/countries.ts`
- `export interface Country { iso2: string; name: string; dialCode: string }`
- `export const COUNTRIES: Country[]` — đầy đủ ~250 nước ISO-3166-1 alpha-2 + tên tiếng Anh + mã gọi quốc tế (vd `{iso2:'US', name:'United States', dialCode:'1'}`, `{iso2:'VN', name:'Việt Nam', dialCode:'84'}`).
- `export function dialCodeFor(iso2: string): string | null` — tra dial code theo ISO2 (uppercase-insensitive); không có → null.
- `export function countryByIso(iso2: string): Country | null`.

### 3.2 `lib/geo/cities.ts`
- `export const CITIES_BY_ISO: Record<string, string[]>` — major cities theo ISO2, **curate cho các nước MEAN hay ship tới** (US, SA, AE, QA, KW, GB, AU, CA, JP, SG, CN, HK, VN, FR, DE, TH, MY, PH, IL… — bám theo carrier zones). Mỗi nước ~15-40 TP lớn.
- `export function citiesFor(iso2: string): string[]` — trả list TP theo ISO2 (rỗng nếu chưa curate — UI vẫn cho free-entry).

## 4. Component (không thêm dep)

### 4.1 `components/ui/search-select.tsx` (client)
Combobox nhẹ dùng lại cho **country + city**:
- Props: `value: string`, `onChange(value: string)`, `options: { value: string; label: string }[]`, `placeholder?`, `allowFreeEntry?: boolean`, `disabled?`.
- Hành vi: ô input lọc (case-insensitive, match label); danh sách gợi ý (popover/div dưới ô) click chọn → set `value`; `allowFreeEntry=true` → giá trị gõ vào cũng nhận (không ép trong list); `false` → chỉ nhận khi khớp option.
- Không cần thư viện — chỉ `useState` + list filter + click/keyboard (Esc đóng, Enter chọn item đầu). Tái dùng `Card`/util có sẵn cho style.
- **Phần thuần tách được để test**: `filterOptions(options, query)` (lọc + rank theo prefix/substring).

## 5. Hành vi form (`NewOrderForm.tsx`)

- **Country**: `SearchSelect` với `options = COUNTRIES.map(c => ({ value:c.iso2, label:`${c.name} (${c.iso2})` }))`, `allowFreeEntry=false`. Lưu `f.country = iso2`.
- **Thành phố**: `SearchSelect` với `options = citiesFor(f.country).map(c => ({value:c,label:c}))`, `allowFreeEntry=true`, `disabled` khi chưa chọn country. Đổi country → **reset city** (tránh TP không thuộc nước mới).
- **Số điện thoại** (mới, dưới người nhận): prefix hiển thị `+${dialCodeFor(f.country) ?? '—'}` (readonly, đổi theo country) + ô nhập số. Submit: `recipientPhone = dial && số ? `+${dial} ${số}` : (số || undefined)`.
- Giữ nguyên các field khác + nút "Tạo đơn & tính giá".

## 6. Data flow / lưu

- Country → `iso2` (như cũ; action đã `.toUpperCase()`).
- City → string TP (chọn hoặc gõ) → cột `city`.
- Phone → ghép `+<dial> <số>` → `recipientPhone` (cột đã có).
- **Không đổi** `orders-actions.ts`, schema, quote-adapter (đã dùng `country`/`city`).

## 7. Test

- Thuần: `dialCodeFor` (có/không/khác hoa thường), `countryByIso`, `citiesFor` (nước có/không curate), `filterOptions` (prefix ưu tiên, substring, rỗng), ghép phone (`buildPhone(dial, số)` nếu tách helper).
- Component: smoke (render, chọn item, free-entry) — nhẹ.

## 8. YAGNI / không làm

- Không API autocomplete, không cmdk/thư viện phone, không validate định dạng phone theo nước (chỉ ghép prefix), không cờ (flag emoji) bắt buộc.
- City list không cần đủ mọi TP — free-entry lo phần còn lại.
- Chỉ áp cho form **tạo đơn** (new); import lô giữ nguyên (partner tự cấp data).
