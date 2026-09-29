/**
 * THUẦN: MỐC ÁP QUY CHẾ — ranh giới giữa "nợ lịch sử" và "việc thuộc trách nhiệm của kỳ".
 *
 * Vì sao cần (CEO 29/09/2026): Gate Pillar 3 đòi TỒN ĐỌNG đối soát bằng 0. Đo ngày 29/09 thấy
 * 2.431 kiện tồn, trải từ 06/2025 đến 07/2026 và KHÔNG một kiện nào thuộc tháng đang chấm. Đó là
 * nợ có từ trước khi quy chế tồn tại. Giữ nguyên thì Gate không bao giờ đạt dù người phụ trách
 * làm tốt đến đâu — tức tiêu chí không còn đo được gì, chỉ còn chặn.
 *
 * Mốc 01/08/2026 là CEO chọn: tháng 8 là kỳ đầu tiên được chấm nên tồn của nó bằng 0, rồi từ
 * tháng 9 trở đi Gate bắt đầu đòi đối soát xong kiện tháng 8 — đội có đúng một kỳ ân hạn.
 *
 * ĐÂY KHÔNG PHẢI XOÁ NỢ: 2.431 kiện cũ vẫn nằm nguyên trong danh sách đối soát và vẫn phải dọn.
 * Chỉ là chúng không còn khoá Gate của người không gây ra chúng.
 */

/** Kiện gửi TRƯỚC ngày này là nợ lịch sử — không tính vào tồn đọng của Gate. */
export const MOC_AP_QUY_CHE = '2026-08-01';

/**
 * Một kiện có bị tính vào tồn đọng Gate của kỳ bắt đầu ngày `dauKy` không.
 *
 * Hai điều kiện, cả hai đều theo NGÀY GỬI: phải từ mốc quy chế trở đi (không phải nợ lịch sử),
 * và phải trước đầu kỳ (hoá đơn carrier về trễ — kiện gửi trong chính kỳ đang chấm thì chưa thể
 * đối soát xong, quy chế chi trả gối một kỳ).
 */
export function tinhVaoTonDong(ngayGui: string, dauKy: string): boolean {
  return ngayGui >= MOC_AP_QUY_CHE && ngayGui < dauKy;
}
