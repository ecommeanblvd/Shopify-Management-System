# Module đổi trả — thiết kế

**Ngày:** 27/09/2026 · **Duyệt:** CEO Lê Minh Tiệp

## Bối cảnh

CX quản lý đổi trả trên Lark, bảng `Return Management` (1.414 dòng, 01/2026 →
24/09/2026). Hệ thống **đã có sẵn** một module gần hoàn chỉnh nhưng CHƯA AI DÙNG
(bảng rỗng): `customer_order_requests` + `return_hubs` + màn quản trị
`/f/customer-account/requests`.

Việc cần làm không phải dựng mới, mà **lấp bốn khoảng trống** giữa module sẵn có
và cách CX thật sự làm việc.

## Đo đạc làm nền

| Việc | Số đo |
|---|---|
| Dòng / đơn | 1.414 dòng trên 1.096 đơn — **224 đơn nhiều dòng** → theo TỪNG MÓN |
| Quantity | 1.389/1.393 là **1** |
| Refund to | Store Credit (web) **1.059** · Original Payment (bank) **82** |
| Return Categories | Refund 1.061 · **Exchange 22 (2%)** |
| Return Status | REFUNDED 597 · APPROVED 151 · **CANCEL 142** · REJECTED 12 |
| Lý do hàng đầu | "Doesn't suit me (I ordered my usual size)" **451** |

## Bốn khoảng trống

**1. Mức chi tiết.** Module hiện là mức ĐƠN; CX theo TỪNG MÓN. Thêm
`orderLineId`, `sku`, `itemName`, `quantity`, `itemValue` vào chính bảng —
**một dòng = một món trả**, đúng hình CX đang sống. Không dựng bảng con: 1.414
dòng Lark chính là 1.414 món, bảng con chỉ thêm một tầng cho một quan hệ mà
thực tế luôn là 1-1.

**2. Nơi hoàn tiền.** Module có số tiền nhưng không có `refundTo`. 93% là
Store Credit trên web — thiếu trường này là mất thông tin quan trọng nhất của
khâu hoàn.

**3. Bộ lý do sai thực tế.** `CLAIM_REASONS` hiện là `damaged_package`,
`damaged_product`, `wrong_item`, `wrong_size`, `missing_item`, `other` — thiên
về hàng lỗi. Thực tế CX chủ yếu là **không vừa / đổi ý**, và là phân loại HAI
TẦNG (lý do chính + lý do phụ trong ngoặc). Giữ bộ cũ là CX chọn "other" cho
gần hết.

Bộ mới, dựng từ dữ liệu thật:

| Lý do chính | Lý do phụ |
|---|---|
| `khong_vua` Doesn't suit me | đúng size quen · đã dùng bảng size · đặt nhầm size · quà không vừa · (không nêu) |
| `doi_y` I change my mind | — |
| `khac_mo_ta` Different than described | khác màu · thiếu phụ kiện · (không nêu) |
| `hang_loi` Defective item | — |
| `khac` Other | (tự nhập) |

**4. Thiếu trạng thái CANCEL.** Chiếm 142/1.414 (10%) bên Lark. Thêm vào máy
trạng thái: huỷ được từ mọi trạng thái chưa hoàn tiền.

## Mô hình

Một **yêu cầu trả** = một món của một đơn. Giữ nguyên máy trạng thái sẵn có:

```
submitted → under_review → approved → return_in_transit → received → refund_pending → refunded
              ↘ rejected                              ↘ rejected (QC fail)
   (mọi trạng thái chưa refunded) → cancelled
```

Dùng lại không đổi: ảnh khách gửi (1–5), hub nhận hàng theo nước, tracking +
hãng, lỗi thuộc về ai, ai trả phí ship về, mốc thời gian từng bước, màn duyệt.

**Mã RMA đọc được**: `RT` + số đơn không dấu `#`, đúng quy ước CX (`RTTA1861`,
`RHC1293`). Trùng thì thêm hậu tố `-2`.

## Màn hình

**CX tạo yêu cầu thay khách** — CEO chốt 27/09: giữ nguyên thói quen CX, không
phụ thuộc khách có chịu dùng trang tài khoản hay không. Chọn đơn → chọn món →
lý do hai tầng → số lượng → nơi hoàn → ảnh (tuỳ chọn khi CX nhập hộ, vì ảnh do
khách gửi qua kênh khác).

**Hàng đợi duyệt** — dùng lại `/f/customer-account/requests`, bổ sung cột món,
nơi hoàn, và bộ lọc theo trạng thái mới.

**Kho nhận hàng trả** — khi yêu cầu ở `return_in_transit`, kho thấy nó trong
danh sách chờ; nhận + QC đạt/không đạt kèm lý do. QC đạt → `refund_pending`,
không đạt → `rejected`.

## Phạm vi vòng này

**Làm**: CX tạo yêu cầu · duyệt/từ chối/huỷ · tracking hàng về · kho nhận + QC
· đánh dấu đã hoàn tiền.

**Không làm**: gọi API Shopify hoàn tiền tự động (giữ cách đánh dấu tay như
module đang có) · luồng đổi hàng riêng (2% — CX xử tay rồi đánh dấu) · bật kênh
khách tự gửi (đã có sẵn, bật khi CEO muốn) · nhập 1.414 dòng lịch sử từ Lark.
