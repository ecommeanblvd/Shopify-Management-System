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
- **Không** giới hạn ở hãng có API. CEO đính chính 12/10/2026: Aramex đã có bảng giá trong
  engine (**2 bảng, 1.800 ô giá**) và cách tính của hệ thống **đã được kiểm chứng khớp bill
  Aramex**, nên báo giá của engine dùng làm giá ước tính được. DHL cũng có sẵn (1.520 ô).
  → Nguồn giá: **API sống ở đâu có (FedEx `Rate`, UPS `Rating`), engine ở chỗ còn lại**.
  Phủ ~99% thay vì 81%.
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

## Điều kiện cần — ĐÃ LÀM (commit `4bfff8c5`)

`updateLogRecordFields` chỉ nhận **record_id**, không nhận `Log Unique code`. Đo 12/10/2026:
6.312/6.312 kiện có PK-xxxxx, nhưng `lark_record_id` **0/6.312**. Lượt đồng bộ vẫn đọc
record_id về, chỉ là chưa ai lưu.

Đã sửa: `PackRow.recordId`, truyền ở **cả hai** đường vào (cron `sync-lark` + webhook
`/api/lark/pack`), `patchFrom` chỉ ghi khi CÓ. Đã nạp `larkRecordId` vào truy vấn `existing`
ở cả hai chỗ — thiếu bước đó thì `coThayDoi` luôn thấy "khác" và ghi lại mọi dòng mọi lượt
(hồi quy 3.770 lệnh/lượt đã sửa 05/09). Có test chốt bộ khoá `patchFrom` sinh ra.

**Còn lại:** record_id được điền dần theo nhịp cron. Người thực hiện **đo độ phủ trước**;
nếu còn thấp thì cần một lượt backfill riêng.

## XUNG ĐỘT đã biết và đã chấp nhận: `features/lark/ghi-nguoc/`

**Đã có sẵn một đường ghi khác lên ĐÚNG khối ô chi phí này.** `features/lark/ghi-nguoc/cot.ts`
giữ `COT_CHI_PHI` map đúng các cột dưới đây; `dung-patch.ts` ghi chúng từ `shipment_charges`
— tức **hoá đơn hãng THẬT**, không phải ước tính — cũng theo luật "chỉ điền ô trống", lệch thì
chỉ ghi vào nhật ký `lech`.

**Hệ quả:** ước tính lấp đầy ô vài giờ sau khi tạo nhãn; hoá đơn thật về sau vài tuần sẽ thấy
ô đã có số và **không bao giờ ghi lên Lark nữa**. Lark giữ ƯỚC TÍNH vĩnh viễn cho các kiện đi
qua luồng này.

**SỬA (CEO đính chính 12/10/2026): đây KHÔNG phải xung đột.** Khối ô này **xưa nay vẫn là giá
ước tính do nhân sự điền sau khi tạo vận đơn**, chưa bao giờ là số hoá đơn. Luồng mới chỉ tự
động hoá đúng việc nhân sự đang làm tay. Đảo lại: `ghi-nguoc` mới là bên đang đổ **số hoá đơn
thật** vào ô mang nghĩa "ước tính" — nên việc nhánh đó hiếm khi ghi được nữa là **đúng hơn**,
không phải mất mát. Không gỡ nhánh đó ở vòng này.

**CEO chốt 12/10/2026: chấp nhận, tạm thời giữ "không đè".** Số hoá đơn thật vẫn đầy đủ trong
hệ thống (màn Đối soát phí ship, `carrier_bill_lines`, `shipment_charges`); Lark thành nơi xem
nhanh chứ không phải nơi đối soát. Đây là **đánh đổi có chủ đích**, không phải chỗ hở — ai sửa
sau này đừng "sửa" nó mà chưa hỏi.

**Không đụng gì tới `ghi-nguoc` ở vòng này.** Nhánh chi phí của nó sẽ gần như không còn ghi
được cho những kiện mới; đó là hệ quả đã biết của quyết định trên.

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
| `Mức giá cơ sở` | cước cơ bản **giá niêm yết** (chưa trừ chiết khấu) — đúng quy ước sẵn có `QUY_UOC_BASE = 'niem_yet'` ở `features/lark/ghi-nguoc/dung-patch.ts`, cùng nghĩa với số mà đường ghi hoá đơn đã dùng cho ô này. Bản đầu của tài liệu ghi "đã trừ chiết khấu" là SAI: hai nghĩa trong một ô thì không ai đối soát được |
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

**Dùng lại `COT_CHI_PHI` trong `features/lark/ghi-nguoc/cot.ts` làm nơi DUY NHẤT giữ tên cột
Lark — không khai lại bảng tên cột thứ hai.** Chính file đó đã ghi lý do: *"Đổi tên cột bên
Lark là hỏng — nên để MỘT chỗ."* Hai nơi giữ tên cột thì Ops đổi tên cột chỉ sửa được một bên.
(Quyết định của người viết thiết kế, 12/10/2026.)

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

## Hai chỗ PHẢI ĐO, không được đoán

**VAT cho báo giá UPS.** (UPS Rating API trả `ItemizedCharges` kèm mã từng khoản — bóc được
cơ sở/fuel/residential/ký nhận/demand/vùng sâu xa như FedEx. Riêng VAT thì không có.) FedEx Rate API trả `vat` thành khoản riêng (`fedex_rate_quotes.vat`),
dùng thẳng được. **UPS Rating API không trả VAT thành khoản riêng** — code hiện có chỉ cộng VAT
vào TỔNG để so sánh hiển thị. Đoán sai "base chịu thuế" là sai đúng ô `VAT/Thuế phí khác` —
chính ô Đức dùng để đối soát. Phải đo trên hoá đơn UPS thật (tờ `100000813108`: 37/37 dòng có
VAT nằm trong 7,97%–8,00% của gốc chịu thuế; gốc = mọi khoản dịch vụ, TRỪ chính VAT và TRỪ
thuế nhập khẩu — xem `gocChiuVatUps` trong `ups-invoice-xml.ts`).

**Cờ `signatureOptIn` / `recipientResidential` lúc quote.** Script backfill FedEx lấy hai cờ
này từ `shipment_charges` — tức từ hoá đơn THẬT, chưa tồn tại lúc vừa dán mã vận đơn. Đường
quote gần nhất (`baoGiaKien` trong `features/dong-hang/actions.ts`) đang hardcode
`signatureOptIn: false`. Nếu bỏ qua, ước tính sẽ thiếu đúng hai khoản đó. Người thực hiện phải
chốt nguồn cho hai cờ này và **nói rõ giới hạn trên màn hình**, không để sai âm thầm.

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
