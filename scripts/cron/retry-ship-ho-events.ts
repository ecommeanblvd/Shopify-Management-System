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
import { chayCron } from '@/features/jobs/run';

async function main() {
  return retryPendingShipHoEvents();
}

chayCron('retry-ship-ho-events', main);
