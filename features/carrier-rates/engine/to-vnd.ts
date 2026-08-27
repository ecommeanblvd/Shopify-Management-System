/**
 * Quy cước engine về tiền Việt để so với số hãng đã thu.
 *
 * Bảng giá Aramex tính bằng USD nhưng Hợp Nhất xuất hoá đơn VNĐ. Tỉ giá phải
 * lấy của CHÍNH hoá đơn đang đối soát (bảng kê ghi sẵn: kỳ 25/07–22/08/2026 là
 * 26.310), không lấy tỉ giá tài khoản — tỉ giá tài khoản là con số hiện tại
 * (26.465) và trôi theo thời gian, dùng nó cho hoá đơn cũ sẽ đẻ ra chênh lệch
 * giả ở mọi đơn, hoá đơn càng cũ càng lệch.
 */
/**
 * Hệ số nhân để đưa số tiền của engine về VNĐ (1 đơn vị tiền chi phí = ? VNĐ).
 * Trả 1 khi tài khoản vốn tính bằng VNĐ, null khi không biết tỉ giá nào.
 *
 * Tách riêng vì đối soát phải quy đổi CẢ BẢNG chi tiết (cước gốc, xăng dầu,
 * vùng sâu vùng xa, VAT…) chứ không riêng cột tổng — để đô lẫn đồng trên cùng
 * một hàng thì không so được, và phần chẩn đoán sai lệch cũng đọc nhầm.
 */
export function heSoQuyDoiVnd(opts: {
  costCurrency: string;
  fxRateBill?: number | null;
  fxCostPerDisplay?: number | null;
}): number | null {
  if (opts.costCurrency === 'VND') return 1;
  if (opts.fxRateBill && opts.fxRateBill > 0) return opts.fxRateBill;
  if (opts.fxCostPerDisplay && opts.fxCostPerDisplay > 0) return 1 / opts.fxCostPerDisplay;
  return null;
}

export function cuocEngineSangVnd(opts: {
  /** Cước engine tính, theo đồng chi phí của tài khoản. */
  carrierCost: number;
  costCurrency: string;
  /** Tỉ giá ghi trên hoá đơn đang đối soát (1 đơn vị chi phí = ? VNĐ). */
  fxRateBill?: number | null;
  /** Tỉ giá tài khoản, dạng "1 VNĐ = ? đồng chi phí" — chỉ dùng khi hoá đơn
   *  không ghi tỉ giá. */
  fxCostPerDisplay?: number | null;
}): number | null {
  const { carrierCost } = opts;
  if (!Number.isFinite(carrierCost)) return null;
  const heSo = heSoQuyDoiVnd(opts);
  // Không biết tỉ giá thì KHÔNG đoán: trả null để chỗ gọi hiện "chưa so được"
  // thay vì bịa ra một con số trông như thật.
  return heSo === null ? null : Math.round(carrierCost * heSo);
}
