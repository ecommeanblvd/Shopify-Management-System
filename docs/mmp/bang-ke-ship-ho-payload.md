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
| **`amountVnd`** | số | **Số tiền brand phải trả cho đơn này** — đã gồm duty |
| `fees[]` | mảng | Khoản phí chi tiết — xem dưới |
| `carrier` | chuỗi \| null | `fedex`, `dhl`… |
| `country` | chuỗi \| null | Mã nước nhận |
| `weightKg` | số \| null | Cân khai |
| `chargeableWeightKg` | số \| null | Cân hãng tính cước (có thể khác cân khai do quy đổi kích thước) |
| `dimensions` | chuỗi \| null | `DxRxC` cm |
| `fedexInvoiceNumber`, `invoiceDate` | | **chỉ có ở bảng kê `type: "duty"`** |

**Bất biến quan trọng:** `sum(fees[].amountVnd) === amountVnd`. Đã kiểm trên toàn bộ 137 đơn
thật của 4 brand: khớp 137/137.

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

**1. `signature` gộp cả phí giao nhà dân.** Hoá đơn FedEx ghi chung hai khoản vào mục ký nhận
— đo 141 đơn, **không đơn nào** có hai khoản tách riêng trên hoá đơn. File của Đức tách chúng
bằng kiến thức riêng (phí nhà dân chuẩn 84.400đ), không phải bằng số trên hoá đơn. SMS trung
thành với hoá đơn nên gửi một khoản gộp. Ví dụ: Đức ghi `92.700 + 84.400`, SMS gửi `177.100`.

**2. Duty về sau cước 3–6 tuần.** Một đơn có thể được gửi ở bảng kê `freight` trước, rồi duty
về sau và vào bảng kê `duty`. Khi duty về, giá cước của đơn **có thể được tính lại**. Đo
30/09: 75 đơn có bảng khoản phí dựng từ **hai hoá đơn** (cước + duty) — đây là hành vi bình
thường, không phải lỗi.

**3. `label` là chữ hiển thị.** Nó đã đổi vài lần trong dự án. Khoá theo `code`.

## Ví dụ thật (đơn `26-INSLG-SV-0012`, brand kalisa)

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
