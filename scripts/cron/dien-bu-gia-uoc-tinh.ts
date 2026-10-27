/**
 * Cron điền bù giá ước tính lên Lark.
 * Dùng: `npm run cron:dien-bu-gia-uoc-tinh`
 *
 * ## Vì sao tệp này sinh ra (BL-2, 27/10/2026)
 *
 * Route `app/api/cron/dien-bu-gia-uoc-tinh/route.ts` được viết từ 12/10 nhưng **chưa bao giờ
 * được gọi**: không npm script, không cron service trong `.railway/railway.ts`, và `job_runs`
 * có **0 lượt** cho khoá này. Trong khi đó giao diện nhập mã vận đơn hứa thẳng với nhân sự
 * *"vẫn lưu được mã vận đơn, cron sẽ thử lại"* — một lưới an toàn không tồn tại. Kiện PK-22436
 * nằm im hơn 20 giờ rồi thành báo lỗi BL-2, và đo lại thì giá **lấy được bình thường**
 * (UPS mức 65, 1.035.880đ): thứ duy nhất thiếu là lượt thử lại.
 *
 * ## Vì sao PHẢI là service riêng, không nhét vào `sync Lark operation`
 *
 * Chuỗi đó đã chứa cả họ job Lark nên trông như chỗ đúng, NHƯNG đo 27/10/2026: service
 * `sync Lark operation` **chỉ có `LARK_*`** — không có `UPS_ACCOUNT_NUMBER`, không có
 * `FEDEX_*`. Đặt job vào đó là nó trả null ngay ở chốt `!soTaiKhoan` mỗi lượt. Và không cron
 * service nào hiện có đủ bộ: `cron-sync-orders`/`cron-track-shipments` có `UPS_CLIENT_*` nhưng
 * **thiếu `UPS_ACCOUNT_NUMBER`** và không có `LARK_*`. Chỉ service chính đủ.
 *
 * Xem thêm bẫy "cron chạy ở SERVICE KHÁC" trong `AGENTS.md`.
 *
 * Exit codes: 0 — chạy xong; 1 — lỗi fatal.
 */
import { chayDienBuGiaUocTinh } from '@/features/dong-hang/dien-bu';
import { chayCron } from '@/features/jobs/run';

/* `kiemTra` giống hệt route: tác vụ chạy xong KHÔNG có nghĩa là làm được việc. Thiếu nó thì
 * một lượt mà 20/20 kiện thất bại vẫn ghi `ok` và trang giám sát báo xanh. */
chayCron('dien-bu-gia-uoc-tinh', chayDienBuGiaUocTinh, (s) => {
  const t = s as Awaited<ReturnType<typeof chayDienBuGiaUocTinh>>;
  return t.tongSoXetDuyet > 0 && t.ghiDuoc === 0
    ? `0/${t.tongSoXetDuyet} kiện ghi được giá lên Lark${t.canhBaos.length > 0 ? ` — ${t.canhBaos[0]}` : ''}`
    : null;
});
