# Ghi ngược trạng thái giao, ngày giao và chi phí hãng lên bảng Lark LOG-Export

**Ngày:** 2026-09-19 · **Trạng thái:** thiết kế, chờ CEO soát · **Quyết định liên quan:** D-045 (đường ghi Lark chỉ điền ô trống — spec này mở rộng), D-051 (mỗi việc nền một tên), D-073 (Lark không phải nguồn tiền), D-086 (ngày giao theo từng mã vận đơn)

## 1. Vấn đề

Bảng Lark **LOG-Export** là bảng vận hành chính của Ops: 897 dòng tạo trong 60 ngày (≈15 kiện/ngày), mỗi kiện Ops điền ~20 ô tay. Trong đó **~10 ô là thứ SMS đã biết**:

| Nhóm | Cột Ops gõ tay (tỉ lệ điền 60 ngày) | SMS đã có từ đâu |
|---|---|---|
| C — theo dõi giao | `LOG-EP-Dispatch Category (Final)` 95 %, `LOG-EP-Dispatch Status` 95 %, `Ngày giao dự kiến` 96 %, `Ngày giao thực tế` 85 % | Tra FedEx / DHL / UPS mỗi giờ; bằng chứng giao hàng (POD) trên hoá đơn FedEx |
| D — chi phí hãng | `INS \| Chi phí Tổng (đ)` 85 %, `Mức giá cơ sở` 85 %, `Phụ phí nhiên liệu` 85 %, `VAT/Thuế phí khác` 82 %, `Phí kí nhận trực tiếp` 61 %, `EES / Theo nhu cầu` 37 %, `Phí xử lý hàng nhập` 36 %, `Phụ phí vùng sâu xa` 7 %, `Phụ Phí Residential` 5 % | Bảng `shipment_charges` — cước hãng đã thu, tách từng khoản, nhập từ hoá đơn FedEx/Aramex; 1.038/1.388 kiện 90 ngày đã có |

Ops gõ lại số từ hoá đơn hãng vào Lark để công thức Lark tính lãi, trong khi SMS đã đối soát xong. Trạng thái giao Ops cũng tự tra rồi gõ, trong khi SMS đã tra tự động.

Ngược lại, SMS hiện **đọc** trạng thái giao từ Lark: 1.270/1.383 kiện 90 ngày lấy ngày giao từ Lark nhập tay, chỉ 113 kiện từ hãng. Muốn Ops ngừng gõ thì phía SMS phải đủ tự tin lấy hãng làm nguồn.

## 2. Mục tiêu bước 1

Ops **ngừng gõ 13 ô nhóm C + D**; SMS điền thay, mỗi giờ, lên đúng dòng Lark. Ops không phải đổi công cụ, Lark vẫn nguyên để ai quen xem thì xem. Nhóm A (đóng gói) và B (lên vận đơn) Ops vẫn gõ như cũ — chuyển ở bước 2.

## 3. Nguyên tắc ghi (CEO chốt 19/09/2026 — phương án 1)

1. **Hãng là sự thật cho trạng thái và ngày giao thực tế.** SMS ghi đè `Dispatch Category`, `Dispatch Status`, `Ngày giao thực tế` mỗi khi hãng có tin mới, kể cả khi Ops đã gõ khác. Khớp với quyết định trước: POD trên hoá đơn ghi đè ngày Lark nhập tay.
2. **Cổng "nguồn hãng" chỉ áp cho trạng thái và ngày giao thực tế.** Hai ô chọn và `Ngày giao thực tế` chỉ ghi khi `delivery_source ∈ {fedex, dhl, ups, trackingmore, carrier_bill}` — SMS không bao giờ lấy dữ liệu Lark ghi lại vào Lark. Chi phí (từ `shipment_charges`, hoá đơn hãng) và `Ngày giao dự kiến` (cam kết SOP) không thể là dữ liệu Lark dội lại nên điền ô trống bất kể nguồn trạng thái. (Sửa 19/09/2026 sau lượt dry: luật cũ chặn chi phí ở 834/864 kiện.)
3. **Chi phí chỉ điền ô trống.** Số Ops đã gõ có thể đã được đối soát tay; lệch thì ghi nhật ký, không sửa.
4. **`Ngày giao dự kiến` chỉ điền ô trống.** SMS không có ngày hãng hứa; SMS điền **cam kết SOP** (`label_created_at + slaCuaNuoc(nước)`) để công thức Lark `Final | Delivery Status` vẫn phân được "Đúng / Chậm / Nhanh hơn dự kiến" như KPI 1.2 đang chấm. Ops gõ ngày hãng hứa thì giữ.
5. **Không tạo, không xoá dòng Lark** (giữ D-045). Chỉ sửa ô của dòng đã có.
6. **Chỉ ghi ô KHÁC giá trị hiện có** (D-05x: mọi luồng định kỳ so với giá trị đang có trước khi ghi).

## 4. Khớp dòng Lark ↔ kiện SMS

Khoá chính: **`Log Unique code`** (cột AUTO number `PK-xxxxx` của Lark) = `shipments.log_unique_code`. 1.429/1.429 kiện 90 ngày có code, code là duy nhất mỗi dòng nên không có chuyện đơn tách kiện nhận nhầm dòng (đúng tinh thần D-086). Không khớp code thì **bỏ qua** dòng đó, không thử khớp theo mã đơn.

Phạm vi thời gian: kiện có `label_created_at` trong **60 ngày** (khớp cửa sổ courier-backfill). Kiện cũ hơn đã xong việc.

## 5. Bảng map cột

### 5.1 Trạng thái (ghi đè khi nguồn là hãng)

| `shipments.delivery_status` | `LOG-EP-Dispatch Category (Final)` | `LOG-EP-Dispatch Status` |
|---|---|---|
| `label_created` | Shipment Created | Ready for Carrier |
| `in_transit`, `out_for_delivery` | In Transit | On Delivery |
| `delivered` | Delivered | Delivery Completed |
| `exception` | Shipping Exceptions | Delayed |
| `returning` | Shipping Failed | Return-Processing |
| `unknown` / null | — không ghi — | — |

Hai cột đều là ô chọn: ghi **đúng chuỗi** đang có trong danh sách (kiểm 19/09 qua API fields), giá trị lạ sẽ đẻ lựa chọn mới (bài học cột Couriers, D-045). Cột `Sub-Status` (0 % điền) không ghi.

`Final | Delivery Status` là **công thức** của Lark dựa trên Category + so sánh hai ngày giao, không ghi được và không cần ghi.

### 5.2 Ngày

| Cột Lark | Nguồn SMS | Luật |
|---|---|---|
| `Ngày giao thực tế` | `shipments.delivered_at` | Ghi đè khi nguồn là hãng. Chỉ khi `delivery_status = delivered`. |
| `Ngày giao dự kiến` | `label_created_at + slaCuaNuoc(ship_country)` | Chỉ điền ô trống. Cần có `label_created_at` và nước. |

Định dạng: Lark nhận epoch ms; ghi **nửa đêm giờ VN của ngày-lịch** (nghịch đảo của `larkEpochToVnMidnight` trong `parse-pack-row.ts`), để đọc lại ra đúng ngày.

### 5.3 Chi phí (chỉ điền ô trống, VND)

Nguồn: `shipment_charges` theo `shipment_id` (một dòng mỗi kiện; 100 % `currency = 'VND'`).

| Cột Lark | `shipment_charges` |
|---|---|
| `INS \| Chi phí Tổng (đ)` | `total_amount` |
| `Mức giá cơ sở` | `base` |
| `Phụ phí nhiên liệu` | `fuel` |
| `Phụ phí vùng sâu xa` | `remote` |
| `EES / Theo nhu cầu` | `demand` |
| `Phí kí nhận trực tiếp` | `direct_signature` |
| `VAT/Thuế phí khác` | `vat` |
| `GoGreen Plus-Basic` | `gogreen` |
| `Phí rủi ro gia tăng` | `elevated_risk` |
| `Phí xử lý hàng nhập` | `import_handling` |
| `Phụ Phí Residential` | `residential` |

Luật:
- Chỉ ghi khi `total_amount > 0`.
- Khoản thành phần bằng 0 thì **không ghi** (Ops để trống ô 0đ — `Phụ phí vùng sâu xa` chỉ 7 % có số).
- `discount` không ghi: Lark có công thức `Giá chiết khấu` tự trừ từ tổng. `address_correction`, `non_conveyable` không có cột Lark → bỏ.
- **Bước 0 bắt buộc trước khi bật:** đối chiếu 20 dòng Ops đã gõ tay với `shipment_charges` để xác nhận `Mức giá cơ sở` Ops ghi là giá **niêm yết** (`base`, trước chiết khấu) chứ không phải giá sau chiết khấu. Nếu Ops ghi giá sau chiết khấu thì map thành `base + discount`. Kết quả ghi vào Decisions.

## 6. Chống vòng lặp Lark → SMS → Lark

Hiện `features/lark/sync.ts` (khối freeze) lấy trạng thái Lark ghi vào `shipments` với `delivery_source = 'lark'` mỗi khi kiện chưa `delivered`. Sau khi SMS ghi Category lên Lark, công thức `Final | Delivery Status` đổi, lượt sync sau đọc lại và **ghi đè nguồn hãng thành nguồn lark** → lượt ghi ngược sau bị chặn (luật 3.2) → trạng thái đứng.

Sửa khối freeze: **không đè kiện có `delivery_source` là hãng.** Cụ thể, ba lệnh UPDATE của freeze thêm điều kiện `delivery_source IS NULL OR delivery_source = 'lark'` (`can-freeze.ts` thêm điều kiện tương ứng để bỏ qua trong bộ nhớ). Hệ quả có chủ ý: khi hãng đã nói, Ops gõ gì trên Lark cũng không đổi được SMS — đúng luật 3.1. Trạng thái `delivered` vẫn dính (sticky) như cũ.

## 7. Cơ chế chạy

- **Ở đâu:** trong `scripts/cron/sync-lark.ts`, ngay sau `syncLarkPacks()` (đã có key Lark, đã tải toàn bộ record). Việc mới tên **`ghi-nguoc-lark`** trong `features/jobs/registry.ts`, nhóm `sync-lark`, chạy qua `chayMotJob` để trang Tác vụ nền thấy.
- **Không đọc thêm Lark:** `syncLarkPacks` trả thêm danh sách `{ record_id, fields }` đã tải (hiện bỏ đi sau khi dùng); việc ghi ngược dùng lại, khỏi tốn một lượt đọc ~4.000 record.
- **Một đường ghi:** `updateLogRecordFields(recordId, fields)` như D-045. Mỗi dòng một lệnh PUT gom mọi ô cần đổi.
- **Công tắc:** env `LARK_GHI_NGUOC` — `dry` = tính patch, ghi nhật ký, **không** gọi Lark; `1` = ghi thật; trống = không chạy.
- **Nhật ký mỗi lượt:** số dòng soi, số dòng ghi, số ô ghi theo nhóm (trạng thái / ngày / chi phí), số dòng bỏ qua vì nguồn lark, số ô **lệch** (Ops gõ khác hãng — trạng thái/ngày thì đã ghi đè, chi phí thì không đụng), 5 ví dụ lệch đầu tiên.

## 8. Cấu trúc code

```
features/lark/ghi-nguoc/
  map-trang-thai.ts        THUẦN: DeliveryStatus → {category, status} | null
  ngay-lark.ts             THUẦN: Date → epoch nửa đêm VN; so sánh với ô Lark
  dung-patch.ts            THUẦN: (kiện SMS, charge, ô Lark hiện có) → patch { fieldName: value } + danh sách lệch
  ghi-nguoc.ts             đọc kiện 60 ngày + charges, khớp code, gọi dungPatch, ghi qua updateLogRecordFields, trả tóm tắt
features/lark/can-freeze.ts   thêm điều kiện nguồn hãng (mục 6)
features/lark/sync.ts         freeze thêm WHERE nguồn; trả records đã tải
scripts/cron/sync-lark.ts     chayMotJob('ghi-nguoc-lark', …)
features/jobs/registry.ts     khai việc
```

Mỗi hàm thuần một việc; `ghi-nguoc.ts` là chỗ duy nhất chạm DB và Lark.

## 9. Kiểm thử

Thuần, không mạng:
- `mapTrangThai`: đủ 7 trạng thái; `unknown` → null; chuỗi ra khớp đúng danh sách lựa chọn Lark (test canh bằng hằng số).
- `dungPatch`:
  - nguồn `lark`/null → patch rỗng dù dữ liệu đủ;
  - nguồn hãng, Ops gõ Status khác → patch có ghi đè + một mục lệch;
  - `delivered` → có `Ngày giao thực tế`; `in_transit` → không;
  - `Ngày giao dự kiến` đã có → không ghi; trống + có nước → `label + SLA`;
  - chi phí: ô đã có số → không ghi, lệch nếu khác; thành phần 0 → không ghi; `total_amount = 0` → không ghi gì;
  - ô hiện có bằng giá trị mới → không nằm trong patch.
- `ngayLark`: 2026-09-19 → epoch đúng nửa đêm VN; đọc ngược qua `larkEpochToVnMidnight` ra cùng ngày.
- `can-freeze`: kiện nguồn `fedex` → `canDongTrangThai` false.

Chạy thật: `LARK_GHI_NGUOC=dry` hai lượt cron, CEO xem nhật ký (số ô sẽ ghi, số lệch) trước khi bật `1`.

## 10. Triển khai

1. Bước 0 (mục 5.3): xác nhận quy ước `Mức giá cơ sở` trên 20 dòng.
2. Code + test, đẩy; Railway `sync Lark operation` đặt `LARK_GHI_NGUOC=dry`.
3. Hai lượt cron dry: soát nhật ký. Kỳ vọng ~1.000 kiện có charge được điền, vài trăm ô trạng thái/ngày.
4. Bật `1`. Kiểm bằng mắt 10 dòng trên Lark.
5. Báo Ops: ngừng gõ 13 ô nhóm C + D; ô nào SMS chưa điền sau 2 giờ là kiện SMS chưa có dữ liệu (chưa khớp code, hãng chưa trả lời, hoá đơn chưa về) — báo lại thay vì gõ.
6. Ghi D-0xx vào Decisions: mở rộng D-045 (ghi đè có điều kiện cho trạng thái/ngày; nguồn hãng thắng Lark ở cả hai chiều).

## 11. Ngoài phạm vi

- Nhóm A (cân/dim/vật tư) và B (tracking/nhãn/attachment): bước 2.
- Cột `Sub-Status`, `Mức giá chênh lệch (Sau đối soát)`, `INS | VA Return`, `MR | Giá Ship Khách Chịu` (0 % điền).
- Bảng LOG-Import (hàng hoàn), WH-Inventory (QC), Transfers: chưa có luồng SMS tương ứng.
- Ngày giao dự kiến từ hãng (FedEx `estimatedDeliveryTimeWindow`): bổ sung sau nếu Ops cần ngày hãng hứa thay cho cam kết SOP.
