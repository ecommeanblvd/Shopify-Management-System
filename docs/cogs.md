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
