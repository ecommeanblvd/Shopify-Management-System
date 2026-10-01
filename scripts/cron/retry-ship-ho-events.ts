/**
 * Standalone Railway-friendly cron entry point.
 * Usage: `npm run cron:retry-ship-ho`
 *
 * Gửi lại các sự kiện ship hộ còn kẹt trong outbox sang MMP. Bản đã BỊ VƯỢT
 * (có sự kiện mới hơn gửi thành công) được đánh dấu bỏ, không gửi — gửi lại số
 * cũ sẽ ghi đè dữ liệu đúng bên MMP (xem features/ship-ho/event-obsolete.ts).
 *
 * Trước 04/09 endpoint này tồn tại nhưng KHÔNG có lịch chạy: 9 sự kiện nằm im
 * từ tháng 7 với attempts = 0.
 */
import { retryPendingShipHoEvents } from '@/features/ship-ho/mmp-events';
import { thuLaiSuKienBangKe } from '@/features/ship-ho/statement-outbox';
import { chayCron, chayMotJob } from '@/features/jobs/run';

async function main() {
  /* Outbox CẤP BẢNG KÊ chạy LỒNG ở đây (CEO 01/10/2026), không khai vào nhóm: không service
   * Railway nào gọi `run-group` nên khai vào nhóm là khai suông (xem features/jobs/groups.ts).
   * Đặt TRƯỚC lượt cấp đơn: nó chỉ có vài dòng, còn lượt cấp đơn quét tới 200 dòng — hỏng ở
   * dưới thì cũng đã gửi xong phần trên. `chayMotJob` bắt lỗi nên một bên ngã không kéo bên kia. */
  const ke = await chayMotJob('retry-statement-events', () => thuLaiSuKienBangKe());
  const don = await retryPendingShipHoEvents();
  return { ...don, bangKe: ke };
}

chayCron('retry-ship-ho-events', main);
