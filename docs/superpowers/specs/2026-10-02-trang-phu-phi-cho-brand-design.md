# Trang phụ phí ship hộ cho brand — thiết kế

**Ngày:** 2026-10-02 · **Chốt với:** CEO Lê Minh Tiệp

## 1. Việc trang này làm

Một trang **không cần đăng nhập**, mỗi brand một link riêng, để brand **xuất trình căn cứ** cho các khoản phụ phí trên bảng kê ship hộ của họ.

Phụ phí là **pass-through**: MEAN bị hãng thu rồi thu lại brand đúng số đó ([price-structure.ts:153](../../../features/ship-ho/price-structure.ts) — *"phụ phí = pass-through cost"*). Nên công khai mức phụ phí không hở giá vốn hay lãi.

**Đây là nơi DẪN NGUỒN, không phải công cụ tra cứu.** CEO chốt rõ: *"anh đang không muốn quá tiện lợi cho brand, chỉ là 1 nơi có thể dẫn nguồn cho họ xem"*. Nên KHÔNG làm: ô tra mã bưu chính, bảng lịch sử cho mọi tuần, biểu đồ, bộ lọc. Một lần nữa để tránh hiểu sai: brand tự xem con số ở trang của hãng; trang này chỉ nói **có những loại phí nào** và **xem ở đâu**.

**Ca dùng chuẩn:** Kalisa đối soát từ tháng 7/2026 tới nay, thấy dòng *"Phụ phí xăng dầu"* và *"Phụ phí vùng xa"*, cần biết hai dòng đó là gì và căn cứ ở đâu.

## 2. Đường dẫn và token

`app/pp/[token]/page.tsx` — theo đúng nếp hai trang public đã có (`app/gr/[token]`, `app/wl/[token]`):

- `export const dynamic = 'force-dynamic'`
- `generateMetadata` trả `robots: { index: false, follow: false }`
- token sai / đã thu hồi → `notFound()`

Bảng mới:

```
brand_surcharge_links
  id                uuid pk
  partner_brand_slug text  → mmp_brands.slug, NOT NULL
  token             text   NOT NULL, UNIQUE
  created_by        text   → user.id
  created_at        timestamp NOT NULL default now()
  revoked_at        timestamp            -- NULL = còn hiệu lực
```

Token = 32 byte ngẫu nhiên (`randomBytes(32).toString('base64url')`), không đoán được, không mang thông tin brand.

**MỘT link sống cho mỗi brand tại một thời điểm.** Tạo link mới cho brand đang có link → thu hồi link cũ trong cùng transaction. Hai link sống cùng lúc là hai thứ phải nhớ thu hồi, và sẽ có cái bị quên.

Màn quản trị: thêm một khối vào `/f/ship-ho/partners` — mỗi brand một dòng với nút **Tạo link** / **Chép link** / **Thu hồi**. Quyền: `manage_ship_ho` (quyền đã dùng cho mọi thao tác ship hộ).

## 3. Nội dung trang

### 3.1 Hãng nào hiện

Các hãng brand đó **thực sự đã đi**, lấy từ `ship_ho_orders` theo `partner_brand_slug`, nhóm theo `carrier_account_id`, **không giới hạn thời gian** (CEO chốt: đối soát có thể lùi xa; một hãng chỉ đi một lần hồi tháng 5 vẫn cần căn cứ).

Đơn có `carrier_account_id` NULL thì bỏ qua — không đoán hãng từ `carrier_key`.

### 3.2 Gom theo DÒNG TRÊN BẢNG KÊ, không theo `kind` của engine

Có **hai bộ từ vựng** trong hệ thống và chúng không trùng nhau:

- brand nhìn **nhãn trên bảng kê** — 8 dòng, dựng ở [price-structure.ts:208](../../../features/ship-ho/price-structure.ts), mã ổn định ở [bang-ke-khoan-phi.ts](../../../features/ship-ho/bang-ke-khoan-phi.ts);
- `carrier_surcharges.kind` là **cách engine chia nhỏ** — 12 loại.

Trang gom theo **dòng bảng kê**, vì brand đi từ dòng họ đang nhìn. Ánh xạ:

| dòng trên bảng kê | `kind` nuôi nó | hiện gì |
|---|---|---|
| Phụ phí xăng dầu | `fuel_percent` | % + **bảng tuần** (§3.3) |
| Phụ phí vùng xa | `remote_fixed` | mức + **tệp tài liệu gốc** (§3.4) |
| Phụ phí nhu cầu (demand) | `demand_per_kg` | tiền/kg + nước áp dụng |
| Giao nhà dân | `residential_fixed` | tiền/đơn |
| Ký nhận (direct signature) | `addon_fixed` có `service_key = 'direct_signature'` | tiền/đơn + danh sách nước MIỄN |
| VAT | `vat_percent` | % |
| Phụ phí khác | `peak_fixed` · `per_kg_fixed` · `per_step_fixed` · `country_fixed` · `packaging_fixed` · `addon_fixed` còn lại | mỗi loại một dòng con, kèm cách tính |

**`markup_percent` KHÔNG xuất hiện trong bảng trên** — đó là lãi của MEAN (dữ liệu thật: FedEx 4 dòng, DHL 4 dòng).

Dùng **danh sách cho phép**: một `kind` chỉ lên trang nếu nó nằm trong một ô của cột giữa. Thêm `kind` mới vào enum thì nó mặc định **không** hiện. Danh sách loại trừ thì thêm `kind` mới là lọt ra ngoài mà không ai thấy.

Chỉ lấy dòng `active = true` và `ends_at IS NULL`. Mức cũ của các loại không-phải-dầu không hiện — chúng gần như không đổi (ngày hiệu lực lùi tới 2025).

### 3.2.1 Dòng KHÔNG phải phụ phí của hãng

**`Phí xử lý đơn hàng` (`processing`) là phí của MEAN, không phải pass-through.** Bằng chứng trong mã: [price-structure.ts:265](../../../features/ship-ho/price-structure.ts) dựng dòng này với `costVnd: null, billVnd: null` — không có vế giá vốn nào, vì không hãng nào thu MEAN khoản này.

Trang này có tiền đề *"các khoản phí mà mình bị đối tác charge và mình charge lại"*, nên dòng đó **không thuộc tiền đề**. Xử: **KHÔNG hiện**, và thêm một câu ở cuối trang nói rõ trang chỉ dẫn nguồn các khoản phụ phí **của hãng vận chuyển**; những khoản khác trên bảng kê (phí xử lý đơn hàng, thuế/phí nhập khẩu thu hộ) không có nguồn hãng và hỏi trực tiếp MEAN.

Không im lặng bỏ dòng đó: brand đếm số dòng trên bảng kê rồi đếm số dòng trên trang, thấy lệch mà không có lời giải thích thì sẽ hỏi — và câu hỏi đó quay về CEO.

### 3.3 Phụ phí dầu — bảng tuần, CHỈ tuần brand đó có đơn

Dầu đổi hàng tuần và **hãng chỉ công bố tuần hiện tại**, nên link sang hãng không giải được ca đối soát tháng 7. SMS đang là nơi duy nhất giữ lịch sử (FedEx 84 dòng, DHL 42, UPS 25, lùi tới 01/2025).

CEO chốt mức giữa: hiện bảng tuần **giới hạn ở những tuần brand đó thực sự có đơn gửi**.

Phép chọn: với mỗi hãng, lấy dòng `fuel_percent` mà `[starts_at, ends_at)` **giao với** ít nhất một `ship_ho_orders.shipped_at` của brand đó ở cùng `carrier_account_id`. `ends_at` NULL = mức đang mở, so tới hôm nay.

Mỗi dòng: `từ ngày – đến ngày · mức %`. Sắp giảm dần theo ngày, mới nhất trên cùng.

Lý do giới hạn: đây là con số **đã dùng để tính tiền chính brand đó** — đưa cho họ là xuất trình căn cứ, không phải mở kho dữ liệu. Brand mới đi một tháng chỉ thấy một tháng.

### 3.4 Tài liệu gốc vùng sâu vùng xa

Dưới dòng `remote_fixed` của mỗi hãng: danh sách tệp từ `carrier_remote_evidence` của đúng `carrier_account_id` đó — nhãn, kỳ hiệu lực, nút tải. Dữ liệu thật đang có 8 tệp.

Tải qua route public mới `app/pp/[token]/evidence/[evidenceId]/route.ts`, soi theo **đúng mẫu route nội bộ đã có** (`.../remote-postcodes/evidence/[evidenceId]/route.ts`): đọc `file_key`, xin `getSignedDownloadUrl(key, 300)`, trả `307` redirect.

Hàng rào: token phải còn hiệu lực, **và** `evidenceId` phải thuộc một `carrier_account_id` mà brand đó đã đi. Thiếu phép kiểm thứ hai thì một brand đổi `evidenceId` trên URL là tải được tài liệu hãng họ chưa bao giờ dùng.

### 3.5 Link trang công bố của hãng

Mã nguồn đã có bốn link, dùng lại chứ không gõ lại:

| hãng | hằng số |
|---|---|
| FedEx | `PAGE_URL` trong `features/carrier-rates/fuel-fetcher/fedex.ts` (hiện là `const` nội bộ — cần export) |
| DHL | `DHL_VN_PAGE_URL` |
| UPS | `UPS_FUEL_PAGE_URL` |
| SF Express | `SF_FUEL_PAGE_URL` |

Hãng không có link (Aramex) → không hiện dòng link, **không** để link rỗng hay trỏ sang trang chủ.

## 4. Kiến trúc

```
features/ship-ho/trang-phu-phi/
  link-token.ts     THUẦN  sinh token, luật một-link-sống
  loai-phu-phi.ts   THUẦN  DANH SÁCH CHO PHÉP + nhãn + cách tính + link hãng
  tuan-dau.ts       THUẦN  lọc tuần dầu giao với ngày gửi của brand
  queries.ts        I/O    đọc token → brand → hãng đã đi → phụ phí → tệp
  actions.ts        'use server'  tạo / thu hồi link (có kiểm quyền)
app/pp/[token]/page.tsx                      trang public
app/pp/[token]/evidence/[evidenceId]/route.ts  tải tệp
components/ship-ho/KhoiLinkPhuPhi.tsx        khối quản trị
```

Ba tệp THUẦN tách riêng vì đó là phần có luật và phải có test: danh sách cho phép, phép giao khoảng ngày, luật một-link-sống. Phần I/O chỉ nối dữ liệu.

## 5. Luồng dữ liệu

```
token → brand_surcharge_links (còn hiệu lực?) → partner_brand_slug
      → ship_ho_orders nhóm theo carrier_account_id (mọi thời điểm)
      → carrier_surcharges đang mở, LỌC qua danh sách cho phép
      → fuel_percent: lọc tuần giao với shipped_at của brand
      → carrier_remote_evidence theo carrier_account_id
```

Đọc một lượt cho cả trang; không truy vấn theo từng dòng.

## 6. Lỗi và ca biên

| ca | xử |
|---|---|
| token không tồn tại / đã thu hồi | `notFound()` — không phân biệt hai ca, để không ai dò được token nào từng tồn tại |
| brand chưa có đơn nào | trang hiện: *"Chưa có đơn nào qua SMS nên chưa có phụ phí để dẫn nguồn."* Không hiện bảng rỗng |
| hãng đã đi nhưng không còn phụ phí đang mở | hiện tên hãng + link trang hãng, ghi rõ không có phụ phí đang áp dụng |
| `evidenceId` không thuộc hãng brand đã đi | `404` |
| storage hỏng lúc xin signed URL | `502` kèm chữ cho người đọc, không để trang trắng |

## 7. Test

**THUẦN (vitest):**
- `loai-phu-phi`: `markup_percent` **không** ánh xạ tới dòng bảng kê nào; thêm một `kind` giả → mặc định bị loại; mọi `kind` được ánh xạ đều có nhãn và cách tính (không dòng nào rỗng); `processing` **không** nằm trong bảng ánh xạ (nó là phí của MEAN, §3.2.1).
- `tuan-dau`: tuần giao một phần với ngày gửi → nhận; tuần hoàn toàn ngoài → loại; `ends_at` NULL so tới hôm nay; brand không có đơn → mảng rỗng.
- `link-token`: token đủ dài và khác nhau mỗi lần; tạo link mới thu hồi link cũ.

**Ghim bằng dữ liệu thật:** một test đọc danh sách cho phép và khẳng định nó **không** chứa `markup_percent` — vì đó là dòng duy nhất mà lộ ra là lộ lãi.

## 8. Ngoài phạm vi

- Không gửi email cho brand; CEO tự chép link đi gửi.
- Không đa ngữ. Trang tiếng Việt, như bảng kê brand đang nhận.
- Không hiện giá cước cơ bản (bảng giá) — trang này chỉ phụ phí.
- Không hiện `Phí xử lý đơn hàng` và `Thuế / hải quan thu hộ`: một là phí của MEAN, một là tiền nhà nước thu — cả hai không có "nguồn hãng" để dẫn (§3.2.1).
- Không hiện `markup_percent` ở bất kỳ đâu, bất kỳ lúc nào.
