# Chọn box khi đóng hàng — thiết kế

CEO Lê Minh Tiệp chốt 14/10/2026. Người viết: Claude (phiên 13–14/10/2026).

## 1. Vì sao làm

Nhân sự đóng xong một kiện thì gõ **cân** và **kích thước** vào bảng LOG-Export trên Lark. SMS không có chỗ nào nhập hai thứ đó — nó chỉ đọc về.

Kích thước gõ lại từ đầu mỗi kiện, dù thùng chỉ là một trong ~21 loại kho đang dùng và loại nào cũng có số đo cố định. CEO muốn bỏ việc gõ ba con số: **chọn box là ra dài-rộng-cao**, sửa lại được chiều nào bị vênh vì kiện đóng dày hơn hay phồng lên.

### Đã đo (14/10/2026)

| | |
|---|---|
| Kiện đóng trong 30 ngày | 418 |
| Trong đó thiếu kích thước | 2 |
| Trong đó có chọn box trên Lark | **0** |

Lark **đã có sẵn** cơ chế này: cột `Select VTĐG1` liên kết sang bảng kho, và cột `Dimension lookup` kéo kích thước từ dòng kho đó về. Không ai dùng. Nhân sự gõ tay `Dimension ( điền tay)`, và gõ khá đều (416/418).

Nên việc này **không phải vá một đường dữ liệu đang hỏng** — nó là đổi nơi làm việc, để bước chọn box nằm đúng chỗ người ta đang thao tác thì mới có người dùng.

## 2. Nguồn dữ liệu đã dò được

Bảng kho `tblfnOiEwzcXmemM` — "WH - Inventory (Nhập, QC, Pack)", cùng base với LOG-Export.

- Vật tư đóng gói là những dòng có `Import - Inventory type` = **`VTĐG1`** (và `VTĐG2` cho vật tư phụ: tag, decal, thiệp).
- Kích thước nằm ở cột **`Kích thước`** (`fldFXcu7Nc`, kiểu **Text**, chữ tự do).
- **46 dòng `VTĐG1`, trong đó 38 dòng có kích thước, 8 dòng trống.**
- `Định danh` cũng mang sẵn số đo: `MEAN-OCV-40x30x10-APP-02-VTĐG2-WH-25954`.

Bảng này **đã được đồng bộ sẵn** về SMS: `lark_wh_inventory`, 9.450 dòng, có `inventory_type`, `lineitem_name`, `dinh_danh`, `record_id`. **Chưa có cột `Kích thước`** — đó là chỗ phải nối thêm.

### 21 box dùng được hôm nay

Thùng (ba số): Thùng Carton 2.4kg `36x26x10` · 3kg `30x25x20` · 4kg `30x25x25` · 5kg `40x25x25` · 6kg `40x30x30` · Hộp MEAN Ver 1 `39x29x9` · Ver 2 `42x30x10` · Hộp 39x28x9 `39x28x9` · Hộp Happy Clothing `36x26x10` · Thùng DHL 2.5kg `32x23x16` · 5.5kg `33x24x33` · Thùng DHL `46x17x32` · Thùng FedEx 7.5kg `45x29x28`

Túi hãng (ba số): Túi FedEx Nhỏ `40x31x2` · To `53x42x2` · Túi DHL Nhỏ `40x30x2` · To `48x38x2`

Túi **chỉ có hai số**: niêm phong nhỏ `28x42` · to `38x52` · zip nhỏ `25x35` · zip to `35x45`

Trong `VTĐG1` còn lẫn thứ không phải box — `Giấy Nến Trắng 160x60`, các tag và decal. Lọc chúng ra là việc của người dựng (§7).

## 3. Màn hình đã có sẵn — đây là NÂNG CẤP, không phải dựng mới

Kiểm 14/10/2026 (sau khi CEO hỏi "chỗ chọn box nằm ở phần nào trên SMS"): màn đóng kiện **đã tồn tại**.

`/f/warehouse/dong-goi` → "ĐÓNG HÀNG — kho đóng kiện" (`app/(dashboard)/f/warehouse/dong-goi/page.tsx`, spec `2026-09-26-dong-hang-design.md`). Bấm một đơn thì mở `components/dong-goi/ModalDongKien.tsx`, trong đó **đã có đủ**:

- ô **Cân nặng (kg)**
- ba ô **kích thước (cm)**
- dropdown **"Hộp / vật tư đóng gói"**, đọc đúng nguồn đề xuất ở §2: `vatTuDongGoi()` trong `features/dong-goi/queries.ts` chạy `SELECT … FROM lark_wh_inventory WHERE inventory_type IN ('VTĐG1','VTĐG2')`

`dongKien()` (`features/dong-goi/actions.ts`) ghi `actualWeightKg`, `dimLengthCm/WidthCm/HeightCm`, `larkHop`, `hopLarkRecordId` vào `shipments`.

**Nhưng không ai dùng.** Toàn hệ thống có đúng **2 kiện** từng đóng qua màn này (`sms_packed_at IS NOT NULL`), lần cuối 12/10/2026, và **0 kiện chọn hộp**. Đúng y chuyện `Select VTĐG1` bên Lark ở §1: công cụ có, không ai dùng.

### Năm việc còn thiếu — đây là toàn bộ phạm vi

1. **Chọn hộp không tự điền kích thước.** Đây là yêu cầu gốc của CEO.
2. **Dropdown hiện mã kho dài** (`MEAN-OCV-40x30x10-APP-02-VTĐG2-WH-25954`) chứ không phải tên người đọc được kèm số đo (`Hộp MEAN Ver 2 · 42×30×10`).
3. **Chưa có ô tìm + lưới thẻ** tách khối Thùng / khối Túi (cách bày CEO đã chọn).
4. **Không đẩy ngược cân và kích thước lên Lark.**
5. **Danh mục box chưa sửa/thêm được trong SMS.**

Việc đầu tiên của người dựng **không phải viết mã** mà là hỏi kho vì sao họ chưa dùng màn này. Nếu lý do nằm ngoài năm việc trên thì làm xong vẫn không ai dùng, và cả tài liệu này sai mục tiêu.

## 4. Cái sẽ làm

Nhân sự đóng xong một kiện, mở kiện đó trong SMS và làm **trọn vẹn tại đây**:

1. **Chọn box** — ô tìm ở trên, dưới là lưới thẻ tách khối **Thùng** và khối **Túi**; gõ vào ô tìm thì lưới lọc theo tên hoặc theo số đo. Ai quen thì gõ hai chữ, ai mới thì nhìn lưới mà bấm. *(CEO chọn cách này sau khi bấm thử ba bản nháp A/B/C — đây là B ghép C.)*
2. **Ba ô Dài / Rộng / Cao tự điền** theo box, và **sửa được**. Số nhân sự để lại trong ba ô đó là số thật, không phải số của box. Sửa lệch so với box thì hiện dấu cho người ta biết mình vừa sửa.
3. **Nhập cân** ngay tại đó.
4. SMS **đẩy cân và kích thước ngược lên Lark**.

### Đẩy ngược lên Lark

| Ô trên LOG-Export | SMS có đẩy không |
|---|---|
| `Weights` | **Có** |
| `Dimension ( điền tay)` | **Có** |
| `Select VTĐG1` (box đã chọn) | **Không** |

Luật ghi giữ nguyên luật CEO đã chốt cho mọi đường ghi Lark: **chỉ điền ô trống, không đè**. Nhân sự nào lỡ gõ thẳng trên Lark trước thì SMS để yên.

Vì sao phải đẩy cân chứ không chỉ dim: ô `Weights` không vô hại. `actual_weight_kg` của toàn hệ thống lấy từ nó; rule webhook Lark có điều kiện `Weights is not empty` nên ô trống là rule không bắn; đối soát cước, bảng kê và màn của Đức đều đọc cân từ dòng LOG. Cân vào SMS mà không đẩy ngược là Lark mù cân.

### Danh mục box

Kéo từ Lark (`lark_wh_inventory`, `inventory_type = VTĐG1`, cột `Kích thước`), **và sửa/thêm được ngay trong SMS**.

**Luật khi hai bên lệch nhau — bản sửa tay trong SMS THẮNG.** Box nào có người sửa trong SMS thì khoá lại; lượt kéo sau Lark đổi gì cũng không đụng tới. SMS hiện dấu lệch ("Lark đang ghi 40x25x28, khác ô này") để người ta tự quyết.

Lý do: người ngồi trong SMS là người vừa cầm cái thùng mà đo, còn ô trên Lark là chữ gõ tay từ lúc nhập kho. Đây cũng đúng tinh thần "không đè cái người khác đã gõ", chỉ là chiều ngược lại.

## 5. Không làm

- **Không** tạo nhãn vận chuyển. D-691 giữ việc đó ở Ops.
- **Không** đẩy lựa chọn box lên Lark. Hai cột `Select VTĐG1` và `Dimension lookup` bên Lark vẫn trống như hiện nay.
- **Không** đụng bước Đức chọn line, cũng không đụng cron `sync-lark` một tiếng một lượt.
- **Không** bắt nhân sự khai box mới trước khi đóng được hàng. Box lạ thì vẫn gõ tay ba số như cũ.

## 6. Hỏng kể cả khi chạy đúng

- **Đè mất số người khác đã gõ** — dù trên Lark hay trong SMS. Lark không có undo.
- **Chậm hơn gõ ba số.** Nhân sự đóng vài chục kiện một ngày. Chọn box mà mất nhiều thao tác hơn gõ `40x30x20` thì họ bỏ, và tính năng này chết đúng kiểu `Select VTĐG1` trên Lark đang chết.
- **Số của box thành số của kiện.** Box là cái bấm cho nhanh, không phải số cuối cùng. Kiện phồng lên mà vẫn gửi đi số của box thì sai cước, và sai về phía hãng tính thêm tiền.

## 7. Ràng buộc kỹ thuật

- Next.js 16.2.6, React 19.2.4, Drizzle + Postgres, Tailwind 4, vitest 4.
- **vitest chỉ bắt `.ts`, không bắt `.tsx`.** Mọi luật — phân tích chuỗi kích thước, luật khoá bản sửa tay, dựng bản vá gửi Lark — phải nằm trong module `.ts` có test. File `.tsx` chỉ còn việc vẽ.
- Quyền: nhập cân/kích thước là `manage_fulfillment` (vai `viewer` chỉ có `view_fulfillment`, không được ghi).
- Khoá Lark **chỉ có trên Railway**. Muốn dò bảng thì `railway run npm run probe:lark-table`.
- Di trú chạy **bằng tay** — `npm run db:migrate` báo thành công nhưng không làm gì. Thủ tục ở `db/migrations/README.md`.
- Đường ghi ngược Lark đã có sẵn và **chỉ có một đường**: `features/lark/ghi-nguoc/` (`dung-patch.ts` giữ luật chỉ-điền-ô-trống, `cot.ts` giữ tên cột). Thêm cột mới thì thêm vào đó, không mở đường thứ hai.
- Màn phải sửa là `components/dong-goi/ModalDongKien.tsx` + `features/dong-goi/{queries,actions,logic}.ts` (xem §3). KHÔNG phải `components/dong-hang/BangDongHang.tsx` — đó là màn chọn line của Đức, việc khác.

## 8. Để người dựng tự quyết

- Hình dạng bảng box trong SMS, và chỗ đặt màn quản lý danh mục.
- Cách đọc chuỗi kích thước tự do thành số: `40x30x20`, `37x30x9.5`, `28x42` (hai số), `15x10.7`. Chuỗi không đọc được thì box đó không hiện trong lưới chọn, nhưng phải liệt kê ra đâu đó cho người ta sửa.
- Cách lọc dòng `VTĐG1` nào là box, dòng nào không (`Giấy Nến Trắng 160x60`, tag, decal). Gợi ý: lọc theo số chiều đọc được cộng một công tắc ẩn/hiện trong SMS, chứ đừng chép cứng danh sách tên.
- Dòng kho trùng nhau: mỗi loại box có nhiều dòng `VTĐG1` (mỗi lô nhập một dòng). Danh mục box phải gom về một dòng cho mỗi loại.
- Cân có cần cảnh báo khi lệch xa cân dự kiến không.
- Thứ tự box trong lưới (hay dùng đứng trước, hay xếp theo tên).
- Dropdown cũ bỏ hẳn hay giữ làm đường lùi khi lưới không có box cần tìm.
