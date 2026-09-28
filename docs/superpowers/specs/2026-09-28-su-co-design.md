# Module Incident Management (sự cố + thiệt hại tiền) — thiết kế

CEO duyệt 28/09/2026.

## Vì sao

CX ghi sự cố kèm thiệt hại tiền trên bảng Lark `Incident Management (Cũ)`
(`tbl7gQuwsBxW20Fj`, 156 bản ghi, 07/2025 → 07/2026). Đây là bảng thứ tư trong
danh sách `docs/phan-tich/2026-09-27-doi-chieu-file-cx.md` — sau `CX - To Do` và
`Dispute Management` đã làm, còn lại `Truspilot Review`.

Đây là bảng duy nhất trong bốn bảng **quy thiệt hại tiền về bộ phận gây ra**, nên
giá trị của nó là con số quy trách nhiệm, không phải luồng xử lý.

## Một chỗ chưa đọc được

Cột `Incident Management Test-Select Order No.` trong file CX trỏ sang bảng
`tblTBahjux1YrQHR`. App của mình gọi thì Lark trả **`RolePermNotAllow`**; bảng đó
không nằm trong base CX.

Đáng ngờ hơn: bản ghi cuối của bảng `(Cũ)` là **tháng 7/2026** — hai tháng không
có dòng mới, trong khi 13 tháng trước đều đặn ~12 ca/tháng. Cộng với chữ "(Cũ)",
khả năng cao CX đã chuyển sang bảng mới mà mình không thấy.

**CEO 28/09: sẽ hỏi đội Lark; vòng này cứ làm với bảng cũ.** Nếu sau đó có bảng
mới, script nhập chỉ cần đổi `table_id` và bảng mapping — không phải sửa mô hình.

## Đo dữ liệu thật trước khi thiết kế

### Thiệt hại tiền: $42.601,76

Bảng Lark **không có cột nào về đơn vị tiền**, nên đây là giả định USD.

| Loại chi phí | Ca | Số tiền |
|---|---:|---:|
| Hoàn qua ngân hàng | 88 | 38.781,58 |
| Phí pick-up | 12 | 1.457,44 |
| Phí gửi lại | 13 | 834,44 |
| Bù bằng hàng | 2 | 772,00 |
| Bù store credit | 33 | 576,89 |
| Thuế | 4 | 106,57 |
| Doanh thu mất | 2 | 72,84 |

Công thức `Total order loss` của chính Lark cho 38.639,50 trên 122 ca — lệch với
tổng cộng tay ở trên, thêm một lý do không tin cột tổng của bảng gốc.

### Quy về bộ phận

Procurement 81 ca · **25.452,89 (60%)** · Warehouse 30 ca · 8.511,37 ·
Merchandise 31 ca · 2.735,90 · Logistic 8 ca · 1.198,02 · Product Portfolio 1 ca
· 275,77 · CX-CS 3 ca · 96,44 · **29 ca không ghi bộ phận · 8.523,03**.

### Nguyên nhân (sau khi bỏ tiền tố `(2)`/`(3)` của Lark)

sold_out 67 (43%) · delayed_delivery 18 · delayed_production 15 · defective_item 8
· return_item_not_as_described 6 · cancel_delivery_delay 6 · return_defective_item 5
· wrong_item 5 · missing_item 5 · tax_issue 5 · delivery_wrong_address 3 ·
cancel_due_to_sold_out 3 · return_wrong_item 3 · package_lost_by_carrier 2 ·
cancel_not_in_time_for_event 1 · promotion_not_working 1 · return_shipping_issue 1
· returned_item_damaged_by_customer 1 · return_size_issue 1 — **19 nguyên nhân**.

Tiền tố `(n)` là rác của Lark: nó tách `delayed_delivery` thành 17 + 1.

### Các con số hình dáng

- Giai đoạn hành trình: Purchase 93 · Post-Purchase 62 · Pre-Purchase 1
- Trạng thái: **trống 58 (37%)** · In Progress 42 · Resolved 41 · Open 15
  → 115/156 chưa Resolved
- **Nối đơn: 134/134 mã đơn khớp hệ thống — 100%**, tất cả meanblvd. Khác hẳn
  module tranh chấp (28%) vì đây là đơn 2025–2026.
- Có ảnh bằng chứng: 98/156 · có số ticket Intercom: 90%
- Số loại chi phí mỗi ca: 0 loại 1 ca · 1 loại 52 · **2 loại 100** · 3 loại 3
- Số bộ phận mỗi ca: 0 → 29 ca · 1 → 102 · 2 → 23 · 3 → 2

### Bốn chỗ Lark tự mâu thuẫn

1. **Khai loại chi phí mà không có số tiền**: hoàn bank 18/105 · bù store credit
   6/39 · gửi lại 3/13 · thuế 2/6 · bù bằng hàng 1/3 — khoảng 30 lời khai.
2. **Ngược lại, 10 ca có số tiền ở cột mà không khai loại.** Hai chỗ ghi một sự
   thật nên chúng lệch nhau cả hai chiều.
3. **Quy bộ phận cộng trùng tiền**: cộng theo bộ phận ra **46.791** trong khi
   tổng thật là **42.601** — ca có hai bộ phận thì số tiền tính cho cả hai.
4. **Danh sách lựa chọn `Responsible Dept.` bị lọt giá trị tiền** (`$537.67`,
   `-$0.05`, `$613.94`…). May là dữ liệu thật không dùng cái nào.

## Quyết định của CEO

1. **Mỗi khoản chi phí là một dòng riêng** (loại + số tiền + đơn vị tiền), không
   phải 8 cột tiền cố định như Lark.
2. **Gán bộ phận cho từng dòng chi phí**; sự cố có một bộ phận chịu chính, dòng
   nào khác thì gán riêng. Nhờ vậy tổng theo bộ phận luôn bằng tổng thật.

## Phạm vi

**Làm:** ghi sự cố · gắn đơn · dòng chi phí kèm bộ phận · ảnh bằng chứng · mã
giảm giá đã cấp · màn tổng hợp thiệt hại theo bộ phận / loại / nguyên nhân · nhập
156 ca cũ từ Lark.

**Không làm vòng này:** tải 98 ảnh bằng chứng cũ từ Lark về (hồ sơ đã đóng, ảnh
vẫn xem trên Lark) · nối sự cố với ticket CX · tự phát hiện sự cố từ dữ liệu đơn ·
`Truspilot Review` (spec riêng).

## Dữ liệu (migration 0180)

### `su_co`

| Cột | Kiểu | Ghi chú |
|---|---|---|
| `id` | uuid pk | |
| `ma_su_co` | text unique not null | `SC-0001`; ca nhập từ Lark là `LARK-<Incident ID>` |
| `ngay_bao` | date not null | `Date Reported` |
| `nguyen_nhan` | text not null | một trong 19 mã |
| `giai_doan` | text | `truoc_mua` / `mua` / `sau_mua` |
| `trang_thai` | text not null default `'mo'` | `mo` / `dang_xu_ly` / `xong` — **NOT NULL**, Lark để trống 37% |
| `mo_ta` | text | `Issue Log` |
| `bo_phan_chinh` | text | bộ phận chịu chính; dòng chi phí không ghi bộ phận thì thừa hưởng |
| `ma_giam_gia` | text | mã đã cấp cho khách — **không phải** một loại chi phí |
| `ma_ticket_cs` | text | số ticket Intercom |
| `store_id` | uuid → `stores` | |
| `order_id` | uuid → `shopify_orders` on delete set null | |
| `ma_don` | text | giữ chuỗi mã đơn kể cả khi chưa nối được |
| `anh_keys` | text[] not null default `'{}'` | ảnh bằng chứng trên S3, cùng cách `customer_order_requests.photo_keys` |
| `can_xem_lai` | boolean not null default false | ca nhập từ Lark mà dữ liệu không đủ để suy |
| `lark_record_id` | text unique | chặn nhập trùng khi chạy lại |
| `tao_boi` | text → `user` | |
| `created_at` `updated_at` `dong_luc` | timestamp | |

### `su_co_chi_phi` — chỗ tiền sống

`su_co_id` · `loai` not null · `so_tien` numeric(14,2) **not null** ·
`tien_te` text **not null** · `bo_phan` (nullable — thừa hưởng `bo_phan_chinh`) ·
`created_at`.

Bảng con này làm ba lỗi của Lark **không thể xảy ra**:

| Lỗi Lark | Vì sao hết |
|---|---|
| Khai loại mà không có số (≈30 ca) | Dòng chi phí bắt buộc có số tiền |
| Có số mà không khai loại (10 ca) | Loại và số nằm cùng một dòng |
| Cộng trùng tiền theo bộ phận | Mỗi đồng thuộc một dòng, dòng thuộc một bộ phận |

`so_tien` luôn đi kèm `tien_te`, và dùng lại `gomTheoTienTe` của
`features/dispute/tong-tien.ts` thay vì viết lại — hàm đó đã có test cho ca nhiều
đơn vị tiền.

### `su_co_ghi_chu`

Append-only, cùng hình `dispute_ghi_chu`: `su_co_id` · `noi_dung` · `tao_boi` ·
`tu_lark` boolean · `created_at`.

Không dùng enum Postgres cho các cột phân loại: thêm một nguyên nhân hay loại chi
phí mới không được phép cần migration.

## Phân loại

`features/su-co/phan-loai.ts`:

- **19 nguyên nhân** đúng danh sách đo được ở trên, kèm hàm `donTienTo` bỏ tiền tố
  `(n)` của Lark.
- **8 loại chi phí**: `hoan_bank` · `bu_store_credit` · `bu_bang_hang` ·
  `phi_gui_lai` · `phi_pickup` · `thue` · `doanh_thu_mat` · `khac`.
- **3 giai đoạn**: `truoc_mua` · `mua` · `sau_mua`.
- **3 trạng thái**: `mo` · `dang_xu_ly` · `xong`.

### Dọn danh sách bộ phận (việc phụ, có lý do)

Danh sách bộ phận đang nằm trong `features/cx-ticket/phan-loai.ts`; giờ module này
cũng cần. Chuyển sang **`features/to-chuc/bo-phan.ts`** và cho `cx-ticket` export
lại, nên không file nào khác phải sửa.

Thêm **`PRODUCT-PORTFOLIO`**: bảng sự cố có bộ phận này (1 ca, $275,77) mà danh
sách 6 bộ phận của bảng ticket không có.

Hai bảng Lark gọi tên bộ phận khác nhau nên script nhập phải dịch:
`Warehouse` → `DISCO-WH` · `Logistic` → `DISCO-LOG` · `Procurement` →
`PROCUREMENT` · `Merchandise` → `MERCHANDISE` · `CX - CS` → `CX-CS` ·
`Product Portfolio` → `PRODUCT-PORTFOLIO`.

## Tổng hợp

`features/su-co/tong-hop.ts` — hàm THUẦN, gom thiệt hại theo bộ phận / loại /
nguyên nhân, **mọi số tách theo đơn vị tiền**.

Quy tắc quy bộ phận, viết một lần ở đây: bộ phận của một dòng chi phí là
`COALESCE(chi_phi.bo_phan, su_co.bo_phan_chinh)`. Mỗi dòng thuộc đúng một bộ phận
nên tổng theo bộ phận **luôn bằng** tổng thật. Test phải có ca một sự cố hai bộ
phận để chứng minh không lặp lại lỗi $46.791 vs $42.601.

## Màn hình — thêm tab "Sự cố" vào `/f/cx`

**Khối tổng hợp** là giá trị chính — ba bảng nhỏ, mọi số tách theo đơn vị tiền:

- theo **bộ phận chịu** — "Procurement gây thiệt hại bao nhiêu"
- theo **loại chi phí** — hoàn bank so với phí pick-up
- theo **nguyên nhân** — sold_out chiếm 43% số ca, tốn bao nhiêu

Dưới là danh sách lọc theo trạng thái / bộ phận / nguyên nhân, bấm một dòng mở
modal có các dòng chi phí, ảnh bằng chứng và ghi chú. Ca `can_xem_lai` có dấu
hiệu riêng.

Form ghi sự cố mới: nguyên nhân, mô tả, tìm và gắn đơn (dùng lại ô tìm đã có),
bộ phận chịu chính, thêm/bớt dòng chi phí, tải ảnh bằng chứng.

## Quyền

Scope riêng `cx.incident` với `view` / `create` / `edit`; hai quyền cũ
`view_cx_incident`, `manage_cx_incident`. Riêng vì đây là tiền, giống `cx.dispute`.

## Nhập 156 ca cũ

`scripts/nhap-su-co-lark.ts` — **CHỈ ĐỌC** Lark.

Ba chỗ dữ liệu Lark không đủ để suy, ghi thành **ghi chú** chứ không bịa số:

1. **Đơn vị tiền**: bảng gốc không có cột nào. Ghi `USD` và đính ghi chú "đơn vị
   tiền là suy ra, bảng gốc không ghi".
2. **≈30 lời khai không có số tiền**: KHÔNG tạo dòng chi phí (số 0 giả), mà ghi
   chú "Lark khai loại X nhưng không có số tiền".
3. **18 ca vừa nhiều bộ phận vừa nhiều loại chi phí**: Lark không nói bộ phận nào
   chịu khoản nào. Đặt bộ phận đầu làm `bo_phan_chinh`, ghi chú liệt kê đủ các bộ
   phận Lark ghi, và đặt `can_xem_lai = true`. (Tổng 25 ca có từ 2 bộ phận.)

`lark_record_id` UNIQUE nên chạy lại vô hại. Không tải ảnh bằng chứng cũ.

## Kiểm thử

- `features/su-co/phan-loai.ts` thuần: `nguyenNhanHopLe`, `donTienTo`,
  `loaiChiPhiHopLe`, `mapNguyenNhanLark`, `mapBoPhanLark`, `maSuCo`. Unit test.
- `features/su-co/tong-hop.ts` thuần: `gomTheoBoPhan`, `gomTheoLoai`,
  `gomTheoNguyenNhan`. **Test bắt buộc có ca một sự cố hai bộ phận** để chứng minh
  không cộng trùng.
- Action test bằng transaction rollback như các module trước.

## Việc còn lại sau spec này

- `Truspilot Review` (45 bản ghi) — spec cuối của bộ bốn bảng CX
- Làm rõ bảng `tblTBahjux1YrQHR` với đội Lark; nếu là bảng sự cố mới thì đổi
  `table_id` trong script nhập
- Tải ảnh bằng chứng cũ từ Lark (nếu CX cần tra hồ sơ cũ ngay trên hệ thống)
