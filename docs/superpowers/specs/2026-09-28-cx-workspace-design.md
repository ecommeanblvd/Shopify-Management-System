# Workspace CX — thiết kế

CEO duyệt 28/09/2026.

## Vì sao

Bốn bảng vận hành của CX đã lên hệ thống thành bốn module (`CX - To Do`,
`Dispute Management`, `Incident Management`, `Truspilot Review`), cộng module đổi
trả. Mỗi cái là một tab rời: chưa có chỗ nào trả lời "hôm nay làm gì", và chưa
nhìn được một đơn hàng có những hồ sơ gì.

## Đo dữ liệu thật trước khi thiết kế

### Liên kết chéo giữa các module RẤT THẤP — 2,4%

616 đơn có ít nhất một hồ sơ CX:

| Số module trên một đơn | Đơn |
|---|---:|
| 1 | **601 (97,6%)** |
| 2 | 13 |
| 3 | 2 |

Chỉ **2 khách** xuất hiện ở 2+ module. Cặp hay đi cùng nhau nhất là
**sự cố + ticket (8 đơn)** — hợp lý: một vấn đề vừa mở ticket vừa gây mất tiền.

**Đây là lý do KHÔNG dựng màn 360° cho từng đơn làm trung tâm**: 97,6% lần mở sẽ
chỉ thấy đúng một hồ sơ, tức không hơn gì mở thẳng tab của module đó.

Một phần lý do con số thấp là dữ liệu vừa nhập từ bốn bảng Lark mà CX vốn ghi
RỜI nhau. Liên kết chéo có thể tăng khi CX làm thật trên hệ thống — nhưng thiết
kế cho tương lai mình hy vọng là chỗ dễ làm thừa nhất, nên vòng này chỉ làm phiên
bản rẻ: một ô tìm và một dải "liên quan" chỉ hiện khi thật sự có.

### Việc đang treo, rải khắp bốn tab — 204 việc

| Việc | Số |
|---|---:|
| Sự cố chưa xong | **115** |
| Ticket (nhập từ Lark) chưa xong | **60** |
| Sự cố cần rà lại quy trách nhiệm | 18 |
| Đánh giá 1–2 sao chưa xử lý | 10 |
| Tranh chấp cần phản hồi, chưa nộp bằng chứng | 1 |
| Ticket tạo trên hệ thống chưa xong | 0 |
| Đổi trả chờ xử lý | 0 |

Hai dòng cuối bằng 0 vì hệ thống vừa chạy: **toàn bộ việc đang treo là tồn đọng
nhập từ Lark**. Đây là lý do phải tách tồn đọng khỏi việc phát sinh.

## Quyết định của CEO

**Trang "Hôm nay" + ô tìm xuyên module + dải "liên quan"** — không dựng màn 360°
riêng cho từng đơn.

## Phạm vi

**Làm:** đổi `/f/cx` thành trang tổng quan · trang "Hôm nay" tách tồn đọng ·
ô tìm xuyên module theo mã đơn / email · dải "liên quan" trong modal ·
gom logic ô tìm dòng đơn đang lặp.

**Không làm vòng này:** màn 360° cho từng đơn · thông báo đẩy / email nhắc việc ·
biểu đồ theo thời gian · gộp năm module vào một bảng.

## Đổi route

`/f/cx` hiện là danh sách ticket → chuyển sang **`/f/cx/viec-can-lam`**, và
`/f/cx` thành trang "Hôm nay".

Sáu tab: **Hôm nay · Việc cần làm · Tranh chấp · Sự cố · Đánh giá · Đổi trả**.

Đường cũ `/f/cx` bị đổi nghĩa; trang ticket mới ra đời một ngày nên không ai kịp
bookmark. `revalidatePath('/f/cx')` trong `features/cx-ticket/actions.ts` phải đổi
sang `/f/cx/viec-can-lam` — quên là danh sách ticket không tự mới lại sau khi ghi.

## Trang "Hôm nay"

### Tách tồn đọng khỏi việc phát sinh

Theo đúng nguyên tắc CEO đã chọn ở workspace nhận hàng 25/09 ("tách nhóm tồn hôm
trước"). Dồn chung là mỗi sáng CX mở ra thấy 204 việc rồi bỏ qua cả trang.

- **Cần làm ngay** — việc phát sinh trên hệ thống, CỘNG mọi việc có **hạn cứng**
  (bất kể nguồn)
- **Tồn đọng từ Lark** — khối riêng, gập lại được, mỗi dòng có liên kết sang tab
  tương ứng đã lọc sẵn

Việc có hạn cứng **luôn** nằm ở "Cần làm ngay" dù là hồ sơ nhập từ Lark: một
tranh chấp nhập từ Lark sắp hết hạn nộp bằng chứng vẫn là mất tiền thật.

### Thứ tự ưu tiên — theo HẬU QUẢ nếu bỏ qua

| Ưu tiên | Việc | Hậu quả |
|---|---|---|
| 1 | Tranh chấp chưa nộp bằng chứng | Quá hạn là **mất tiền vĩnh viễn**, không lùi được |
| 2 | Đổi trả đang chờ | Khách đang đợi |
| 3 | Đánh giá 1–2 sao chưa xử lý | Công khai, càng để lâu càng khó chữa |
| 4 | Ticket có hạn xử lý sắp đến | Bộ phận khác đang chờ |
| 5 | Sự cố cần rà lại quy trách nhiệm | 18 ca đang gán tiền cho bộ phận Lark liệt kê đầu |
| 6 | Sự cố chưa xong | Không có hạn, nhưng là tiền đã mất chưa kết luận |
| 7 | Ticket chưa xong | |

Mỗi khối hiện **số đếm + 5 việc gấp nhất**, kèm liên kết "xem tất cả". Không liệt
kê 204 dòng trên một trang.

Thêm dải số liệu gọn: thiệt hại sự cố tháng này · tranh chấp đang mở · đánh giá
1 sao tháng này — **tách theo đơn vị tiền**, dùng lại `gomTheoTienTe`.

## Ô tìm xuyên module

Một ô trên mọi tab CX. Gõ **mã đơn** hoặc **email khách** → trả về mọi hồ sơ ở cả
năm module, nhóm theo module, bấm là sang tab của nó với hồ sơ mở sẵn.

Đây chính là "nhìn một đơn có gì", nhưng dưới dạng kết quả tìm: khi chỉ có một hồ
sơ thì nó là một dòng, không phải một trang trống bốn khối.

## Dải "liên quan"

Trong modal mỗi hồ sơ, nếu đơn đó **thật sự** có hồ sơ ở module khác thì hiện một
dải nhỏ: *"Đơn này còn: 1 sự cố · 1 tranh chấp"*. Không có thì **không hiện gì** —
không để một dòng "không có hồ sơ liên quan" trên 97,6% số lần mở.

## Kiến trúc

| File | Việc |
|---|---|
| `features/cx/uu-tien.ts` | **THUẦN** — xếp việc theo mức gấp, tách tồn đọng. Có test. |
| `features/cx/tong-quan.ts` | Đếm + 5 việc gấp nhất mỗi khối, **theo quyền người xem** |
| `features/cx/tim-kiem.ts` | Tìm xuyên module theo mã đơn / email |
| `features/cx/lien-quan.ts` | Hồ sơ liên quan của một mã đơn, cho dải "liên quan" |
| `components/cx/TrangHomNay.tsx` | Trang "Hôm nay" |
| `components/cx/OTimXuyenModule.tsx` | Ô tìm |
| `components/cx/DaiLienQuan.tsx` | Dải "liên quan" |
| `components/cx/dung-tim-dong.ts` | Hook gom logic ô tìm dòng đơn đang lặp |

**Quyền lọc ở tầng TRUY VẤN, không ở tầng hiển thị.** Người chỉ có `cx.review` gõ
mã đơn thì không được thấy số tiền tranh chấp của đơn đó. Chỉ ẩn ở UI thì dữ liệu
vẫn về trình duyệt.

### Gom logic ô tìm dòng đơn

Hai chỗ đang lặp gần như từng dòng: `components/doi-tra/FormTaoYeuCau.tsx` và
`components/cx-ticket/TaoTicket.tsx`. (Bản trình bày cho CEO nói "ba chỗ"; đo lại
thì form sự cố dùng ô text thuần cho mã đơn, không phải ô tìm — nên đúng là HAI.)

Phần lặp là đoạn dễ sai nhất và mang một bài học đã trả giá: **debounce + chặn đua
lượt gọi + tách "lỗi gọi" khỏi "không có kết quả"**. Ngày 24/09 màn nhận hàng nuốt
lỗi nên một server action chết hiện thành "không có món nào", CEO thử ba lần mà
không ai biết vì sao.

Gom thành **HOOK** `dungTimDong` chứ không phải component: phần render khác nhau
thật (đổi trả hiện số đã trả, ticket hiện chip chọn nhiều), chỉ phần logic mới
đáng gom. Hai chỗ gọi giữ nguyên giao diện của mình.

## Kiểm thử

`features/cx/uu-tien.ts` là hàm thuần nên test được đầy đủ:

- thứ tự bảy mức ưu tiên
- tách tồn đọng khỏi việc phát sinh
- **việc có HẠN CỨNG vượt lên "Cần làm ngay" dù thuộc nhóm tồn đọng**
- mỗi khối cắt còn 5 việc nhưng số đếm vẫn là tổng thật (cắt mà đếm sai là lỗi
  đã mắc ở màn sổ nhập: header báo "397 chiếc" trong khi thật có 470)

Các truy vấn kiểm bằng cách chạy thật trên production, như các module trước.

## Việc còn lại sau spec này

- Màn 360° cho từng đơn, nếu liên kết chéo tăng sau vài tháng CX làm thật
- Thông báo đẩy / email nhắc việc có hạn cứng
- Ba việc chờ CEO và đội Lark: bảng `tblTBahjux1YrQHR` bị chặn quyền · scope
  payment cho `cici-mean` · mở tài khoản cho PROCUREMENT / MERCHANDISE / WAREHOUSE
