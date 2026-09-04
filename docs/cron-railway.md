# Bật lịch cron trên Railway

Mỗi tác vụ nền là **một service riêng** trên Railway, cùng trỏ về repo này nhưng
dùng file cấu hình khác nhau. Lịch chạy nằm trong file (`cronSchedule`), nên
sửa lịch = sửa file + đẩy code, không phải bấm lại trên web.

## Tạo một cron service

1. Railway → project **Shopify Management System** → **+ New** → **GitHub Repo**
   → chọn `ecommeanblvd/Shopify-Management-System`.
2. Vào service vừa tạo → **Settings**:
   - **Service Name**: đặt theo tác vụ, ví dụ `cron-retry-mmp`.
   - **Config as code** → điền đúng tên file, ví dụ `railway.cron-retry-mmp.json`.
     *Đây là bước quyết định — sai tên file thì service chạy như web app.*
3. **Variables** → **Add Variable Reference** → chọn service chính, thêm HẾT biến
   (tối thiểu `DATABASE_URL` và biến của tác vụ đó, ví dụ `MMP_ORDERS_URL`,
   `MMP_OUTBOUND_SECRET`). **Thiếu biến là tác vụ chạy nhưng không làm gì và
   không báo lỗi** — đúng cái đã xảy ra với outbox MMP.
4. **Deploy**. Railway đọc `cronSchedule` trong file và tự lên lịch.

## Kiểm tra đã chạy chưa

Mở `/f/jobs` trong hệ thống (Settings → Admin → Tác vụ nền). Sau một chu kỳ, tác
vụ phải chuyển **✅ Bình thường**. Còn **❌ Chưa chạy lần nào** nghĩa là service
chưa tạo, sai tên file cấu hình, hoặc thiếu biến môi trường.

**Không tin file cấu hình, chỉ tin trang `/f/jobs`** — nó đọc nhật ký do chính
tác vụ ghi ra.

## Danh sách file ↔ lịch

| File cấu hình | Tác vụ | Lịch |
|---|---|---|
| `railway.cron.json` | Đồng bộ đơn Shopify | mỗi giờ |
| `railway.cron-retry-mmp.json` | Đẩy đơn sang MMP | 15 phút/lần |
| `railway.cron-retry-ship-ho.json` | Gửi lại sự kiện MMP kẹt | 15 phút/lần |
| `railway.cron-lark.json` | Đồng bộ Lark | mỗi giờ, phút 15 |
| `railway.cron-track.json` | Tra giao hàng (đơn nhà) | 6 giờ/lần |
| `railway.cron-track-ship-ho.json` | Tra giao hàng (ship hộ) | 6 giờ/lần |
| `railway.cron-lifecycle.json` | Vòng đời đơn | 6 giờ/lần |
| `railway.cron-surcharges.json` | Phụ phí hãng | 01:00 hằng ngày |
| `railway.cron-vcb.json` | Tỉ giá Vietcombank | 02:00 hằng ngày |
| `railway.cron-wh-sync.json` | Tồn kho Lark | 05:00 hằng ngày |
| `railway.cron-meanblvd.json` | Đẩy tồn lên Shopify | 05:30 hằng ngày |
| `railway.cron-create-sale.json` | Tạo sản phẩm -Sale | 06:00 hằng ngày |
| `railway.cron-sync-catalog.json` | Catalog Shopify | 07:00 hằng ngày |
| `railway.cron-prune-logs.json` | Dọn bảng log | 03:00 thứ Hai |
| `railway.cron-refresh-demand.json` | Phụ phí demand FedEx | 04:00 thứ Hai |
| `railway.cron-remind-fuel.json` | Nhắc nhập xăng dầu | 08:00 thứ Hai |
| `railway.cron-geo.json` | Dữ liệu địa lý | 09:00 ngày 1 hằng tháng |

Giờ trên Railway là **UTC**. Ví dụ `0 3 * * 1` = 10:00 sáng thứ Hai giờ Việt Nam.

## Ưu tiên nếu chỉ bật được vài cái

1. `cron-retry-mmp` — MMP đang thiếu đơn, đây là cái đau nhất.
2. `cron-retry-ship-ho` — outbox kẹt vĩnh viễn nếu không có.
3. `cron-track` — trạng thái giao đơn nhà đã đứng im gần 2 tháng.
4. `cron-prune-logs` — database phình tới trần dung lượng.
