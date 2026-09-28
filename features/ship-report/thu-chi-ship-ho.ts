/**
 * THUẦN: chọn doanh thu và chi phí của MỘT đơn ship hộ cho báo cáo P&L.
 *
 * Tách khỏi SQL vì một lỗi cụ thể (CEO báo 28/09/2026): báo cáo ship hiện margin
 * ship hộ ÂM mọi tháng. Truy vấn cũ viết thẳng trong SQL:
 *
 *     COALESCE(actual_charged_vnd, charged_vnd)      AS revenue
 *     COALESCE(actual_carrier_cost_vnd, carrier_cost_vnd) AS cost
 *
 * Hai vế KHÔNG cùng thước: từ 21/09/2026 duty tách khỏi cước, nên
 * `actual_charged_vnd` là cước thu của brand **không gồm duty**, còn
 * `actual_carrier_cost_vnd` là số thật trả hãng **có gồm duty**. Margin vì vậy
 * hụt đúng bằng duty.
 *
 * Đo trên đơn đã đối soát, cộng lại duty ra khớp `margin_vnd` đã lưu TỪNG ĐỒNG:
 *   2026-09: −7.625.714 → 12.797.514 (= margin_vnd)
 *   2026-08: −7.671.474 →  9.844.358 (= margin_vnd)
 *   2026-07:   −770.954 →  8.432.025 (= margin_vnd)
 *
 * Duty thu hộ brand ĐÚNG NGUYÊN GIÁ, không markup, nên cộng vào cả hai vế thì nó
 * tự triệt tiêu — margin không đổi, chỉ hết hụt oan. Cùng lý lẽ với
 * `displayChargedWithDuty` của bảng đơn ship hộ (features/ship-ho/pnl.ts), nơi
 * lỗi này đã được xử lý đúng từ trước; báo cáo chỉ là nơi bị bỏ sót.
 */

export interface DonShipHoTho {
  chargedVnd: number | null;
  actualChargedVnd: number | null;
  actualDutyVnd: number | null;
  carrierCostVnd: number | null;
  actualCarrierCostVnd: number | null;
}

export interface ThuChi {
  revenueVnd: number | null;
  costVnd: number | null;
  /** Hai vế lấy từ hai nguồn khác nhau (thu dự tính + chi thực, hoặc ngược lại). */
  lechNguon: boolean;
}

/**
 * Duty CHỈ cộng khi đang dùng số THỰC. Đơn chưa đối soát chỉ có báo giá, mà báo
 * giá vốn không có duty — cộng vào là bịa doanh thu.
 */
export function thuChiShipHo(d: DonShipHoTho): ThuChi {
  const thuThuc = d.actualChargedVnd != null;
  const chiThuc = d.actualCarrierCostVnd != null;

  const revenueVnd = thuThuc
    ? Math.round(d.actualChargedVnd! + (d.actualDutyVnd ?? 0))
    : (d.chargedVnd == null ? null : Math.round(d.chargedVnd));

  const costVnd = chiThuc
    ? Math.round(d.actualCarrierCostVnd!)
    : (d.carrierCostVnd == null ? null : Math.round(d.carrierCostVnd));

  return {
    revenueVnd,
    costVnd,
    // Trộn dự tính với thực làm margin sai lệch mà không ai thấy. Đo 28/09: 4 đơn
    // tháng 9 có chi THỰC nhưng thu vẫn DỰ TÍNH. Đánh dấu để báo cáo đếm được.
    lechNguon: thuThuc !== chiThuc && revenueVnd != null && costVnd != null,
  };
}
