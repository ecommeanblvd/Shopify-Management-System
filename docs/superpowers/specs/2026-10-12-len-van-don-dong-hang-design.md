# Bước "Lên vận đơn" trong module Đóng hàng — thiết kế

**Ngày:** 2026-10-12 · **Chốt với:** CEO Lê Minh Tiệp · **Trạng thái:** đã duyệt thiết kế

## Mục tiêu

Sau khi chọn line ship trên `/f/dong-hang`, người lên vận đơn mở một hộp thoại tổng hợp đủ
thông tin để **copy & paste sang form của hãng** — không phải mở ba màn khác và gõ lại.

## Bối cảnh

D-691 chốt luồng: *"Đức chọn hãng trên màn SMS mới `/f/dong-hang` (quote theo cân thực +
kích thước kiện), SMS ghi cột `Couriers` lên Lark rồi **Ops tạo nhãn như cũ**."* Việc này nối
vào đúng chỗ "như cũ" đó — hệ thống chưa bao giờ tự tạo nhãn và lượt này cũng không.

Vì sao đáng làm ngoài chuyện đỡ gõ: lỗi địa chỉ là loại lỗi đắt nhất của khâu này. Vụ sai địa
chỉ giao → hoàn hàng → brand làm lại đồ → mua lại và gửi lần hai thiệt hại ~10tr (D-073,
D-076), và KPI nhân **hệ số nghiêm trọng ×2** cho `sai_dia_chi_giao`. Bước này là chỗ cuối
cùng con người còn nhìn thấy địa chỉ trước khi nó thành nhãn.

**Đo trước khi thiết kế (12/10/2026):**

| Đo | Số |
|---|---|
| Đơn có địa chỉ đầy đủ + đã verify | 13.105 / 13.125 |
| Đơn có **số điện thoại người nhận** | **0 / 13.125** — bộ sync không kéo field `phone` |
| Kiện đang chờ đóng hàng | 42 (36 đã verify · 6 chưa có kết quả verify nào) |
| Đơn "verified" mà **vẫn mang cờ vấn đề** | 244 |
| Cờ thuộc họ "thiếu/sai số căn hộ" (4 cách viết) | 238 |
| Cờ `INTERPOLATED.STREET.ADDRESS` | 155 |
| Đơn có 1 kiện / 2 kiện (trong 41 đơn đang chờ) | 40 / 1 |
| `addr_standardized` chứa đường | **Không** — chỉ city/state/ZIP+4 |

Phát hiện đáng kể nhất: `addr_standardized` **không** phải địa chỉ chuẩn hoá đầy đủ. Ví dụ
thật `1395 Silver Moon Drive, Tallahassee 32312` → `TALLAHASSEE, FL, 32312-3934`. FedEx không
viết lại đường; thứ nó thêm được là **ZIP 9 số**. Nên không có chuyện "dán địa chỉ chuẩn hoá
thay địa chỉ khách" — chỉ có chuyện dán ZIP nào.

## Trong phạm vi / ngoài phạm vi

**Trong:** hộp thoại chỉ-đọc gom thông tin + nút copy từng ô và từng khối; nút verify lại địa
chỉ ngay tại bước này; luật chọn ZIP; luật chọn nguồn cân/kích thước; lấy SĐT · email · chất
liệu live từ Shopify.

**Ngoài (cố ý):** tự tạo nhãn qua API hãng; lưu giá trị khai/HS code/loại dịch vụ; trang in;
nhập mã vận đơn trả về (mã vẫn về qua đồng bộ Lark như hiện nay); đơn ship hộ (bảng khác,
màn khác).

## Nguồn dữ liệu

Không migration, không cột mới, không backfill.

**Đã có trong CSDL — không gọi mạng:**

- `shopify_orders`: `ship_name`, `ship_company`, `ship_address1`, `ship_address2`, `ship_city`,
  `ship_province_code`, `ship_postcode`, `ship_country`, `addr_class`, `addr_deliverable`,
  `addr_issue`, `addr_standardized`, `addr_confidence`, `addr_verified_at`
- `shipments`: `sms_hop`, `sms_weight_kg`, `sms_dim_length_cm`, `sms_dim_width_cm`,
  `sms_dim_height_cm`, `sms_packed_at` (bước Đóng thùng của SMS — cột SMS sở hữu, đồng bộ Lark
  không đụng, migration 0187) và đường lùi `actual_weight_kg`, `dim_length_cm`,
  `dim_width_cm`, `dim_height_cm`
- `shopify_order_lines`: `product_title`, `variant_title`, `sku`, `quantity`

**Gọi Shopify live MỘT lượt lúc mở hộp thoại** — lấy ba thứ CSDL không có:

```graphql
query($id: ID!) {
  order(id: $id) {
    email
    shippingAddress { phone }
    lineItems(first: 50) { nodes {
      sku
      product { metafields(first: 50) { nodes {
        namespace key value
        reference { ... on Metaobject { displayName } }
        references(first: 10) { nodes { ... on Metaobject { displayName } } } } } } } } }
}
```

Chất liệu nằm ở `custom.materials_v2` (metafield tham chiếu metaobject) — `locThuocTinh`
(`features/kho-nhan/thuoc-tinh-shopify.ts`, thuần, đã có test) đã gộp `material` /
`materials` / `fabric` / `materials_v2` về một dòng nhãn "Chất liệu".

**Vì sao lấy live chứ không backfill 13.125 đơn:** chỉ cần SĐT của đơn đang lên vận đơn, và
lấy live thì luôn là số mới nhất (khách sửa thì theo). Cùng lượt gọi với chất liệu nên không
thêm vòng mạng. Màn QC đo thật lượt gọi tương đương: 444–615ms, 5–45 điểm trên hạn mức 20.000
với tốc độ hồi 1.000/giây.

**Giữ kết quả trong phiên** theo `shipmentId` (đi đúng lối cache của `baoGiaKien` trong
`features/dong-hang/actions.ts`) — đóng/mở lại cùng kiện không gọi mạng lần nữa.

## Bốn khối thông tin

### Khối 1 — Người nhận

Ô: Tên · Công ty · Địa chỉ 1 · Địa chỉ 2 · Thành phố · Bang/Tỉnh · ZIP · Nước · SĐT · Email.

**Luật chọn ZIP.** Lấy đoạn sau dấu phẩy cuối cùng của `addr_standardized`, bỏ khoảng trắng
hai đầu. Dùng đoạn đó khi **cả ba** điều kiện đúng:

1. Nó bắt đầu bằng `ship_postcode` (so sau khi bỏ khoảng trắng, viết hoa) — bảo đảm nó là ZIP
   mở rộng của chính mã khách gõ, không phải mã của nơi khác;
2. Nó **dài hơn** `ship_postcode` (có thêm phần +4 mới dán, bằng nhau thì dán bản khách);
3. `addr_issue` **không** thuộc họ nội suy.

Không thoả thì dán `ship_postcode`, kèm câu giải thích tại chỗ.

**Họ nội suy:** chuẩn hoá `addr_issue` (bỏ ký tự không phải chữ, viết thường) rồi kiểm có chứa
`interpolated`. Lý do: `INTERPOLATED.STREET.ADDRESS` nghĩa là FedEx **nội suy** phần +4 từ dải
số nhà quanh đó, không phải tra được chính địa chỉ này — dán một +4 đoán là tệ hơn dán ZIP 5
số đúng.

**Băng cảnh báo.** Chuẩn hoá `addr_issue` như trên:

- chứa `suite` → **băng đỏ**, bắt tích xác nhận trước khi copy khối này. Câu: *"Địa chỉ thiếu
  hoặc sai số căn hộ — hãng sẽ thu phí sửa địa chỉ hoặc trả hàng về."* Bốn cách viết đã gặp
  thật đều chứa `suite`: `SuiteRequiredButMissing`, `InvalidSuiteNumber`,
  `SUITE.NUMBER.REQUIRED`, `INVALID.SUITE.NUMBER`.
- có cờ khác (vd `STANDARDIZED.ADDRESS.NOTFOUND`, `MISSING.OR.AMBIGUOUS.DIRECTIONAL`) → **băng
  vàng**, không bắt xác nhận.
- không cờ → không băng.

**Chưa verify** (`addr_verified_at` null) → nút **"Verify ngay"**, và **chặn copy khối này**
tới khi có kết quả. Lý do chặn: lỗi địa chỉ là loại đắt nhất và có hệ số KPI ×2.

### Khối 2 — Kiện hàng

Ô: Cân thực · Dài × Rộng × Cao · Loại hộp · Số kiện. Hiện kèm **cân quy đổi** (`canQuyDoi`
trong `features/dong-hang/logic.ts` — trả `quyDoi` và `tinhCuoc`) để người lên vận đơn thấy
trước hãng sẽ tính theo cân nào.

**Luật số kiện:** `N` = `soKienCungDon` (đã có trong `queries.ts`, đếm kiện của đơn có
`log_unique_code`). `n` = thứ tự của kiện này khi sắp **`log_unique_code` tăng dần** — chọn
cách sắp này vì mã kiện Lark (`PK-…`) là khoá duy nhất và ổn định, không phụ thuộc thứ tự truy
vấn. `N = 1` → hiện `1/1`. Kiện không có `log_unique_code` → hiện `—` kèm *"kiện chưa có mã
Lark"*, **không** đoán thứ tự.

**Luật nguồn:** bước Đóng thùng của SMS **thắng** (`sms_packed_at` có giá trị) — đó là lần cân
cuối và là cột SMS sở hữu. Chưa đóng thùng trong SMS thì rơi về số Lark. **Luôn ghi rõ đang
lấy từ nguồn nào**, vì hai số có thể khác nhau.

**Không bao giờ** rơi về cân dự kiến (`canMon.tongKg`). Nó là tổng cân dự kiến từng món, mỗi
món tính một hộp, nên nhiều món gộp một thùng thì nó CAO HƠN cân kiện thật — xem
`NHAN_DU_KIEN` trong `can-du-kien.ts`. Thiếu cân hoặc thiếu kích thước → **chặn copy khối
này**, ghi *"chưa cân — phải cân lại trước khi lên vận đơn"*.

### Khối 3 — Hàng hoá

Mỗi dòng đơn một dòng: Tên sản phẩm · SKU · Số lượng · Chất liệu. Thêm một ô **"Mô tả hàng
hoá"** ghép sẵn để dán vào ô *Description of goods* của hãng.

**Luật ghép mô tả:** `<tên sản phẩm> — <chất liệu>`; thiếu chất liệu thì chỉ còn tên, **không
để dấu gạch lơ lửng**.

**Đơn nhiều kiện** (hiện 1/41): liệt kê **toàn bộ** món của đơn kèm băng *"đơn này có N kiện —
tự chọn món nào thuộc kiện này"*. **Không đoán** từ `shipments.sku_text` của Lark: nó là chuỗi
dính liền (một ô thật chứa 16 SKU nối nhau `LaLING-LL-MNC25-01-M-BRZ-SaleDetheia-…`) và null ở
6/12 kiện mẫu.

### Khối 4 — Khai hải quan

Năm ô: Giá trị khai · Đơn vị tiền · HS code · Nước xuất xứ · Loại dịch vụ. **Hiện ô, để dấu
`—`**, kèm câu "gõ tay bên cổng hãng". Không lưu, không cột mới, không form nhập.

"Loại dịch vụ" không phải khoản hải quan, nhưng xếp cùng khối này vì cả năm ô có đúng một điểm
chung đáng kể với người dùng: **ô nào cũng phải gõ tay bên cổng hãng**. Gom một chỗ thì quét
một lượt là biết còn gì phải tự điền.

CEO chốt 12/10/2026: để optional vì chưa có dữ liệu. Hiện ô (chứ không ẩn) để người mới vào
việc biết cổng hãng còn đòi những ô đó. Khi nào có dữ liệu thì ô tự đầy, không phải sửa UI.

### Copy

Mỗi ô một nút copy. Mỗi khối một nút "copy cả khối", dạng mỗi dòng `Nhãn: giá trị`, ô trống
hiện `—`.

## Quyền

Hai hàm sẵn có **không dùng lại được** vì vai trò `logistics` của Đức không có quyền chúng đòi:

| Việc | Hàm sẵn có | Quyền nó đòi | `logistics` có |
|---|---|---|---|
| Lấy chất liệu | `layDuLieuQc` | `view_receiving` | không |
| Verify địa chỉ | `verifyOrderAddressAction` | `manage_fulfillment` | không |

Nên hai action mới trong `features/dong-hang/actions.ts`:

- **đọc khối thông tin** → `view_fulfillment` (đúng quyền gác chính màn `/f/dong-hang`)
- **bấm Verify** → `chon_line_ship` (đúng người đang chọn line ship thì verify được địa chỉ của
  chính kiện đó); gọi lõi `verifyAndStoreOrderAddress` đã có, rồi
  `revalidatePath('/f/dong-hang')`

Không viết luật thứ hai cho việc verify hay việc lọc thuộc tính — chỉ gác quyền khác.

## Lỗi

- **Shopify hỏng** → hộp thoại **vẫn mở**. Mất SĐT · email · chất liệu; địa chỉ, cân, SKU vẫn
  đủ vì nằm trong CSDL. Ô mất ghi *"không lấy được từ Shopify — thử lại"*, **không** để trống
  im lặng. Đi theo đúng nguyên tắc của `layDuLieuQc`: không ném lỗi, không chặn người làm việc.
- **Chặn copy theo KHỐI, không chặn cả hộp thoại.** Chưa verify → chặn khối 1. Thiếu cân/kích
  thước → chặn khối 2. Các khối còn lại vẫn copy được.
- **Không ghi gì vào dữ liệu** ngoài lượt Verify (đã idempotent). Hộp thoại chỉ đọc; mở lại
  bao nhiêu lần cũng không đổi gì.

## Cấu trúc tệp

| Tệp | Việc |
|---|---|
| `features/dong-hang/van-don.ts` (mới, **thuần**) | toàn bộ luật: chọn ZIP, cảnh báo, nguồn cân, mô tả hàng hoá, dựng khối, văn bản copy |
| `features/dong-hang/van-don.test.ts` (mới) | test cho module trên |
| `features/dong-hang/queries.ts` (sửa) | thêm hàm đọc địa chỉ + dòng đơn cho một kiện |
| `features/dong-hang/actions.ts` (sửa) | 2 action: lấy khối thông tin (gồm lượt gọi Shopify + cache phiên), verify địa chỉ |
| `components/dong-hang/HopThoaiVanDon.tsx` (mới) | hộp thoại 4 khối + nút copy |
| `components/dong-hang/BangDongHang.tsx` (sửa) | thêm nút mở hộp thoại cạnh chỗ chọn hãng |

`BangDongHang.tsx` đã 891 dòng — hộp thoại đi tệp riêng, không nhồi thêm vào đó.

## Giao diện module thuần

```ts
export interface DiaChiDon {
  shipName: string | null; shipCompany: string | null;
  shipAddress1: string | null; shipAddress2: string | null;
  shipCity: string | null; shipProvinceCode: string | null;
  shipPostcode: string | null; shipCountry: string | null;
  addrIssue: string | null; addrStandardized: string | null;
  addrDeliverable: boolean | null; addrVerifiedAt: string | null;
}

/** ZIP nên dán + nguồn + câu giải thích. */
export function chonZip(d: Pick<DiaChiDon, 'shipPostcode' | 'addrStandardized' | 'addrIssue'>):
  { zip: string | null; nguon: 'zip4' | 'khach'; vi: string };

/** Băng cảnh báo địa chỉ. */
export function canhBaoDiaChi(d: Pick<DiaChiDon, 'addrIssue'>):
  { muc: 'do' | 'vang' | 'khong'; cau: string | null; batXacNhan: boolean };

export interface CanKienVao {
  sms: { hop: string | null; canKg: number | null; dai: number | null; rong: number | null; cao: number | null; luc: string } | null;
  lark: { hop: string | null; canKg: number | null; dai: number | null; rong: number | null; cao: number | null } | null;
}
/** Cân + kích thước nên dán, kèm nguồn. `thieu` rỗng = dán được. */
export function nguonCanKien(v: CanKienVao):
  { canKg: number | null; dai: number | null; rong: number | null; cao: number | null;
    hop: string | null; nguon: 'sms' | 'lark' | null; nhan: string; thieu: string[] };

/** `<tên> — <chất liệu>`; thiếu chất liệu → chỉ tên. */
export function moTaHangHoa(tenSp: string, chatLieu: string | null): string;

export interface O { nhan: string; giaTri: string | null; vi?: string }
export interface Khoi {
  ten: string; o: O[];
  chanCopy: boolean; lyDoChan: string | null;
  canhBao: { muc: 'do' | 'vang' | 'khong'; cau: string | null; batXacNhan: boolean } | null;
}
export interface MonHang {
  tenSanPham: string;        // product_title (+ variant_title khi có)
  sku: string | null;
  soLuong: number;
  chatLieu: string | null;   // từ metafield, null khi Shopify không trả được
}
export interface VaoKhoiVanDon {
  diaChi: DiaChiDon;
  /** null = không gọi được Shopify → ô SĐT/email ghi câu "không lấy được". */
  tuShopify: { phone: string | null; email: string | null } | null;
  can: CanKienVao;
  mon: MonHang[];
  /** `n/N` của kiện; null khi kiện chưa có mã Lark. */
  soKien: { n: number; tong: number } | null;
}
export function dungKhoiVanDon(vao: VaoKhoiVanDon): Khoi[];

/** Văn bản "copy cả khối": mỗi dòng `Nhãn: giá trị`, ô trống hiện `—`. */
export function vanBanKhoi(k: Khoi): string;
```

## Kiểm thử

Test đặt ở `features/dong-hang/van-don.test.ts` (`.ts` — bộ test của repo **không** bắt
`.tsx`, nên mọi luật phải ở module thuần mới có test canh).

- `chonZip`: có +4 nối đúng mã khách → dán +4 · cờ chứa `interpolated` → dán ZIP 5 số · không
  có `addr_standardized` → 5 số · đoạn cuối không bắt đầu bằng mã khách → 5 số · đoạn cuối dài
  bằng mã khách (`LONDON, W9 1UJ`) → 5 số
- `canhBaoDiaChi`: cả 4 cách viết của họ `suite` → đỏ + `batXacNhan` true ·
  `STANDARDIZED.ADDRESS.NOTFOUND` → vàng · null → không băng
- `nguonCanKien`: có SMS → lấy SMS + nhãn nguồn · chưa có SMS → Lark + nhãn · thiếu cả hai →
  `thieu` nêu đúng thứ thiếu · thiếu kích thước nhưng có cân → vẫn chặn
- `moTaHangHoa`: có chất liệu → `tên — chất liệu` · không chất liệu → chỉ tên, không gạch
- `dungKhoiVanDon`: đủ 4 khối theo thứ tự · `chanCopy` bật đúng khối đúng lý do · khối Khai hải
  quan luôn 5 ô và luôn `null` giá trị
- `dungKhoiVanDon` — số kiện: `tong = 1` → `1/1` · `tong = 2` → `n/2` · `soKien` null → `—`
  kèm câu "kiện chưa có mã Lark"
- `dungKhoiVanDon` — `tuShopify` null → ô SĐT và email ghi câu "không lấy được từ Shopify",
  **không** để trống, và các khối khác vẫn `chanCopy` false
- `vanBanKhoi`: mỗi dòng `Nhãn: giá trị`; ô trống hiện `—`

Không test cho action (chỉ I/O mỏng) và không test cho `.tsx`.

## Quyết định cố ý KHÔNG làm

- **Không lưu giá trị khai / HS code / loại dịch vụ.** CEO chốt để optional; lưu thì phải dựng
  form + migration cho dữ liệu chưa ai có.
- **Không backfill SĐT cho 13.125 đơn.** Lấy live đúng đơn đang cần, luôn mới.
- **Không đoán món nào thuộc kiện nào** từ `sku_text` của Lark.
- **Không nối API tạo nhãn.** Ngoài phạm vi lượt này; D-691 giữ việc tạo nhãn ở Ops.
