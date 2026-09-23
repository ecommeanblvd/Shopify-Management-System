# SMS ghi sang bảng Lark "WH - Inventory (Nhập, QC, Pack)"

Spec: `docs/superpowers/specs/2026-09-22-nhan-hang-kcs-kho-design.md`

Bảng `tblfnOiEwzcXmemM`, cùng `LARK_BASE_APP_TOKEN` với LOG-Export. Mỗi dòng = một món của một đơn.

## Env
- `WH_GHI_LARK` — điều khiển việc ghi sang Lark. **AN TOÀN LÀ MẶC ĐỊNH**: chỉ đúng MỘT chuỗi bật ghi thật cho mọi món, còn lại — kể cả biến trống, chưa đặt, hay gõ sai bất cứ kiểu gì — đều là chạy thử (không gọi Lark):
  - **`ghi-that-toan-bo`** — chuỗi DUY NHẤT ghi thật cho MỌI món. Gõ đúng nguyên văn (không phân biệt hoa/thường), sai một ký tự cũng rơi về chạy thử.
  - `chon:<định danh món>,<định danh món>` (chấp nhận cả có dấu `chọn:`, không phân biệt hoa/thường) — chỉ những món khai tên mới ghi thật, còn lại vẫn chỉ lưu ở SMS; dùng để kiểm từng bản ghi một. Khai tiền tố mà không có định danh nào phía sau (`chon:` trơ trọi) vẫn là chạy thử, KHÔNG ghi gì.
  - Mọi giá trị khác — trống, chưa đặt biến, `dry`, gõ nhầm `chọnn:`/`chn:`/thiếu dấu `:`, gõ sai `ghi-that-toan-bo` dù chỉ một ký tự — đều là **chạy thử**, không gọi Lark.

  Đọc bằng `docCheDoGhi` (`features/kho-nhan/day-lark.ts`), THUẦN nên có test không cần chạm Lark (`features/kho-nhan/day-lark.test.ts`) — kể cả trường hợp gõ nhầm tiền tố `chon:`/`chọn:` vẫn phải rơi về chạy thử.

### Trình tự bật (spec §6)
Đưa `WH_GHI_LARK` từ chạy thử sang ghi thật theo 5 bước, mỗi bước xong mới sang bước kế:

1. Test màn `/f/warehouse/nhan-kcs`, không gì chạm Lark (đang ở bước này — biến chưa đặt, hoặc đặt `WH_GHI_LARK=dry`, trên mọi service; cả hai đều là chạy thử).
2. Đổi sang `chon:<định danh của MỘT món chưa có dòng Lark>` → ghi thật một lần, soi từng cột trên Lark.
3. Đổi `chon:` sang một món **đã có dòng Lark cũ** → kiểm nhánh CẬP NHẬT (`ghiDongKho` gọi `updateWhInventoryRecord`). Đây là nhánh nguy hiểm nhất vì nó sửa dữ liệu đang có trên bảng kho và **chưa từng chạy thật lần nào** — kiểm kỹ trước khi đi tiếp.
4. Đổi `chon:` sang một món **không đạt QC** (`QC Check = QC Failed`) → kiểm cột `Lý do QC failed` ghi đúng, và kiểm lại thành đạt thì lý do cũ bị XOÁ đúng lúc (không xoá khi chỉ sửa cân/số lượng).
5. Chỉ sau khi cả 4 bước trên đều đúng mới đổi `WH_GHI_LARK` thành đúng chuỗi **`ghi-that-toan-bo`** (ghi thật mọi món) và chuyển job `day-nhan-kcs-lark` từ nhóm `chua-bat` sang `moi-15-phut` trong `features/jobs/groups.ts` để cron tự đẩy lại các dòng `cho`/`loi`.

`day-nhan-kcs-lark` hiện đứng trong nhóm `chua-bat` (`features/jobs/groups.ts`) — cố ý, KHÔNG nối service cron nào. Muốn bật cron tự động thì chuyển khoá `day-nhan-kcs-lark` từ mảng `chua-bat` sang mảng `moi-15-phut`, chỉ làm việc này ở bước 5 sau khi đã kiểm cả 4 bước trên bằng tay qua nút "Thử lại"/lưu từng món trên màn hình.

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

## Kiểm tay (chế độ chạy thử / `chon:`)
Không đặt `WH_GHI_LARK` (hoặc đặt `WH_GHI_LARK=dry`), nhập một món trên `/f/warehouse/nhan-kcs`, xem log — màn phải báo đúng "Đã lưu ở SMS (chế độ chạy thử — chưa gửi Lark)", không được khoe đã tạo dòng. Đổi sang `chon:` cho đúng một món (hoặc đúng chuỗi `ghi-that-toan-bo` khi đã sẵn sàng ghi hết) rồi nhập lại, mở Lark kiểm đúng cột; lúc này câu báo "tạo" hay "cập nhật" lấy từ chính lượt ghi Lark.

## Hướng dẫn cho CEO — bật ghi từng món một bằng `chon:`

**Ghi nhớ điều quan trọng nhất: gõ SAI ở bất cứ bước nào dưới đây cũng chỉ dẫn tới KHÔNG ghi gì lên Lark (chạy thử), không bao giờ dẫn tới ghi nhầm hàng loạt.** Chỉ có đúng nguyên văn chuỗi `ghi-that-toan-bo` mới ghi thật cho mọi món — mọi chuỗi khác, kể cả gần đúng, đều an toàn.

**1. Lấy "định danh món" của MỘT món** (chuỗi cần khai trong `chon:`):
   - Mở bảng Lark **"WH ngày MEAN nhận hàng"** (base app riêng, KHÔNG phải bảng "WH - Inventory" đích ghi).
   - Tìm đúng dòng của món muốn kiểm (lọc theo mã đơn ở cột Order Number, hoặc theo mã hàng).
   - Copy nguyên văn giá trị ở cột **"Định danh"** — ví dụ dạng `#MBLVD29309-Larmes-LAR1612-L-RED-PDL-21184`. Đây chính là chuỗi SMS lưu ở `wh_nhan_kcs.mon_dinh_danh` / `lark_mon_don.dinh_danh`, không phải mã vạch in trên tem (`L:…` / `V:…` / `WH-…` là mã KHÁC, dùng để quét, không dùng ở đây).
   - Muốn thêm nhiều món cùng lúc: nối bằng dấu phẩy — `chon:dinh-danh-1,dinh-danh-2` (viết `chọn:` có dấu cũng được, SMS nhận cả hai cách viết). Món không có tên trong danh sách vẫn CHỈ lưu ở SMS như chạy thử, không hề bị ghi lên Lark.

**2. Đặt biến môi trường** `WH_GHI_LARK=chon:<định danh vừa copy>` trên service Railway đang chạy SMS, rồi deploy lại. Đây là bước duy nhất phải làm tay — code không tự bật, và cố tình không có công tắc trong màn hình để tránh bấm nhầm hàng loạt.

**3. Kiểm kết quả trên Lark:** vào lại `/f/warehouse/nhan-kcs`, lưu (hoặc bấm "Thử lại") đúng món vừa khai tên, rồi mở bảng Lark **"WH - Inventory (Nhập, QC, Pack)"** (bảng `tblfnOiEwzcXmemM`), lọc theo mã đơn ở cột `Order Number final`, đối chiếu từng cột với những gì vừa nhập trên SMS: `Quantity tiếp nhận trước QC`, `Weight (kg)`, `QC Check`, `WH - Action`, `Lý do QC failed` (nếu không đạt). Nếu món này TRƯỚC ĐÓ đã có dòng trên Lark (nhánh cập nhật, xem bước 3 ở "Trình tự bật" phía trên) thì đặc biệt soi kỹ: dòng cũ có bị sửa nhầm cột nào không.

**4. Backout (lỡ ghi sai hoặc muốn dừng):** xoá hẳn biến `WH_GHI_LARK` khỏi service trên Railway, hoặc đặt lại bất cứ giá trị nào KHÔNG phải `ghi-that-toan-bo`/`chon:...` hợp lệ (ví dụ `dry`) rồi deploy lại — mọi lượt ghi Lark tiếp theo dừng ngay, kể cả món vừa mở. SMS không có lệnh xoá trên bảng kho (xem "SMS KHÔNG có lệnh xoá trên bảng này" phía trên), nên nếu Lark đã lỡ nhận một giá trị sai thì phải sửa TAY trực tiếp trên Lark; muốn ghi lại đúng qua SMS thì cứ để `chon:` giữ tên món đó và lưu lại từ màn hình — `ghiDongKho` sẽ CẬP NHẬT đúng dòng đã có (tìm theo liên kết món, không tạo dòng mới).

**5. Bật ghi thật cho MỌI món (chỉ sau khi đã kiểm xong cả 5 bước ở "Trình tự bật"):** đặt đúng nguyên văn `WH_GHI_LARK=ghi-that-toan-bo`, không thêm bớt ký tự nào, rồi deploy lại.
