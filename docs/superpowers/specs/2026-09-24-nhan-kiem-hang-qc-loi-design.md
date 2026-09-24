# Nhận & Kiểm hàng: tìm theo đơn chưa fulfill, QC có ảnh + thuộc tính, bắt lỗi trả brand

**Ngày:** 2026-09-24 · **Người chốt:** CEO Lê Minh Tiệp

## 1. Mục tiêu

Dựng lại luồng nhận và kiểm hàng ở `/f/warehouse/nhan-kcs` cho khớp cách kho thực sự làm việc:

1. Ô tìm kiếm gợi ý được **món của đơn chưa fulfill** (mã đơn, SKU, tên sản phẩm, hoặc quét mã sản phẩm).
2. Hàng về thì chỉ ghi **"đang kiểm"** — chưa vào tồn. **QC đạt mới nhập kho.**
3. Khi QC, người kiểm xem được **ảnh to** và **thuộc tính sản phẩm** để soi.
4. QC **không đạt** thì chụp **nhiều chỗ lỗi**, chọn **lý do**, rồi **in biên bản** gửi lại brand.

## 2. Quyết định đã chốt trong lúc bàn

- **D-A. Không có danh sách "Chờ về" dựng sẵn.** Mọi việc đi qua ô tìm kiếm. (CEO 24/09)
- **D-B. Ảnh và thuộc tính lấy TRỰC TIẾP từ Shopify lúc QC, KHÔNG lưu lại.** Mục tiêu của CEO là không tốn thêm storage và không nhân bản dữ liệu. (CEO 24/09)
- **D-C. Ghi vào ĐÚNG sổ chiếc hàng mà phân bổ đang đọc (`goods_receipt_items`), không tạo sổ thứ hai.**
  CEO ban đầu đề nghị bỏ luồng cũ `/f/warehouse/receiving` vì tưởng nó chỉ là bản sao dữ liệu Lark. Đo thật cho thấy tiền đề đó sai: bảng có 833 chiếc, **285 chiếc đã cấp cho đơn**, cập nhật gần nhất **17/09/2026**, và `features/warehouse/allocate.ts` / `release.ts` / `features/fulfillment/queries.ts` đang đọc nó để cấp hàng cho đơn khách. Mối nối chiếc-hàng ↔ dòng-đơn KHÔNG nằm trên Lark nên không lấy lại được. CEO đồng ý đi hướng này.
- **D-D. Màn cũ `/f/warehouse/receiving` GIỮ NGUYÊN trong vòng này.** Gỡ khi màn mới đã chạy thật và không còn ai ghi vào nó.

## 3. Dữ liệu — đo thật ngày 24/09/2026

| Đo | Kết quả |
|---|---|
| Đơn chưa fulfill | 672 `UNFULFILLED` + 116 `PARTIALLY_FULFILLED` |
| `shopify_order_lines` | 15.836 dòng · **sku 15.705 (99%)** · variant_id **199 (1,3%)** · product_id **199 (1,3%)** |
| ID lấy từ `order.lineItems[].variant.id` / `.product.id` trên Shopify | **đủ 100%** trên mẫu, chi phí 5 điểm, ~600ms |
| Thuộc tính đọc được mỗi sản phẩm | **26–34** (chất liệu, cổ, khoá, dáng, tay, cạp, độ dài, phụ kiện kèm, số đo mẫu) |
| Ảnh | ảnh **đúng biến thể màu khách đặt** + 5–8 ảnh sản phẩm |
| Metafield khác nhau trên 10 sản phẩm | **58** — phần lớn là rác app |
| `order.special_features` | 52% đơn, 1–14 mục, trung bình 3,9 — **gộp cả đơn, không tách theo món** |
| `goods_receipt_items.qc_fail_photo_key` | **0 dòng** — chưa dùng lần nào |
| `qc_fail_reason` | chữ tự do, 83 món `pass` lại có lý do fail |

**Cạm bẫy đã đo, phải xử trong code:** `lark_mon_don.order_number` lưu `MBLVD26763` còn `shopify_orders.shopify_order_number` lưu `#MBLVD2009`. Ghép thẳng ra 597/7.150; chuẩn hoá bỏ `#` ra 6.168 (86%). Nơi nào nối hai bảng này mà quên chuẩn hoá sẽ trả gần như rỗng **mà không có lỗi nào báo**.

## 4. Vòng đời một chiếc hàng

```
        (chưa có gì)
             │  kho tìm thấy món trong ô search, bấm "Đã về"
             ▼
     qc_result = 'pending'          ← ĐANG KIỂM. Chưa vào tồn.
     disposition = 'pending'           Phân bổ KHÔNG nhìn thấy.
             │
      ┌──────┴───────┐
      │              │
  QC đạt          QC không đạt
      │              │
      ▼              ▼
 qc_result='pass'   qc_result='fail'
 disposition =      disposition='return_to_brand'
   'store' hoặc     + ≥1 dòng lỗi (ảnh + lý do)
   'allocate_to_order'      │
      │                     ▼
      ▼                in biên bản gửi brand
  VÀO TỒN — applyMovement
  phân bổ nhìn thấy
```

Ba trạng thái này **đã có sẵn**: enum `qc_result` (`pending|pass|fail`) và `receipt_item_disposition` (`pending|allocate_to_order|store|return_to_brand`). Không thêm enum trạng thái mới.

**Bất biến:** chiếc ở `qc_result='pending'` KHÔNG được xuất hiện trong bất kỳ truy vấn phân bổ nào. Phải có test canh.

## 5. Ô tìm kiếm

**Nguồn:** dòng của đơn Shopify đang `UNFULFILLED` hoặc `PARTIALLY_FULFILLED`, trừ những dòng đã có chiếc hàng ghi nhận.

**Khớp theo** (gõ tối thiểu 2 ký tự, debounce 250ms):
- mã đơn (chuẩn hoá bỏ `#` cả hai phía)
- SKU
- tên sản phẩm — **không phân biệt dấu**, dùng lại `boDauTiengViet` và cột sinh `shopify_variants.tim_kiem` (D-105)
- **ID sản phẩm / biến thể** dạng số — thứ tem `V:` in ra (D-106)

**Kết quả** mỗi dòng: mã đơn · SKU · tên sản phẩm + biến thể · brand · số lượng đặt · số chiếc đã ghi nhận. Bấm một dòng là ghi nhận một chiếc ở trạng thái `pending`.

**Quét** đi qua `giaiMaQuetTaoDon` sẵn có: tem `V:` ra biến thể, tem `O:` mở đơn. Mã lạ thì **nói rõ không nhận diện được**, không đoán.

## 6. Màn QC

Danh sách "Đang kiểm" — các chiếc `qc_result='pending'`, mới nhất trước. Bấm một chiếc mở **modal toàn màn hình**:

- **Trái — ảnh:** cao gần hết chiều cao màn hình, mũi tên trái/phải đổi ảnh, phím `←`/`→` cũng đổi. Ảnh đầu tiên là **ảnh của đúng biến thể** (màu khách đặt), sau đó tới ảnh sản phẩm. Bấm ảnh để phóng to hơn nữa.
- **Phải — thuộc tính:** danh sách nhãn/giá trị để soi khi kiểm. Trên cùng là SKU, tên, màu, size. Dưới là thuộc tính từ Shopify.
- **Băng cấp đơn:** `order.special_features` nếu có, ghi rõ nhãn **"Đặc điểm của cả đơn"** — vì nó gộp chung, không tách theo món (đơn `#MBLVD30517` có 6 sản phẩm / 10 đặc điểm trộn lẫn).
- **Dưới cùng:** hai nút **Đạt** / **Không đạt**.

### 6.1 Truy vấn Shopify (một lần cho một đơn)

```graphql
{ order(id: $orderId) {
    name
    specialFeatures: metafield(namespace: "order", key: "special_features") { value }
    lineItems(first: 50) { nodes {
      sku name quantity
      variant { id title image { url } selectedOptions { name value } }
      product { id title
        images(first: 8) { nodes { url } }
        metafields(first: 50) { nodes {
          namespace key value
          reference { ... on Metaobject { displayName } }
          references(first: 10) { nodes { ... on Metaobject { displayName } } } } } } } } } }
```

### 6.2 Luật lọc thuộc tính — DANH SÁCH CHO PHÉP, không phải danh sách chặn

Đo thật: 10 sản phẩm trả về **58 metafield khác nhau**, phần lớn là rác app — widget đánh giá judge.me dạng HTML dài hàng nghìn ký tự, `bcpo_data` JSON, badge, `swym_wishlist`, `mm-google-shopping`, `mc-facebook`, `theme.*`.

**Bản đầu của thiết kế đề xuất "chặn namespace app, namespace lạ thì hiện lên" — SAI, đã sửa.** Làm vậy sẽ đổ HTML review vào màn QC ngay khi app cài thêm cái mới.

Luật đúng:

1. **Chỉ nhận namespace `custom` và `shopify`.** Mọi namespace khác bỏ.
2. Trong hai namespace đó, **loại trừ khoá không phục vụ kiểm hàng**: `return_refund_policy_v2`, `seasonal`, `suggested_item`, `product_return_refund_policy`.
3. **Giá trị tham chiếu metaobject** phải quy về chữ đọc được qua `displayName` (`reference` cho một, `references` cho danh sách). Còn là `gid://` thì **bỏ**, không hiện mã cho người kiểm.
4. **Bỏ giá trị dài quá 200 ký tự** — không phải thuộc tính, là blob.
5. **Gộp hai thế hệ.** Shopify của MEAN đang có cả `custom.fitting_type` (8/10 sản phẩm) lẫn `custom.fitting_type_v2` (9/10), `custom.neck_style` (7/10) lẫn `custom.neckline_type_v2` (8/10). Gộp theo thuộc tính logic, **ưu tiên `_v2` khi có giá trị**, nếu không thì lấy bản cũ. Không gộp thì màn QC hiện trùng hoặc hiện ô trống.
6. **Không im lặng giấu hết.** Sau danh sách hiển thị, ghi một dòng `"còn N thuộc tính khác không hiển thị"` — để người sửa sau biết bộ lọc đang cắt bao nhiêu, mà vẫn không đổ rác ra màn hình.

### 6.3 Hỏng thì vẫn chạy

Shopify lỗi, chậm, hết hạn token, hay đơn không tra được → **modal vẫn mở, vẫn bấm Đạt/Không đạt được**, chỉ mất ảnh và thuộc tính, kèm một dòng nói rõ vì sao. **Tuyệt đối không chặn kho làm việc.** Đo thật: 444–615ms mỗi lượt, chi phí 5–45 điểm trên hạn mức 20.000 với tốc độ hồi 1.000/giây — không có rủi ro chạm trần.

## 7. Bắt lỗi khi QC không đạt

Bấm **Không đạt** mở khối nhập lỗi. **Một chiếc có thể có nhiều chỗ lỗi.**

### 7.1 Bảng mới `wh_loi_qc`

| Cột | Kiểu | Ghi chú |
|---|---|---|
| `id` | uuid pk | |
| `receipt_item_id` | uuid → `goods_receipt_items.id` on delete cascade | |
| `ly_do` | enum `qc_ly_do_loi` | bắt buộc |
| `anh_key` | text | khoá S3, có thể null (lỗi mô tả được bằng chữ) |
| `ghi_chu` | text | tuỳ chọn |
| `tao_luc` | timestamp not null default now | |
| `tao_boi` | text not null | |

Index: `(receipt_item_id)`.

**Vì sao bảng riêng chứ không thêm cột:** `goods_receipt_items` chỉ có một ô `qc_fail_photo_key`, mà một chiếc váy bẩn gấu VÀ rách nách VÀ hỏng khoá là ba chỗ lỗi, mỗi chỗ một ảnh. Nhồi vào một ô là mất bằng chứng khi cãi nhau với brand.

`qc_fail_photo_key` cũ **giữ nguyên, không dùng nữa** (0 dòng, chưa ai dùng). `qc_fail_reason` cũ giữ nguyên cho 100 dòng lịch sử.

### 7.2 Enum `qc_ly_do_loi`

Rút từ chính lý do đội kho đã gõ tay trong `goods_receipt_items`:

`ban` (bẩn) · `rach` (rách) · `loi_vai` (lỗi vải) · `xuoc_vai` (xước vải) · `hong_khoa` (hỏng khoá kéo) · `thieu_phu_kien` (thiếu đá đính / phụ kiện) · `co_mui` (có mùi) · `sai_mau` (sai màu) · `sai_size` (sai size) · `loi_duong_may` (lỗi đường may) · `o_loang_mau` (ố / loang màu) · `khac` (khác — **bắt buộc điền ghi chú**)

Lý do chọn từ danh sách chứ không gõ tay: hiện tại không gom nhóm được, không thống kê được brand nào hay lỗi gì. Ô ghi chú vẫn còn cho chi tiết.

### 7.3 Ảnh lỗi

Dùng `lib/storage/s3.ts` sẵn có: `putObject` khi tải lên, `getSignedDownloadUrl` khi xem — đúng khuôn `signed()` trong `features/receiving/queries.ts`. Khoá đặt theo `qc-loi/{receipt_item_id}/{uuid}.{ext}`.

Kho chưa cấu hình storage (`isStorageConfigured()` false) → vẫn ghi được lỗi + lý do, chỉ không đính ảnh, và **nói rõ** chứ không im lặng nuốt ảnh.

## 8. Biên bản trả brand

Màn `/f/warehouse/nhan-kcs/bien-ban`: chọn brand + khoảng ngày → liệt kê mọi chiếc `qc_result='fail'` và `disposition='return_to_brand'` chưa nằm trong biên bản nào.

Bản in gồm: tên brand, ngày lập, người lập, và mỗi chiếc một khối — mã chiếc, SKU, tên sản phẩm + biến thể, mã đơn, danh sách chỗ lỗi (lý do + ghi chú) kèm ảnh.

In bằng `window.print()` với CSS in riêng — cùng cách màn in tem đang làm, không thêm thư viện PDF.

Chiếc đã vào biên bản thì ghi `vendor_return_doc_key` (cột **đã có sẵn**) để không lập trùng.

## 9. Ngoài phạm vi vòng này

- **Không** xoá `/f/warehouse/receiving` (xem D-D).
- **Không** vá bộ đồng bộ để điền `shopify_product_id`/`shopify_variant_id` trên `shopify_order_lines` (199/15.836). Là lỗi thật và hợp hướng D-106, nhưng đụng luồng đồng bộ đơn đang chạy — tách việc riêng.
- **Không** lưu ảnh hay thuộc tính Shopify về database (D-B).
- **Không** đụng `applyMovement` ngoài việc gọi nó khi QC đạt.
- **Không** bật ghi Lark. `WH_GHI_LARK` giữ `dry`, `day-nhan-kcs-lark` giữ trong nhóm `chua-bat`.

## 10. Kiểm thử

**Hàm thuần, có test:**
- Lọc thuộc tính: cho một mảng metafield thô (gồm HTML judge.me, JSON bcpo, gid chưa quy đổi, cặp `_v2`/bản cũ) → ra đúng danh sách hiển thị + đếm đúng số bị cắt.
- Chuẩn hoá mã đơn: `MBLVD26763` và `#MBLVD26763` phải khớp nhau; có test canh vì đây là cạm bẫy đã đo.
- Luật chuyển trạng thái: `pending → pass` cho vào tồn; `pending → fail` không; `fail` bắt buộc ≥1 dòng lỗi; `khac` bắt buộc ghi chú.

**Test tích hợp:**
- Chiếc `pending` **không** xuất hiện trong truy vấn phân bổ. Đây là bất biến đắt nhất của thiết kế — hỏng nó là bán hàng chưa kiểm.
- QC đạt → đúng một `inventory_movements` được ghi, không nhân đôi khi bấm hai lần.
