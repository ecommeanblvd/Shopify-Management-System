/**
 * Pure staleness check for carriers WITHOUT an auto-fetcher. FedEx/DHL/UPS có
 * fetcher chạy tự động trong `apply.ts` (`fedex.ts` / `dhl.ts` / `ups.ts`) nên
 * được `findStaleAutoFuel` canh; mọi hãng còn lại — Aramex, và SF Express kể từ
 * 23/09/2026 (xem ghi chú ở `AUTO_FUEL_CARRIER_KEYS`) — đi đường này.
 *
 * These carriers' `fuel_percent` surcharge is entered by hand at
 * `/f/carrier-rates/[id]/surcharges`. Nothing keeps it fresh automatically,
 * so we need a REMINDER mechanism: a weekly cron that flags accounts whose
 * fuel % was never set, or hasn't been touched in `staleDays` days, so an
 * operator goes and checks the carrier's published rate.
 *
 * Kept carrier-agnostic and DB-agnostic (pure function over plain rows) so
 * it's trivially unit-testable — the cron script and the admin page banner
 * both call this with rows they've already queried.
 */

/** Carrier keys that have a working auto-fetch scraper (see `apply.ts`).
 *  Everything else is manual-fuel and eligible for the staleness reminder.
 *
 *  ĐÂY LÀ NGUỒN SỰ THẬT DUY NHẤT về "hãng nào được cron xăng dầu quét". Mọi
 *  đường vào (`features/carrier-rates/fuel-fetcher/refresh-all.ts`, dùng chung
 *  cho cả script cron lẫn route HTTP) PHẢI đọc hằng này, KHÔNG chép lại danh
 *  sách. Chép lại chính là lỗi đã xảy ra: route `/api/cron/refresh-fuel` giữ
 *  ['fedex','dhl'] từ 02/06/2026, nên khi thêm UPS + SF ngày 06/07 vào script
 *  thì hai hãng đó KHÔNG BAO GIỜ được gọi — mà tác vụ vẫn báo xanh 11 tuần. */
export const AUTO_FUEL_CARRIER_KEYS = ['fedex', 'dhl', 'ups'] as const;

// ⚠ SF Express ĐÃ BỊ GỠ khỏi danh sách trên — TẠM GỬI CHỖ, KHÔNG PHẢI ĐÃ SỬA.
//
// Lý do (xác minh 23/09/2026): trang nguồn bên Trung Quốc
// `sf-express.com/chn/en/support-more/international_fuel_surcharge_introduction`
// KHÔNG đăng thêm tuần nào sau 29/06/2026 — rà toàn trang không có một nhãn
// tháng 7, 8 hay 9 nào. Fetcher `sf.ts` vẫn chạy tốt: trả HTTP 200, parse ra 15
// tuần, 0 thay đổi. Tức bản thân MÃ không hỏng, NGUỒN DỮ LIỆU tự nó đã chết.
//
// Vì sao gỡ thay vì để `findStaleAutoFuel` kêu: để trong danh sách auto thì
// `refresh-fuel` sẽ ĐỎ mỗi ngày vì SF, mãi mãi, cho tới khi có nguồn khác. Một
// tác vụ lúc nào cũng đỏ sẽ tập cho người ta quen bỏ qua, rồi hỏng thật cũng
// không ai thấy — đúng cái bẫy mà bản sửa này sinh ra để tránh. CEO chốt
// 23/09/2026: giữ xanh có nghĩa, và "xanh" nghĩa là FedEx + DHL + UPS đều tươi.
//
// SF KHÔNG biến mất khỏi tầm mắt: nằm ngoài danh sách auto thì nó rơi vào
// `findStaleManualFuel` y như Aramex, nên trang
// `/f/carrier-rates/<id>/surcharges` của SF hiện băng cảnh báo "Fuel nhập tay
// chưa cập nhật — N ngày" (hôm nay: 25,00% từ 06/07, đã 79 ngày).
//
// `refreshSfFuel` + nhánh 'sf-express' trong dispatcher `apply.ts` vẫn giữ
// nguyên: nút bấm tay vẫn dùng được, và ngày nào SF có nguồn đăng đều đặn trở
// lại thì chỉ cần thêm 'sf-express' vào mảng trên là xong.

export interface ManualFuelRow {
  accountId: string;
  accountName: string;
  carrierKey: string;
  fuelPercent: number | null;
  updatedAt: Date | null;
}

export interface StaleFuel extends ManualFuelRow {
  reason: 'unset' | 'stale';
  daysSince: number | null;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Filter manual-fuel carrier rows (carrier key NOT in `AUTO_FUEL_CARRIER_KEYS`)
 * down to the ones that need an operator's attention:
 *   - `fuelPercent === null` (no `fuel_percent` surcharge row at all) → the
 *     carrier is priced ALL-IN (e.g. Aramex: fuel + VAT already baked into
 *     the rate card, so there's deliberately no separate fuel line) →
 *     **skip, never flag**. Nagging about a row that will never exist is
 *     pure noise.
 *   - `fuelPercent === 0` (a `fuel_percent` row EXISTS but its value is the
 *     0 placeholder from a fresh seed) → 'unset' (needs a real number
 *     entered).
 *   - row exists, value > 0, `updatedAt` more than `staleDays` days before
 *     `now` → 'stale'.
 *   - row exists, value > 0, updated within `staleDays` → not flagged.
 *
 * Hãng nằm trong `AUTO_FUEL_CARRIER_KEYS` luôn bị bỏ qua ở đây — cron giữ tươi
 * giúp rồi, và `findStaleAutoFuel` bên dưới mới là chỗ canh chúng. Kêu ở cả hai
 * nơi chỉ tổ ồn.
 */
export function findStaleManualFuel(
  rows: ManualFuelRow[],
  now: Date,
  staleDays = 7,
): StaleFuel[] {
  const autoKeys = new Set<string>(AUTO_FUEL_CARRIER_KEYS);
  const result: StaleFuel[] = [];

  for (const row of rows) {
    if (autoKeys.has(row.carrierKey)) continue;

    // No fuel_percent row at all → all-in carrier, not applicable. Skip.
    if (row.fuelPercent === null) continue;

    if (row.fuelPercent === 0) {
      result.push({ ...row, reason: 'unset', daysSince: null });
      continue;
    }

    if (row.updatedAt === null) {
      // Fuel is set but we have no updatedAt to judge staleness — shouldn't
      // happen in practice (the surcharge row always has updatedAt), but
      // treat conservatively as unset rather than silently skipping.
      result.push({ ...row, reason: 'unset', daysSince: null });
      continue;
    }

    const daysSince = Math.floor((now.getTime() - row.updatedAt.getTime()) / MS_PER_DAY);
    if (daysSince > staleDays) {
      result.push({ ...row, reason: 'stale', daysSince });
    }
  }

  return result;
}

/**
 * Mặt còn lại của tấm gương: hãng CÓ auto-fetch cũng phải bị canh.
 *
 * `findStaleManualFuel` cố ý BỎ QUA mọi hãng trong `AUTO_FUEL_CARRIER_KEYS` vì
 * giả định "đã có cron lo". Chính giả định đó tạo ra điểm mù: khi cron không
 * bao giờ gọi tới hãng đó (UPS + SF Express, 06/07→23/09/2026 — route
 * `/api/cron/refresh-fuel` lọc cứng ['fedex','dhl']) thì KHÔNG ai canh nữa,
 * mức xăng dầu đứng im 11 tuần mà tác vụ vẫn báo xanh.
 *
 * Hàm này THUẦN: nhận tuần mới nhất đang lưu của từng hãng auto, trả về hãng
 * nào đã quá hạn. Xăng dầu công bố theo TUẦN nên ngưỡng mặc định 14 ngày (2 kỳ)
 * là đã chắc chắn hỏng chứ không phải trễ nhịp.
 */
export interface AutoFuelRow {
  accountId: string;
  accountName: string;
  carrierKey: string;
  /** `starts_at` của dòng fuel_percent mới nhất đang lưu; null = chưa có dòng nào. */
  newestWeekStart: Date | null;
}

export interface AutoFuelStale extends AutoFuelRow {
  reason: 'unset' | 'stale';
  daysSince: number | null;
}

export function findStaleAutoFuel(
  rows: AutoFuelRow[],
  now: Date,
  staleDays = 14,
): AutoFuelStale[] {
  const autoKeys = new Set<string>(AUTO_FUEL_CARRIER_KEYS);
  const result: AutoFuelStale[] = [];

  for (const row of rows) {
    // Hãng nhập tay đã có `findStaleManualFuel` lo — ở đây chỉ canh hãng auto.
    if (!autoKeys.has(row.carrierKey)) continue;

    if (row.newestWeekStart === null) {
      result.push({ ...row, reason: 'unset', daysSince: null });
      continue;
    }

    const daysSince = Math.floor((now.getTime() - row.newestWeekStart.getTime()) / MS_PER_DAY);
    if (daysSince > staleDays) {
      result.push({ ...row, reason: 'stale', daysSince });
    }
  }

  return result;
}
