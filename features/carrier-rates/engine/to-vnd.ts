/**
 * Quy cước engine về tiền Việt để so với số hãng đã thu.
 *
 * Bảng giá Aramex tính bằng USD nhưng Hợp Nhất xuất hoá đơn VNĐ. Tỉ giá phải
 * lấy của CHÍNH hoá đơn đang đối soát (bảng kê ghi sẵn: kỳ 25/07–22/08/2026 là
 * 26.310), không lấy tỉ giá tài khoản — tỉ giá tài khoản là con số hiện tại
 * (26.465) và trôi theo thời gian, dùng nó cho hoá đơn cũ sẽ đẻ ra chênh lệch
 * giả ở mọi đơn, hoá đơn càng cũ càng lệch.
 */
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
  const { carrierCost, costCurrency, fxRateBill, fxCostPerDisplay } = opts;
  if (!Number.isFinite(carrierCost)) return null;
  if (costCurrency === 'VND') return Math.round(carrierCost);
  if (fxRateBill && fxRateBill > 0) return Math.round(carrierCost * fxRateBill);
  if (fxCostPerDisplay && fxCostPerDisplay > 0) return Math.round(carrierCost / fxCostPerDisplay);
  // Không biết tỉ giá thì KHÔNG đoán: trả null để chỗ gọi hiện "chưa so được"
  // thay vì bịa ra một con số trông như thật.
  return null;
}
