# Ngày đi hàng + cổng chốt kỳ ship hộ — thiết kế

**Ngày:** 03/10/2026 · **Chốt bởi:** CEO Lê Minh Tiệp

## 1. Vấn đề

Cột "Ngày gửi" của hệ thống (`ship_ho_orders.shipped_at`) là **ngày Đức gõ trên Lark**, không
phải ngày hàng rời kho. Đo trên AWB `873918787369`: FedEx quét `OC` (nhận thông tin) 03/07
05:31, `PU` (lấy hàng) 06/07 14:52, `DL` (giao) 08/07 09:51 — `shipped_at` ghi **03/07**, lệch
**3 ngày** với ngày đi thật.

Phụ phí xăng dầu tính theo **tuần của ngày đi**. Tuần 29/06–06/07 là 38,50%; tuần 06/07–13/07
là 38,25%. Hãng áp 38,25%. Ai đối chiếu theo `shipped_at` sẽ thấy lệch và báo động nhầm — đã
xảy ra thật ngày 02/10/2026.

Đo toàn bộ: **19/138 đơn** có ngày gửi lệch ngày trên hoá đơn hãng (9 đơn lệch 5 ngày, 1 đơn
lệch 14 ngày).

Và kỳ bảng kê hiện được phát hành mà **không có phép kiểm nào về ngày hay về %phụ phí** — ba
cổng hiện có chỉ kiểm: bảng kê còn nháp · mọi đơn đã chốt giá · không đơn nào lệch kỳ.

## 2. Mục tiêu

1. Ghi **ngày hãng thật sự lấy hàng** cho mọi đơn, hiện trên màn vận hành ship hộ của SMS.
2. Bảng kê gửi MMP/brand dùng **ngày đi hàng**, không dùng ngày gõ tay.
3. Chốt kỳ phải **qua một cổng rà soát**; cổng đỏ thì không tạo kỳ, không đẩy đi đâu.
4. Kỳ xanh thì đẩy sang **Google Sheet** của brand và sang **MMP** — một lượt, cùng dữ liệu.

**Không nằm trong phạm vi:** đổi `shipped_at` (mốc nghiệp vụ của mình, nhiều chỗ đang dùng);
ghi ngược lên bảng Lark của Đức (giữ nguyên một chiều Lark → SMS).

## 3. Nguồn ngày đi hàng

| Hãng | Đơn (03/10) | Nguồn | Trạng thái |
|---|---|---|---|
| FedEx | 152 | quét `PU` qua `layLichSuQuet` | đã chạy, 147 đơn có ngày |
| UPS | 5 | quét `P` **sớm nhất** qua `layLichSuQuetUps` | cần nối |
| DHL | 0 | `lib/dhl` | chưa cần, nối khi có đơn |
| **Aramex HN** | 13 | **không có API tra cứu** | dùng ngày Đức gõ |

**Aramex (CEO chốt 03/10):** không có nguồn hãng thì lấy **ngày Đức điền trên Lark**
(`shipped_at`). Đây là **ngoại lệ được khai báo**, không phải phép rơi-về im lặng: đơn Aramex
mang `nguon_ngay_di = 'lark'`, hãng khác mang `'hang'`.

**UPS — điểm chưa kiểm được:** UPS dùng mã trạng thái `P` cho cả lượt lấy hàng lẫn lượt giao
(phân biệt bằng mô tả), nên lấy sự kiện `P` **sớm nhất**. Phép kiểm đã chứng minh mốc `PU` của
FedEx là đúng — *%fuel của tuần chứa ngày đó khớp % suy từ hoá đơn, 116/116 đơn* — **chưa chạy
được cho UPS vì hệ thống chưa có hoá đơn UPS nào**. Khi hoá đơn UPS đầu tiên về, chạy lại đúng
phép kiểm đó trước khi tin.

## 4. Mô hình dữ liệu

`ship_ho_orders` (cột `picked_up_at` đã có từ migration 0195):

| Cột | Nghĩa |
|---|---|
| `shipped_at` | ngày Đức gõ trên Lark — **giữ nguyên, không đụng** |
| `picked_up_at` | mốc hãng lấy hàng, `NULL` khi chưa tra được |

**KHÔNG thêm cột `nguon_ngay_di`.** Bản nháp đầu của spec này có nó; đó là lỗi: nguồn suy được
hoàn toàn từ `picked_up_at IS NULL`, nên lưu thêm là **hai chỗ giữ cùng một sự thật** và chỉ chờ
ngày chúng lệch. Đúng loại lỗi mà `fedex-fbo-bill.ts` và `price-structure` vừa mắc (D-201).

Một hàm THUẦN là nơi DUY NHẤT quyết định:

```ts
export type NguonNgayDi = 'hang' | 'lark';
export function ngayDiHang(d: { pickedUpAt: Date | null; shippedAt: string | null }):
  { ngay: string | null; nguon: NguonNgayDi };
```

Trả cả ngày lẫn nguồn trong một lượt, để không nơi nào phải tự ghép lại.

## 5. Cổng chốt kỳ

`phatHanhBangKe` thêm **ba phép kiểm**, chạy trước khi đổi trạng thái sang `issued`:

| # | Chặn khi | Vì sao |
|---|---|---|
| 1 | đơn của hãng **có nguồn tra** mà thiếu `picked_up_at` | bảng kê dùng ngày đi hàng; thiếu thì không có gì để ghi. Aramex không rơi vào đây. |
| 2 | %fuel suy từ hoá đơn ≠ % công bố của **tuần chứa ngày đi hàng** | đúng phép kiểm đã bắt được lỗi #KLS1998 |
| 3 | %fuel suy ra **ngoài lưới 0,25%** | mức hãng luôn là bội 0,25%; ngoài lưới = mẫu số thiếu một khoản chịu fuel |

Ba cổng cũ giữ nguyên. Luật **"đơn chưa đối soát thì chưa thuộc kỳ"** (kỳ gán theo mốc Đức đẩy
`order.reconciled`) **đã nằm trong `chonKyGom`** — không dựng lại, chỉ giữ.

Phép kiểm 2 và 3 **bỏ qua đơn chưa có hoá đơn hãng**: chưa có bill thì không có % để suy, và
đơn đó vốn chưa thuộc kỳ.

Cổng trả về **danh sách đơn hỏng kèm lý do**, không trả một câu chung — người sửa cần biết đơn
nào.

## 6. Đẩy Google Sheet

Sau khi kỳ tạo xong: ghi tab tên theo kỳ (`9.26`) vào sheet của brand, đúng bố cục sheet Kalisa
đang dùng (21 cột, `Mã đơn` → `Mã SMS`).

**Brand chưa có sheet thì hệ thống TỰ TẠO** (CEO chốt 03/10), rồi chia sẻ quyền `writer` cho
CEO và ghi id sheet vào cột MỚI `ship_ho_partners.doi_soat_sheet_id` (migration riêng). Sheet
Kalisa đang có thì nhập sẵn id của nó vào cột đó, không tạo lại.

**Ràng buộc đã kiểm 03/10:** `spreadsheets.create` nằm trong Sheets API (đã bật), nhưng **chia
sẻ file cần Drive API** — hiện **CHƯA BẬT** (`HTTP 403: Google Drive API has not been used in
project 76133261392`). Không bật thì sheet tạo ra nằm trong Drive của service account và **không
ai mở được**. Vậy nên:

- Việc của CEO: bật **Google Drive API** cho project `shopify-management-510413`.
- Nếu không bật: hệ thống **không tự tạo sheet**, mà báo *"brand chưa có sheet — tạo và chia sẻ
  cho `sms-sheet-manager@…` rồi dán link vào trang đối tác"*. Thà bảo người làm còn hơn tạo ra
  một file không ai mở được.

Ghi theo nếp đã dùng cho sheet Kalisa: locale `vi_VN`, cột ngày định dạng `dd/mm/yyyy`, tiền
là chuỗi `1.234.567 đ`.

## 7. Thứ tự và tính nguyên tử

```
rà soát cổng → (xanh) → tạo kỳ → đẩy Google Sheet → đẩy MMP
                 (đỏ) → dừng, không tạo kỳ, không đẩy
```

Đẩy MMP **đi qua outbox đã có** (`statement-outbox.ts`): ghi dòng trước, cron thử lại. Đẩy
Google Sheet **cũng dùng outbox đó** với `event = 'sheet'`, vì cùng một tính chất: gọi ra ngoài
có thể hỏng, và hỏng thì phải thử lại chứ không được âm thầm bỏ.

Sheet hỏng **không làm hỏng việc tạo kỳ** — kỳ đã tạo, MMP đã nhận; sheet là bản tiện đọc.

## 8. Ca biên

| Ca | Xử lý |
|---|---|
| Đơn thiếu `carrier_account_id` (2 đơn) | cổng #1 chặn — không biết hãng thì không biết có nguồn tra hay không |
| FedEx quá 90 ngày, không còn dữ liệu quét | cổng #1 chặn; người vận hành nhập tay `picked_up_at` |
| Lô bị trả rồi gửi lại (hai lần `PU`) | lấy lần **sớm nhất** — cước tính theo lượt đi đầu tiên |
| Brand chưa có sheet, Drive API chưa bật | tạo kỳ + đẩy MMP vẫn chạy; phần sheet báo việc cho người |
| Kỳ chỉ có đơn Aramex | qua cổng #1 (ngoại lệ khai báo), vẫn phải qua #2 và #3 |

## 9. Kiểm thử

**Thuần (vitest):** `ngayDiHang` chọn đúng nguồn và đúng thứ tự ưu tiên · `mocLayHang` cho UPS
lấy `P` sớm nhất · ba phép kiểm cổng, mỗi phép một ca đỏ và một ca xanh dựng từ số liệu THẬT
(#KLS1998 52,65%, SV-0015 48,91%) · bố cục hàng ghi ra sheet.

**Trên dữ liệu thật, trước khi bật:** chạy cổng ở chế độ **chỉ đếm** trên mọi kỳ đã phát hành —
kỳ nào hôm nay sẽ bị chặn, vì lý do gì. Số đó phải giải thích được trước khi cổng chặn thật.

## 10. Điều kiện cần từ CEO

1. Bật **Google Drive API** cho project `shopify-management-510413` (nếu muốn hệ thống tự tạo
   sheet cho brand chưa có). Không bật thì mọi phần khác vẫn chạy; riêng brand chưa có sheet
   sẽ nhận một dòng báo việc thay vì một sheet mới.

## 11. Thứ tự làm

1. `ngayDiHang` + cột ngày trên màn ship hộ — dùng ngay dữ liệu FedEx đã nạp.
2. Nối UPS vào `napNgayLayHang`.
3. Ba phép kiểm cổng, chạy **chế độ chỉ đếm** trên mọi kỳ cũ trước khi bật chặn.
4. Bảng kê đổi sang ngày đi hàng.
5. Đẩy Google Sheet qua outbox + migration `doi_soat_sheet_id`.
6. Tự tạo sheet cho brand chưa có — **phụ thuộc mục 10.1**, làm sau cùng vì có thể bị hoãn.
