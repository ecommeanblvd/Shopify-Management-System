/**
 * Standalone Railway-friendly cron entry point.
 * Usage: `npm run cron:track-ship-ho`
 *
 * Poll trạng thái giao hàng các đơn ship hộ CHƯA giao → cập nhật
 * ship_ho_orders.delivery_status/delivered_at. One-way (carrier → hệ thống).
 * DHL cần env DHL_TRACK_API_KEY; thiếu key thì bỏ qua DHL.
 *
 * Exit codes: 0 — chạy xong; 1 — lỗi fatal.
 */

import { trackPendingShipHo, luotTrackHong } from '@/features/ship-ho/track';

import type { TomTatTrack } from '@/features/ship-ho/track-tom-tat';
import { chayCron, chayMotJob } from '@/features/jobs/run';
import { napNgayLayHang } from '@/features/ship-ho/nap-ngay-lay-hang';
async function main(): Promise<TomTatTrack> {
  const s = await trackPendingShipHo({ limit: 200 });
  process.stdout.write(
    `track-ship-ho: tracked ${s.tracked}, delivered ${s.delivered}, failed ${s.failed}, skipDHL ${s.skippedDhl}`
    + `${s.loi ? ` · lý do ${JSON.stringify(s.loi)}` : ''}\n`,
  );
  /* Nạp ngày hãng lấy hàng — ĐI CÙNG lượt track vì cùng gọi FedEx và cùng chu kỳ 6 giờ.
   * Lồng trong `chayMotJob` nên hỏng cũng không kéo đổ lượt track đã xong ở trên. */
  await chayMotJob('nap-ngay-lay-hang', async () => {
    const k = await napNgayLayHang({ gioiHan: 200 });
    process.stdout.write(`nap-ngay-lay-hang: thử ${k.thu}, lấy được ${k.co}, chưa có ${k.khong}, lệch ngày gửi ${k.lech}\n`);
    return k;
  });

  // Hỏng sạch mà vẫn báo xanh là cách tác vụ này chết âm thầm suốt nhiều tháng.
  if (luotTrackHong(s)) process.exitCode = 1;
  return s;
}

chayCron('track-ship-ho', main);
