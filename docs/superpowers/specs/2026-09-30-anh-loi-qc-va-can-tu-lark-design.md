# Ảnh lỗi QC + cân sản phẩm: nối dữ liệu Lark về SMS

**Ngày:** 30/09/2026 · **Người đặt:** CEO Lê Minh Tiệp

## Vì sao

Hai việc CEO giao trên màn Nhận & Kiểm hàng:

1. Thêm cột **ảnh chụp lỗi QC fail** vào bảng "Nhận hôm nay".
2. Cân đóng hàng nên **điền sẵn** từ cân sản phẩm đã nhập lúc QC, thay vì gõ lại.

## Đo trước khi thiết kế (30/09/2026)

Phát hiện quyết định hướng làm: **dữ liệu đã có sẵn trên Lark, SMS chưa hề đọc về.**

| Cột Lark (bảng `tblfnOiEwzcXmemM`) | Có dữ liệu | Kết luận |
|---|---|---|
| `Weight (kg)` | **3.628 / 6.000 dòng (60,5 %)** | Đúng cột đội kho đang điền |
| `Lineitem weight` | 1.417 (23,6 %) | Cột KHÁC, ít dùng — KHÔNG đụng |
| `Ảnh chụp lỗi QC fail` | 422 (7 %) | Đã dùng thật trên Lark |
| `Kích thước` | 1 | Bỏ qua |

Phía SMS, cùng ngày:

- `goods_receipt_items`: 859 dòng, **26 dòng trong 30 ngày gần nhất và 0 dòng có cân**.
- Modal kiểm đang dùng (`ModalQc`) **không có ô nhập cân**.
- Ô "Cân (kg)" chỉ có ở màn CŨ `BangNhanKcs` — không trang nào còn dùng, bảng `wh_nhan_kcs` **rỗng**.
- `wh_loi_qc` (ảnh từng chỗ lỗi, dựng 24/09) **rỗng** — nhưng KHÔNG hỏng: 19 món fail đều
  có từ trước 07/2026, tức chưa món nào trượt QC kể từ khi tính năng lên.

Mẫu Lark lấy ra trùng đúng hai chiếc trong ảnh CEO gửi:
`WH-34184 · Seychas-AV13-S-WIR · #MBLVD30503 · 0.7 kg`.

**Nên đây không phải việc xây mới, mà là nối Lark về SMS.**

## Phạm vi

### Trong phạm vi

1. Đồng bộ **một chiều Lark → SMS** cột `Weight (kg)` vào `goods_receipt_items.weight_kg`.
2. Màn Đóng hàng: ô cân **điền sẵn** bằng TỔNG cân các món trong kiện, cho sửa.
3. Bảng "Nhận hôm nay": thêm cột **"Ảnh lỗi QC"** — hiện ảnh đã có, `+ thêm` mở khối nhập lỗi.
4. Ảnh mới thêm ở SMS đẩy sang cột Lark `Ảnh chụp lỗi QC fail`, **qua cổng `WH_GHI_LARK`**.

### NGOÀI phạm vi (cố ý)

- **KHÔNG** tải 422 ảnh lịch sử từ Lark về. Nhu cầu CEO nêu là từ nay trở đi; tải ngược
  lịch sử là thêm một kho ảnh thứ hai và một đường đồng bộ nữa cho thứ chưa ai hỏi.
- **KHÔNG** thêm ô nhập cân vào modal kiểm của SMS — đội kho điền trên Lark, và đó là
  quyết định của CEO.
- **KHÔNG** đụng cột `Lineitem weight`.
- **KHÔNG** cộng thêm cân thùng (CEO chốt: "điền tổng cân món thôi").

## Giả định phải được xác nhận

CEO trả lời "một chiều Lark → SMS" cho câu hỏi về ĐỒNG BỘ, nhưng yêu cầu ban đầu nói ảnh
"sẽ ghi vào cột Ảnh chụp lỗi QC fail trên Lark". Spec này hiểu là:

- **Đồng bộ hàng loạt:** một chiều Lark → SMS. SMS KHÔNG bao giờ ghi đè dữ liệu Lark.
- **Ảnh MỚI thêm ở SMS:** vẫn đẩy sang Lark dạng THÊM VÀO, không thay thế.

Nếu hiểu sai chỗ này thì bỏ mục 4 khỏi phạm vi.

## Kiến trúc

### Nối dòng

`goods_receipt_items` đã có sẵn `lark_record_id` và `lark_unique_code`. Nối bằng
`lark_record_id` (ổn định nhất), rơi về `lark_unique_code` khi thiếu. **Không** nối bằng
`unit_code` của SMS: mã SMS là `WH-2609-00028`, mã Lark là `WH-34184` — hai hệ mã khác nhau,
nối nhầm là gán cân của chiếc này sang chiếc khác.

### Các đơn vị mã

| Tệp | Việc | Phụ thuộc |
|---|---|---|
| `features/kho-nhan/can-tu-lark.ts` | THUẦN: đọc `Weight (kg)` từ một dòng Lark, lọc giá trị vô lý | không |
| `features/kho-nhan/dong-bo-can-lark.ts` | Đọc Lark → ghi `goods_receipt_items.weight_kg` | client Lark, db |
| `features/dong-hang/can-du-kien.ts` | THUẦN: tổng cân món của một kiện + nhãn "chưa gồm thùng" | không |
| `components/kho-nhan/OAnhLoiQc.tsx` | Ô ảnh lỗi QC trên từng dòng | `KhoiLoi` có sẵn |

Phần đẩy ảnh lên Lark dùng lại `anh-lark.ts` (đã có `uploadWhInventoryMedia` +
`updateWhInventoryRecord`), chỉ thêm ánh xạ cột `Ảnh chụp lỗi QC fail`.

### Luồng dữ liệu

```
Lark "Weight (kg)"  ──đồng bộ──►  goods_receipt_items.weight_kg
                                            │
                                            ▼  tổng theo kiện
                                   Đóng hàng: ô cân điền sẵn (sửa được)

SMS: chụp ảnh lỗi ──► wh_loi_qc ──cổng WH_GHI_LARK──► Lark "Ảnh chụp lỗi QC fail"
```

## Lỗi và trường hợp biên

- **Cân vô lý:** bỏ qua giá trị ≤ 0 hoặc > 50 kg. Một chiếc áo 500 kg là gõ nhầm, và ghi
  vào thì cước tính sai. Bỏ qua kèm ghi nhật ký, KHÔNG tự sửa thành số khác.
- **Kiện thiếu cân của vài món:** ô cân KHÔNG điền sẵn, và nói rõ thiếu mấy món. Tổng
  thiếu vế là một con số SAI trông như số đúng.
- **Dòng Lark không khớp món nào:** bỏ qua, đếm lại để báo — không tạo món mới từ Lark.
- **Đẩy ảnh hỏng:** ảnh đã nằm ở SMS rồi; lượt đẩy ghi nhật ký và thử lại sau, không chặn
  người dùng.
- **`WH_GHI_LARK=dry`:** in payload, không gọi Lark. Đây là mặc định cho tới khi CEO bật.

## Kiểm thử

- Hàm thuần `can-tu-lark.ts`: nhận số hợp lệ, từ chối ≤0 / >50 / chuỗi / null.
- Hàm thuần `can-du-kien.ts`: tổng đúng; thiếu một món thì trả `null` kèm số món thiếu;
  không làm tròn mất số lẻ (0,4 + 0,7 = 1,1 chứ không phải 1).
- Đồng bộ: nối đúng theo `lark_record_id`; KHÔNG nối theo `unit_code`; dòng lạ thì bỏ qua.
- Canh hồi quy: nhãn ô cân ở Đóng hàng phải chứa chữ "chưa gồm thùng".

## Quyết định thiết kế cần ghi

**Ô cân điền sẵn phải nói rõ nó là TỔNG CÂN MÓN, chưa gồm thùng.** CEO đã nói cân đóng
hàng là cân cả kiện. Điền sẵn mà không nói rõ thì người đóng bấm lưu luôn, và mình có một
cân kiện thiếu trọng lượng thùng — cước tính sai mà không ai biết. Cùng bài học với
D-159/D-160: một con số không kèm ngữ cảnh thì bị đọc sai.

**Thêm ảnh ở bảng dùng lại khối nhập lỗi, không làm ô tải ảnh riêng.** CEO muốn thêm được
ngay tại bảng; làm một ô tải ảnh riêng thì ảnh sẽ không có LÝ DO LỖI đi kèm, và bảng
`wh_loi_qc` sinh ra để giữ cặp lý do + ảnh. Ảnh không lý do là bằng chứng không dùng được
khi cãi với brand.
