# SMS ghi sang bảng Lark "WH - Inventory (Nhập, QC, Pack)"

Spec: `docs/superpowers/specs/2026-09-22-nhan-hang-kcs-kho-design.md`

Bảng `tblfnOiEwzcXmemM`, cùng `LARK_BASE_APP_TOKEN` với LOG-Export. Mỗi dòng = một món của một đơn.

## Env
- `WH_GHI_LARK=dry` — chạy thử: ghi vào SMS, KHÔNG gọi Lark. Bỏ biến khi chạy thật.

## Cột SMS ghi
Tạo dòng mới (13 cột): `Import (select order)` · `Lineitem SKU final` · `Lineitem Name` · `Order Number final` · `Store final` · `Vendor final` · `Warehouse` · `Import - Inventory type` (= Retail) · `Ngày Import - tiếp nhận đồ tại kho` · `Quantity tiếp nhận trước QC` · `Weight (kg)` · `QC Check` · `WH - Action`; thêm `Lý do QC failed` khi không đạt.

Cập nhật dòng có sẵn (tối đa 5 cột): `Quantity tiếp nhận trước QC` · `Weight (kg)` · `QC Check` · `WH - Action` · `Lý do QC failed`.

`Lý do QC failed` chỉ được gửi khi kho vừa nhập lý do mới, HOẶC khi món thật sự rời khỏi `QC Failed` (lúc đó gửi chuỗi rỗng để xoá). Sửa cân hay số lượng của một món không đụng tới cột lý do — 8.858/9.007 dòng Lark đã có kết quả, xoá vô điều kiện là thổi bay lý do người khác đã ghi.

Cột `Ngày Import - tiếp nhận đồ tại kho` dùng `ngayLark()` (`features/lark/ghi-nguoc/ngay-lark.ts`) — hàm chiều-ghi chuẩn của repo, ra epoch ms của nửa đêm giờ VN — để ngày trên Lark trùng nếp với mọi chỗ khác SMS đang ghi, thay vì tự tính một kiểu riêng.

**SMS KHÔNG có lệnh xoá trên bảng này.**

## Giá trị hợp lệ (cột chọn — ghi giá trị lạ là Lark đẻ lựa chọn mới, hỏng bộ lọc của cả đội)
- `QC Check`: QC Pass · QC Failed · Gửi dư
- `WH - Action`: Tạm nhập (đi đơn) · Lưu kho · Gửi trả Vendor (QC fail) · Hoàn trả brand (return) · Trả lại Vendor (đồ mượn)
- `Warehouse`: HN | GVM · SG | AP · TQ | CG · PHSG

Ba cột trên do SMS tự cho chọn nên đã khớp sẵn (`features/kho-nhan/gia-tri-lark.ts`). Còn `Store final` / `Vendor final` bê từ bảng MÓN sang bảng kho — tên có thể lệch — nên trước khi TẠO dòng, `ghiDongKho` đối chiếu với danh sách lựa chọn thật đọc từ API fields của bảng kho (`optionHopLe`, nhớ trong RAM); giá trị lạ thì BỎ hẳn cột đó và ghi log, không gửi để Lark đẻ lựa chọn mới.

## Màn đọc Lark trước khi ghi
`timMonCuaDon` đọc các dòng kho của đơn ngay trên Lark (`searchWhInventoryByDon` + `timDongTheoMon`) và hiện kết quả đang có của từng món, vì SMS mới biết những dòng do chính SMS ghi. Đọc hỏng thì màn vẫn chạy nhưng hiện cảnh báo "chưa đọc được bảng kho trên Lark" để kho không bấm Lưu mù.

## Chặn đẻ dòng đôi
`wh_nhan_kcs` có unique index theo `mon_dinh_danh` (migration `0156_wh-nhan-kcs-unique.sql`): một món chỉ có một dòng việc kho trong SMS. Hàm `ghiDongKho` (`features/lark/wh-inventory.ts`) tìm-rồi-tạo trên Lark là hai lượt gọi mạng, tự nó không chống được hai người cùng nhận một món chạy đua — chỗ chặn thật nằm ở unique index này, nên dù chạy đua thì SMS vẫn chỉ ra một dòng việc và một lần đẩy sang Lark.

## Khi Lark hỏng
Việc kho đã lưu ở bảng `wh_nhan_kcs` của SMS. Dòng đẩy trượt có `trang_thai_day = 'loi'`; job `day-nhan-kcs-lark` (15 phút một lần, nhóm `moi-15-phut`) thử lại, và màn có nút "Thử lại" từng dòng.

## Kiểm tay
Đặt `WH_GHI_LARK=dry`, nhập một món trên `/f/warehouse/nhan-kcs`, xem log — màn phải báo đúng "Đã lưu ở SMS (chế độ chạy thử — chưa gửi Lark)", không được khoe đã tạo dòng. Bỏ biến, nhập lại, mở Lark kiểm đúng cột; lúc này câu báo "tạo" hay "cập nhật" lấy từ chính lượt ghi Lark.
