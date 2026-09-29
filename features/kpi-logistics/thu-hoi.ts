/**
 * THUẦN: tỉ lệ THỰC THU dùng cho hệ số K của tiêu chí 3C.
 *
 * Lỗi phải sửa (CEO 29/09/2026): tỉ lệ cũ lấy TỬ SỐ là tổng credit note theo ngày hoá đơn, còn
 * MẪU SỐ là tổng mức khiếu nại của các dòng đối soát trong kỳ. Hai tập khác nhau trên hai trục
 * thời gian khác nhau, nên nó không trả lời được câu hỏi nào cả. Đo tháng 8: 50.676.806 / 21.001.269
 * = 241%, và vì mọi giá trị ≥ 90% đều cho K = 1,0 nên hệ số chất lượng này **luôn** bằng 1 —
 * tưởng là đang chấm, thật ra đã thôi chấm từ lâu.
 *
 * Bằng chứng hai tập rời nhau: 10 credit note của tháng 8 đều là DHL, và `credit_note_lines` rỗng
 * 0 dòng nên không nối được credit note nào về kiện nào (D-137).
 *
 * Luật mới: tử số và mẫu số lấy từ CHÍNH những dòng đối soát đó. Câu hỏi K hỏi là "trong số tiền
 * ta đã xác định hãng sai, đòi lại được bao nhiêu phần" — chỉ trả lời được khi hai vế cùng một tập.
 */

export interface DongKhieuNai {
  /** Mức chênh đã khiếu nại tại thời điểm đối soát, VND, luôn lấy trị tuyệt đối. */
  khieuNaiVnd: number;
  /** Tiền hãng đã thực trả lại cho chính dòng này, VND. */
  thuHoiVnd: number;
}

export interface TongThuHoi {
  soDong: number;
  khieuNaiVnd: number;
  /** Tổng thu hồi ĐÃ CHẶN TRẦN theo từng dòng. */
  thuHoiVnd: number;
  /** Tổng thu hồi thô, chưa chặn — giữ để đối chiếu khi số lệch. */
  thuHoiThoVnd: number;
  /** 0..1; null khi không có dòng nào thuộc diện khiếu nại (chưa đo được, khác với 0%). */
  tyLe: number | null;
}

/**
 * Cộng các dòng khiếu nại, CHẶN TRẦN TỪNG DÒNG trước khi cộng.
 *
 * Vì sao chặn trần: đo production thấy 2 dòng hãng trả lại NHIỀU HƠN mức mình khiếu nại, dư tổng
 * 1.773.893đ. Cộng gộp thì phần dư đó bù cho những dòng khác còn đòi thiếu, và tỉ lệ đẹp lên mà
 * không ai đòi thêm được đồng nào. Đúng họ với lỗi cộng gộp ở nhận hàng PO (D-145). Tháng 8:
 * 82,3% thành 76,8% sau khi chặn; tháng 7: 27,9% thành 25,1%.
 */
export function gomThuHoi(dong: readonly DongKhieuNai[]): TongThuHoi {
  let khieuNai = 0, thuHoi = 0, tho = 0;
  for (const d of dong) {
    const k = Math.abs(d.khieuNaiVnd) || 0;
    const t = Math.max(0, d.thuHoiVnd || 0);
    khieuNai += k;
    tho += t;
    thuHoi += Math.min(t, k);
  }
  return {
    soDong: dong.length,
    khieuNaiVnd: Math.round(khieuNai),
    thuHoiVnd: Math.round(thuHoi),
    thuHoiThoVnd: Math.round(tho),
    // Không có dòng nào thuộc diện khiếu nại thì CHƯA ĐO ĐƯỢC, không phải "thu hồi 0%".
    // heSoK(null) trả 0,6 — mức thận trọng, đúng tinh thần "chưa có bằng chứng thì chưa cho điểm".
    tyLe: khieuNai > 0 ? thuHoi / khieuNai : null,
  };
}
