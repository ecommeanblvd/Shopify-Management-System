# Bảng kê ship hộ gửi MMP — payload `statement.issued`

**Ngày:** 30/09/2026 · **Người đặt:** CEO Lê Minh Tiệp
**Mục đích:** kế toán MMP đối soát được **từng khoản phí**, thay vì chỉ thấy một con số tổng.

## Gửi đi đâu, xác thực thế nào

`POST` tới `MMP_SHIP_HO_WEBHOOK_URL`, thân là JSON:

```json
{
  "event": "statement.issued",
  "mmpRef": "<brand-slug>",
  "code": "<brand-slug>",
  "origin": "sms",
  "occurredAt": "2026-09-30T10:00:00.000Z",
  "data": { ... }
}
```

Hai header ký:

| Header | Nội dung |
|---|---|
| `x-mean-timestamp` | epoch giây |
| `x-mean-signature` | HMAC-SHA256 của `<timestamp>.<raw body>` bằng secret chung |

Ký trên **raw body**, không phải JSON đã parse lại.

## `data` — cấp bảng kê

| Trường | Kiểu | Nghĩa |
|---|---|---|
| `statementId` | uuid | Khoá của bảng kê. Cùng bảng kê bắn lại thì `statementId` không đổi |
| `type` | `freight` \| `duty` | Loại bảng kê |
| `periodStart` / `periodEnd` | `YYYY-MM-DD` | Kỳ |
| `periodBasis` | `first_push_at` | Kỳ tính theo ngày đẩy đơn sang MMP lần đầu |
| `orders` | mảng | Xem dưới |
| `orderCount` | số | `orders.length` |
| `totalVnd` | số | Tổng `amountVnd` của mọi đơn |

## `orders[]` — cấp đơn

| Trường | Kiểu | Ghi chú |
|---|---|---|
| `code` | chuỗi | Mã đơn trong SMS |
| `mmpRef` | chuỗi | Mã MMP; rơi về `code` khi thiếu |
| `brandReference` | chuỗi \| null | Mã brand tự đặt (`#KLS1983`) |
| `trackingNumber` | chuỗi \| null | Mã vận đơn |
| `shippedAt` | `YYYY-MM-DD` \| null | Ngày gửi |
| **`amountVnd`** | số | Số tiền của đơn này **TRONG BẢNG KÊ NÀY** — xem "Hai loại bảng kê" |
| `fees[]` | mảng | Khoản phí chi tiết — xem dưới |
| `carrier` | chuỗi \| null | `fedex`, `dhl`… |
| `country` | chuỗi \| null | Mã nước nhận |
| `weightKg` | số \| null | Cân khai |
| `chargeableWeightKg` | số \| null | Cân hãng tính cước (có thể khác cân khai do quy đổi kích thước) |
| `dimensions` | chuỗi \| null | `DxRxC` cm |
| `fedexInvoiceNumber`, `invoiceDate` | | **chỉ có ở bảng kê `type: "duty"`** |

**Bất biến quan trọng:** `sum(fees[].amountVnd) === amountVnd`, trong CÙNG một bảng kê.
Đo lại 30/09/2026: bảng kê cước **137/137**, bảng kê duty **75/75**.

### Ba con số hay bị so nhầm với nhau

Bản trước ghi "137/137 và 74/74" mà không nói rõ **đếm cái gì**, nên MMP so nó với số đơn đã
nhận được và tưởng thiếu 1 đơn cước, thừa 2 đơn duty. Không đơn nào thiếu. Ba con số dưới đây
đếm **ba tập khác nhau** và không được so chéo:

| Con số | Đếm cái gì | Hôm nay |
|---|---|---|
| Bất biến khoản phí | đơn có bảng khoản phí, dùng để KIỂM `sum(fees) === amountVnd` | cước 137, duty 75 |
| Đơn đã đẩy `order.reconciled` thành công | đơn MMP đã nhận giá chốt | **136** |
| Đơn đã đẩy `order.duty_charged` thành công | đơn MMP đã nhận thuế | **76** |

Hai con số cuối là thứ MMP đối chiếu được với sổ của mình, và chúng **khớp tuyệt đối** với số
MMP báo (136 / 76). Con số đầu chỉ là thống kê kiểm nội bộ của SMS.

Đề xuất của MMP — **trả 422 khi tổng không khớp** — là đúng và chúng tôi ủng hộ. Lệch tiền
phải bật lên ngay, không ghi bừa.

## Hai loại bảng kê, và vì sao `amountVnd` khác nhau

Cước và duty đi ở **hai bảng kê riêng**, vì hoá đơn duty của FedEx về sau hoá đơn cước 3–6 tuần.

| `type` | `amountVnd` của mỗi đơn | `fees[]` chứa |
|---|---|---|
| `freight` | **chỉ CƯỚC** | mọi khoản TRỪ `duty` |
| `duty` | **chỉ DUTY** | đúng một khoản `duty` |

Một đơn xuất hiện ở **cả hai** bảng kê, ở hai thời điểm khác nhau. Tổng brand phải trả cho đơn
đó = `amountVnd` ở kê cước + `amountVnd` ở kê duty. **Đừng cộng `fees` của hai kê vào một chỗ
rồi so với một con số duy nhất** — chúng là hai lần thu.

## `order.duty_charged` — bảng kê duty KHÔNG thay thế nó

Bảng kê `type: "duty"` là **thêm vào**, không phải bản thay thế. `order.duty_charged` vẫn bắn
như cũ, cho từng đơn, ngay khi hoá đơn thuế về — độc lập hoàn toàn với việc có bảng kê hay
chưa (nó chạy cả khi hoá đơn cước chưa về và cả khi đơn đã đóng băng đối soát).

Đo 30/09/2026: **76 sự kiện · 76 đơn · 49.574.929đ**, tất cả đã gửi thành công, **0 sự kiện
tồn**, gần nhất 30/09. Con số này **trùng tuyệt đối** với tổng duty trong SMS (76 đơn,
49.574.929đ) — và trùng với `ShipHoDutyCharge` phía MMP.

Hai đường phục vụ hai việc khác nhau và phải đọc cả hai: `order.duty_charged` **đưa thuế vào
công nợ từng đơn**; bảng kê duty **gom kỳ để kế toán đối soát**. Tắt đường nào cũng mất việc
của đường đó.

## Quan hệ với sự kiện `order.reconciled`

`statement.issued` **không thay thế** `order.reconciled`. Hai kênh khác nhau, đọc cả hai:

| | `order.reconciled` | `statement.issued` |
|---|---|---|
| Cấp | từng đơn | cả bảng kê |
| Khi nào | lúc đối soát xong, chốt giá thu | lúc phát hành bảng kê |
| Trường giá | `finalChargedVnd` (+ `dutyVnd`, `totalWithDutyVnd`) | `orders[].amountVnd` |
| Dùng để | **đặt giá của đơn** | **đối soát kế toán** |

SMS **vẫn đang gửi** `finalChargedVnd` trong `order.reconciled` — không có gì thay đổi, MMP cứ
đọc như cũ. Với công tắc hiện tại (`MMP_TACH_DUTY=1`), `finalChargedVnd` là **cước riêng**, kèm
`dutyVnd` và `totalWithDutyVnd`. Sự kiện KHÔNG có `dutyVnd` là bản hợp đồng cũ.

Vì cả hai đều là **cước riêng**, MMP có thể dùng làm phép chiếu chéo:
`amountVnd` (kê `freight`) nên bằng `finalChargedVnd` của cùng đơn.

## `fees[]` — khoản phí

| Trường | Kiểu | Ghi chú |
|---|---|---|
| `code` | chuỗi | **Khoá theo trường này.** Mã ổn định, không đổi |
| `label` | chuỗi | Chữ tiếng Việt để hiển thị. **CÓ THỂ ĐỔI — đừng khoá theo nó** |
| `amountVnd` | số | Số tiền |
| `percent` | số (tuỳ chọn) | Chỉ có ở khoản tính theo tỉ lệ (nhiên liệu, VAT) |

### Danh sách `code`

| `code` | Nghĩa | Cột tương ứng trong file đối soát của Đức |
|---|---|---|
| `base` | Cước cơ bản | Cước vận chuyển |
| `fuel` | Phụ phí xăng dầu (kèm `percent`) | PP Nhiên liệu + % PP Nhiên liệu |
| `signature` | Ký nhận trực tiếp | PP kí nhận trực tiếp **+ Phí Giao nhà dân** — xem lưu ý |
| `demand` | Phụ phí nhu cầu | PP Nhu cầu |
| `remote` | Phụ phí vùng xa | PP vùng sâu xa |
| `residential` | Giao nhà dân | Phí Giao nhà dân |
| `import_handling` | Phí xử lý hàng nhập khẩu | PP xử lý hàng nhập (US Exclusive) |
| `address_correction` | Phí sửa địa chỉ | PP Address Correction |
| `vat` | VAT (kèm `percent`) | VAT (8%) |
| `processing` | Phí xử lý đơn hàng | PP Xử lý hàng hóa |
| `duty` | Thuế / hải quan — thu hộ, nguyên giá, không markup, không VAT | Duty/Tax (Nước tới) |
| `weight_adjust` | Điều chỉnh khớp cân đã ghi | *(không có cột)* |
| `other_surcharge` | Phụ phí khác chưa phân loại | *(không có cột)* |

**Khoản bằng 0 KHÔNG được gửi.** Payload là dữ liệu, không phải bảng cố định cột — MMP muốn
bày đủ cột thì khoản vắng mặt coi như 0.

**Khoản có thể ÂM:** `weight_adjust`. Đừng lọc số âm, lọc là tổng không khớp.

## Ba lưu ý để MMP không đối soát nhầm với file tay của Đức

**1. `signature` và `residential` KHÔNG chồng nhau — mang cả hai không thu hai lần.**

Câu trong bản trước (*"`signature` gộp cả phí giao nhà dân"*) mô tả **hoá đơn**, không phải
payload, và dễ hiểu nhầm. Nói lại cho đúng:

- Hoá đơn FedEx ghi **chung** hai khoản vào một dòng ký nhận.
- SMS lấy phần nhà dân từ **nguồn khác** rồi **TRỪ khỏi** `signature`.
- Bất biến: `signature + residential` = **đúng** dòng gộp trên hoá đơn. Luôn đúng, dù tách
  được hay không. Tách được thì `92.700 + 84.400`; không tách được thì `177.100 + 0`
  (khoản 0 bị bỏ khỏi payload). **Tổng không đổi ở cả hai đường.**

Đo trên toàn bộ 141 đơn đã đối soát (30/09/2026): `residential > 0` ở **0 đơn**, mang **cả
hai** ở **0 đơn**, và `signature + residential` lệch dòng gộp ở **0 đơn**. Nên thực tế hôm nay
`signature` đang mang khoản gộp và `residential` vắng mặt — nhưng nếu nguồn tách được bật lên
thì `signature` tự nhỏ lại đúng bằng phần nhà dân. **Có test canh bất biến này.**

MMP đúng khi nói bộ kiểm tổng không bắt được ca này: Σ vẫn khớp kể cả khi một khoản sai.
Phép kiểm thẳng cho ca này là **`residential` chỉ được xuất hiện kèm `signature` đã nhỏ đi
tương ứng** — mà điều đó thì phía nhận không tự kiểm được, nên nó được canh ở phía SMS.

**2. Duty về sau cước 3–6 tuần.** Một đơn có thể được gửi ở bảng kê `freight` trước, rồi duty
về sau và vào bảng kê `duty`. Khi duty về, giá cước của đơn **có thể được tính lại**. Đo
30/09: 75 đơn có bảng khoản phí dựng từ **hai hoá đơn** (cước + duty) — đây là hành vi bình
thường, không phải lỗi.

**3. `label` là chữ hiển thị.** Nó đã đổi vài lần trong dự án. Khoá theo `code`.

**4. Công thức MMP tái kiểm được (MMP xác nhận 30/09):**
`fuel = (base + signature) × fuel%` — phí xử lý hàng nhập KHÔNG chịu phụ phí nhiên liệu
(pass-through). `vat = (mọi khoản trước VAT) × vat%`. Duty KHÔNG chịu markup, KHÔNG chịu VAT.

## Ví dụ thật — bảng kê `type: "freight"` (đơn `26-INSLG-SV-0012`, brand kalisa)

Đơn này không có duty nên nó chỉ xuất hiện ở kê cước. Đơn CÓ duty sẽ có thêm một dòng ở bảng
kê `duty` riêng, với `fees` đúng một khoản `duty`.

```json
{
  "code": "26-INSLG-SV-0012",
  "mmpRef": "26-INSLG-SV-0012",
  "brandReference": "#KLS1983",
  "trackingNumber": "873911051364",
  "shippedAt": "2026-07-03",
  "amountVnd": 1882846,
  "fees": [
    { "code": "base",            "label": "Cước cơ bản",                     "amountVnd": 996240 },
    { "code": "signature",       "label": "Ký nhận (direct signature)",      "amountVnd": 177100 },
    { "code": "import_handling", "label": "Phí xử lý hàng nhập khẩu",        "amountVnd": 68300 },
    { "code": "fuel",            "label": "Phụ phí xăng dầu",                "amountVnd": 451736, "percent": 38.5 },
    { "code": "processing",      "label": "Phí xử lý đơn hàng",              "amountVnd": 50000 },
    { "code": "vat",             "label": "VAT",                             "amountVnd": 139470, "percent": 8 }
  ],
  "carrier": "fedex",
  "country": "US",
  "weightKg": 1.7,
  "chargeableWeightKg": 2,
  "dimensions": "30x24x11"
}
```

Cộng lại: `996.240 + 177.100 + 68.300 + 451.736 + 50.000 + 139.470 = 1.882.846` ✓
Đúng bằng dòng `#KLS1983` trong file đối soát của Đức.

## Tương thích ngược

Mọi trường cũ (`code`, `mmpRef`, `brandReference`, `trackingNumber`, `shippedAt`, `amountVnd`,
`fedexInvoiceNumber`, `invoiceDate`) **giữ nguyên**. Các trường mới chỉ được THÊM, nên hệ thống
MMP hiện tại không cần đổi gì để tiếp tục chạy. Có test canh điều này.
