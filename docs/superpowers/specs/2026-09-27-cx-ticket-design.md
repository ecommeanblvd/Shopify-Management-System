# Module CX - To Do (ticket liên bộ phận) — thiết kế

CEO duyệt 27/09/2026.

## Vì sao

Team CX đang chạy việc hằng ngày trên bảng Lark `CX - To Do`. Bảng đối chiếu
27/09 (`docs/phan-tich/2026-09-27-doi-chieu-file-cx.md`) cho thấy 16 trường CX
dùng mà hệ thống chưa có, và gần hết thuộc về đúng module này. Sau khi module
đổi trả xong, đây là phần cuối còn thiếu để đưa CX lên hệ thống.

## Đo dữ liệu thật trước khi thiết kế

Đọc trực tiếp base CX trên Lark (`EaPswVhWEi8MnckszPAluuq8gZg`).

**"Module ticket/sự cố" thật ra là bốn thứ riêng biệt:**

| Bảng Lark | Bản ghi | Là gì |
|---|---:|---|
| `CX - To Do` (tblDADK0cZxRx1XP) | 675 | Ticket liên bộ phận — việc hằng ngày |
| `Incident Management (Cũ)` (tbl7gQuwsBxW20Fj) | 156 | Sự cố kèm thiệt hại tiền |
| `Dispute Management` (tblbHZu614yrzr12) | 197 | Chargeback cổng thanh toán |
| `Truspilot Review` (tblOvLCB2Btkss6a) | 45 | Đánh giá Trustpilot / Judge.me |
| `Tickets Report` · `Customer Issue Analysis Report` | 830 · 4.000+ | **Không phải bảng làm việc** — bản xuất từ Intercom |

Spec này CHỈ làm `CX - To Do`. Ba bảng còn lại là ba spec riêng: vòng đời,
người dùng và dữ liệu khác hẳn nhau.

**Nhịp việc:** 675 ticket — tháng 7: 349 · tháng 8: 187 · tháng 9: 139 (≈7/ngày).

**Lõi là chuyển việc qua bộ phận khác:**

- Bộ phận nêu: CX-CS 239 · DISCO-LOG 103 · PROCUREMENT 72 · MERCHANDISE 6
- Bộ phận nhận: PROCUREMENT 274 · CX-CS 229 · MERCHANDISE 197 · DISCO-WH 13 · DISCO-LOG 7
- **257/675 ticket gửi cho hơn một bộ phận**
- Mỗi bộ phận có cột cập nhật + trạng thái riêng trên Lark (`CS Update`/`CS Process`,
  `MER …`, `PRM …`, `WH …`, `LOG …`), ba giá trị: đang xử lý / đã xử lý / chưa đủ thông tin

**Một ticket gắn nhiều dòng đơn:** 0 dòng 321 · 1 dòng 292 · 2 dòng 40 · 3 dòng 13
· 4 dòng 7 · 7 dòng 2. Quan hệ phải là nhiều-nhiều.

**Phân loại của Lark sạch** — ba nhóm không chồng nhau (503 / 108 / 24), nhưng
kèm rác: hai cột `Text 13`/`Text 14` trùng nội dung, bốn cột `Parent items` bỏ
hoang, gõ sai `Managerment`/`Delevery`, và các lựa chọn khai mà chưa ai dùng lần
nào (Pre/Purchase/Post-Purchase, Return Issue, Refund Issue, Web & Account Issue).

## Ràng buộc đã biết

Hệ thống hiện chỉ có **4 tài khoản**: 2 Logistics, 1 Admin, 1 OC. Chưa có tài
khoản CX, MERCHANDISE, PROCUREMENT, WAREHOUSE. Nếu dựng luồng liên bộ phận mà các
bộ phận đó không đăng nhập được, CX sẽ ghi ticket vào chỗ không ai đọc.

**Quyết định (CEO):** dựng đủ mô hình nhiều bộ phận ngay từ đầu, nhưng CX được
quyền **ghi hộ** bộ phận chưa có tài khoản — đúng cách họ đang làm trên Lark khi
bộ phận khác trả lời qua chat. Khi tài khoản được mở, họ tự vào ghi, không phải
sửa gì.

## Phạm vi

**Làm:** tạo ticket · gắn nhiều dòng đơn · gán nhiều bộ phận · mỗi bộ phận có
trạng thái + ghi chú riêng · CX ghi hộ · đóng ticket · nhập 675 ticket cũ để đọc.

**Không làm vòng này:**

- Gửi email mẫu cho khách. Lark làm việc này qua checkbox (`CS - Send Email
  Invalid` 9%, `Sold out` 5%, `Customize` 2%). Gửi email cho khách thật là việc
  dễ gây hậu quả — tách ra bàn riêng sau khi luồng ticket chạy ổn. Vòng này chỉ
  GHI NHẬN đã gửi email gì, lúc nào.
- Incident / Dispute / Trustpilot — ba spec riêng.
- Nhập báo cáo Intercom (`Tickets Report`, `Customer Issue Analysis Report`).
- Luật SLA / cảnh báo quá hạn.
- Ghi ngược sang Lark.

## Kiến trúc: bảng phần việc riêng cho từng bộ phận

Ba cách đã cân:

| Cách | Được | Mất |
|---|---|---|
| **A. Bảng ticket + bảng phần việc theo bộ phận** ✅ | Biết bộ phận nào đang tắc; thêm bộ phận không cần migration; có lịch sử ai ghi lúc nào | Hai bảng, truy vấn nhiều hơn một chút |
| B. Cột cố định giống Lark 1:1 | Đối chiếu Lark dễ nhất; một truy vấn | 10 cột cho 5 bộ phận; thêm bộ phận = migration; ghi mới đè ghi cũ nên mất diễn biến; không biết ai ghi. **Chính kiểu này sinh ra `Text 13`, `Text 14`, `Parent items 1..4` bỏ hoang trên Lark** |
| C. Một luồng bình luận tự do | Linh hoạt nhất | Trạng thái từng bộ phận biến thành văn bản — mất đúng thứ Lark đang làm được |

Chọn **A**: đúng với thực tế 257/675 ticket đi qua nhiều bộ phận, và sửa ba
khuyết điểm của Lark mà không phức tạp hơn đáng kể.

### Bốn bảng (migration 0178)

**`cx_ticket`** — một dòng một ticket

| Cột | Kiểu | Ghi chú |
|---|---|---|
| `id` | uuid pk | |
| `ma_ticket` | text unique not null | `CXT-0001`, đọc được |
| `tieu_de` | text not null | |
| `nhom` | text not null | `don_hang` / `truoc_khi_gui` / `su_co_van_chuyen` |
| `loai` | text not null | mã loại con, phải thuộc `nhom` |
| `bo_phan_neu` | text not null | bộ phận nêu vấn đề |
| `trang_thai` | text not null default `'moi'` | `moi` / `dang_xu_ly` / `xong` |
| `han_xu_ly` | date | Lark dùng 4% — giữ, không bắt buộc |
| `ma_ticket_cs` | text | số ticket Intercom (`Ticket No. (for CS)`) |
| `store_id` | uuid → `stores` | suy từ dòng đơn đầu; để lọc |
| `khach_email` | text | suy từ đơn, hoặc CX nhập khi ticket không gắn đơn |
| `nguon` | text not null default `'he_thong'` | `he_thong` / `lark` |
| `lark_record_id` | text unique | chặn nhập trùng khi chạy lại script |
| `tao_boi` | text not null → `user` | |
| `created_at` `updated_at` `dong_luc` | timestamp | |

`trang_thai` là **not null có default** — trên Lark 259/675 dòng (38%) để trống
cột `Status TODO`, tức không ai biết ticket đó còn sống hay đã xong.

**`cx_ticket_dong`** — nhiều-nhiều sang dòng đơn

`ticket_id` · `order_line_id` · unique(`ticket_id`, `order_line_id`).

**`cx_ticket_phan_viec`** — một dòng cho mỗi bộ phận được gán

`ticket_id` · `bo_phan` · `trang_thai` not null default `'dang_xu_ly'`
(`dang_xu_ly` / `da_xu_ly` / `chua_du_thong_tin` — đúng ba giá trị Lark) ·
`nguoi_phu_trach` (nullable) · `xong_luc` · unique(`ticket_id`, `bo_phan`).

**`cx_ticket_ghi_chu`** — append-only

`ticket_id` · `bo_phan` · `noi_dung` not null · `tao_boi` not null ·
`ghi_ho` boolean not null default false · `created_at`.

`ghi_ho` là thứ Lark không có: đo được bao nhiêu phần trăm cập nhật là CX gõ hộ,
tức bộ phận nào cần mở tài khoản trước.

Không dùng enum Postgres cho các cột trạng thái/phân loại — thêm một loại vấn đề
mới không được phép cần migration. Kiểm giá trị ở tầng hàm thuần, có unit test.

## Phân loại — dọn lại từ số đếm thật

`features/cx-ticket/phan-loai.ts`, cùng hình với `features/doi-tra/ly-do.ts`.
Ba nhóm, 18 loại. Số trong ngoặc là ca đo được trên 675 ticket.

**`don_hang` — Vấn đề quản lý đơn (503)**

| Mã | Tên | Ca | Gộp từ |
|---|---|---:|---|
| `thoi_gian_xu_ly` | Thời gian xử lý | 179 | Processing Time 154 + Production Time 25 |
| `het_hang` | Hết hàng | 92 | SOLD OUT |
| `so_do` | Thông tin số đo / may đo | 71 | Customize Info |
| `khach_huy` | Khách huỷ | 28 | Cancel by Customer |
| `sua_thiet_ke` | Sửa thiết kế | 20 | Design Modification |
| `doi_size` | Đổi size | 20 | Change Size 18 + Size Issue 2 |
| `san_xuat_tre` | Sản xuất trễ | 18 | Production Delayed |
| `cap_nhat_don` | Cập nhật đơn | 18 | Order Update 16 + Order Status 2 |
| `nghi_mua_nham` | Nghi mua nhầm | 14 | Suspected Mispurchase |
| `khach_giu_don` | Giữ đơn | 14 | Hold by Customer 13 + Hold by CX 1 |
| `qc_khong_dat` | QC không đạt | 10 | QC Failed |
| `khac` | Khác | 13 | Inventory 4 · Additional Item 2 · Product 2 · Change Item 2 · Split Shipment 1 · Delivery Time 1 · Service Quality 1 |

**`truoc_khi_gui` — Vấn đề trước khi gửi (108)**

| Mã | Tên | Ca |
|---|---|---:|
| `dia_chi_khong_hop_le` | Địa chỉ không hợp lệ | 107 |
| `doi_dia_chi` | Đổi địa chỉ | 5 |

**`su_co_van_chuyen` — Sự cố vận chuyển (24)**

| Mã | Tên | Ca |
|---|---|---:|
| `giao_that_bai` | Giao không thành công | 10 |
| `thieu_thong_tin` | Hãng vận chuyển cần thêm thông tin | 9 |
| `cho_nhan_buu_cuc` | Chờ khách nhận tại bưu cục | 3 |
| `thong_quan` | Vướng thông quan | 2 |

Bỏ hai cột rác `Text 13`/`Text 14` và các lựa chọn Lark khai mà **chưa ai dùng
lần nào**. Khi CX cần loại mới, thêm vào một chỗ duy nhất trong file này.

**Sáu bộ phận** theo đúng danh sách Lark: `CX-CS` · `MERCHANDISE` ·
`PROCUREMENT` · `DISCO-WH` · `DISCO-LOG` · `CHINA`.

## Luồng

1. CX chọn nhóm + loại, gõ tiêu đề, **tìm dòng đơn để gắn** (dùng lại ô tìm của
   màn đổi trả), chọn bộ phận nhận — nhiều được, ghi chú mở đầu.
2. Mỗi bộ phận thấy ticket ở "Việc của bộ phận tôi", ghi chú và đổi trạng thái
   **phần mình**.
3. Bộ phận chưa có tài khoản: CX ghi hộ, hệ thống đánh dấu `ghi_ho = true`.
4. Đóng ticket: nếu còn bộ phận `dang_xu_ly` → **hiện cảnh báo, KHÔNG chặn
   cứng**, theo đúng nguyên tắc CEO đặt ở màn nhận hàng ("không muốn chặn cứng
   mà chỉ hiện lên thông báo noti để người dùng biết").
5. Ticket `nguon = 'lark'`: chỉ đọc — không sửa, không ghi chú, không đóng. Tránh
   lẫn hồ sơ lịch sử với ticket đang chạy.

## Màn hình

Module mới **`/f/cx`**, hai tab:

- **Việc cần làm** — danh sách lọc theo trạng thái / nhóm / bộ phận / "của tôi";
  nút tạo ticket; bấm một dòng mở modal chi tiết có phần việc từng bộ phận và
  dòng ghi chú.
- **Đổi trả** — trỏ sang `/f/customer-account/requests` đã có, không dựng lại.

Đây cũng là chỗ để sau này gom thành workspace CX.

## Quyền

Hai quyền mới trong `lib/auth/rbac.ts`: `view_cx_ticket`, `manage_cx_ticket`.
Scope mới trong `lib/auth/permissions.ts`: `cx.ticket` với actions
`view` / `create` / `edit`. Map trong `lib/auth/permission-map.ts`.

Thêm cột `bo_phan` (text, nullable) vào `app_roles` — mỗi vai trò thuộc một bộ
phận. Người có `manage_cx_ticket` ghi được cho **mọi** bộ phận (CX ghi hộ);
người của một bộ phận chỉ ghi được phần bộ phận mình.

## Nhập 675 ticket cũ

Script `scripts/nhap-cx-ticket-lark.ts` — **CHỈ ĐỌC** Lark, không ghi gì lên.

- Nối dòng đơn qua `Order Number` + `Lineitem SKU` — đúng khoá đã dùng khi điền
  Min/Max Production, nên đã biết là chạy được.
- Năm cột `CS/MER/PRM/WH/LOG Update` tách thành năm ghi chú riêng thay vì một
  khối văn bản.
- `lark_record_id` unique nên chạy lại vô hại.
- Ticket nhập vào có `nguon = 'lark'` và chỉ đọc trên UI.

## Kiểm thử

- `features/cx-ticket/phan-loai.ts` — hàm thuần: `nhomHopLe`, `loaiHopLe(nhom,
  loai)`, `nhanLoai`, `boPhanHopLe`, `maTicket(n)`. Unit test như `ly-do.ts`.
- `features/cx-ticket/trang-thai.ts` — hàm thuần: `chuyenDuocTrangThai`,
  `boPhanConTac(phanViec[])` (danh sách bộ phận chưa xong, để hiện cảnh báo lúc
  đóng), `ghiDuocPhanViec(quyen, boPhanCuaNguoi, boPhanDich)`. Unit test.
- Action test bằng transaction rollback, như module đổi trả.

## Việc còn lại sau spec này

- Spec riêng: Incident Management · Dispute Management · Trustpilot Review
- Gửi email mẫu cho khách
- Mở tài khoản cho PROCUREMENT / MERCHANDISE / WAREHOUSE / CX
- Nhập báo cáo Intercom (nếu cần báo cáo thời gian xử lý ticket)
