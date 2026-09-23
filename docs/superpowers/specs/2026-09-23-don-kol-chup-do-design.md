# Luồng đơn KOL và chụp đồ trên SMS: không lên Shopify, gửi được cả nội địa lẫn quốc tế

**Ngày:** 2026-09-23 · **Trạng thái:** thiết kế, chờ CEO soát · **Liên quan:** `features/ship-ho/` (luồng đơn phi-Shopify duy nhất đang chạy thật, dùng làm khuôn), `features/warehouse/ledger.ts` (cổng duy nhất thay đổi tồn kho), D-089 (đơn nội bộ rời KPI logistics)

## 1. Vấn đề

Hàng gửi KOL và hàng phục vụ chụp đồ hiện được **tự tạo đơn trên Shopify của MEAN**. Hậu quả: số đơn, doanh số và tồn kho trên Shopify lẫn hàng không bán. Mọi báo cáo dựng trên Shopify đều bị nhiễu, và không có cách nào lọc ra vì đơn nội bộ trông y hệt đơn khách.

Các đơn này có hai đặc điểm mà luồng bán hàng không phục vụ được:

- **Có cả nội địa lẫn quốc tế.** Hàng gửi KOL trong nước đi hãng nội địa, hàng gửi KOL nước ngoài đi hãng quốc tế.
- **Có hàng cho mượn.** KOL mượn đồ chụp rồi trả, khác hẳn hàng tặng luôn. Hiện không ai theo dõi được món nào chưa về.

CEO 23/09/2026: tách hẳn một luồng riêng để đỡ lẫn số liệu trên Shopify của MEAN.

## 2. Quyết định (CEO chốt 23/09/2026)

1. **Gửi hàng bằng cách gõ tay tên hãng và mã vận đơn**, cả nội địa lẫn quốc tế. Không tích hợp API hãng, không báo giá cước ở đợt này.
2. **Có trừ tồn kho** như đơn bán.
3. **Có theo dõi hàng mượn**: ngày hẹn trả, danh sách quá hạn, nhận lại thì cộng tồn.
4. **Có ghi nhận chi phí** theo giá vốn.
5. **Có sổ KOL dùng lại**, không gõ tay người nhận từng đơn.
6. **Màn riêng**, không sửa quy trình kho đang chạy.

## 3. Ranh giới

Luồng này chạm vào đúng **một** thứ dùng chung: sổ cái tồn kho, qua đúng cổng `applyMovement` (`features/warehouse/ledger.ts`).

Tuyệt đối **không** chạm vào:

| Không đụng | Vì sao |
|---|---|
| Shopify | Mục tiêu gốc: không để đơn nội bộ lẫn vào số liệu bán hàng |
| MMP | Sự kiện sang MMP đều gọi tay từng chỗ (`emitShipHoEvent`), không có móc tự động. Đơn KOL không được lọt vào hoá đơn đối tác |
| KPI logistics | Theo tinh thần D-089, đơn nội bộ rời mọi chỗ chấm điểm, nếu không đội logistics bị chấm trên việc không phải của mình |
| Màn Đóng hàng, màn Nhận & kiểm hàng | Đang chạy thật, vừa qua một đợt sửa dài |
| Engine báo giá cước, bảng cước, đối soát hoá đơn hãng | CEO chốt gõ tay |

## 4. Dữ liệu

Bốn bảng mới, feature ở `features/kol/`. Bám khuôn `shipHoOrders` (bảng độc lập, không dẫn xuất từ `shopifyOrders`, địa chỉ là các cột phẳng, ảnh chụp giá trị bất biến tại thời điểm chốt), khác ở hai chỗ: đơn KOL **có dòng hàng** và **có trừ tồn**.

### 4.1 `kol_nguoi_nhan` — sổ KOL

| Cột | Kiểu | Ghi chú |
|---|---|---|
| `id` | uuid PK | |
| `ten` | text NOT NULL | |
| `kenh` | text | tên kênh, ví dụ handle Instagram/TikTok |
| `dien_thoai` | text | |
| `email` | text | |
| `quoc_gia` | text NOT NULL default `'VN'` | mã nước 2 ký tự |
| `dia_chi` | text | địa chỉ mặc định, một ô nhiều dòng |
| `thanh_pho` | text | |
| `ghi_chu` | text | |
| `ngung_dung` | boolean NOT NULL default false | ẩn khỏi ô chọn mà không xoá lịch sử |
| `tao_luc`, `tao_boi`, `sua_luc`, `sua_boi` | | |

Index: `kol_nguoi_nhan_ten_idx` trên `ten`.

### 4.2 `kol_don` — đơn

| Cột | Kiểu | Ghi chú |
|---|---|---|
| `id` | uuid PK | |
| `ma` | text NOT NULL UNIQUE | sinh từ sequence `kol_don_seq`, dạng `KOL-YYMM-NNNN`. Sequence chạy liên tục, **không reset theo tháng**: đơn cuối tháng 9 là `KOL-2609-0007` thì đơn đầu tháng 10 là `KOL-2610-0008`. Cố ý, để mã không bao giờ trùng |
| `nguoi_nhan_id` | uuid NOT NULL → `kol_nguoi_nhan.id` | |
| `muc_dich` | enum `kol_muc_dich` NOT NULL | `'kol'` \| `'chup_do'` \| `'khac'` |
| `trang_thai` | enum `kol_don_trang_thai` NOT NULL default `'nhap'` | xem §5 |
| `ten_nhan`, `dien_thoai_nhan`, `quoc_gia`, `thanh_pho`, `dia_chi` | text | **ảnh chụp** từ sổ lúc tạo đơn; sửa sổ về sau không đổi đơn cũ |
| `hang_van_chuyen` | text | gõ tay, ví dụ `GHTK`, `Viettel Post`, `FedEx` |
| `ma_van_don` | text | gõ tay |
| `gui_luc` | timestamp | đặt khi chuyển sang `da_gui` |
| `da_nhan_luc` | timestamp | bấm tay khi KOL báo đã nhận; không có theo dõi tự động |
| `ghi_chu` | text | |
| `tao_luc`, `tao_boi`, `sua_luc`, `sua_boi` | | |

Index: `kol_don_trang_thai_idx` trên `(trang_thai, tao_luc)`, `kol_don_nguoi_nhan_idx` trên `nguoi_nhan_id`.

**Nội địa hay quốc tế là suy ra, không lưu cột riêng:** `quoc_gia = 'VN'` là nội địa, khác là quốc tế. Một nguồn sự thật, không có cách nào lệch nhau.

### 4.3 `kol_dong_don` — dòng hàng

| Cột | Kiểu | Ghi chú |
|---|---|---|
| `id` | uuid PK | |
| `don_id` | uuid NOT NULL → `kol_don.id` ON DELETE CASCADE | |
| `sku` | text NOT NULL | |
| `ten_hang` | text | ảnh chụp tên lúc tạo, để đơn cũ vẫn đọc được khi sản phẩm đổi tên |
| `kho` | text NOT NULL | `'GVM'` \| `'AP'` \| `'DM'`, khớp `warehouse_inventory.warehouse_code` |
| `so_luong` | integer NOT NULL CHECK > 0 | |
| `hinh_thuc` | enum `kol_hinh_thuc` NOT NULL | `'tang'` \| `'muon'` |
| `han_tra` | date | bắt buộc khi `hinh_thuc = 'muon'`, NULL khi `'tang'` |
| `gia_von` | numeric(14,4) | sửa được khi đơn còn `nhap` hoặc `da_chot`; **đông cứng khi chuyển sang `da_gui`** — trừ ngoại lệ **điền một lần** cho ô còn TRỐNG (§7.2); NULL nếu chưa có giá |
| `gia_von_tien_te` | text | `'VND'` hoặc `'USD'`, đi kèm `gia_von` |
| `gia_von_nguon` | text | `'sku_costs'` khi hệ thống điền, `'tay'` khi người dùng gõ |
| `so_luong_da_tra` | integer NOT NULL default 0 | cộng dồn từ `kol_tra_ve` |
| `so_luong_nhap_lai` | integer NOT NULL default 0 | phần đã trả VÀ nhập lại kho |

Index: `kol_dong_don_don_idx` trên `don_id`, `kol_dong_don_muon_idx` trên `(hinh_thuc, han_tra)` phục vụ màn Đang mượn.

CHECK: `so_luong_da_tra <= so_luong`, `so_luong_nhap_lai <= so_luong_da_tra`.

### 4.4 `kol_tra_ve` — lần trả về

| Cột | Kiểu | Ghi chú |
|---|---|---|
| `id` | uuid PK | |
| `dong_don_id` | uuid NOT NULL → `kol_dong_don.id` | |
| `so_luong` | integer NOT NULL CHECK > 0 | |
| `nhap_lai_kho` | boolean NOT NULL | true thì cộng tồn, false thì không |
| `ly_do_khong_nhap` | text | bắt buộc khi `nhap_lai_kho = false` |
| `tra_luc` | timestamp NOT NULL default now | |
| `ghi_chu` | text | |
| `tao_boi` | text NOT NULL | |

Index: `kol_tra_ve_dong_idx` trên `dong_don_id`.

## 5. Trạng thái và tồn kho

Bốn trạng thái. Tồn kho đổi ở đúng hai bước.

```
nhap ──chốt──> da_chot ──gửi──> da_gui
  │               │
  └──huỷ──────────┴──huỷ──> huy
```

| Chuyển | Tồn kho | Lý do `inventory_movements` |
|---|---|---|
| tạo đơn → `nhap` | không đụng | — |
| `nhap` → `da_chot` | giữ chỗ: `deltaReserved +sl` | `auto_allocate` |
| `da_chot` → `da_gui` | xuất thật: `deltaOnHand -sl`, `deltaReserved -sl` | `pick` |
| `nhap` → `huy` | không đụng | — |
| `da_chot` → `huy` | trả chỗ: `deltaReserved -sl` | `release_allocation` |
| nhận trả về, nhập lại kho | `deltaOnHand +sl` | `receipt_return` |
| nhận trả về, không nhập lại | không đụng | — |

**Đơn `da_gui` không huỷ được.** Hàng đã đi rồi thì đường về là hàng trả, không phải huỷ đơn.

**Sửa dòng hàng chỉ khi đơn còn `nhap`.** Từ `da_chot` trở đi, thêm bớt dòng hoặc đổi số lượng sẽ làm lệch phần tồn đã giữ chỗ. Muốn sửa thì huỷ về `nhap`, hệ thống trả lại chỗ đã giữ, rồi chốt lại. Riêng `gia_von` vẫn sửa được ở `da_chot` vì nó không dính tới tồn.

**Dùng lại lý do sẵn có, KHÔNG thêm giá trị enum mới.** `validateMovement` (`features/warehouse/allocation-logic.ts`) chỉ xét delta và bất biến, hoàn toàn không phân biệt lý do, nên bốn lý do trên mang đúng nghĩa cho cả đơn bán lẫn đơn KOL. Phân biệt bằng `refType = 'kol_dong_don'` và `refId = kol_dong_don.id`, đúng mục đích hai cột đó sinh ra. Tránh được migration `ALTER TYPE ... ADD VALUE` vốn không chạy chung transaction với chỗ dùng nó.

Cần thêm index cho việc lọc: `inventory_movements_ref_idx` trên `(ref_type, ref_id)`. Hiện chỉ có index trên `warehouse_inventory_id` và `reason`.

**Không gửi được hàng không có tồn.** `warehouse_inventory` có CHECK cứng `qty_on_hand >= 0` và `qty_reserved <= qty_on_hand`. Chốt đơn mà không đủ tồn thì `applyMovement` ném lỗi, màn hình phải hiện đúng mã hàng nào thiếu và thiếu bao nhiêu, chứ không nuốt lỗi. Đo 23/09/2026: kho có 705 mã hàng, 696 mã còn tồn. Hàng mẫu về rồi đi ngay thì phải nhận vào kho trước.

## 6. Hàng mượn và trả về

**Đánh dấu tặng hay mượn ở TỪNG DÒNG, không phải cả đơn.** Một đơn gửi KOL có thể gồm hai váy mượn chụp và một hộp son tặng luôn.

Dòng `muon` bắt buộc có `han_tra`. Dòng `tang` không có.

**Màn Đang mượn** liệt kê mọi dòng `muon` **của đơn `da_gui`** còn `so_luong_da_tra < so_luong`, quá hạn xếp trên cùng kèm số ngày trễ và tên KOL.

> **Sửa 23/09/2026.** Điều kiện `trang_thai = 'da_gui'` là BẮT BUỘC, không phải trang trí. Đơn nháp / đã chốt chưa hề rời kho, đơn đã huỷ thì đã trả lại chỗ tồn — cả ba vẫn giữ `so_luong_da_tra = 0` mãi mãi, nên nếu không lọc thì cùng một số lượng vừa nằm trong kho vừa được báo là "còn nợ, đã trễ" ở nhà KOL. Và dòng ma đó **không bao giờ dọn được**, vì `nhanTraVe` (đúng đắn) chỉ nhận đơn `da_gui` nên bộ đếm đã trả không thể tăng. Áp cùng điều kiện cho khối "đang giữ hàng" trong hồ sơ sổ KOL.

**Không có nhắc tự động ở đợt này.** Nhắc KOL là việc của người làm marketing. Hệ thống không tự gửi thư cho người ngoài khi chưa ai duyệt nội dung.

**Khi nhận lại phải chọn hàng còn dùng được hay không.** Hàng cho mượn đi chụp về thường không còn nguyên. Nếu cứ nhận là cộng tồn thì một cái váy hỏng nằm trong kho như hàng bán được, rồi có ngày đi thẳng vào đơn của khách thật.

- `nhap_lai_kho = true` → cộng tồn, bán tiếp được.
- `nhap_lai_kho = false` → không cộng tồn, bắt buộc ghi lý do. Món đó coi như đã tiêu.

**Trả từng phần được.** Gửi 3, về 2, dòng đó vẫn nằm ở danh sách đang mượn với số còn thiếu là 1.

**Chỉ dòng `muon` mới nhận trả về.** Dòng `tang` không có đường trả, vì đã tặng thì không đòi. Nếu thực tế KOL gửi lại hàng tặng thì nhập vào kho bằng luồng nhận hàng thường, không đi qua màn này. Cố ý giữ hẹp để số liệu chi phí không bị sửa ngược sau khi đã chốt.

## 7. Chi phí marketing

### 7.1 Thực trạng giá vốn (đo 23/09/2026)

| | Số lượng |
|---|---|
| Mã hàng trong `warehouse_inventory` | 705 |
| Trong đó có dòng trong `sku_costs` | 166 (23,5 %) |
| Dòng `sku_costs` tiền `VND` | 4.105 |
| Dòng `sku_costs` tiền `USD` | 10 |
| `effective_from` mới nhất | 2026-07-31 |

Chỉ dựa vào `sku_costs` thì báo cáo trống ba phần tư. Nên:

**Hệ thống điền sẵn nếu có, người dùng gõ tay nếu chưa có, báo cáo nói thẳng bao nhiêu dòng chưa có giá.** Không đoán, không để trống lặng lẽ.

Nguồn điền sẵn: dòng `sku_costs` của mã hàng đó có `effective_from` lớn nhất mà `<= ngày gửi`. Ghi `gia_von_nguon = 'sku_costs'`. Người dùng sửa thì thành `'tay'`.

### 7.2 Chốt cứng tại lúc gửi

`gia_von` ghi vào dòng đơn **khi chuyển sang `da_gui`**, không tra lại về sau. Giống cách `shipHoOrders` chốt `quoteBreakdown` tại thời điểm báo giá. Lý do: giá vốn đổi theo tháng, tra động thì báo cáo tháng trước tự đổi số mỗi lần mở ra xem.

#### Ngoại lệ: ĐIỀN MỘT LẦN cho ô còn trống (thêm 23/09/2026)

Lúc gửi, giá vốn **cố ý để `NULL`** khi không phân giải được cửa hàng của mã hàng (xem §7.1 và `storeCuaSku`) — thà để trống còn hơn đóng băng giá của một brand khác. Đo 23/09/2026: **110 trên 2.911** mã có giá vốn rơi vào diện này.

Nếu "đông cứng" hiểu theo đúng trạng thái đơn thì những dòng ấy **vô giá vĩnh viễn**: không màn nào mở ô nhập, action cũng chặn lại, nên tiền của chúng không bao giờ vào chi phí marketing — đúng thứ mà action sửa giá vốn sinh ra để tránh.

Luật chính xác, phân biệt **ĐIỀN** với **ĐỔI**:

| Trạng thái đơn | Ô giá vốn đang trống | Ô giá vốn đã có số |
|---|---|---|
| `nhap`, `da_chot` | Ghi được | Ghi được (sửa tự do) |
| `da_gui` | **Ghi được — điền một lần** | **KHÔNG**, đã đông cứng |
| `huy` | Không | Không |

Hệ quả: mọi con số **thật sự** đã được đông cứng lúc gửi thì không ai đổi được nữa — báo cáo tháng cũ vẫn không tự đổi số. Chỉ những dòng **chưa từng có số nào** mới còn đường điền.

Thể hiện bằng một luật thuần RIÊNG, `ghiGiaVonDuoc(trangThai, giaVonHienTai)` trong `features/kol/trang-thai.ts`, **không nới lỏng** `suaGiaVonDuoc(trangThai)` — luật cũ vẫn nói nguyên văn "đã gửi thì không sửa được giá" và vẫn đúng như vậy. Server action `suaGiaVon` đọc lại giá hiện tại **sau khi đã khoá đơn** rồi mới xét luật này, nên không có khe hở với `danhDauDaGui`.

### 7.3 Luật tính

Chi phí = giá vốn của hàng **không quay lại kho bán được**.

| Trường hợp | Tính chi phí |
|---|---|
| `hinh_thuc = 'tang'` | Có, toàn bộ số lượng |
| `'muon'`, đã trả và nhập lại kho | Không, phần `so_luong_nhap_lai` |
| `'muon'`, đã trả nhưng không nhập lại | Có, phần `so_luong_da_tra - so_luong_nhap_lai` |
| `'muon'`, chưa trả | **Cột riêng "đang treo ở KOL"**, không trộn vào chi phí đã tiêu |

Công thức cho một dòng:

- `daTieu = so_luong_da_tra - so_luong_nhap_lai` khi `hinh_thuc = 'muon'`; `= so_luong` khi `'tang'`
- `dangTreo = so_luong - so_luong_da_tra` khi `hinh_thuc = 'muon'`; `= 0` khi `'tang'`
- `chiPhi = daTieu × gia_von`, bỏ qua dòng `gia_von IS NULL` và **đếm riêng số dòng bị bỏ qua**

> **Sửa 23/09/2026 (CEO chốt).** Bản đầu viết `daTieu = so_luong - so_luong_nhap_lai`, mâu thuẫn với chính cái bảng ngay trên: nó gộp cả phần CHƯA TRẢ vào chi phí, nên `daTieu` luôn bao trùm `dangTreo` và một dòng mượn chưa trả gì bị tính chi phí NGUYÊN số lượng ngay lúc gửi. Ví dụ gửi 3, trả 2, nhập lại 2, còn 1 chưa về: công thức cũ ra chi phí 1 món, trong khi chưa món nào thật sự mất.
> Luật đúng: **chỉ tính chi phí khi đã biết kết cục.** Hàng chưa trả vẫn có thể về nguyên nên chưa phải tiền đã tiêu, nó nằm ở cột "đang treo". Đánh đổi CEO đã biết và chấp nhận: con số tháng thấp hơn thực tế cho tới khi KOL trả xong, và hàng mất hẳn sẽ nằm mãi ở cột đang treo nếu không ai chốt. Cột "đang treo" chính là chỗ để nhìn ra việc phải đi đòi.

Báo cáo xem theo tháng (`gui_luc`), theo KOL, theo `muc_dich`.

**Gom theo KOL khoá trên `nguoi_nhan_id`, không trên tên** (sửa 23/09/2026). `ten_nhan` trên đơn là ảnh chụp lúc tạo — giữ nguyên có chủ đích để đơn cũ đọc đúng lịch sử — còn sổ KOL không có ràng buộc duy nhất trên tên và cho sửa tên bất cứ lúc nào. Gom theo chuỗi tên hỏng cả hai chiều mà không có gì báo: hai người trùng tên nhập làm một dòng, một người đổi tên tách thành hai dòng nửa vời. Nhãn hiển thị vẫn lấy **tên hiện tại** trong sổ để người đọc thấy đúng người họ biết hôm nay.

### 7.4 Tiền tệ

`gia_von_tien_te` lưu kèm số. Báo cáo quy về VND dùng tỷ giá tháng sẵn có trong hệ thống giá vốn (D-055 báo cáo VND). Dòng `USD` chỉ có 10 trên tổng 4.115 nên đây là đuôi nhỏ, nhưng vẫn phải xử đúng chứ không cộng thẳng hai loại tiền.

## 8. Màn hình

| Đường dẫn | Việc |
|---|---|
| `/f/kol` | Danh sách đơn, lọc theo trạng thái / người nhận / nội địa hay quốc tế |
| `/f/kol/moi` | Tạo đơn: chọn người nhận từ sổ, chọn mã hàng và số lượng, đánh dấu tặng hay mượn từng dòng |
| `/f/kol/[ma]` | Chi tiết: chốt đơn, gõ hãng và mã vận đơn, đánh dấu đã gửi, nhận hàng trả về |
| `/f/kol/nguoi-nhan` | Sổ KOL: hồ sơ, lịch sử đơn, món đang giữ chưa trả |
| `/f/kol/dang-muon` | Mọi dòng chưa trả, quá hạn trên cùng |

Tất cả nằm dưới một mục menu riêng.

## 9. Quyền

Nhóm quyền mới `kol` với ba mức `view` / `create` / `edit`, khai trong `CATALOG` của `lib/auth/permissions.ts`.

**Mỗi thao tác ghi dữ liệu tự kiểm quyền lại một lần**, không tin màn hình đã kiểm hộ. Theo đúng nếp `requireManageShipHo()` (`features/ship-ho/require-manage.ts`), với lý do được ghi sẵn ở đó: các thao tác gọi được độc lập với màn hình.

## 10. Kiểm thử

**Thuần (có test):**

- Luật chuyển trạng thái: chuyển hợp lệ, chuyển không hợp lệ (ví dụ `da_gui` → `huy` phải bị chặn).
- Luật tính chi phí, đủ bốn ca ở §7.3, kể cả ca `gia_von IS NULL` phải bị đếm riêng chứ không tính là 0.
- Tính quá hạn: chưa tới hạn, đúng hạn, quá hạn, đã trả đủ.
- Luật trả từng phần: trả thiếu, trả đủ, trả vượt phải bị chặn.
- Sinh mã đơn.

**Dùng lại đã có test:** `applyMovement` và `validateMovement` đã có test và có ràng buộc cứng ở cơ sở dữ liệu. Không viết lại luật tồn kho.

**Phải kiểm tay:** toàn bộ màn hình. Đăng nhập Google chặn agent, không agent nào mở được màn thật. Giống hệt tình huống ở màn Nhận & kiểm hàng.

## 11. Ngoài phạm vi

Tích hợp API hãng nội địa (GHTK, GHN, Viettel Post, J&T...) · báo giá cước qua engine sẵn có · tự tạo nhãn vận chuyển · nhắc KOL tự động qua email hay tin nhắn · đẩy dữ liệu sang MMP · gắn vào KPI logistics · đối soát hoá đơn hãng cho đơn KOL · sửa quy trình kho đang chạy.
