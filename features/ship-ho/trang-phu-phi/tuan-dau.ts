/**
 * THUẦN: lọc các tuần phụ phí dầu CHỈ còn những tuần brand đó thực sự có đơn gửi.
 *
 * Vì sao giới hạn (CEO 02/10/2026): mức dầu là con số ĐÃ DÙNG để tính tiền chính brand đó, nên
 * đưa cho họ là xuất trình căn cứ. Trả cả bảng lùi tới 01/2025 thì trang thành kho tra cứu cho
 * cả thị trường — thứ CEO nói rõ là không muốn ("không muốn quá tiện lợi cho brand").
 *
 * Vì sao link sang hãng KHÔNG thay được chỗ này: FedEx/DHL/UPS chỉ công bố tuần HIỆN TẠI. Kalisa
 * đối soát tháng 7 mở trang FedEx sẽ thấy mức của tuần này, không phải 38,5% của tuần 29/06.
 * Đo 02/10/2026: SMS giữ FedEx 84 dòng, DHL 42, UPS 25 — là nơi duy nhất còn lịch sử.
 */
export interface TuanDau {
  /** `YYYY-MM-DD`. */
  tu: string;
  /** `YYYY-MM-DD`, hoặc `null` = mức đang mở. */
  den: string | null;
  phanTram: number;
}

/**
 * Khoảng NỬA MỞ `[tu, den)`.
 *
 * Ngày gửi đúng bằng `den` thuộc tuần SAU, không phải tuần này: hãng đổi mức vào đúng ngày
 * biên, nên lấy khoảng đóng hai đầu là đưa brand mức của tuần khác làm căn cứ — sai một ngày ở
 * đây là sai cả con số họ dùng để đối soát.
 *
 * `den === null` = mức đang mở, so tới `homNay`.
 *
 * So sánh chuỗi `YYYY-MM-DD` trực tiếp, không dựng `Date`: định dạng này sắp theo thứ tự từ
 * điển đúng bằng thứ tự thời gian, và dựng `Date` từ chuỗi ngày sẽ kéo múi giờ vào một phép so
 * vốn chỉ cần tới ngày.
 */
export function locTuanCoDon(
  tuan: readonly TuanDau[],
  ngayGui: readonly string[],
  homNay: string,
): TuanDau[] {
  const giu = tuan.filter((w) => {
    const den = w.den ?? homNay;
    return ngayGui.some((d) => d >= w.tu && d < den);
  });
  // Mới nhất trên cùng: brand đối soát thường bắt đầu từ kỳ gần nhất.
  return [...giu].sort((a, b) => b.tu.localeCompare(a.tu));
}
