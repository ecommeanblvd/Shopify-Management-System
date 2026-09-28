# Module Trustpilot Review (đánh giá) — thiết kế

CEO duyệt 28/09/2026.

## Vì sao

Bảng cuối trong bốn bảng CX của `docs/phan-tich/2026-09-27-doi-chieu-file-cx.md`:
`Truspilot Review` (`tblOvLCB2Btkss6a`, 45 bản ghi, 04/2025 → 08/2026). Ba bảng
trước đã lên hệ thống (`CX - To Do`, `Dispute Management`, `Incident Management`).

## Đo dữ liệu thật trước khi thiết kế

### Đánh giá chia hai cực, không có ở giữa

| Số sao | Bản ghi |
|---:|---:|
| 5 | **22** |
| 4 | 1 |
| 2 | 1 |
| 1 | **21** |

Không có 3 sao nào. Bảng đang dùng cho hai việc trái ngược: lưu lời khen để dùng
lại, và chữa cháy 21 đánh giá 1 sao.

**Đây là lý do màn hình CỐ Ý không hiện số sao trung bình**: 22 ca 5 sao cộng 21 ca
1 sao ra ~3,0 — con số không mô tả gì thật.

### Các con số hình dáng

- **Nhịp rất thấp**: 45 bản ghi / 17 tháng ≈ **2,6 ca/tháng**. Bản ghi mới nhất
  tháng 8/2026 nên bảng **vẫn đang sống** (khác bảng sự cố, dừng từ tháng 7).
- Trang đánh giá: Trustpilot 22 · Judge.me 5 · **trống 18 (40%)**
- Trạng thái: Responded 23 · Archived 9 · trống 7 · Pending Customer Feedback 5 ·
  Request Info 4
- Kênh liên hệ: Email 30 · trống 13 · Instagram 2 · Facebook 1
- Nội dung: 45/45 có, trung vị 248 ký tự · Theo dõi/xử lý: 19/45 · Ảnh: 4/45
- Nối đơn: 39 mã đơn duy nhất, **28 khớp hệ thống** (phần còn lại là đơn 2025 đầu
  chưa sync)

### Ba chỗ dữ liệu Lark phải tách hoặc bỏ

**1. Cột `Reason` lẫn HAI thứ.** Có ca là chính lời khách viết
(*"Best wedding dress ever!!!"*), có ca là ghi chú phân tích của CX bằng tiếng Việt
(*"Khách mua sản phẩm của Happy Clothing nhưng không hài lòng về chất liệu, đã
return và refund"*).

Spec này **KHÔNG tự đoán tách** 45 dòng cũ — đoán theo ngôn ngữ là một suy luận
sai được ở nhiều ca. Nhập tất cả vào `noi_dung`, và mỗi bản ghi nhập từ Lark có một
ghi chú nói rõ nội dung có thể là ghi chú CX. Bản ghi mới có hai ô riêng.

**2. Cột `Country` bị hỏng.** 22/45 dòng trả về **toàn bộ danh sách 75 quốc gia**
thay vì một nước (`Qatar,Italy,Saudi Arabia,United States,...`) — lookup cấu hình
sai trên Lark. 23 dòng còn lại có nước thật (United States 6 · Australia 4 ·
Saudi Arabia 2 · Israel 2 · Cyprus 2 …).

Quy tắc lọc dứt khoát: **giá trị chứa dấu phẩy là rác**. Không tên quốc gia thật
nào chứa dấu phẩy, kể cả `Lao People's Democratic Republic` hay
`Trinidad and Tobago`.

**3. Mã đơn nằm ở hai cột.** Lookup `Order Number` 22 · `Order number (Data cũ)`
18 · cả hai 1 · không có 4. Gộp: lấy lookup trước, thiếu thì lấy "Data cũ". Email
và tên sản phẩm cũng bị chia đôi y như vậy.

## Quyết định của CEO

1. **Module riêng, cực gọn** — một bảng, một tab. Không bảng ghi chú (2,6 ca/tháng
   không đáng), không tải ảnh (4/45 ca).
2. **Không kéo tự động từ API Judge.me/Trustpilot vòng này.** Hai dịch vụ đều có
   API nhưng cần khoá riêng hệ thống chưa có; với 2,6 ca/tháng thì nhập tay không
   tốn gì, và dựng tích hợp trước là làm trước khi biết có cần.

## Phạm vi

**Làm:** ghi đánh giá · số sao · trang đăng · nội dung · trạng thái · kênh liên hệ ·
nối đơn · **gộp đánh giá 1 sao theo brand** · nhập 45 ca cũ.

**Không làm vòng này:** kéo tự động từ API · tải 4 ảnh cũ từ Lark · trả lời đánh
giá trực tiếp từ hệ thống.

## Dữ liệu (migration 0181) — MỘT bảng

### `danh_gia`

| Cột | Kiểu | Ghi chú |
|---|---|---|
| `id` | uuid pk | |
| `ma_danh_gia` | text unique not null | `DG-0001`; ca nhập từ Lark là `LARK-<record_id 8 ký tự cuối>` |
| `ngay` | date not null | |
| `so_sao` | integer not null | 1–5, kiểm ở tầng hàm thuần |
| `trang` | text | `trustpilot` / `judge_me` / `khac` — 40% dòng Lark để trống nên nullable |
| `noi_dung` | text | lời khách viết |
| `ghi_chu_cx` | text | phân tích của CX — **tách hẳn** khỏi `noi_dung` |
| `trang_thai` | text | 9 trạng thái của Trustpilot |
| `kenh_lien_he` | text | `email` / `facebook` / `instagram` / `whatsapp` |
| `quoc_gia` | text | đã lọc rác |
| `khach_email` `khach_ten` | text | |
| `store_id` | uuid → `stores` | |
| `order_id` | uuid → `shopify_orders` on delete set null | |
| `ma_don` | text | giữ chuỗi kể cả khi chưa nối được |
| `vendor` | text | xem mục dưới |
| `theo_doi` | text | `Follow-up & Resolution` |
| `lark_record_id` | text unique | chặn nhập trùng |
| `tao_boi` | text → `user` | |
| `created_at` `updated_at` | timestamp | |

Không enum Postgres: thêm một trạng thái hay trang đánh giá mới không được phép
cần migration. Kiểm ở `features/danh-gia/phan-loai.ts`, có unit test.

## Vendor — để trả lời "brand nào làm hỏng danh tiếng"

Đây là việc Lark không làm được và là giá trị phân tích chính của module.

Vendor **lưu thành cột, KHÔNG suy lúc hiển thị**: một đơn có thể nhiều brand, và
đếm một đánh giá cho hai brand là đúng lỗi cộng trùng đã sửa ở module sự cố
(46.791 vs 42.601).

Cách điền:

- Đơn nối được **và chỉ có MỘT vendor** → tự điền
- Đơn nhiều vendor, hoặc không nối được đơn → **để trống**, hiện thành nhóm
  `(chưa rõ brand)` như `(chưa ghi)` của module sự cố

## Phân loại

`features/danh-gia/phan-loai.ts`:

- **Số sao**: số nguyên 1–5, `soSaoHopLe`.
- **Trang**: `trustpilot` · `judge_me` · `khac`.
- **Trạng thái** — giữ cả 9 giá trị Lark khai: `responded` · `archived` ·
  `pending_customer_feedback` · `request_info` · `approved` · `hidden` · `edited` ·
  `flagged` · `deleted`.

  Khác module ticket (ở đó bỏ các lựa chọn không dùng): 675 dòng là bằng chứng đủ
  để kết luận một lựa chọn vô dụng, 45 dòng thì không — và 9 giá trị này là
  **trạng thái do chính Trustpilot định nghĩa**, không phải CX tự nghĩ ra.
- **Kênh liên hệ**: `email` · `facebook` · `instagram` · `whatsapp`.
- **`locQuocGia(v)`**: trả `null` khi giá trị chứa dấu phẩy (chuỗi 75 nước của
  Lark), ngược lại trả tên đã trim.

## Tổng hợp

`features/danh-gia/tong-hop.ts` — hàm THUẦN:

- `gomTheoSao` — phân bố 1…5 sao
- `gomTheoBrand` — số đánh giá và số ca 1 sao theo vendor; nhóm `(chưa rõ brand)`
  giữ lại, không bỏ
- `canChua(ds)` — đánh giá 1–2 sao **chưa** ở trạng thái `responded`/`archived`

**KHÔNG có hàm tính sao trung bình.** Phân bố hai cực làm trung bình thành con số
gây hiểu sai, nên module không cung cấp nó ở bất kỳ đâu.

## Màn hình — tab "Đánh giá" trong `/f/cx`

- **Cần chữa**: đánh giá 1–2 sao chưa Responded/Archived, xếp mới nhất trước
- **Phân bố theo số sao**
- **1 sao theo brand** — brand nào nhiều đánh giá tệ nhất
- Danh sách lọc theo sao / trang / trạng thái / brand; bấm một dòng mở modal có
  nội dung, ghi chú CX, ô theo dõi và đổi trạng thái
- Form ghi đánh giá mới, có **hai ô riêng** cho nội dung khách và ghi chú CX

## Quyền

Scope riêng `cx.review` (`view_cx_review`, `manage_cx_review`). Tách vì đánh giá là
**danh tiếng, không phải tiền**: mở được cho marketing xem đánh giá mà không phải
mở dữ liệu thiệt hại (`cx.incident`) và tranh chấp (`cx.dispute`).

## Nhập 45 ca cũ

`scripts/nhap-danh-gia-lark.ts` — **CHỈ ĐỌC** Lark.

- Gộp mã đơn / email / tên sản phẩm từ cặp cột lookup + "Data cũ"
- Bỏ `Country` rác theo quy tắc dấu phẩy
- Tự điền `vendor` khi đơn nối được và chỉ có một brand
- Mỗi bản ghi nhập vào có `ghi_chu_cx` nói rõ: nội dung mang từ cột `Reason` của
  Lark và **có thể là ghi chú CX chứ không phải lời khách** — CX chuyển tay khi rà
- `lark_record_id` UNIQUE nên chạy lại vô hại

## Kiểm thử

- `phan-loai.ts` thuần: `soSaoHopLe`, `mapTrang`, `mapTrangThai`, `mapKenh`, và
  **`locQuocGia` có test cho đúng chuỗi 75 nước thật của Lark** cùng ca
  `Trinidad and Tobago` / `Lao People's Democratic Republic` để chứng minh không
  cắt oan tên nước thật.
- `tong-hop.ts` thuần: `gomTheoSao`, `gomTheoBrand` (có test một đánh giá không
  đếm cho hai brand), `canChua`.

## Việc còn lại sau spec này

- Bốn bảng CX đã lên hệ thống xong; bước tiếp là gom thành một workspace CX hoàn
  chỉnh nếu CEO muốn
- Kéo tự động từ Judge.me / Trustpilot khi có khoá API
- Làm rõ bảng `tblTBahjux1YrQHR` bị chặn quyền với đội Lark
- Cấp scope payment cho cici-mean
