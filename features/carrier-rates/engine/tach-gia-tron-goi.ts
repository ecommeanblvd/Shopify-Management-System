/**
 * Tách một ô giá TRỌN GÓI thành cước gốc, để engine tự cộng lại phụ phí xăng
 * dầu và VAT.
 *
 * Vì sao cần: HNC (Aramex Việt Nam) chỉ phát hành bảng giá đã gộp sẵn — cả hai
 * bản 01/10/2025 và 01/07/2026 đều ghi "Bảng giá cước bao gồm Phụ Phí xăng dầu
 * & VAT" — và họ không có bảng giá net. Trong khi bảng kê hàng tháng lại tách
 * ba khoản riêng. Không tách thì màn đối soát chỉ so được con số tổng, cột phụ
 * phí xăng dầu và VAT của phía hệ thống luôn trống, không đối chiếu được với
 * bảng kê.
 *
 * Thứ tự cộng của hãng (đọc từ bảng kê kỳ 25/07–22/08/2026):
 *   cước gốc → + phụ phí xăng dầu (% trên cước gốc) → + phí phát sinh cố định
 *   → + VAT (% trên toàn bộ)
 * nên tách ngược đúng theo thứ tự đó.
 *
 * LƯU Ý: tách rồi ghép lại phải ra lại chính con số cũ, nếu không giá báo cho
 * khách ở khâu thanh toán sẽ đổi — việc này chỉ nhằm mục đích đối soát, không
 * được phép động tới giá bán.
 *
 * Cột giá chỉ lưu 2 chữ số thập phân, mà mỗi cent của cước gốc nở thành 1,4
 * cent ở giá trọn gói, nên không phải giá nào cũng khôi phục khít tuyệt đối.
 * Hàm thử cả ba ứng viên quanh giá trị lý thuyết và giữ cái sai ít nhất — sai
 * lệch còn lại tối đa dưới 1 cent (~26₫), không nhìn thấy được ở khâu bán hàng.
 */
export interface ThamSoTach {
  /** Phụ phí xăng dầu tính trên cước gốc, ví dụ 30. */
  fuelPercent: number;
  /** Thuế suất tính trên toàn bộ, ví dụ 8. */
  vatPercent: number;
  /** Phí phát sinh cố định mỗi lô (cùng đơn vị tiền với ô giá). */
  phiPhatSinh: number;
}

/** Tách ngược: từ giá trọn gói ra cước gốc, chọn cent khôi phục sát nhất. */
export function tachGiaTronGoi(giaTronGoi: number, t: ThamSoTach): number {
  const chuaVat = giaTronGoi / (1 + t.vatPercent / 100);
  const lyThuyet = (chuaVat - t.phiPhatSinh) / (1 + t.fuelPercent / 100);
  const giua = Math.round(lyThuyet * 100) / 100;
  let tot = giua;
  let saiIt = Infinity;
  for (const ungVien of [Math.round((giua - 0.01) * 100) / 100, giua, Math.round((giua + 0.01) * 100) / 100]) {
    const sai = Math.abs(ghepLaiTronGoi(ungVien, t) - giaTronGoi);
    if (sai < saiIt) { saiIt = sai; tot = ungVien; }
  }
  return tot;
}

/** Ghép lại theo đúng thứ tự hãng cộng — dùng để kiểm tra phép tách. */
export function ghepLaiTronGoi(goc: number, t: ThamSoTach): number {
  const chuaVat = goc * (1 + t.fuelPercent / 100) + t.phiPhatSinh;
  return Math.round(chuaVat * (1 + t.vatPercent / 100) * 100) / 100;
}

/** Sai lệch tuyệt đối sau khi tách rồi ghép lại, làm tròn tới cent (phép trừ
 *  số thực để nguyên sẽ ra 0,010000000000005 và làm hỏng mọi phép so sánh). */
export function saiLechSauTach(giaTronGoi: number, t: ThamSoTach): number {
  return Math.round(Math.abs(ghepLaiTronGoi(tachGiaTronGoi(giaTronGoi, t), t) - giaTronGoi) * 100) / 100;
}
