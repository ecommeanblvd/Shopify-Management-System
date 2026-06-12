# Spec: FedEx Demand Surcharge — fetch PDF + parse + backfill + cron cảnh báo

**Ngày:** 2026-06-12
**Module:** carrier-rates (`features/carrier-rates/demand-fetcher`) + cron + config
**Specs nền:** carrier-rates engine (demand_per_kg), fuel-fetcher (mẫu cron Akamai)

## 0. Bối cảnh & quyết định (operator, 2026-06-12)

FedEx công bố Demand Surcharge VN ở trang
`fedex.com/en-vn/shipping/surcharges/demand-surcharge.html`, data nằm trong **PDF
theo từng kỳ** (`/content/dam/fedex/international/rates/fedex-ds-<kỳ>-638-en-vn.pdf`).

**Probe feasibility (2026-06-12) — TẤT CẢ XANH:**
- Trang fetch được bằng header browser (HTTP 200, không cần Akamai cookie trick).
- **13 PDF**, lịch sử **07/2025 → 06/2026** (đủ cho đối soát).
- PDF fetch server-side OK (`%PDF-1.7`, không bị chặn).
- PDF text sạch, bảng có cấu trúc + ngày hiệu lực ở tiêu đề.

**Config demand hiện tại SAI:** 8 dòng `demand_per_kg` KHÔNG mốc thời gian; LAC/
Canada/Mexico/USA để 11.300đ/kg trong khi PDF hiện tại = **0**; Israel để 28.400 cho
cả 2025 trong khi Jul–Sep 2025 chỉ 11.200. → backfill theo kỳ sửa hết.

Quyết định:
1. Chỉ lấy cột **"Export shipments from Vietnam to"** (fleet ship TỪ VN). Bỏ ImportOne
   + bảng Global Third-Party (G3P, page 2 — không phải mình).
2. Map vùng→nước theo **định nghĩa trong PDF** (Asia/Europe/MEISA Group1+2/LAC…),
   tái dùng list ISO sẵn có trong config hiện tại.
3. Backfill **THAY** 8 dòng demand cũ bằng dòng **có mốc thời gian** parse từ 13 PDF.
4. Parser xử lý **2 format**: cũ (2025, mini-table "Demand Surcharge from X to Y") và
   mới (2026, consolidated "Effective from X", cột Export/ImportOne). Có TDD.
5. Cron tuần: fetch trang → phát hiện PDF kỳ MỚI (chưa có trong config) → parse →
   **CẢNH BÁO** (không auto-apply). Parse fail → cảnh báo "review tay".
6. **Ngoài phạm vi (flag):** min/shipment ("25.000đ" cũ, "6.400đ" mới) — engine chưa
   model min-per-shipment cho demand. Pack nhẹ tới nước demand thiếu phần min →
   **follow-up riêng** (cần thêm cột + sửa engine). KHÔNG gộp lần này.

## 1. Dependency

- Thêm `pdf-parse` (trích text từ PDF trong Node). Cron/script chạy server-side Node.

## 2. Fetch (`features/carrier-rates/demand-fetcher/fetch.ts`)

- `DEMAND_PAGE = 'https://www.fedex.com/en-vn/shipping/surcharges/demand-surcharge.html'`.
- Header browser (mượn từ fuel-fetcher: User-Agent Chrome, Accept, Sec-Fetch…).
- `fetchDemandPdfUrls(fetchImpl?) → string[]`: GET trang, regex
  `/content/dam/fedex/international/rates/fedex-ds-[^"']+\.pdf` → URL tuyệt đối,
  unique, giữ thứ tự xuất hiện.
- `fetchDemandPdfText(url, fetchImpl?) → string`: GET PDF (header browser + Referer
  = trang), `pdf-parse` → text. Lỗi/không phải PDF → throw rõ ràng.

## 3. Parse (`features/carrier-rates/demand-fetcher/parse.ts`, THUẦN, TDD)

```ts
export interface DemandPeriod {
  effectiveFrom: Date;            // ngày bắt đầu (UTC)
  effectiveTo: Date | null;       // ngày kết thúc (UTC, exclusive) — null nếu "Effective from"
  /** Vùng (tên chuẩn hoá) → demand export VN→vùng (VND/kg). Bỏ vùng 0đ. */
  exportRates: Record<string, number>;
}
export function parseDemandPdfText(text: string): DemandPeriod;
```
- **Format CŨ** ("Demand Surcharge from <X> to <Y>"): lấy from/to từ tiêu đề; mỗi
  block "Export shipments from Vietnam to <region> <Priority>VND <Economy>VND" → lấy
  **Priority** (fleet IP). `effectiveTo` = ngày "to" + 1 ngày (exclusive).
- **Format MỚI** ("Effective from <X>"): `effectiveFrom`=X, `effectiveTo`=null; bảng
  Region × [Export, ImportOne] → lấy cột **Export** (số đầu sau tên vùng).
- Chuẩn hoá tên vùng về key: `israel, europe, meisa, lac, canada, mexico, usa,
  asia, australia_nz, india` (regex khớp "MEISA", "Latin America (LAC)", "United
  States…(USA)…", "Australia, New Zealand"…).
- Chỉ giữ vùng có rate > 0 trong `exportRates`.
- Parse ngày: "July 21, 2025" / "June 18, 2026" (Date.UTC). Tên tháng → số.

## 4. Map vùng (`features/carrier-rates/demand-fetcher/regions.ts`)

```ts
export const REGION_COUNTRIES: Record<string, string[]>; // key chuẩn → ISO-2[]
export function regionToCountries(regionKey: string): string[]; // [] nếu chưa map
```
- Seed từ list ISO trong config demand hiện tại (Europe 50, MEISA 70, LAC 48,
  USA[US,PR], Canada[CA], Mexico[MX], Israel[IL]) + thêm khi cần (asia/australia_nz/
  india) theo định nghĩa PDF. Vùng chưa map → backfill/cron BÁO "thiếu map vùng X".

## 5. Apply / build rows (`features/carrier-rates/demand-fetcher/apply.ts`, THUẦN phần build, TDD)

```ts
export interface DemandRowSpec {
  countryCodes: string[]; valueVndPerKg: number; startsAt: Date; endsAt: Date | null; regionKey: string;
}
/** Từ các kỳ đã parse (sắp theo from) → dòng demand có mốc, không chồng lấn.
 *  Kỳ format-mới (effectiveTo=null) lấy endsAt = effectiveFrom của kỳ kế (hoặc null nếu mới nhất). */
export function buildDemandRows(periods: DemandPeriod[]): DemandRowSpec[];
```
- Mỗi (kỳ, vùng có rate>0) → 1 row: countryCodes = regionToCountries(vùng),
  value = rate, window = [from, to). Vùng không map được → bỏ + cảnh báo (caller).
- Cửa sổ: format-cũ có sẵn to; format-mới lấy to = from kỳ kế tiếp (chain), kỳ mới
  nhất to=null (open).

## 6. Backfill script (`scripts/backfill-fedex-demand.ts`, dry-run/--apply)

- `fetchDemandPdfUrls` → fetch+parse từng PDF → `buildDemandRows`.
- Dry-run: in mỗi kỳ (from→to) + vùng + rate + #nước; liệt kê vùng chưa map (nếu có)
  để operator kiểm trước. KHÔNG ghi.
- `--apply`: trong transaction, **XOÁ** dòng `demand_per_kg` của FedEx cũ, INSERT các
  DemandRowSpec (kind='demand_per_kg', applyMode='always'). Reconcile cache tự bust
  (đã có cơ chế configVersion).
- Verify: quote thử pack FedEx IL trước/sau 1 mốc đổi để xác nhận demand đúng kỳ.

## 7. Cron cảnh báo (`app/api/cron/refresh-demand/route.ts` + `scripts/cron/refresh-fedex-demand.ts`)

- Mẫu như refresh-fuel (Railway cron service + HTTP ping fallback). Auth bằng
  `CRON_SECRET` như refresh-fuel.
- Logic: `fetchDemandPdfUrls` → với mỗi PDF, suy ra kỳ (parse) → so với config
  `demand_per_kg` FedEx hiện có (theo startsAt). **Kỳ chưa có trong config** →
  parse → ghi cảnh báo: `recordAudit('fedex_demand_new_period', { url, from, to,
  exportRates })` + log. Parse fail → cảnh báo `{ url, error }`. **KHÔNG auto-apply.**
- Trả JSON tóm tắt (kỳ mới phát hiện, lỗi parse) cho lần ping.

## 8. Kiểm thử (TDD)

- `parse.test.ts`: (a) format CŨ (text Jul–Sep 2025: Israel 11200) → from/to đúng,
  exportRates {israel:11200}; (b) format MỚI (text Jun 2026: Israel 28400, Europe
  28400, MEISA 39700, còn lại 0) → effectiveFrom 2026-06-18, exportRates đúng 3 vùng,
  bỏ vùng 0; (c) ngày parse đúng; (d) text rác → throw.
- `regions.test.ts`: regionToCountries('israel')→['IL']; 'meisa' chứa SA,IQ,AE…;
  'europe' chứa DE,FR…; vùng lạ → [].
- `apply.test.ts` `buildDemandRows`: chain window (kỳ mới-format nối to=from kỳ kế;
  mới nhất null); bỏ vùng 0; vùng không map → không tạo row.
- Fetch/cron: không unit test mạng (inject fetchImpl trong test parse/build); tsc+
  eslint sạch; build pass.

## 9. Ngoài phạm vi
- min-per-shipment cho demand (follow-up: cột `min_per_shipment` + engine).
- Bảng G3P (third-party) + cột ImportOne.
- Auto-apply trong cron (chỉ cảnh báo).
- UI cấu hình demand (vẫn qua script).
