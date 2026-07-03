# Ship hộ — Giá offer (markup base-only) + Rate card per partner

**Ngày:** 2026-07-03
**Trạng thái:** Đã duyệt thiết kế

## Bối cảnh & vấn đề

Hiện giá thu partner = `carrierCost × (1 + markup%)` — markup nhân lên **toàn bộ** cước FedEx
(base + fuel + phụ phí + VAT). Điều này khiến margin phụ thuộc biến động fuel/phụ phí và khó cam kết
một bảng giá ổn định cho đối tác.

Mô hình mới: **markup CHỈ trên cước base của bảng giá**; fuel, phụ phí và VAT được **pass-through**
đúng theo FedEx tính khi xuất bill. Đồng thời cung cấp **rate card offer** (bảng giá base đã markup)
cho từng đối tác để gửi báo giá, với **margin base tối thiểu 30%** nhằm đảm bảo rủi ro.

## Quyết định

| Nội dung | Chốt |
|---|---|
| Công thức giá đơn | `chargedVnd = carrierCostVnd + round(baseVnd × markup/100)` → margin = `base × markup%` |
| Fuel / phụ phí / VAT | Pass-through nguyên giá FedEx (đã nằm trong `carrierCost`), KHÔNG markup |
| Markup tính trên | `base` **công bố** của bảng giá (`breakdown.base`); volume discount (nếu có) giữ lại thành lãi thêm |
| Sàn markup | `markupPercent ≥ 30` — **chặn** khi lưu partner + **cảnh báo** badge đỏ cho partner cũ < 30% |
| Rate card | Lưới **zone (cột) × mức cân (hàng)**, ô = `round(baseVnd × (1+markup))` (CHỈ base). Carrier: **chỉ FedEx** |
| Rate card notes | Link fuel FedEx + liệt kê các loại phụ phí active của account (sẽ do FedEx thu khi bill) |
| Rate card lưu trữ | Generate **live** từ snapshot FedEx × markup partner. KHÔNG lưu DB |
| Export | XLSX + PDF (tái dùng hạ tầng statement-export) |
| Áp production | Từ giờ trở đi cho mọi partner ship hộ; đơn đã quote giữ snapshot cũ |
| Đơn test Kalisa | Set về `draft` + requote bằng công thức mới (một lần) |
| Migration DB | KHÔNG cần (base đã nằm trong `quoteBreakdown` jsonb; dùng lại cột giá hiện có) |

## Kiến trúc

Chia 2 phần thực thi tuần tự, chung một core thuần (`offer-pricing.ts`).

### Phần A — Mô hình giá (production)

#### A1. Lấy base về VND — `features/ship-ho/quote-adapter.ts`
Thêm hàm thuần song song `pickCarrierCostVnd`:

```ts
export function pickBaseVnd(
  snap: { costCurrency: string; displayCurrency: string; fxCostPerDisplay: number },
  breakdown: { base: number },
): { ok: true; vnd: number } | { ok: false; reason: string };
```

- `costCurrency === 'VND'` → `vnd = breakdown.base`.
- `displayCurrency === 'VND'` → `vnd = Math.round(breakdown.base / snap.fxCostPerDisplay)` (khớp cách engine suy `carrierCostDisplay`).
- Ngược lại → `{ ok: false, reason: 'non_vnd_currency(...)' }`.

`ShipHoQuoteResult` (nhánh ok) thêm field `baseVnd: number`. `quoteShipHoOrder` gọi `pickBaseVnd` sau `pickCarrierCostVnd`; nếu `pickBaseVnd` fail → trả `{ ok:false, reason }` (không để base thiếu).

#### A2. Core tính giá — `features/ship-ho/offer-pricing.ts` (thuần)

```ts
export const MIN_MARKUP_PERCENT = 30;

export function computeOffer(
  carrierCostVnd: number,
  baseVnd: number,
  markupPercent: number,
): { chargedVnd: number; marginVnd: number } {
  const margin = Math.max(0, Math.round(baseVnd * (markupPercent / 100)));
  return { chargedVnd: Math.round(carrierCostVnd) + margin, marginVnd: margin };
}
```

Thay thế vai trò `applyMarkup` trong luồng ship-ho. `markup.ts` cũ có thể giữ (dùng nơi khác) nhưng ship-ho không gọi nữa.

#### A3. Áp vào quote line — `features/ship-ho/quote-lines-logic.ts` + `quote-lines-actions.ts`
`summarizeLine(carrierCostVnd, baseVnd, markupPercent)` gọi `computeOffer`. `quoteShipHoLines` truyền `q.baseVnd` (từ A1) vào.

#### A4. Áp vào requote đơn — `features/ship-ho/orders-actions.ts`
Trong `requoteShipHoOrder`, thay:
```ts
const charged = applyMarkup(q.carrierCostVnd, Number(markupPercent));
```
bằng:
```ts
const { chargedVnd: charged } = computeOffer(q.carrierCostVnd, q.baseVnd, Number(markupPercent));
```
Ghi `chargedVnd = charged`, giữ nguyên các cột snapshot khác (`carrierCostVnd`, `markupPercent`, `quoteBreakdown`).

#### A5. Sàn 30% — `features/ship-ho/partners-actions.ts`
Trong hàm tạo/sửa partner, sau `const mk = Number(input.markupPercent)`:
```ts
if (!Number.isFinite(mk) || mk < MIN_MARKUP_PERCENT) {
  return { ok: false, error: `Markup phải ≥ ${MIN_MARKUP_PERCENT}% để đảm bảo margin rủi ro` };
}
```
Trang partner (`PartnersManager.tsx`): badge đỏ "⚠ < 30%" cạnh partner có `markupPercent < 30` (dữ liệu cũ).

#### A6. Clear đơn Kalisa — `features/ship-ho/orders-actions.ts` (hoặc script `scripts/`)
Action `clearAndRequoteOrder(orderId)`: set đơn về `status='draft'`, xoá snapshot giá (`carrierCostVnd/markupPercent/chargedVnd/quoteBreakdown/quotedAt = null`), rồi gọi `requoteShipHoOrder`. Chạy một lần cho đơn test Kalisa (tra id qua partner slug + code).

### Phần B — Rate card offer (FedEx)

#### B1. Logic thuần — `features/ship-ho/offer-ratecard-logic.ts`
Đầu vào: snapshot FedEx (`zonesByCountry`, `weightTiers`, `costCurrency/displayCurrency/fxCostPerDisplay`, `surcharges`), `markupPercent`.
Đầu ra:

```ts
export interface RateCardCell { tierUpperKg: number; baseVnd: number; offerVnd: number }
export interface RateCardZone { label: string; countries: string[]; cells: RateCardCell[] }
export interface RateCard {
  markupPercent: number;
  tiers: number[];              // upperKg tăng dần
  zones: RateCardZone[];
  surchargeNotes: string[];     // nhãn tiếng Việt các surcharge kind active
}
export function buildRateCard(snap, markupPercent): RateCard;
```

- Đảo `zonesByCountry` → mỗi zone (theo `label`) gom danh sách nước.
- Với mỗi zone × tier: `baseCost = zone.rateByTierUpper.get(tierUpper)`; `baseVnd` quy đổi VND (dùng cùng quy tắc `pickBaseVnd`); `offerVnd = round(baseVnd × (1+markup/100))`. Ô thiếu rate → bỏ qua/để trống.
- `surchargeNotes`: map distinct `snap.surcharges[].kind` → nhãn VN (vd `fuel_percent`→"Phụ phí xăng dầu (theo tuần FedEx)", `remote_fixed`→"Phụ phí vùng xa", `demand_per_kg`→"Phụ phí nhu cầu/kg", `country_fixed`→"Phí xử lý theo nước", `residential`→"Phụ phí địa chỉ dân cư", `vat_percent`→"VAT"). Giữ set cố định, kind lạ → bỏ.

#### B2. Action nạp dữ liệu — `features/ship-ho/offer-ratecard-actions.ts`
`getPartnerRateCard(brandSlug)`: `requireManageShipHo` → nạp partner (markup) → chọn account FedEx đầu tiên đang bật (`carrierKey === 'fedex'`) qua `listAccounts` + `loadAccountSnapshot` → `buildRateCard`. Trả `{ ok, card?, error? }` (không có account FedEx → error rõ ràng).

#### B3. Trang UI — `app/(dashboard)/f/ship-ho/partners/[slug]/rate-card/page.tsx` (+ client bảng nếu cần)
- Header: tên partner, markup%, badge đỏ nếu < 30%.
- Bảng zone × tier (ô = `offerVnd` định dạng VND), cột đầu = mức cân.
- Khối notes: link fuel FedEx (URL hằng số cấu hình) + `surchargeNotes` dạng bullet + câu "Phụ phí/fuel/VAT do FedEx tính khi xuất bill".
- Link "Rate card" từ dòng partner trong `PartnersManager.tsx`.

#### B4. Export XLSX + PDF — `features/ship-ho/ratecard-export-action.ts`
Tái dùng cách `statement-export-action.ts` sinh file. XLSX: sheet zone×tier + sheet notes. PDF: bảng + notes. Nút "Export XLSX/PDF" trên trang rate card.

## Đơn vị & ranh giới

- `offer-pricing.ts` (thuần) — nguồn sự thật công thức giá; test độc lập.
- `offer-ratecard-logic.ts` (thuần) — dựng lưới; test độc lập bằng snapshot giả.
- `pickBaseVnd` (thuần) — quy đổi tiền; test cùng `quote-adapter.test.ts`.
- Actions (I/O) mỏng, chỉ nạp dữ liệu + gọi core.

## Test

- `offer-pricing.test.ts`: margin = base×markup; markup chỉ trên base (carrierCost lớn không đổi margin); markup 30 → margin 30% base; markup < 30 vẫn tính (floor enforce ở tầng partner, không ở core); round VND.
- `quote-adapter.test.ts` (bổ sung): `pickBaseVnd` cho costCurrency=VND, displayCurrency=VND (chia fx), non-VND → fail.
- `offer-ratecard-logic.test.ts`: lưới đúng số zone/tier; offer = base×(1+markup) quy đổi; surchargeNotes map đúng & distinct.
- `partners-actions` (nếu có test): chặn markup < 30.

## Ngoài phạm vi (YAGNI)

- Không lưu lịch sử/phiên bản rate card (generate live).
- Không đổi luồng reconcile/statement (chỉ dùng lại hạ tầng export).
- Không tự động cào fuel% vào rate card (chỉ để link FedEx).
- Không đổi giá các đơn đã quote (chỉ Kalisa test được clear thủ công).

## Kế hoạch thực thi

- **Plan A** (production-critical): A1–A6 + test. Phải xong & xanh trước.
- **Plan B** (rate card + export): B1–B4 + test. Dựa trên `pickBaseVnd`/quy đổi của Plan A.
