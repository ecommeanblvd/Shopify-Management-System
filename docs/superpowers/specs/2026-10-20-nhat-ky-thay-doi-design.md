# Nhật ký thay đổi — ai sửa gì, từ giá trị nào sang giá trị nào

CEO Lê Minh Tiệp chốt 20/10/2026. Người viết: Claude (phiên 19–20/10/2026).

## 1. Vì sao làm

CEO cần trả lời được những câu như: **ai QC lô nhập kho hôm nay, ai điền pass hay không pass, ai nhập mã vận đơn cho đơn này.** Hiện không có chỗ nào trả lời được.

Nguyên văn 20/10/2026:

> "anh cần 1 trang log lịch sử ở các table mà vận hành nhiều có nhiều nhân sự tác động vào như là Đóng hàng, Kho hàng, Quản lí đơn, chỗ nào mà có table mà hệ thống đang nhập thông tin vào thì đều cần có log để xem"

Mẫu CEO đưa là **lịch sử bản ghi của Lark**: mỗi dòng một thay đổi, gồm `Ngày · Người dùng · Trường · Trước → Sau`, và liệt kê cả tác nhân máy (`Base Assistant`, `Open Claw Bot`) ngang hàng với người.

### Đã đo (20/10/2026)

| | |
|---|---|
| Bảng trong `db/schema.ts` | 132 |
| Chỗ gọi `recordAudit` | 36, rải ở 19 thư mục |
| Màn hình đọc `audit_log` | **0** |
| Cột `before` / `after` trong `audit_log` | **không có** |

Ba điều rút ra:

1. **Dữ liệu đang ghi nhưng không ai xem được.** `audit_log` có 36 chỗ ghi vào, không một màn hình nào đọc.
2. **Kể cả xem được cũng không đủ.** `audit_log` ghi *"người X làm hành động `pack_check` lên kiện Y"*. Nó không ghi **trường nào đổi, từ giá trị gì sang giá trị gì** — tức không dựng được màn như Lark từ bảng này.
3. **Giá trị hiện tại không phải lịch sử.** `goods_receipt_items` có `qc_checked_by` / `qc_checked_at`, nên biết được ai QC **lần cuối**. Nếu một người để `pass`, người khác sửa thành `fail`, rồi người thứ ba sửa lại `pass` — chỉ còn dấu vết của người cuối. Đúng cái ca cần truy thì mất.

## 2. Điều khó nhất: dữ liệu bị sửa từ nhiều đường

Đây là lý do thiết kế này không phải "thêm một bảng log rồi gọi nó trong mấy action".

Dữ liệu vận hành trong SMS bị ghi từ ít nhất năm hướng:

- nhân sự bấm trên giao diện (Next.js server action),
- bộ đồng bộ Lark (`features/lark/sync.ts`) và webhook Lark bắn về (`nhan-mot-dong.ts` → `patch-kien.ts`),
- nhập file hoá đơn / XLSX (`features/shipments/import-actions.ts`),
- các cron (tra hãng, tính giá, chốt kỳ),
- script chạy tay qua `railway run`.

Riêng cột `shipments.tracking_number` đã có **ba** đường ghi — chính chú thích trong `db/schema.ts` nói vậy, và đó là lý do cột `tracking_nhap_luc` tồn tại: để phân biệt đường nào ghi.

**Hệ quả:** bắt thay đổi ở tầng ứng dụng chỉ thấy đường nào đi qua code mình chủ động sửa. Những đường còn lại lọt, và màn log sẽ sai theo kiểu tệ nhất — **trông đầy đủ mà thiếu**, nên người đọc tin vào một bức tranh không đúng.

CEO đã chốt hướng xử lý khi được hỏi thay đổi từ máy nên hiện hay ẩn:

> "Ghi rõ 'Đồng bộ Lark' luôn, cần thấy hết"

## 3. Cách bắt thay đổi

**Bắt ở tầng CSDL bằng trigger**, không bắt ở tầng ứng dụng.

Mỗi bảng trong phạm vi gắn một trigger `AFTER INSERT OR UPDATE OR DELETE ... FOR EACH ROW`. Trigger so `OLD` với `NEW`, và với mỗi **cột có giá trị khác nhau** ghi **một dòng** vào bảng nhật ký.

Vì sao trigger:

- **Không đường ghi nào lọt** — kể cả script chạy tay và `UPDATE` gõ thẳng vào CSDL.
- Không phải sửa 36+ chỗ gọi và nhớ sửa mọi chỗ mới trong tương lai. Một chốt chặn quên gọi là một lỗ hổng im lặng.
- Mức **từng ô**, đúng hình mà Lark đang cho CEO xem.

Trigger **không** biết ai đang thao tác — xem mục 4.

### Bảng nhật ký

```
nhat_ky_thay_doi
  id            uuid pk
  bang          text        -- tên bảng, vd 'shipments'
  ban_ghi_id    text        -- khoá chính của dòng, dạng text để nhận mọi kiểu khoá
  thao_tac      text        -- 'them' | 'sua' | 'xoa'
  truong        text        -- tên cột
  truoc         text        -- NULL với 'them'
  sau           text        -- NULL với 'xoa'
  tac_nhan_id   text        -- user.id, NULL khi không phải người
  tac_nhan_nhan text        -- nhãn hiện ra, vd 'Đồng bộ Lark'
  luc           timestamptz
```

`truoc` / `sau` lưu **text**, không phải jsonb: chúng chỉ để người đọc, không để truy vấn theo kiểu. Giá trị `NULL` lưu đúng `NULL` và màn hình hiện dấu `–`, giống Lark.

Một lượt `UPDATE` đổi ba cột ⇒ **ba dòng**, cùng `luc`. Màn hình gom lại theo `(ban_ghi_id, tac_nhan, luc)` khi hiện.

**`them` và `xoa` cũng ghi theo từng cột** — quyết định của người viết sau lượt soát 20/10/2026.
Bản đầu để `truong` NULL cho hai thao tác này, tức một dòng bị xoá chỉ sinh một dòng log rỗng.
Hai chỗ thật trong mã làm điều đó thành vô dụng:

- `features/kho-nhan/nhan-actions.ts` (`goChiecNhanNham`) **xoá cứng** dòng `goods_receipt_items`.
  Log sẽ nói "có người xoá một chiếc" mà không nói **chiếc nào, SKU gì** — mất đúng thứ cần truy.
- `features/shopify-orders/sync/upsert-order.ts` **xoá sạch rồi chèn lại** toàn bộ
  `shopify_order_lines` mỗi lượt đồng bộ một đơn.

Nên `them` ghi `sau` cho từng cột (trừ cột loại trừ), `xoa` ghi `truoc` cho từng cột.

**Và cặp xoá-rồi-chèn-lại của đồng bộ KHÔNG phải thay đổi.** Nếu ghi thật thì mỗi lượt đồng bộ
một đơn sinh N dòng `xoa` + N dòng `them` với nội dung y hệt nhau — đúng kiểu hỏng "nhiễu tới
mức không ai mở" ở §10, và sẽ chiếm phần lớn khối lượng. Cách xử lý: `upsert-order.ts` phải đổi
sang `INSERT ... ON CONFLICT DO UPDATE` + xoá đúng dòng thừa, thay vì xoá sạch. Đây là **việc
bắt buộc trong phạm vi**, không phải việc dọn kèm: giữ nguyên cách ghi hiện tại thì nhật ký của
`shopify_order_lines` vô dụng ngay ngày đầu.

## 4. Ai đang thao tác

Trigger chạy dưới một kết nối CSDL duy nhất, không biết người dùng ứng dụng. Phải để ứng dụng **gắn danh tính vào từng giao dịch**, trigger đọc lại bằng `current_setting('app.tac_nhan', true)`.

Ràng buộc kỹ thuật phải nói rõ, vì nó quyết định khối lượng việc:

`db/client.ts` dùng **một `Pool` của `pg`**. Một lệnh `db.update(...)` trần mượn một kết nối trong pool **chỉ cho lệnh đó**, nên `SET LOCAL` đặt ngoài giao dịch **không có tác dụng**. Và `set_config(..., false)` ở mức phiên thì **nguy hiểm**: kết nối được tái dùng, danh tính của request trước rò sang request sau — **gán sai người còn tệ hơn không gán ai**.

⇒ Mọi lệnh ghi cần gắn danh tính **phải nằm trong một giao dịch** mà việc đầu tiên là đặt danh tính:

```
ghiVoi(tacNhan, async (tx) => { ...mọi lệnh ghi... })
```

Hàm này mở giao dịch, chạy `SET LOCAL app.tac_nhan = $1`, rồi chạy phần thân.

**Lệnh ghi chưa bọc vẫn được ghi nhật ký đầy đủ về nội dung**, chỉ là cột người hiện `Chưa gắn danh tính`. Đây là **thiếu sót nhìn thấy được**, không phải thiếu sót im lặng — và phải có một truy vấn đếm được còn bao nhiêu dòng như vậy, theo bảng, để biết còn nợ chỗ nào.

**Đợt một bọc BAO NHIÊU** (người viết chốt sau lượt soát 20/10/2026): đếm được **~170 chỗ ghi**
vào 10 bảng trong phạm vi (`ship_ho_orders` 46, `shipments` 36, `goods_receipt_items` 36,
`order_fulfillment_lines` 20, `shopify_orders` 11, còn lại rải rác), 75 chỗ đã tự mở giao dịch.
Bọc hết ~170 chỗ là một đợt refactor giao dịch trên đường vận hành nóng, rủi ro hồi quy lớn hơn
hẳn giá trị nó mang lại ngay.

Đợt một chỉ bọc **ba luồng CEO nêu đích danh**: QC nhập kho, nhập kho, và nhập mã vận đơn. Phần
còn lại là **nợ có số đo** — truy vấn ở trên đếm ra đúng còn bao nhiêu dòng `Chưa gắn danh tính`
theo bảng, và con số đó phải hiện ngay trên trang nhật ký để không ai quên.

Nhãn cho tác nhân máy đặt ngay tại đầu vào của chúng, không đoán: bộ đồng bộ Lark đặt `Đồng bộ Lark`, webhook đặt `Lark bắn về`, cron đặt tên cron, script đặt tên script.

**Thay đổi đến từ Lark KHÔNG truy ra tên người gõ bên Lark** — CEO chốt 20/10/2026 khi được
hỏi. Lấy được tên đó sẽ phải đọc thêm trường người sửa từ Lark và dựng một bảng ánh xạ tài
khoản Lark → nhân sự SMS; hệ thống chưa có gì cho việc đó và CEO chọn không làm trong đợt này.

Hệ quả phải nói thẳng: với **ô nào do người gõ bên Lark**, cột Người dùng chỉ nói `Đồng bộ Lark`.
Riêng mã vận đơn thì ảnh hưởng nhỏ, vì từ quyết định 14/10/2026 nhân sự nhập mã **qua hệ thống**
(`luuTrackingChoKien`, có dấu `tracking_nhap_luc`) — những lượt đó có tên thật. Đường Lark chỉ
còn là đường cũ và đường phụ.

## 5. Phạm vi bảng

CEO nói *"chỗ nào mà có table mà hệ thống đang nhập thông tin vào thì đều cần có log"*. 132 bảng là quá rộng để làm một lượt, và phần lớn là bảng tra cứu hoặc bảng máy tự ghi (bảng giá, cache báo giá, dòng hoá đơn) — log chúng chỉ tạo tiếng ồn.

**Đợt một — các bảng vận hành nhiều người chạm, đúng ba module CEO nêu:**

| Module | Bảng |
|---|---|
| Đóng hàng | `shipments` |
| Kho hàng | `goods_receipts`, `goods_receipt_items`, `warehouse_inventory`, `inventory_movements` |
| Quản lí đơn | `shopify_orders`, `shopify_order_lines` |
| Điều phối / fulfillment | `order_fulfillment`, `order_fulfillment_lines` |
| Ship hộ | `ship_ho_orders` |

**Luật để quyết bảng tiếp theo** (để người làm không phải hỏi lại): bảng vào phạm vi khi **người** sửa được nó qua giao diện **và** nhiều hơn một người chạm. Bảng chỉ do máy ghi (cache, bảng giá nhập theo lô, dòng hoá đơn) **không** vào, trừ khi CEO nêu tên.

**Cột nào được ghi — hai chế độ, khai theo từng bảng:**

- **Bảng người sửa là chính** (`shipments`, `goods_receipt_items`, `goods_receipts`,
  `warehouse_inventory`, `inventory_movements`, `order_fulfillment*`, `ship_ho_orders`):
  ghi **mọi cột trừ danh sách loại trừ**. Loại trừ: `updated_at`, `created_at`, và các mốc cron
  tự đặt (`last_tracked_at`, `lark_synced_at`, `delivery_status`, `track_detail`).

- **Bảng máy ghi là chính** (`shopify_orders`, `shopify_order_lines`): ghi **chỉ danh sách cột
  cho phép** — những cột người sửa được (`selected_carrier_key`, các cột `*_override`, …).
  Quyết định của người viết sau lượt soát 20/10/2026: hai bảng này chủ yếu do cron Shopify ghi,
  mỗi lượt đồng bộ đặt lại `raw_payload`, `synced_at`, `content_fingerprint`. Dùng danh sách
  loại trừ thì phải duyệt tay ~90 cột của `shopify_orders` để không sót cột máy ghi, mà §5 đã
  cấm đoán theo tên cột. **`raw_payload` loại trừ tuyệt đối** — một lần đổi có thể hàng chục KB
  và bên trong có dữ liệu cá nhân của khách.

Cả hai danh sách khai **tường minh theo tên cột**, không đoán theo khuôn tên.

## 6. Màn hình

Hai lối vào, cùng một nguồn dữ liệu.

**a) Tab "Lịch sử" trên từng bản ghi** — giống hệt mẫu Lark CEO đưa. Cột: `Ngày · Người dùng · Trường · Trước → Sau`. Đây là lối CEO sẽ dùng nhiều nhất: đang xem một kiện / một lô nhập kho thì mở ngay lịch sử của nó.

**Tab này phải CUỐN CẢ THAY ĐỔI CỦA DÒNG CON** — quyết định của người viết sau lượt soát
20/10/2026. Việc QC xảy ra ở `goods_receipt_items` (từng chiếc), nhưng thứ CEO mở là **lô nhập
kho** (`goods_receipts`); tương tự đơn ↔ `shopify_order_lines`, fulfillment ↔
`order_fulfillment_lines`. Không cuốn lên thì tab Lịch sử của một lô gần như trống, và câu
*"ai QC lô nhập kho hôm nay"* ở §1 — câu CEO nêu đầu tiên — không trả lời được ở đúng lối vào
CEO sẽ dùng.

Khi cuốn lên, màn hình thêm một cột chỉ rõ **dòng con nào** (chiếc nào, SKU gì, dòng hàng nào).
Cách nối dòng con về bản ghi cha để lại cho người làm (ghi sẵn cột cha lúc trigger chạy, hay
join lúc truy vấn) — xem §11.

**b) Trang nhật ký của cả bảng** — lọc theo người, theo trường, theo khoảng ngày. Dùng khi câu hỏi là *"hôm nay ai sửa gì trong kho"* chứ không phải *"bản ghi này ai sửa"*.

Yêu cầu trình bày:

- Tên trường hiện bằng **nhãn tiếng Việt người dùng đang thấy trên màn hình** (`Kết quả QC`), không phải tên cột (`qc_result`). Cần một bảng ánh xạ cột → nhãn; cột chưa có nhãn thì hiện tên cột, không để trống.
- Giá trị dạng chọn (`pass` / `fail`) hiện dưới dạng chip có màu, như Lark.
- Giá trị `NULL` hiện dấu `–`.
- Tác nhân máy hiện nhãn của nó, **không** hiện như người dùng ẩn danh.
- Thay đổi cùng một người, cùng một lúc, trên cùng một bản ghi gom thành một khối.

## 7. Ai được xem

**Mọi nhân sự đều xem được nhật ký** — CEO chốt 20/10/2026 khi được hỏi có giới hạn cho quản lý
không. Cần một quyền riêng (`nhat_ky:xem`) gán cho mọi vai trò đang có, thay vì để trống không
kiểm tra: sau này muốn siết một vai trò nào đó thì có sẵn chỗ.

**NHƯNG giá trị nhạy cảm bị CHE theo đúng phân quyền đang có** — CEO chốt 20/10/2026 ở câu hỏi
thứ hai. Phạm vi §5 có `shopify_orders` / `shopify_order_lines` (email, tên, địa chỉ khách, giá
vốn, các cột `*_override`) và `ship_ho_orders` (`quote_breakdown`, `actual_bill_breakdown`).
Phân quyền hiện tại **cố ý** chặn đúng những thứ này — vai `logistics` chỉ có `orders:view`,
`orders.cogs:view` là scope riêng. Mở hết sẽ biến nhật ký thành **đường vòng qua toàn bộ phân
quyền** đã dựng.

Luật hiển thị:

- Người **không** đủ quyền với một cột vẫn thấy **dòng log, tên người sửa, tên trường và thời
  điểm** — tức vẫn trả lời được "ai sửa cái gì lúc nào".
- Chỉ **giá trị trước/sau** của cột đó bị che (hiện `•••`), kèm chữ nói rõ là bị che vì quyền,
  **không** ẩn im lặng.
- Cần khai **độ nhạy cho từng cột** trong phạm vi, ánh xạ sang quyền đang có
  (`orders.cogs:view`, …). Cột chưa khai mặc định coi là **nhạy cảm** và bị che — thà che nhầm
  một cột vô hại còn hơn lộ một cột nhạy vì ai đó quên khai.

## 8. Giữ bao lâu

**12 tháng**, rồi xoá dần. Đây là mặc định của người viết, CEO không bác.

Khối lượng **chưa đo được**. Dự án chỉ có **một** CSDL và nó là production (`DATABASE_URL` trỏ
thẳng Supabase pooler; `TEST_DATABASE_URL` không đặt nên suite integration đang skip; di trú áp
tay vào production). Nên không có chỗ nào đo trước mà không đụng vào thật.

**Cách đo đã chốt** (người viết, sau lượt soát 20/10/2026): bật trigger trên **đúng một bảng** —
`goods_receipt_items`, vì nó thuộc việc CEO nêu đầu tiên và không nằm trên đường ghi nóng nhất —
chạy **7 ngày**, rồi đo ba con số: số dòng nhật ký sinh ra mỗi ngày, tỉ lệ dòng do người so với
do máy, và thời gian ghi trung bình của bảng đó trước so với sau.

**Ngưỡng dừng:** thời gian ghi tăng quá **20%**, hoặc hơn **200.000 dòng/ngày** trên riêng bảng
đó. Chạm một trong hai thì **không mở rộng**, quay lại cắt theo thứ tự dưới đây rồi đo lại.

**Đường lui:** `DROP TRIGGER` là đủ và tức thời — trigger không đổi dữ liệu nghiệp vụ, bảng nhật
ký đứng riêng. Phải viết sẵn lệnh gỡ và thử nó trước khi bật.

Logic trigger là SQL nên `vitest` không chạm tới được (§12). Phần so sánh cột và lọc cột viết
thành hàm **thuần TypeScript** có test, rồi sinh ra SQL của trigger từ đó — để thứ dễ sai nhất
nằm trong tầm test.

Nếu khối lượng lớn hơn dự tính thì cắt theo thứ tự này, **không** cắt bừa: (1) thêm cột vào danh sách loại trừ, (2) rút thời gian giữ, (3) chia phân vùng theo tháng.

## 9. Không làm trong đợt này

- **Không** dựng lại lịch sử của quá khứ. CSDL chỉ giữ giá trị hiện tại; thay đổi trước ngày bật trigger **không khôi phục được**. CEO đã được báo.
- **Không** khôi phục giá trị cũ từ nhật ký (nút "hoàn tác"). Nhật ký là để đọc.
- **Không** thay `audit_log`. Hai thứ khác nhau: `audit_log` ghi *hành động* (đăng nhập, bấm đẩy giá, đổi cấu hình), nhật ký này ghi *thay đổi dữ liệu*. Giữ cả hai, không gộp.
- **Không** đụng vào việc chặn nhầm mã vận đơn — việc riêng, CEO còn chưa chốt chặn hay chỉ cảnh báo.

## 10. Hỏng kiểu nào là thất bại

- **Màn log trông đầy đủ nhưng thiếu.** Người đọc tin rằng "không có dòng nào ⇒ không ai sửa", trong khi thật ra đường ghi đó không bị bắt. Đây là lý do chọn trigger thay vì bắt ở tầng ứng dụng.
- **Gán sai người.** Tệ hơn không gán ai: nó buộc tội nhầm một nhân sự. Đây là lý do cấm `set_config` mức phiên trên pool dùng chung.
- **Nhiễu tới mức không ai mở.** Nếu mỗi lượt cron sinh hàng trăm dòng `last_tracked_at`, thao tác của người sẽ chìm và màn log thành vô dụng dù kỹ thuật vẫn "chạy đúng".
- **Làm chậm việc ghi.** Trigger nằm trong đường ghi nóng. Phải đo thời gian ghi trước và sau trên một bảng đông như `shipments`.

## 11. Để lại cho người làm

- Hình thù hàm `ghiVoi` và cách nó lồng với các giao dịch đang có (`shipPack` đã tự mở giao dịch).
- Hàm trigger viết chung một bản dùng cho mọi bảng, hay sinh riêng từng bảng.
- Cách lưu khoá chính dạng text cho bảng có khoá ghép (nếu có trong phạm vi).
- Bố cục cụ thể của hai màn, và chỗ đặt tab "Lịch sử" trong từng module.
- Bảng ánh xạ cột → nhãn tiếng Việt đặt ở đâu để không lệch với nhãn trên giao diện.
- Thứ tự triển khai: nên bật trigger trước trên **một** bảng, đo khối lượng và thời gian ghi thật, rồi mới mở rộng.

## 12. Ràng buộc dự án

- Di trú **áp tay** lên CSDL thật — `npm run db:migrate` in ra thành công nhưng không làm gì.
- `vitest` chỉ bắt `lib|features|components/**/*.test.ts`, **không** bắt `.tsx`; môi trường `node`, không có jsdom. Logic cần test phải nằm ở tệp `.ts` thuần.
- Hook `pre-push` chạy `tsc` + `eslint` + toàn bộ test; không đẩy khi đỏ.
