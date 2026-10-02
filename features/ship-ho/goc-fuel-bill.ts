/**
 * THUẦN: gốc tính phụ phí xăng dầu trên hoá đơn hãng. Không I/O.
 *
 * Tách thành module riêng vì hai nơi cần đúng một định nghĩa này và đã từng lệch nhau:
 *   - `carrier-invoice-lookup.billImpliedFuelPercent` — suy %fuel để TÍNH TIỀN thu brand;
 *   - `price-structure` cột `billPercent` — %fuel HIỆN trên bảng đối soát.
 * Bản cũ của cái thứ hai bỏ `addressCorrection` ra khỏi mẫu số, kèm chú thích nói carrier
 * không tính fuel trên khoản đó. Hoá đơn thật nói ngược: #KLS1998 (20/07/2026) có phí sửa địa
 * chỉ 289.200đ, bỏ ra thì %fuel hiện 52,65% — không phải một mức FedEx nào từng công bố; cộng
 * vào thì ra đúng 39,75%, chính là mức của tuần đó. Hai đơn hiện sai, cả hai đều có AC.
 *
 * `price-structure` là module THUẦN nên không import được `carrier-invoice-lookup` (file đó kéo
 * theo `db/client`) — đó là lý do helper nằm ở đây chứ không nằm cạnh một trong hai.
 */
export interface KhoanChiuFuel {
  base: number;
  /** Chiết khấu — lưu SỐ ÂM trên hoá đơn, nên CỘNG vào chứ không trừ. */
  discount: number;
  remote: number;
  demand: number;
  signature: number;
  residential: number;
  addressCorrection: number;
}

/**
 * Tổng các khoản mà hãng nhân %fuel lên.
 *
 * KHÔNG gồm VAT (tính sau cùng), duty và phí xử lý hàng nhập (hai khoản pass-through mà hoá đơn
 * FedEx thật cho thấy nằm ngoài gốc fuel — xem 845 dòng đo ngày 02/10/2026).
 */
export function gocFuelTrenBill(s: KhoanChiuFuel): number {
  return s.base + s.discount + s.remote + s.demand + s.signature + s.residential + s.addressCorrection;
}
