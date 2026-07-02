# Aramex bảng giá VND + tỉ giá VCB tự cập nhật — Design

**Ngày:** 2026-07-02. Aramex lưu giá USD (cost currency), matrix hiện USD làm tròn số nguyên
(mất `.05`). Cần: (1) matrix hiện **VND (chính) + USD nhỏ**, (2) tỉ giá **VCB tự fetch hàng ngày**.

## Part A — VCB FX fetcher + cron
- `lib/fx/vcb.ts`:
  - `parseVcbUsd(xml: string): { buy: number; transfer: number; sell: number } | null` — THUẦN,
    parse `<Exrate CurrencyCode="USD" Buy Transfer Sell/>` từ VCB XML portal. Test được.
  - `fetchVcbUsd(): Promise<{buy,transfer,sell}>` — GET `https://portal.vietcombank.com.vn/UserControls/TVPortal.TyGia/pXML.aspx`, parse. Ném lỗi rõ nếu fail.
- `features/carrier-rates/fx/refresh-vcb.ts`:
  - `refreshVcbFx(): Promise<{ rate: number; updated: number }>` — lấy **sell** (bán, dùng khi
    mua USD trả NCC), cập nhật account `costCurrency='USD'` (Aramex): `fxCostPerDisplay = 1/sell`
    (USD/VND), `fxUpdatedAt = now`.
- Cron: `scripts/cron/refresh-vcb-fx.ts` + route `GET /api/cron/refresh-vcb-fx` (Bearer CRON_SECRET)
  + `railway.cron-vcb.json` + npm `cron:refresh-vcb`. Chạy sáng hàng ngày (bạn wire lịch Railway).
- Data ngay: chạy `refreshVcbFx` 1 lần để set tỉ giá VCB hôm nay (26.466 → fx 1/26466).

## Part B — Matrix VND display + số thập phân USD
Canonical money đã hỗ trợ decimal (`sanitizeMoneyRaw(x, 2)`, `formatMoneyForDisplay`); matrix
hardcode `0` nên mất. Sửa:
- `RateMatrix`: `const decimals = costCurrency === 'VND' ? 0 : 2;` dùng ở cells khởi tạo (dòng 63)
  + truyền xuống `Cell` (input dòng 529 dùng `decimals`).
- Thêm prop `vndPerUnit?: number | null` cho `RateMatrix` + `Cell`. Khi set (account USD→VND):
  dưới mỗi ô, hiện **VND = round(Number(value) × vndPerUnit)** (text nhỏ, muted); USD giữ ở dòng
  chính (2 số thập phân). `vndPerUnit=null` (VND-cost card) → không hiện dòng phụ.
- `RateWorkspace`: nhận + chuyển tiếp `vndPerUnit`.
- Workspace page: tính `vndPerUnit = (costCurrency!=='VND' && displayCurrency==='VND' && fx>0) ? 1/fx : null`
  từ account (`fxCostPerDisplay`, `displayCurrency`) → truyền xuống.

## Ripple
`fxCostPerDisplay` Aramex cũng được bảng So sánh + đối soát dùng → đổi 26.000→VCB làm mọi chỗ
quy VND của Aramex đồng bộ theo VCB (đúng ý). Cron giữ tươi.

## Test
- `lib/fx/vcb.test.ts`: `parseVcbUsd` bóc đúng Buy/Transfer/Sell từ XML mẫu; thiếu USD → null.
- Verify sau deploy: `railway run npm run cron:refresh-vcb` → fx cập nhật; matrix Aramex hiện VND.

## Ngoài phạm vi
- Auto-refresh cho DHL/FedEx (VND-cost, fx chỉ ảnh hưởng USD-display, không đổi VND so sánh).
- Sửa parseVnd search sang decimal (search reverse-lookup giữ nguyên, thứ yếu).
