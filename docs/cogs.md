# Giá vốn theo line đơn và báo cáo lãi gộp theo tháng

## Mục đích

Cho biết "Rev thực tế" (lãi gộp) mỗi tháng: doanh thu thuần trừ phí ship thực trừ giá vốn hàng bán — tách khỏi
báo cáo doanh thu/phí ship đã có sẵn ở dashboard store. Giá vốn hàng ký gửi từ brand (phần lớn dòng đơn MEAN
BLVD) không phải một giá cố định theo SKU — nó biến thiên theo dòng (chiết khấu đổi theo tháng, phí customize)
và chỉ chốt được khi có bảng kê công nợ hằng tháng. Vì vậy giá vốn được lưu **theo từng line đơn Shopify và
theo kỳ ghi nhận**, không theo SKU.

## Ba nguồn giá vốn và thứ tự ưu tiên

Một line có thể có giá vốn từ nhiều nguồn; khi trùng, hệ thống lấy theo thứ tự ưu tiên sau (nguồn tự động
**không bao giờ đè** số đã đối soát với brand):

1. **`mmp`** — webhook MMP đẩy bảng kê (đợt 2, chưa bật) — **KẾ NHIỆM** `brand_statement`: một khi một line đã
   có dòng `mmp`, dòng `brand_statement` (kể cả nhập lại/kỳ khác) không còn ghi đè được nữa (xem "Thứ tự ưu
   tiên nguồn — chi tiết" bên dưới).
2. **`brand_statement`** — nhập từ bảng kê công nợ brand (trang này, xlsx tay) — quy trình TẠM trước khi brand
   chuyển hẳn sang đẩy qua MMP.
3. **`csv`** — sửa tay qua luồng CSV/`cost_override` hiện có.
4. **`shopify_unit_cost`** — *Cost per item* trên Shopify (đợt 2: cron `sync-unit-cost` + `apply-own-cogs`, dùng cho hàng tự sản xuất — TINH, Mirer, hàng MEAN tự sản).

Giá vốn hàng brand = **Tổng thành tiền TT (trước VAT)** trên bảng kê, ghi nhận vào **kỳ (tháng) THỰC NHẬN**
trên bảng kê — không phải tháng đặt hàng. Hàng tự sản xuất (đợt 2) ghi theo tháng đặt.

## Cách nhập bảng kê brand

Trang **Đơn hàng → Giá vốn → Bảng kê brand** (`/f/orders/cogs/bang-ke`, quyền `manage_cogs`).

1. Chọn brand, dán **link Google Sheet** (hoặc tải file `.xlsx`/`.csv`). Sheet phải ở chế độ **"ai có link đều
   xem được"** — hệ thống tải qua đường xuất `xlsx` của Google, không đăng nhập được.
2. Hệ thống chỉ đọc tab có tiêu đề đúng dạng `BẢNG KÊ CÔNG NỢ Từ ngày … đến … Brand: …`, và trong tab đó chỉ
   lấy mục **`A. Đơn thực nhận trong tháng`** (mục `A. Đơn thực bán` chỉ tham khảo, tab nháp/không tiêu đề đều
   bị bỏ qua — xem danh sách "bỏ qua" khi xem trước). Tên brand trên tiêu đề sheet phải khớp brand đã chọn,
   khác thì dừng và báo lỗi.
3. **Xem trước** trước khi ghi: theo từng kỳ hiện tổng dòng, số khớp đúng SKU, số khớp qua mã gốc, số dòng đơn
   một-line, số dòng offline, danh sách dòng **không khớp** (không ghi), số dòng return, tổng TT/tổng return,
   số dòng lệch công thức, danh sách dòng "sheet tính dư" số lượng.
4. **Áp dụng**: chọn kỳ cần ghi, xác nhận. Nhập lại một kỳ (brand, tháng) đã áp dụng sẽ **xoá toàn bộ** dòng
   `order_line_cogs`/`brand_cogs_offline` nguồn `brand_statement` của đúng kỳ đó rồi ghi lại từ đầu, trong một
   transaction — không đụng dòng nguồn khác (CSV, Shopify). Mỗi lần áp dụng có audit log (ai, lúc nào, tên
   file, bao nhiêu dòng).
5. **Dòng không khớp không bao giờ được đoán** — không ghi, chỉ hiện trong danh sách xem trước để xử lý tay
   (đối chiếu mã đơn/SKU, hoặc bỏ qua nếu không thuộc Shopify).

## Luật ghép dòng bảng kê vào line đơn (5 bước)

1. **Tìm đơn**: chuẩn hoá mã (bỏ `#`, khoảng trắng, không phân biệt hoa/thường) rồi so với
   `shopify_order_number`. Mã dạng `#MBLVDPO…` hoặc `#MTB…` → ghi vào **`brand_cogs_offline`** (không thuộc
   Shopify — mục riêng trong báo cáo, không trừ vào doanh thu). Mã khác không tìm thấy đơn → "không khớp",
   không ghi.
2. **Tìm line trong đơn**, theo thứ tự: SKU khớp đúng tuyệt đối → ghép; không có → so **mã sản phẩm gốc**
   (ví dụ `DN0729` từ SKU `Denio-DN0729-M-…`, hoặc phụ kiện `PKDN0729` ghép về line chứa `DN0729`); nhiều ứng
   viên cùng mã gốc → so thêm size/màu; đơn chỉ có một line → ghép thẳng vào line đó; còn mơ hồ (nhiều ứng
   viên, không phân biệt được) → "không khớp", không đoán.
3. **Cộng dồn**: giá vốn của line = tổng TT các dòng sheet ghép vào line đó. Nếu tổng số lượng trên sheet lớn
   hơn số lượng của line → gắn cờ "sheet tính dư" nhưng vẫn nhập (không chặn).
4. **Return**: dòng ở mục `B. Đơn return` ghi `kind = return`, số âm, kỳ = tháng return (trừ vào giá vốn kỳ
   đó, không lùi về kỳ gốc).
5. **Kiểm tra chéo công thức**: tính lại TT = giá nội địa × SL × (1 − %CK) + phí customize; lệch quá 1 ₫ →
   cảnh báo trong xem trước, nhưng vẫn lấy đúng số trên sheet (đây là bản đã ký với brand, không phải số hệ
   thống tự tính).

## Cách đọc báo cáo "Lãi gộp theo tháng"

Trang **Đơn hàng → Lãi gộp** (`/f/orders/lai-gop`, quyền `view_cogs`), lọc theo khoảng tháng / cửa hàng /
brand. Toàn bộ số tiền quy về **VND**; tháng gom theo giờ kinh doanh (Asia/Bangkok).

| Cột | Ý nghĩa |
|---|---|
| Doanh thu thuần | `netGmv − discount` theo đúng định nghĩa dashboard hiện có (đã gồm phí ship khách trả), của đơn **đặt trong tháng**, đổi VND theo tỉ giá tháng |
| Phí ship thực | phí ship thực trả (hoá đơn → override → ước lượng, như dashboard), đổi VND |
| Giá vốn | tổng `order_line_cogs` có `period` = tháng đang xem, cộng dòng `cogs`, trừ dòng `return` |
| **Rev thực tế (lãi gộp)** | Doanh thu thuần − Phí ship thực − Giá vốn |
| Chi brand ngoài Shopify | tổng `brand_cogs_offline` của kỳ, cột riêng, **không** trừ vào lãi gộp |
| Độ phủ COGS | % số line và % doanh thu đã có giá vốn trong tháng; dưới 100% thì lãi gộp hiện cảnh báo (thiếu dữ liệu, số chưa đầy đủ) |
| Thuộc đơn tháng trước | phần giá vốn của kỳ này thuộc về đơn đã đặt ở tháng trước (đơn đặt tháng N, brand ghi nhận thanh toán tháng N+1 là bình thường) |

Có thể mở chi tiết theo brand rồi theo từng line (doanh thu, giá vốn, nguồn, tham chiếu bảng kê). Hai nút xuất
CSV: **bảng theo tháng** và **danh sách line chưa có giá vốn** (store, brand, mã đơn, SKU, số lượng, doanh
thu) — dùng để đi tìm và bổ sung giá vốn còn thiếu.

## Nơi nhập tỉ giá tháng

Ngay dưới bảng báo cáo (chỉ hiện với quyền `manage_cogs`) có form nhập tỉ giá USD→VND theo từng tháng
(`fx_month_rates`). Thiếu tỉ giá của một tháng → hệ thống tự dùng tỉ giá tháng gần nhất **trước đó** và gắn cờ
"tỉ giá tạm" trên dòng báo cáo tháng đó; nhập đúng tỉ giá của tháng sẽ thay số tạm ngay. Tỉ giá tĩnh
`stores.fx_cost_per_order_currency` (dùng cho dashboard cũ) không đổi, không liên quan bảng này.

## Vì sao Doanh thu thuần định nghĩa như vậy

Dùng lại đúng định nghĩa `netGmv − discount` đã có sẵn trong dashboard store (qua `getStoreMetrics`) thay vì
định nghĩa mới, để hai báo cáo không lệch số khi CEO đối chiếu. Định nghĩa này đã gồm phí ship khách trả (thu
về cùng đơn hàng); báo cáo lãi gộp trừ ngay phí ship **thực** trả cho hãng vận chuyển ở cột kế bên, nên phần
chênh lệch thu/chi ship hiện rõ trong "Rev thực tế" thay vì bị ẩn trong doanh thu.

## Đợt 2 — trạng thái

- Cron `sync-unit-cost` + `apply-own-cogs` (hàng tự sản xuất) — **đã chạy production** (02:00 UTC hằng ngày).
  Chi tiết ở mục ngay dưới.
- Webhook `POST /api/mmp/cogs` — route **đã tồn tại trong code, ký HMAC, nhưng CHƯA BẬT/CHƯA BÁO cho MMP**
  (chờ CEO xác nhận thiết kế với MMP trước khi công bố). Xem hợp đồng payload bên dưới.

## Hàng tự sản xuất — cron `cogs-own`

Áp dụng cho **TINH** (`tinhatelier`), **Mirer** (`mirermirer-official`) — mọi line của hai store này — và
riêng trên store đa-brand `meanblvd`, chỉ line có `vendor = 'MEAN BLVD'` (so sánh không phân biệt hoa/thường)
— luật thuần ở `laHangTuSanXuat` (`features/cogs/vendor-tu-san-xuat.ts`). Hàng outsource (brand khác gửi bảng
kê PO/MTB) không đi qua cron này.

Service Railway `cron-cogs-own` (`npm run cron:cogs-own`, IaC `.railway/railway.ts`), chạy **02:00 UTC hằng
ngày**, gồm hai bước lồng nhau trong một script (`scripts/cron/cogs-own.ts`):

1. **`sync-unit-cost`** (`features/cogs/unit-cost-sync.ts`) — đọc *Cost per item* (`inventoryItem.unitCost`)
   từng biến thể qua GraphQL Shopify, một truy vấn DISTINCT ON/store để tra giá hiện có, chỉ **ghi khi giá đổi**
   vào `sku_costs` (nguồn `shopify`, `effective_from` = lúc đồng bộ). Trên store đa-brand `meanblvd`, chỉ ghi
   SKU của **vendor tự sản xuất** (`laHangTuSanXuat`, đọc thêm `product.vendor` từ Shopify) — biến thể của
   brand khác trên cùng store bị bỏ qua (`boQuaVendor`), không đè giá của brand outsource lên `sku_costs`. Lỗi
   một store không chặn store khác, nhưng `chayCron` vẫn báo đỏ (`process.exitCode = 1`) khi có `loi` — không
   nuốt lỗi im lặng.
2. **`apply-own-cogs`** (`features/cogs/own-cogs.ts`, chạy lồng qua `chayMotJob('apply-own-cogs', …)`) — quét
   line đơn **90 ngày gần đây**, chưa huỷ, thuộc store/vendor tự sản xuất, **chưa có** `order_line_cogs`
   `kind='cogs'` từ bất kỳ nguồn nào (`onConflictDoNothing` — nguồn tay luôn thắng, không đè). Với mỗi line,
   tra `sku_costs` cùng store/SKU có `effective_from` ≤ **ngày đặt hàng** (giờ nghiệp vụ Bangkok,
   `processed_at_shopify`), lấy bản **mới nhất thoả điều kiện**; không có giá phù hợp → đếm vào `khongCoGia`,
   bỏ qua (không chặn line khác). Kỳ ghi (`period`) = **tháng đặt hàng**, khác với hàng brand ghi theo tháng
   thực nhận bảng kê.

**Không hồi tố**: giá mới đồng bộ từ Shopify chỉ có hiệu lực từ lúc đồng bộ trở đi (`effective_from` = ngày
chạy cron) — line đặt **trước** ngày đó không tự động có giá (không có `sku_costs` nào với `effective_from` ≤
ngày đặt), phải nhập tay (CSV/bảng kê) nếu cần giá vốn hồi tố. Đây là thiết kế có chủ ý (spec không yêu cầu
truy hồi giá lịch sử cho hàng tự sản xuất), không phải lỗi — lần chạy production đầu tiên (2026-09-08) minh
hoạ đúng hành vi này: 10 `sku_costs` được ghi (giá mới), nhưng `apply-own-cogs` ghi 0/289 line vì toàn bộ 289
line ứng viên đều đặt trước ngày giá có hiệu lực.

**`DRY_RUN=1`**: chỉ in số liệu sẽ đọc/sẽ ghi ra log, không ghi gì vào `sku_costs`/`order_line_cogs` — dùng để
kiểm tra trước khi chạy thật hoặc khi đổi luật vendor/store.

**Biến môi trường** (service `cron-cogs-own`, 11 biến, xem `.railway/railway.ts`): `TZ=UTC` (bắt buộc — xem
cảnh báo giờ nghiệp vụ ở `ungVienChuaCoCogs`), `DATABASE_URL`, `ENCRYPTION_KEY_V1`, `ENCRYPTION_KEY_CURRENT`,
`SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_SCOPES`, `SHOPIFY_APP_URL`, `SHOPIFY_API_VERSION`,
`BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`.

Xem chi tiết quyết định và khảo sát dữ liệu tại
`docs/superpowers/specs/2026-09-08-gia-von-lai-gop-thang-design.md`.

## Hợp đồng payload MMP (chưa bật)

`POST /api/mmp/cogs` — HMAC SHA-256 giống mọi endpoint `mmp` khác: `sha256=<hex>` của
`HMAC_SHA256(MMP_WEBHOOK_SECRET, "<timestamp>.<rawBody>")`, header `x-mean-signature` / `x-mean-timestamp`
(mẫu `app/api/mmp/order-confirmations/route.ts`). Nhận cấu trúc trung gian giống bộ nhập bảng kê ở trên —
đi qua **đúng luật ghép dòng** (mục "Luật ghép dòng bảng kê vào line đơn" phía trên) và hàm ghi
`apDungBangKeDaDoc` (`features/cogs/bang-ke-import.ts`), nguồn `source = 'mmp'` — **KẾ NHIỆM** `brand_statement`
(xem "Thứ tự ưu tiên nguồn — chi tiết" bên dưới), không phải nguồn ngang hàng.

### Thứ tự ưu tiên nguồn — chi tiết (spec §7 refined, quyết định 2026-09-08)

`order_line_cogs` chỉ có một index duy nhất (order_id, shopify_line_id, kind, period) — **không có `source`**
trong đó — nên một line/kind/kỳ chỉ tồn tại **một dòng**; nguồn nào thắng do hàm thuần `duocGhiDe`
(`features/cogs/uu-tien-nguon.ts`) quyết định khi ghi (upsert `onConflictDoUpdate`):

- **`mmp` là nguồn KẾ NHIỆM `brand_statement`** — MMP thay thế hoàn toàn quy trình bảng kê xlsx tay: dòng `mmp`
  luôn ghi đè dòng đang có (kể cả `brand_statement`), còn dòng `brand_statement` **không bao giờ** ghi đè được
  dòng đang là `mmp` (nhập lại một kỳ sheet cũ, hoặc MMP đẩy sai kỳ trước, không được xoá mất số đã lên MMP).
  Vì MMP có thể ghi nhận một line vào kỳ (tháng thực nhận) khác kỳ sheet cũ đã ghi (tháng đặt), trước khi ghi
  dòng `mmp` của một line, hệ thống còn xoá thêm dòng `brand_statement` CŨ của đúng line đó ở **bất kỳ kỳ
  nào** — tránh line tồn tại hai dòng COGS ở hai kỳ khác nhau.
- Cả hai nguồn "bảng kê" (`brand_statement`, `mmp`) đều **đè `shopify_unit_cost`** (ưu tiên thấp nhất — Cost
  per item Shopify chỉ là số tạm khi chưa đối soát brand).
- **`shopify_unit_cost` không bao giờ đè nguồn nào khác** — `own-cogs.ts` dùng `onConflictDoNothing`, thấp hơn
  cả mức "so ưu tiên", tách biệt với luật `duocGhiDe`.
- Xoá theo kỳ khi re-import (đoạn trên) vẫn lọc đúng `source` đang ghi — không đụng dòng nguồn khác cùng
  brand/kỳ; luật ghi đè ở trên chỉ áp dụng khi **trùng đúng (order_id, line, kind, period)**.

```json
{ "brandSlug": "denio", "period": "2026-09",
  "lines": [{ "orderNumber": "#MBLVD29521", "sku": "Denio-DN0785-Customize-NPOT-PLA", "qty": 1, "amount": 1861500, "currency": "VND", "kind": "cogs", "ref": "MMP-STMT-2026-09-0001" }],
  "offline": [{ "refCode": "#MBLVDPO24", "sku": "Denio-DN0815-M-WCCM-PLA", "qty": 1, "amount": 1374000, "currency": "VND", "kind": "cogs" }] }
```

- `brandSlug` phải khớp một brand đã có trong `mmp_brands`; `period` dạng `YYYY-MM`.
- `lines[]` và `offline[]` **không được cùng rỗng** — payload rỗng (không có dòng nào) bị từ chối thẳng, để
  tránh trường hợp webhook xoá sạch giá vốn của kỳ mà không ghi lại gì (kỳ trước đó có dữ liệu → mất trắng).
- `lines[]`: dòng thuộc đơn Shopify, `orderNumber` là mã đơn (có thể có `#`). `offline[]` (tuỳ chọn): dòng
  không thuộc Shopify (PO, MTB…), `refCode` thay cho `orderNumber` — vẫn đi qua luật ghép như dòng thường,
  `refCode` không đúng mẫu `MBLVDPO…`/`MTB…` thì báo "không khớp" (`khong_co_don`) thay vì tự suy đoán.
- `kind: 'cogs'` → cộng vào giá vốn kỳ; `kind: 'return'` → trừ vào giá vốn kỳ (route tự ghi số âm khi lưu,
  payload luôn gửi số dương). `amount`/`qty` phải là số dương.
- `currency`: **chỉ nhận `VND`** (bỏ trống cũng được, mặc định `VND`) — hợp đồng payload đợt này CHƯA hỗ trợ
  tiền tệ khác, đẩy `USD` hay bất kỳ mã nào khác `VND` đều bị từ chối, không tự quy đổi ngầm.
- `ref` (tuỳ chọn, chỉ có ở `lines[]`) là mã tham chiếu bảng kê MMP — lưu vào cột `code` giống cột `Code` của
  bảng kê xlsx, chỉ mang tính tra cứu, không ảnh hưởng luật ghép.

Response `200`:

```json
{ "period": "2026-09", "lines": 1, "offline": 1, "returns": 0,
  "khongKhop": [{ "orderNumber": "#MBLVD00000", "sku": "X", "amount": 100000, "lyDo": "khong_co_don" }] }
```

`lines`/`offline`/`returns` là số dòng **đã ghi** (giống `daGhi` của bộ nhập bảng kê); `khongKhop` liệt kê
dòng không ghép được (không ghi) để MMP đối chiếu và gửi lại. Lỗi HMAC → `401`; payload sai hình dạng (kể cả
payload rỗng), brand không tồn tại, hoặc `period`/`amount`/`currency` không hợp lệ → `400`; thiếu
`MMP_WEBHOOK_SECRET` trên SMS hoặc lỗi ghi DB (kèm `wroteNothing: true` — kỳ đang ghi KHÔNG bị xoá dở, xem
`apDungBangKeDaDoc`) → `500`.

`brand_cogs_offline` có cột `source` (`'brand_statement' | 'mmp'`, migration `0129_brand-cogs-offline-
source.sql`) giống `order_line_cogs.source` — xoá theo kỳ khi ghi lại chỉ xoá đúng nguồn đang ghi, hai nguồn
không đụng dữ liệu của nhau.

## Phân bổ hàng PO xuống đơn (nguồn `po`)

Brand kê hai loại tiền trên bảng kê: **theo đơn** (dòng khớp mã đơn + SKU → `order_line_cogs`, nguồn `brand_statement`) và **mua đứt** (`#MBLVDPO…`, `#MTB…` → `brand_cogs_offline`, có SKU + số lượng). Đơn bán hàng lấy từ kho PO thì brand **không** kê theo đơn, nên dòng đơn đó không có giá vốn dù tiền đã trả trong PO.

Nút **"Phân bổ PO → đơn"** (trang Bảng kê brand, quyền `manage_cogs`) làm việc này, luật CEO chốt 08/09/2026:

- Chỉ xét dòng đơn của brand **chưa có giá vốn nguồn khác** (`brand_statement`/`mmp`/`shopify_unit_cost`), đơn chưa huỷ, đặt từ 01/2026.
- Ghép PO ↔ dòng đơn theo **mã chính + size + màu** (`khoaSku`: bỏ `Denio-`, chất liệu `PLA`, hậu tố `-PO`/`-Sale`; `DN0729+PK0729` ghép theo `DN729`).
- **Nhập trước dùng trước**: PO xếp theo kỳ kê rồi số PO; chỉ PO có **kỳ ≤ tháng đặt** được dùng (không có ngày nhập PO nên lấy kỳ kê làm mốc); hết số lượng thì sang PO kế tiếp; dòng SL>1 có thể lấy từ hai PO, thiếu chiếc thì **không ghi** và báo "PO hết số lượng".
- Giá vốn = giá mua trong PO (amount/qty). Ghi `order_line_cogs` nguồn `po`, **kỳ = tháng đặt** (đi cùng doanh thu; khác dòng bảng kê ghi theo kỳ thực nhận), `statement_ref` = mã PO, `detail.tuPO` = từng lô.
- Idempotent: mỗi lần chạy xoá hết dòng `po` của brand rồi phân bổ lại. Ưu tiên nguồn: `po` ngang `brand_statement`, `mmp` kế nhiệm cả hai.
- Báo cáo lãi gộp: dòng `po` trừ vào COGS như dòng bảng kê; cột "offline" vẫn hiện tổng tiền PO/MTB đã trả (thông tin, không trừ lần hai).
- Dòng không phân bổ được (SKU không có trong PO, PO hết số lượng, chưa có PO trước tháng đặt) → ops gửi brand xác nhận, rồi nhập bổ sung bằng bảng kê.

- **Chỉ mã đơn mua đứt mới là PO** (`laMaPO`, 09/09/2026): `#MBLVDPO…`, `#MTB…`, `#PO-001`. Các mã offline khác (`#HC…` store brand, `#MXHS…` XiaoHongShu, `#OS…`/`#MOS…` Off Store) là hàng đã bán ở kênh khác, không phân bổ xuống đơn Shopify (TINH Atelier: 2 dòng #MOS từng bị gán nhầm cho đơn TA…, đã xoá).

## Sheet tính bằng USD (Happy Clothing) và mục B không phải return

Bộ đọc nhận hai khuôn sheet. Denio: VND, cột "Tổng thành tiền TT", mục "A. Đơn thực nhận" / "B. Đơn return". Happy Clothing (08/09/2026): giá và thành tiền bằng **USD** ("$935.00"), cột "Thành tiền", mục "A. Đơn MEAN thực nhận" và **"B. Đơn Happy Clothing Global thực nhận"** — đơn `#HC…` trên store riêng của brand, không có trên Shopify của MEAN → ghi bảng offline (`brand_cogs_offline`, mã `#HC…`), **không phải return**.

- **Đổi tiền:** mỗi tab thực nhận có dòng "TỔNG:" (hoặc "TỔNG THANH TOÁN:") bằng ₫. Tỉ giá kỳ = số ₫ đó ÷ Σ USD của mọi dòng A + B; từng dòng đổi sang VND ngay khi đọc (`tt` = VND, `ttGoc` = USD, `BangKe.tiGia`). Không thấy dòng ₫ → giữ USD + cảnh báo (không ghi được VND). Không dùng `fx_month_rates` cho việc này vì sheet đã nói rõ MEAN trả bao nhiêu ₫.
- Ưu tiên "TỔNG:" hơn "TỔNG THANH TOÁN:" vì dòng sau có kỳ cộng thêm khoản khác (T7/2026: 217.038.412 vs 221.886.162 ₫).
- **Dòng "Tỷ giá Vietcombank ngày chốt công nợ (…): 26,076 ₫" (09/09/2026):** brand ghi rõ tỉ giá thì đó là mốc số 0, đứng trên mọi mốc suy từ dòng TỔNG (`tiGiaGhiTrenSheet`). Cột VND từng dòng khớp tỉ giá này (≤ 0,5 %) được tin dù dòng TỔNG ₫ lệch (tổng gồm VAT). Hệ quả: từng dòng = USD × tỉ giá Vietcombank đúng như brand tính; Σ kỳ có thể lệch vài chục đồng so dòng TỔNG (brand làm tròn khác) — đã nhập lại Happy Clothing T5/T7, Eegen T2, Jenny K Tran T3 theo luật này.
- **Thành tiền gõ sai đơn vị** ("609.60 đ" trong tab USD, Happy Clothing T5 #MBLVD28657): ô Giá có "$" mà Thành tiền < 1.000 → vẫn là USD (không có giá vốn dưới 1.000 ₫), báo cảnh báo.
- Tab "… thực bán" bỏ qua theo tên tab (khuôn HC vẫn ghi "A. Đơn MEAN thực nhận" trong tab thực bán nhưng cột Thành tiền trống).
- Ngày tiêu đề chấp nhận "31/8/2026"; tên brand lấy đủ ("Happy Clothing").
- Nhập thật 8 kỳ 01–08/2026: 80 dòng đơn (100% khớp SKU đúng), 61 dòng #HC offline, Σ A+B khớp TỔNG (A)/(B) từng kỳ, tỉ giá 25.720–26.108.

**Calista de Minh Thanh (08/09/2026):** khuôn Denio nhưng tiền USD, có "TỔNG (A):" ₫ và "TỔNG (B):" ₫ riêng, "TỔNG THANH TOÁN (A-B)". Tỉ giá kỳ ưu tiên **"TỔNG (A):" ₫ ÷ Σ USD mục A** (không dính return), rồi mới đến "TỔNG:"/"TỔNG THANH TOÁN…" ÷ (Σ lines − Σ return). Cột ngày mục return "Ngày trả" được nhận. Tên brand so khớp bỏ gạch nối/khoảng trắng ("Calista de Minh Thanh" ↔ "Calista-de-minh-thanh"). Kỳ chưa điền "Tổng thành tiền TT" (T8) → 0 dòng, không nhập. Cột "% CK BFCM" thứ hai chưa vào công thức kiểm → vài dòng báo "lệch công thức" nhưng tiền vẫn lấy đúng cột TT.

**La Vierge (08/09/2026):** khuôn Denio, USD, **cột "Note" ghi sẵn thành tiền quy VND từng dòng** ("2,717,400"; T5 ghi nghìn ₫ kiểu "2,321.565" → nhân 1.000). Có VND sẵn thì `tt` lấy đúng số đó (`ttVndSan`), chỉ dòng thiếu mới đổi theo tỉ giá kỳ; nhờ vậy Σ khớp từng đồng với dòng ₫ của brand. Số VND sẵn chỉ được tin khi tỉ lệ VND/USD trong 15.000–40.000 (hoặc 15–40 → nghìn ₫). Nhãn các dòng tổng ₫ của La Vierge **không đáng tin** (tổng A có kỳ ghi "TỔNG THANH TOÁN (B):") nên không đọc tổng theo nhãn (A)/(B); return kỳ cũ thiếu VND sẵn sẽ lệch nhỏ so số brand (T8/2026: 3.040.457 vs 3.063.930). Brand này cũng có PO (#MBLVDPO15…38) → chạy "Phân bổ PO → đơn" sau khi nhập.

**Poem (08/09/2026):** khuôn Denio, VND, CK 25%, cột ngày "Ngày báo" (đã nhận). 8 kỳ khớp TỔNG (A) cả số lượng và Tổng thành tiền TT. Mã đơn `#MXHS…` (cũng gặp ở Denio: #MXHS1536/1538) không có trong Shopify của MEAN → "không có đơn", chờ CEO cho biết store/kênh nào để nối.

**Mã `#MXHS…` (08/09/2026):** đơn sàn XiaoHongShu (Trung Quốc), không có trên Shopify MEAN → bảng offline (như #HC). Gặp ở Denio (#MXHS1536/1538) và Poem (#MXHS1552).

**Whiteplan (08/09/2026):** khuôn Denio, VND, CK 25%; có mục **"B. Đơn thực nhận trong tháng"** thứ hai (cộng như A, không phải return) và kỳ T8 có mục **"C. CẤN TRỪ CHÊNH LỆCH THÁNG 5"** (sửa giá 2 dòng T5, −217.500đ trước thuế) — bộ đọc bỏ qua mục C (cột không phải "Tổng thành tiền", báo cảnh báo), chưa ghi điều chỉnh. "TỔNG THANH TOÁN" của Whiteplan **đã gồm VAT 8%**; giá vốn lấy cột Tổng thành tiền TT trước thuế, nhất quán với các brand khác. 8/8 kỳ Σ lines = TỔNG (A) + TỔNG (B).

**Linh Phùng (08/09/2026):** khuôn Denio; kỳ T8 **một tab hai mục hai tiền**: "A. Đơn thực nhận (USD)" (Note có VND từng dòng nhưng là số **trước VAT** = USD × tỉ giá ÷ 1,08, trong khi dòng TỔNG ₫ mục A = USD × tỉ giá, là số MEAN trả) và "B. Đơn thực nhận (VNĐ)". Bộ đọc chỉ đổi dòng USD; cột VND sẵn phải khớp (≤ 0,5 %) một trong hai mốc — tổng ₫ mục A (dòng TỔNG trước mục B) hoặc dòng "Tổng"/"TỔNG THANH TOÁN" cuối — không thì bỏ và đổi theo tỉ giá TỔNG (T8: 25.880). Mục return T5/T6 có dòng **thiếu một cột** (không có ô "Giá phụ kiện") → tiền dồn sang trái: bộ đọc lấy ô bên trái khi ô Thành tiền trống và báo cảnh báo. Tên brand so khớp bỏ dấu ("Linh Phùng" ↔ "Linh Phung"). 8/8 kỳ Σ lines − Σ return = dòng "Tổng".

**Montsand (08/09/2026):** tiêu đề T1–T4 là "BẢNG KÊ ĐƠN HÀNG CẦN THANH TOÁN" (bộ đọc nhận mọi "BẢNG KÊ … Từ ngày … Brand:"); mục "A./B. Đơn phát sinh trong tháng (trước/sau 13/02/2026)" đều cộng (mọi "A. Đơn…" là mục A; "B. Đơn…" chỉ trừ khi có chữ return); T5–T8 **không có dòng mục A** — tab tên "thực nhận" thì cả tab là mục A; cột giá tên "Giá sản phẩm". "TỔNG THANH TOÁN" có kỳ gồm VAT 8% → giá vốn vẫn lấy TT trước thuế. 8/8 kỳ Σ TT = TỔNG (A)+(B). Vendor "VONTIER DE MONTIER" (SKU `VDM-…`) là brand khác, chưa có sheet.

**Keira Tong (08/09/2026):** khuôn Denio, USD, Note có VND từng dòng ở T5/T7 (T6 không) — tin khi khớp tổng ₫; "TỔNG THANH TOÁN" gồm VAT → giá vốn lấy TT trước thuế. **Kỳ T8 chưa hoàn tất** (mọi dòng "$0.00", cột % CK chép nhầm giá) → bộ đọc bỏ toàn bộ dòng tab đó + cảnh báo "kỳ chưa hoàn tất, KHÔNG nhập" (luật chung: tab có dòng nhưng Σ TT ≤ 0). Có PO/MTB offline → chạy "Phân bổ PO → đơn".

**Maison des Copains (09/09/2026):** một tab trộn **mục A VND + mục B USD** (T8/T6) hoặc ngược lại; tỉ giá cho dòng USD = (tổng ₫ − phần VND thuần) ÷ Σ USD — mốc là "TỔNG (A):"/dòng TỔNG ₫ đầu trước mục B (cho mục A) hoặc dòng "Tổng"/"TỔNG THANH TOÁN…" cuối (cả kỳ). Cột giá "Giá Global". Tab **"Bản sao của …"** bị bỏ (nháp nhân đôi kỳ). Mã `#PO-001` (PO viết khác), `#OS007`, `#MOS10011` → ngoài Shopify → offline (CEO 09/09: OS = Off Store, đơn bán tại showroom Diamond). 8/8 kỳ Σ = TỔNG THANH TOÁN.

**Rosee de Matin (09/09/2026):** khuôn Denio chuẩn, VND, CK 25%; tab T1 đặt tên "T12025" nhưng kỳ lấy theo tiêu đề (01/2026). "TỔNG THANH TOÁN" = TT × 1,03 (phí/thuế riêng của brand) → giá vốn vẫn lấy TT. 8/8 kỳ Σ = TỔNG (A) TT, khớp SKU 100%.

**Tracy Studio (09/09/2026):** USD, không có cột Ngày; tab có thêm khối đối chiếu "Tỷ giá MEAN / TRACY / Chênh lệch" với nhiều số ₫ — dòng "TỔNG (A)" đầu mang số đối chiếu (tỉ giá phi lý). Bộ đọc chọn mốc ₫ theo thứ tự ưu tiên nhưng **chỉ nhận mốc cho tỉ giá 15.000–40.000**; "TỔNG THANH TOÁN" (gồm VAT 8%) xét cuối cùng. Tab "ĐỐI CHIẾU CHÊNH LỆCH" bỏ (không phải bảng kê). 4/4 kỳ (05–08) Σ = TỔNG (A)/(A-B) trước thuế.

**Eegen Studio (09/09/2026):** sheet ghi "Brand: Eegen" (hệ thống "Eegen Studio") → so tên chấp nhận tiền tố ≥ 4 ký tự. USD, Note có VND từng dòng; mỗi tab có "Tỷ giá Vietcombank ngày chốt" + "TỔNG" trước thuế + "VAT (8%)" + "TỔNG THANH TOÁN". Return kỳ cũ (T4) dùng tỉ giá kỳ cũ và có dòng "TỔNG … ₫" riêng **sau** tiêu đề mục B → return duy nhất thiếu VND sẵn lấy đúng số đó (chỉ nhận khi tỉ giá suy ra 15k–40k; dòng ₫ trước tiêu đề B không dùng vì La Vierge dán nhãn sai). Kỳ chưa hoàn tất nhận diện thêm bằng "≥ 50% dòng đơn trống Thành tiền" (Eegen T8). Nhập T1–T7: 64 dòng + 1 return, khớp SKU 100%.

**Larmes (09/09/2026):** khuôn Denio chuẩn, VND, CK 25%; dòng "TỔNG " có thêm một số ₫ phía sau cột TT (không dùng). 8/8 kỳ Σ TT = TỔNG TT, đọc đủ mọi dòng đơn, khớp SKU 100% (3 dòng khớp theo mã gốc).

**LaLing (09/09/2026):** khuôn Denio, VND, CK 25%; header tách hai hàng ("Ngày nhận" riêng) → không có cột ngày. Hai điểm mới: (1) mục thứ hai ghi **"A. ĐƠN RETURN TRONG THÁNG"** — chữ cái không quyết định cộng/trừ, **có chữ return/trả/hoàn là mục trừ**; (2) tab T2/T3 có **tiêu đề dán ngược tháng** — khi cả tab đồng nhất một "Kỳ thanh toán Tn" khác tháng tiêu đề thì kỳ lấy theo cột đó (cảnh báo). 8/8 kỳ Σ = dòng "Tổng".

**Jenny K Tran | Divine (09/09/2026):** tiêu đề "Brand: JENNY K TRAN | DIVINE" — brand riêng `jenny-k-tran-divine` (khác `jenny-k-tran`); tên brand lấy đủ dòng kể cả "|"; USD; dòng tổng ₫ tên "TỔNG CÔNG NỢ MEAN THANH TOÁN:" (mọi dòng bắt đầu "TỔNG" có ₫ trước mục B đều là mốc A); Note có VND nhưng T3/T5 lệch tổng → bỏ, dùng tỉ giá tổng. Chưa có tab T8 thực nhận. 7/7 kỳ Σ = tổng ₫ brand (≤ 2đ).

**Das La Vie (09/09/2026):** khuôn Denio, VND, CK 15%; 8/8 kỳ Σ TT = TỔNG (A)/(A-B). Kỳ T1 có mục **"B. Cấn trừ sai lệch chiết khấu T12"**: sửa CK 25%→15% cho đơn 12/2025 (#MBLVD26605, +550.000đ MEAN trả thêm) — cột "Chênh lệch" không phải Tổng thành tiền → bộ đọc bỏ (cảnh báo). Cùng loại với mục C Whiteplan: **khoản điều chỉnh kỳ trước chưa có cơ chế ghi**, chờ CEO quyết.

**De Theia (09/09/2026):** khuôn Denio, VND, CK 25%. Ba điểm mới: (1) tab T1–T5 ghi nhầm tiêu đề mục "A. Đơn thực bán" trong tab **thực nhận** → tên tab quyết định (có "thực nhận" là bảng kê thực nhận); (2) mục "B. Đơn return" T4 **không có hàng tiêu đề** → bộ đọc giữ bản đồ cột của mục trước; (3) T8 chưa hoàn tất (TT trống nhưng có Phí customize) → fallback "dòng lệch cột" chỉ áp khi ô TT chứa mã Code hoặc ô bên trái không phải cột Phí customize. T7 tiêu đề ghi 06 nhưng Kỳ thanh toán T7 → kỳ 07. 7/7 kỳ Σ = TỔNG THANH TOÁN/(A-B).

**L'SCARLETT (09/09/2026):** brand `l-scarlett` (vendor "L'SCARLETT", bán từ 04/2026), USD, cột "Giá global", CK 50%. Mỗi tab có dòng **"Tỷ giá Vietcombank ngày chốt công nợ"** và dòng duy nhất **"TỔNG CÔNG NỢ MEAN THANH TOÁN" đã gồm VAT 8%** (T4 còn có "TỔNG:" trước thuế; T5–T7 không) — chia theo TỔNG sẽ ra tỉ giá 28.16x sai; bộ đọc lấy tỉ giá từ dòng Tỷ giá (26.108 / 26.085 / 26.076 / 26.080), Note VND (T5/T7) khớp tỉ giá đó nên được tin, T6 không có Note → USD × tỉ giá. Giá vốn = TT trước thuế, nhất quán các brand. Nhập T4–T7: 19 dòng, khớp SKU 100 %, không có offline/return; coverage 19/19 line 04–07. T8 chưa hoàn tất (5 dòng trống TT) → chờ brand chốt. Không có PO.

**TINH Atelier (09/09/2026):** một workbook 01/2025–08/2026, mỗi tháng có tab "… đơn thực nhận" (bảng kê, VND đến T3/2026, USD + dòng Tỷ giá Vietcombank từ T4/2026) và tab "… đơn thực bán" (tham khảo), cộng tab **"TINH Global Tn"** = đơn `TA…` trên store Shopify riêng của TINH (hệ thống đồng bộ store này, store_id 2cc2199b) — cột Thành tiền trống/$0, MEAN không trả tiền hàng → 0 dòng, không phải giá vốn. Bốn luật đọc mới: (1) tiêu đề "đến ngày 30/04/2026"; (2) tab tên không nói gì mà ghi "A. Đơn thực bán" (T4–T8/2026 chỉ có một tab/kỳ, đã điền TT) là bảng kê **khi kỳ đó không có tab thực nhận** (cảnh báo), vẫn là tham khảo khi có; (3) tên tab bị Google cắt 31 ký tự ("… đơn thực nh") so tiền tố; (4) cột "Ngày phát sinh trên web", "Giá VND"/"Giá USD". Bộ nhập bỏ qua tab 0 dòng để không xoá dữ liệu kỳ mà tab khác đã ghi. 7/7 kỳ 2026 Σ = TỔNG THANH TOÁN (≤ 2đ); T8/2026 chưa hoàn tất. Nhập T1–T7/2026: 49 dòng + 1 return + 2 #MOS offline, khớp SKU 100 %. Store MEAN (#MBLVD) phủ 45/51 dòng 01–07; **Store TINH (đơn TA…, store_id 2cc2199b) không nằm trong giá vốn/lãi gộp này — CEO 09/09: store TINH có cách tính riêng, đã tính trong đối soát retail TINH; báo cáo lãi gộp lọc theo store nên chỉ xem store MEAN BLVD.** T7/2026 CK 72 % (MEAN trả 28 % giá) khác các kỳ 30 % — lấy đúng số brand, đã báo CEO.
