/**
 * ⚠ BIA MỘ — KHÔNG SERVICE NÀO CHẠY TỆP NÀY. ĐỪNG THÊM VIỆC VÀO ĐÂY.
 *
 * Đo 27/10/2026: `.railway/railway.ts` không khai service nào có `start: "npm run
 * cron:track-ship-ho"`, và `railway status` không có service tương ứng. Khoá `track-ship-ho`
 * VẪN chạy (1.156 lượt, hàng giờ) nhưng là từ danh sách job của
 * `scripts/cron/sync-shopify-orders.ts` — dời sang đó ngày 05/09/2026 vì service cũ thiếu
 * credential FedEx/TrackingMore/DHL và hỏng 48/48 mỗi lượt trong im lặng.
 *
 * Tệp này còn ở lại chỉ để chạy TAY khi cần. Cái giá của việc nó trông còn sống: ngày
 * 02/10/2026 job `nap-ngay-lay-hang` được thêm vào đây và vì vậy **chạy 0 lần trong 25 ngày**,
 * trong khi giao diện và sổ đăng ký đều nói nó chạy mỗi 6 giờ. Việc đó giờ nằm ở
 * `sync-shopify-orders.ts`. Thêm việc mới thì thêm vào ĐÓ.
 *
 * Usage (chỉ chạy tay): `npm run cron:track-ship-ho`
 *
 * Poll trạng thái giao hàng các đơn ship hộ CHƯA giao → cập nhật
 * ship_ho_orders.delivery_status/delivered_at. One-way (carrier → hệ thống).
 * DHL cần env DHL_TRACK_API_KEY; thiếu key thì bỏ qua DHL.
 *
 * Exit codes: 0 — chạy xong; 1 — lỗi fatal.
 */

import { trackPendingShipHo, luotTrackHong } from '@/features/ship-ho/track';

import type { TomTatTrack } from '@/features/ship-ho/track-tom-tat';
import { chayCron } from '@/features/jobs/run';
async function main(): Promise<TomTatTrack> {
  const s = await trackPendingShipHo({ limit: 200 });
  process.stdout.write(
    `track-ship-ho: tracked ${s.tracked}, delivered ${s.delivered}, failed ${s.failed}, skipDHL ${s.skippedDhl}`
    + `${s.loi ? ` · lý do ${JSON.stringify(s.loi)}` : ''}\n`,
  );

  // Hỏng sạch mà vẫn báo xanh là cách tác vụ này chết âm thầm suốt nhiều tháng.
  if (luotTrackHong(s)) process.exitCode = 1;
  return s;
}

chayCron('track-ship-ho', main);
