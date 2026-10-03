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
/** Mã sự kiện UPS cho lượt lấy hàng. UPS dùng CÙNG mã này cho lượt ra xe giao. */
export const MA_LAY_HANG_UPS = 'P';

/** Mốc sự kiện SỚM NHẤT mang mã `ma`, hoặc `null`. */
function mocSomNhat(suKien: readonly SuKienQuetToiThieu[], ma: string): Date | null {
  let som: Date | null = null;
  for (const e of suKien) {
    if (e.eventType !== ma || !e.date) continue;
    const d = new Date(e.date);
    if (Number.isNaN(d.getTime())) continue;
    if (som === null || d < som) som = d;
  }
  return som;
}

export function mocLayHang(suKien: readonly SuKienQuetToiThieu[]): Date | null {
  return mocSomNhat(suKien, MA_LAY_HANG);
}

/**
 * Mã sự kiện UPS cho lượt di chuyển thật (Export Scan, Arrived/Departed…). Dùng làm ĐƯỜNG LÙI
 * khi lô không có `Pickup Scan`.
 */
export const MA_DI_CHUYEN_UPS = 'I';

/**
 * Mốc lấy hàng UPS: `P` (Pickup Scan) sớm nhất, thiếu thì `I` sớm nhất.
 *
 * Vì sao cần đường lùi: đo 5 lô UPS thật ngày 03/10/2026 thì chỉ 1 lô có `P`. Lô 1Z…932029623
 * đi thẳng từ `M` ("Shipper created a label, UPS has not received the package") sang `I`
 * ("Export Scan") — UPS đơn giản là không ghi lượt lấy hàng.
 *
 * KHÔNG BAO GIỜ dùng `M`: đó là mốc TẠO NHÃN, tương đương `OC` của FedEx — chính thứ đã làm
 * `shipped_at` lệch 3 ngày với ngày đi thật.
 *
 * Đường lùi `I` là xấp xỉ: nó xảy ra SAU lúc hãng cầm hàng, nên có thể trễ hơn mốc thật. Cái
 * canh nó là CỔNG CHỐT KỲ: nếu ngày chọn rơi nhầm tuần thì %fuel suy từ hoá đơn sẽ không khớp
 * mức công bố của tuần đó và cổng chặn. Chưa có hoá đơn UPS nào để chạy phép kiểm ấy, nên khi
 * hoá đơn đầu tiên về thì phải soi lại.
 */
export function mocLayHangUps(suKien: readonly SuKienQuetToiThieu[]): Date | null {
  return mocSomNhat(suKien, MA_LAY_HANG_UPS) ?? mocSomNhat(suKien, MA_DI_CHUYEN_UPS);
}
