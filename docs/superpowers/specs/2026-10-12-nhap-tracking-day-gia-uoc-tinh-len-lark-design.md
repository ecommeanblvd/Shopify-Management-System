# Nhập tracking trong hệ thống → đẩy giá ước tính lên Lark

Ngày: 2026-10-12 · Chốt với CEO trong phiên cùng ngày.

## Vì sao làm

Bảng LOG trên Lark có một khối ô chi phí (`Mức giá cơ sở`, `Phụ phí nhiên liệu`,
`Phí kí nhận trực tiếp`, `VAT/Thuế phí khác`…). **Hôm nay nhân sự gõ tay từng ô**, chép từ
màn "Phân tích chi phí" của cổng hãng sau khi tạo nhãn. Đức đọc khối số đó về sau để đối
chiếu khi hoá đơn hãng về.

Việc gõ tay này bỏ được: hệ thống đã có đúng những con số đó qua Rate API của hãng
(`fedex_rate_quotes` đang giữ cơ sở, chiết khấu, fuel + %fuel, ký nhận, VAT, residential,
remote, demand cho 1.310 kiện FedEx). Nhân sự chỉ cần **dán mã vận đơn**; phần còn lại máy làm.

**Bối cảnh lớn hơn:** CEO đang chuyển nhân sự từ làm thẳng trên Lark sang làm trên hệ thống.
Tính năng này là một phần của việc chuyển đó — nó khiến màn Đóng hàng đáng dùng hơn bảng Lark.

## Mục tiêu

1. Nhân sự nhập mã vận đơn cho một kiện **trong hệ thống**, sau khi đã tạo nhãn trên cổng hãng.
2. Hệ thống hỏi Rate API của **đúng hãng đó**, dùng **cân và kích thước đã đóng thật**, lấy
   bảng giá hợp đồng của kiện.
3. Ghi lên **dòng Lark của chính kiện đó**: mã vận đơn + các ô chi phí.
4. Dòng nào chưa ghi được (API hỏng, chưa có `record_id`, hãng không hỗ trợ) thì **bộ điền bù
   theo cron** thử lại, không mất việc.

## Không làm (non-goals)

- **Không** ghi `Giá chiết khấu` và `% Phụ phí Nhiên liệu` — hai ô đó là **công thức Lark**,
  Lark tự tính từ các khoản thành phần. Ghi vào là lỗi API.
- **Không** đụng `Mức giá chênh lệch (Sau đối soát)` — đó là việc của vòng đối soát hoá đơn,
  không phải của giá ước tính.
- **Không** hỗ trợ Aramex và DHL ở vòng này: hai hãng chưa nối Rate API. Ô chi phí để trống,
  nhân sự điền tay như cũ. Đo 60 ngày gần nhất: FedEx 622 + UPS 55 = **81%** số kiện được phủ;
  Aramex 154 (18,5%); DHL 1.
- **Không** tạo hay xoá record Lark. Chỉ sửa trường của record đã có (D-045).
- **Không** thay thế đối soát theo hoá đơn. Đây là **giá ƯỚC TÍNH**; chính FedEx ghi "chi phí
  cuối cùng được xác định bởi trọng lượng và kích thước theo số liệu đo lường của FedEx".

## Anti-goals — coi là THẤT BẠI kể cả khi chạy đúng

- **Đè lên một con số Đức đã gõ tay.** Chỉ điền ô TRỐNG (CEO chốt 12/10/2026, khớp D-045).
- **Làm mất bất kỳ dữ liệu nào trên Lark.**
- **Ghi một con số sai mà không để lại dấu vết** truy ngược được về lượt hỏi giá nào.
- **Chặn nhân sự khi Rate API hỏng.** Mã vận đơn phải lưu được kể cả khi không lấy được giá.

## Ràng buộc đã biết

- **D-045** — Lark chỉ có MỘT đường ghi (`updateLogRecordFields`: record_id + đúng trường cần
  đổi). Không có API xoá, có chủ đích. Giá trị cột chọn (vd `Couriers`) phải khớp CHÍNH XÁC.
- **Khoá Lark chỉ nằm trên Railway.** Máy dev không có. Mọi lệnh chạm Lark phải qua
  `railway run`, và không bao giờ in giá trị khoá.
- **vitest chỉ nhận `.ts`**, không nhận `.tsx` → mọi logic phải nằm trong module thuần.
- **Bảng đích chính là bảng LOG đang dùng**: `LARK_LOG_TABLE_ID = tblF32k3qUhEcK5x`,
  `LARK_BASE_APP_TOKEN = HxfAw0iRViHiNgkSlbBltpVkg3f`. Không phải nối bảng mới.

## Chặn đường: `record_id` chưa bao giờ được lưu

`updateLogRecordFields` cần **record_id của Lark**. Đo 12/10/2026:

| | |
|---|---|
| Kiện có `log_unique_code` (PK-xxxxx) | **6.312 / 6.312 — 100%** |
| Kiện có `lark_record_id` | **0** |
| Kiện có `hop_lark_record_id` | **0** |

Lượt đồng bộ **vẫn đọc được** record_id từ Lark (`listAllRecords` trả về nó), chỉ là chưa ai
lưu xuống. Vậy việc đầu tiên, trước mọi việc khác: **lưu `record_id` xuống `shipments` trong
lượt đồng bộ**. Đây là điều kiện cần cho mọi việc ghi ngược Lark về sau, không riêng việc này.

Trước khi làm, người thực hiện phải **đo lại** con số 0% ở trên — nếu một lượt sync nào đó đã
bắt đầu lưu thì phần này rút gọn.

## Luồng

1. Nhân sự đóng kiện → mở **"Lên vận đơn"** (`HopThoaiVanDon`, đã có) → copy sang cổng hãng →
   tạo nhãn.
2. Quay lại hệ thống, **dán mã vận đơn** vào kiện đó.
   - Ô nhập **nhận cả URL lẫn số trần**. Nhân sự copy URL từ cổng hãng tiện hơn copy số, nên
     hệ thống tự bóc số ra khỏi URL.
   - *Lý do không ghi URL lên Lark:* cột `Tracking link` trên Lark là **Lookup/công thức**,
     không ghi được — Lark tự dựng link từ `Tracking Number`.
3. Hệ thống lưu `shipments.tracking_number`.
4. Hệ thống hỏi Rate API của hãng tương ứng bằng **cân + kích thước đã đóng thật của kiện**
   (không dùng số brand khai — số khai bị thổi lên, đã đo).
5. Hệ thống ghi lên dòng Lark: `Tracking Number` + khối ô chi phí, **chỉ ô đang trống**.
6. Ô nào không ghi được thì cron điền bù thử lại.

## Bản đồ cột Lark

Cột ghi được (dạng Currency) ↔ dữ liệu mình có:

| Cột Lark | Nguồn |
|---|---|
| `Mức giá cơ sở` | cước cơ bản đã trừ chiết khấu |
| `Phụ phí nhiên liệu` | fuel |
| `Phụ phí vùng sâu xa` | remote |
| `EES / Theo nhu cầu` | demand |
| `Phí kí nhận trực tiếp` | signature |
| `Phụ Phí Residential` | residential |
| `Phí xử lý hàng nhập` | importHandling |
| `VAT/Thuế phí khác` | vat |
| `Tracking Number` (Text) | mã vận đơn nhân sự nhập |

**Không ghi:** `Giá chiết khấu`, `% Phụ phí Nhiên liệu` (Formula) · `Tracking link`,
`Couriers (look up)`, mọi cột Lookup · `Log Unique code` (AutoNumber).

Người thực hiện **phải đọc lại danh sách cột trước khi code** (bảng có 92 cột và người vận
hành có thể đổi tên). Đọc bằng `railway run` + API `bitable/v1/apps/{app}/tables/{table}/fields`.
Lưu ý: app_token để gọi API fields là **`PnFJb4IDPaIkCAssi2VlD0jNgng`** (phân giải từ node wiki
`HxfAw0iRViHiNgkSlbBltpVkg3f` qua `wiki/v2/spaces/get_node`); riêng đường ghi hiện có vẫn dùng
`LARK_BASE_APP_TOKEN` như cũ và đang chạy tốt — **đừng đổi nó**.

## Các quyết định đã chốt

- **Chỉ điền ô trống, không bao giờ đè** (CEO 12/10/2026). Dòng cũ giữ số tay kể cả khi số đó
  sai — đổi lại là an toàn: một lỗi lập trình không thể quét sạch số liệu Đức đã nhập.
- **Lark vẫn là nguồn đọc.** `patchFrom` hiện ghi tracking về hệ thống khi Lark có giá trị
  (`if (row.trackingNumber)`), nên lượt đồng bộ **không** xoá mã mình vừa nhập. Giữ nguyên
  hành vi này; không đảo chiều quyền ưu tiên khi đọc.
- **Rate API hỏng không chặn nhân sự.** Lưu tracking trước, giá để trống, cron thử lại.
- **Giá lấy theo cân/kích thước ĐÃ ĐÓNG**, không theo số brand khai.

## Để người thực hiện quyết

- Vị trí chính xác của ô nhập trong màn Đóng hàng (trong `HopThoaiVanDon` hay một nút riêng
  trên dòng kiện) — miễn là nhân sự thấy nó ngay sau khi tạo nhãn xong.
- Nhịp cron điền bù và cách lùi khi API hỏng liên tiếp.
- Có lưu bảng báo giá cho UPS giống `fedex_rate_quotes` hay không. Nếu lưu thì tính năng
  "báo giá vs hoá đơn" cho UPS về sau dùng lại được ngay.
- Cách hiện lỗi cho nhân sự khi không lấy được giá (không được im lặng).

## Phép kiểm trước khi coi là xong

- Ghi thử lên **một** dòng Lark thật, kiểm đúng ô, rồi **xoá dấu vết thử** (luật đứng: bản ghi
  thử trên Lark phải xoá sau khi thử).
- Chứng minh ô ĐÃ CÓ số không bị đè.
- Chứng minh Rate API hỏng thì tracking vẫn lưu được.
- Chứng minh kiện Aramex không làm hỏng luồng (bỏ qua êm, không báo lỗi giả).
