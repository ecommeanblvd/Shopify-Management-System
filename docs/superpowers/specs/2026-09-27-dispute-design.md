# Module Dispute Management (chargeback) — thiết kế

CEO duyệt 27/09/2026.

## Vì sao

CX đang theo dõi chargeback trên bảng Lark `Dispute Management`
(`tblbHZu614yrzr12`, 197 bản ghi, 01/2023 → 09/2026). Đây là bảng thứ ba trong
bốn bảng mà `docs/phan-tich/2026-09-27-doi-chieu-file-cx.md` gọi là "module
ticket/sự cố" — sau `CX - To Do` (đã làm) và trước Incident Management,
Trustpilot Review.

## Đo dữ liệu thật trước khi thiết kế

### Bảng Lark (197 bản ghi)

- **Thua 126 (64%) · Thắng 53 (27%)** · còn mở 15 · closed 3
- Cổng thanh toán: Shopify Payment 87 · Stripe 60 · PayPal 49 · trống 1
- Lý do: Item not received 39 · Product unacceptable 37 · Credit not processed 33
  · Product not received 26 · **trống 48** · còn lại 14
- Phí dispute: 53/197 ca có phí
- Open → Closed: chỉ 24 ca có cả hai mốc — trung vị **23 ngày**, dài nhất 87
- Nối được với đơn trong hệ thống: **53/189** (phần còn lại là đơn 2023 chưa sync)

### Shopify trả được dispute qua API — phát hiện quyết định hình dáng module

Store **meanblvd đã có sẵn** scope `read_shopify_payments_disputes` (và cả
`write_shopify_payments_disputes`). Gọi `shopifyPaymentsAccount.disputes` trả về
đủ hơn bảng Lark: mã dispute, đơn hàng, loại, trạng thái, lý do + mã lý do của
tổ chức thẻ, số tiền + đơn vị tiền, ngày mở, **hạn nộp bằng chứng**, ngày đã
nộp, ngày chốt.

| Store | Dispute | Trạng thái |
|---|---:|---|
| meanblvd | 98 | Lost 76 · Won 14 · Under review 7 · Needs response 1 |
| tinhatelier | 13 | Lost 10 · Won 3 |
| mirermirer-official | 0 | — |
| cici-mean | không đọc được | `shopifyPaymentsAccount` = null, store chưa cấp scope payment |

**tinhatelier có 13 dispute mà bảng Lark không có dòng nào** — CX không theo dõi
store này.

### Hai chỗ số của Lark không dùng được

**1. Lark cộng tiền lẫn nhiều đơn vị tiền tệ.** Cột `Total Amount Lost` cho
"108.565,54" nhưng đó là cộng USD + EUR + GBP + HKD + CAD + KRW vào một số.

Chính người viết spec này đã mắc đúng lỗi đó trong lúc đo: báo tinhatelier
"284.232" vì cộng cả ₩279.000 vào. Số thật: **USD 4.669 (10 ca) + EUR 307 +
CHF 256 + KRW 279.000 (1 ca)**. Vì vậy thiết kế dưới đây **không có cột tổng
tiền**, và có một hàm thuần riêng để gom theo đơn vị tiền, kèm test.

**2. Lark đã lệch thực tế.** Bảng Lark có **14 ca còn mở đã quá hạn phản hồi**.
Shopify nói **0 ca quá hạn** — chúng đã chốt xong. Bản chép tay trôi dần khỏi sự
thật, và đó là lý do phải sync thay vì nhập tay.

## Quyết định của CEO

1. **Sync Shopify Payments + nhập tay PayPal/Stripe** — một màn cho cả ba cổng.
   PayPal và Stripe không có đường nào khác vì dispute nằm trong dashboard riêng
   của họ.
2. **Nhập từ Lark chỉ 110 ca PayPal/Stripe**, không nhập 87 ca Shopify Payment
   (đã có từ nguồn đúng; nhập thêm bản chép tay chỉ sinh hai dòng cho một ca).
3. **Không nộp bằng chứng lên Shopify vòng này.** Nộp bằng chứng là việc không
   lùi được: nộp thiếu hoặc nộp sai là mất quyền tranh chấp, không sửa lại được.
   Hệ thống chỉ hiện ca cần phản hồi kèm hạn nộp; CX vẫn nộp trong Shopify admin.

## Phạm vi

**Làm:** sync dispute Shopify Payments · nhập tay PayPal/Stripe · khối "cần phản
hồi" xếp theo hạn nộp · gắn đơn hàng · ghi chú diễn biến · nhập 110 ca
PayPal/Stripe từ Lark.

**Không làm vòng này:** nộp bằng chứng lên Shopify · tích hợp API PayPal/Stripe ·
gom bằng chứng tự động từ ảnh QC / tracking / biên bản giao · báo cáo thắng-thua
theo brand.

## Dữ liệu (migration 0179)

### `dispute`

Cột chia làm hai loại, và ranh giới này là điểm cốt tử: một lượt sync không được
xoá việc CX đã làm.

| Shopify sở hữu — sync GHI ĐÈ mỗi lượt | CX sở hữu — sync KHÔNG BAO GIỜ chạm |
|---|---|
| `trang_thai`, `loai`, `ly_do`, `ly_do_mang`, `so_tien`, `tien_te`, `mo_luc`, `han_nop`, `da_nop_luc`, `chot_luc` | `ma_ho_so`, `phi_dispute`, ghi chú, `order_id` gắn tay |

| Cột | Kiểu | Ghi chú |
|---|---|---|
| `id` | uuid pk | |
| `store_id` | uuid not null → `stores` | |
| `nguon` | text not null | `shopify` (sync) / `tay` (CX nhập) |
| `shopify_dispute_id` | text unique | null với ca nhập tay; khoá upsert của sync |
| `ma_ho_so` | text | `Case ID` của CX — CX sở hữu |
| `cong_thanh_toan` | text not null | `shopify_payments` / `paypal` / `stripe` |
| `loai` | text not null default `'chargeback'` | `chargeback` / `inquiry` |
| `trang_thai` | text not null | xem bảng chuẩn hoá |
| `ly_do` | text | mã chuẩn hoá |
| `ly_do_mang` | text | `networkReasonCode` của tổ chức thẻ (vd `F29`, `13.1`) |
| `so_tien` | numeric(14,2) not null | |
| `tien_te` | text not null | **luôn đi kèm `so_tien`; KHÔNG có cột tổng** |
| `phi_dispute` | numeric(14,2) | CX nhập; Shopify không trả |
| `mo_luc` `han_nop` `da_nop_luc` `chot_luc` | timestamp | |
| `order_id` | uuid → `shopify_orders` on delete set null | nullable — chỉ 53/189 ca nối được |
| `ma_don` | text | **luôn giữ chuỗi mã đơn** kể cả khi không nối được |
| `khach_email` | text | |
| `lark_record_id` | text unique | chặn nhập trùng khi chạy lại |
| `tao_boi` | text → `user` | null với bản sync |
| `created_at` `updated_at` `dong_bo_luc` | timestamp | |

Không dùng enum Postgres cho `trang_thai` / `ly_do` / `cong_thanh_toan`: Shopify
thêm giá trị mới không được phép cần migration. Kiểm ở tầng hàm thuần, có test.

### `dispute_ghi_chu`

Append-only: `dispute_id` · `noi_dung` · `tao_boi` · `tu_lark` boolean · `created_at`.
Lark dồn mọi diễn biến vào một ô `Following up` (80% dòng có nội dung).

## Chuẩn hoá — lấy từ vựng Shopify làm chuẩn

Shopify là nguồn đúng, nên dùng bộ giá trị của Shopify rồi dịch dữ liệu Lark vào.

**Trạng thái**

| Shopify | Lark | Bên mình |
|---|---|---|
| `NEEDS_RESPONSE` | `Open` | `needs_response` |
| `UNDER_REVIEW` | `Under Review` | `under_review` |
| `WON` | `Won` | `won` |
| `LOST` | `Lost` | `lost` |
| `ACCEPTED` | — | `accepted` |
| `CHARGE_REFUNDED` | — | `charge_refunded` |
| — | `Closed` | `closed` (chỉ cho 3 dòng cũ của Lark) |

**Lý do** — số trong ngoặc là ca đo trên bảng Lark

| Lark ghi | Chuẩn hoá thành |
|---|---|
| Item not received · Product not received | `product_not_received` (65) |
| Product unacceptable · Item not as described | `product_unacceptable` (42) |
| Credit not processed · Missing refund or credit | `credit_not_processed` (34) |
| Fradulent *(lỗi gõ của Lark)* · Unauthorized transaction · Did not authorize | `fraudulent` (7) |
| Duplicate payment | `duplicate` (1) |

Lý do Shopify trả về (`FRAUDULENT`, `PRODUCT_NOT_RECEIVED`, `PRODUCT_UNACCEPTABLE`,
`CREDIT_NOT_PROCESSED`, `DUPLICATE`, `SUBSCRIPTION_CANCELLED`, `UNRECOGNIZED`,
`GENERAL`, `INCORRECT_ACCOUNT_DETAILS`, `INSUFFICIENT_FUNDS`, `BANK_CANNOT_PROCESS`,
`DEBIT_NOT_AUTHORIZED`, `CUSTOMER_INITIATED`) chỉ cần hạ chữ thường. Giá trị lạ
giữ nguyên chứ không ép về `khac` — Shopify thêm lý do mới là chuyện thường, và
ép về `khac` là mất thông tin vĩnh viễn.

**Cổng thanh toán** — Lark ghi `Stripes` và `Stripes mới` là cùng một cổng Stripe.

## Sync

`features/dispute/sync.ts`, mỗi store một lượt, phân trang
`shopifyPaymentsAccount.disputes`, upsert theo `shopify_dispute_id`.

Hai chi tiết phát hiện khi gọi thử, cả hai đều làm sync chết nếu xử lý ngây thơ:

1. **Truy vấn `order { name }` trả lỗi MỘT PHẦN.** Dispute năm 2020 có đơn đã bị
   xoá: Shopify trả `"Order not found"` trong `errors` **nhưng vẫn trả đủ `data`**.
   Coi `errors` là thất bại thì sync chết vì một ca cũ. Phải chấp nhận lỗi một
   phần khi `data` có mặt.
2. **`shopifyPaymentsAccount` trả `null`** với store không dùng Shopify Payments
   (cici-mean). Bỏ qua kèm log rõ ràng, KHÔNG coi là lỗi, và **không kết luận
   store đó không có dispute** — nó cũng chưa cấp scope payment.

Sync chỉ ghi các cột Shopify sở hữu. `ma_ho_so`, `phi_dispute`, `order_id` gắn
tay và ghi chú không bao giờ bị chạm.

**Lịch:** tác vụ `sync-dispute` vào nhóm `moi-6-gio`. Hạn nộp bằng chứng cách
16–40 ngày nên 6 giờ quá đủ. Đây là ĐỌC từ Shopify — không liên quan lệnh hoãn
ghi Lark của CEO.

## Màn hình — thêm tab "Tranh chấp" vào `/f/cx`

- **Khối trên: Cần phản hồi** — ca `needs_response` / `under_review` xếp theo hạn
  gần nhất, hiện "còn N ngày", quá hạn thì đỏ. Đây là giá trị chính của module:
  thua 64%, mà 14 ca Lark tưởng còn mở thực ra đã chốt.
- **Bảng dưới**: tất cả, lọc theo store / cổng / trạng thái / nguồn.
- **Tổng tiền tách theo từng đơn vị tiền** — "USD 29.591 · HKD 2.353 · EUR 1.533",
  không có một số gộp.
- Modal chi tiết: dữ liệu Shopify (chỉ đọc), đơn liên quan, ghi chú append-only,
  và ô sửa phần CX sở hữu.
- Form nhập tay cho PayPal/Stripe, và nút "Sync ngay".

## Quyền

Scope RIÊNG `cx.dispute` với actions `view` / `create` / `edit`; hai quyền cũ
`view_cx_dispute`, `manage_cx_dispute`. Không dùng chung với `cx.ticket` — đây là
tiền, và thường là việc của tài chính chứ không phải CX.

## Nhập 110 ca PayPal/Stripe từ Lark

`scripts/nhap-dispute-lark.ts` — **CHỈ ĐỌC** Lark.

- Lọc `Payment Gateway` thuộc PayPal / Stripe / Stripes mới.
- `Following up` thành một ghi chú với `tu_lark = true`.
- Nối đơn qua `Order No.`; không khớp thì vẫn giữ chuỗi `ma_don`.
- `lark_record_id` unique nên chạy lại vô hại.
- **87 ca Shopify Payment: KHÔNG tạo dòng mới.** Nếu `Following up` có nội dung
  và khớp mã đơn với một dispute đã sync thì đính nội dung đó làm ghi chú
  `tu_lark = true`.

## Kiểm thử

- `features/dispute/chuan-hoa.ts` thuần: `mapTrangThai`, `mapLyDo`,
  `mapCongThanhToan`, `conBaoNhieuNgay(hanNop, moc)`, `capBaoDong(...)`. Unit test.
- `features/dispute/tong-tien.ts` thuần: `gomTheoTienTe(rows)`. Hàm này tồn tại
  CHÍNH VÌ lỗi cộng gộp tiền tệ của Lark (và của người viết spec) — test phải có
  ca nhiều đơn vị tiền để không ai lặp lại.
- Action test bằng transaction rollback, như các module trước.

## Việc còn lại sau spec này

- Spec riêng: Incident Management (156 bản ghi, thiệt hại tiền) · Trustpilot Review (45)
- Nộp bằng chứng lên Shopify — bàn riêng khi luồng đọc đã chạy ổn
- Cấp scope payment cho cici-mean để biết store đó có dispute hay không
- Tích hợp API PayPal / Stripe để bỏ hẳn việc nhập tay
