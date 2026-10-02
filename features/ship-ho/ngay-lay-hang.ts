/**
 * THUẦN: rút mốc hãng LẤY HÀNG từ lịch sử quét. Không I/O.
 *
 * `shipped_at` của SMS là lúc mình tạo nhãn (sự kiện `OC` — "Shipment information sent to
 * FedEx"), không phải lúc hàng rời kho (`PU` — "Picked up"). Phụ phí xăng dầu tính theo TUẦN
 * CỦA NGÀY ĐI, nên lấy nhầm mốc là tra nhầm tuần: AWB 873918787369 có OC 03/07 (tuần 38,50%)
 * và PU 06/07 (tuần 38,25%) — hãng áp 38,25%.
 */
export interface SuKienQuetToiThieu { eventType?: string | null; date?: string | null }

/** Mã sự kiện FedEx cho lượt lấy hàng. */
export const MA_LAY_HANG = 'PU';

/**
 * Mốc `PU` SỚM NHẤT trong lịch sử quét, hoặc `null`.
 *
 * Sớm nhất chứ không phải mới nhất: một lô bị trả về rồi gửi lại có thể có `PU` thứ hai, mà
 * cước và phụ phí thì tính theo lượt đi ĐẦU TIÊN.
 */
export function mocLayHang(suKien: readonly SuKienQuetToiThieu[]): Date | null {
  let som: Date | null = null;
  for (const e of suKien) {
    if (e.eventType !== MA_LAY_HANG || !e.date) continue;
    const d = new Date(e.date);
    if (Number.isNaN(d.getTime())) continue;
    if (som === null || d < som) som = d;
  }
  return som;
}
