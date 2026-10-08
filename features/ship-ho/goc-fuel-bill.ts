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
  /** Phụ phí xử lý đặc biệt (Additional Handling: quá cân, quá khổ, đóng gói không chuẩn).
   *  CHỊU fuel — chứng minh bằng hai vận đơn thật, xem test. NULL/vắng ở dòng bill cũ = 0. */
  additionalHandling?: number;
}

/**
 * Tổng các khoản mà hãng nhân %fuel lên.
 *
 * KHÔNG gồm VAT (tính sau cùng), duty và phí xử lý hàng nhập (hai khoản pass-through mà hoá đơn
 * FedEx thật cho thấy nằm ngoài gốc fuel — xem 845 dòng đo ngày 02/10/2026).
 *
 * CÓ gồm `additionalHandling` (08/10/2026). Kiểm bằng chính mức FedEx công bố: vận đơn
 * 873356889943 đi 22/06 (công bố 41,5%) — cộng AH vào ra đúng 41,500%, bỏ ra ra 65,475%. Vận
 * đơn 877674305295 đi 24/09 (công bố 51,75%) — cộng vào ra đúng 51,750%. Đáng chú ý: 65,475%
 * VẪN lọt lưới 0,25%, nên hàng rào lưới không bắt được ca này; chỉ mức công bố mới bắt được.
 */
export function gocFuelTrenBill(s: KhoanChiuFuel): number {
  return s.base + s.discount + s.remote + s.demand + s.signature + s.residential
    + s.addressCorrection + (s.additionalHandling ?? 0);
}

/** Hãng công bố phụ phí xăng dầu theo nấc 0,25% — FedEx, UPS, DHL đều vậy. */
export const NAC_FUEL = 0.25;
/** Sai số cho phép quanh một nấc: đủ che làm tròn của hãng, không đủ che mẫu số sai. */
export const SAI_SO_NAC = 0.05;

/**
 * %fuel suy từ hoá đơn có đáng tin không.
 *
 * Mọi mức hãng từng công bố đều là bội của 0,25%. Một con số nằm ngoài lưới đó KHÔNG phải mức
 * của hãng — nó là dấu hiệu MẪU SỐ SAI, tức mình quên một khoản chịu fuel.
 *
 * Vì sao cần chốt máy chứ không chỉ cần cẩn thận: ngày 02/10/2026 cột này hiện 52,65% cho đơn
 * #KLS1998 và 48,91% cho SV-0015 — cả hai đều ngoài lưới, cả hai đều do mẫu số thiếu phí sửa
 * địa chỉ. Em nhìn con số 52,65% và đi GIẢI THÍCH nó thay vì nghi nó, hai lượt liền. Một phép
 * kiểm số học bắt được ngay cái mà sự cẩn thận đã bỏ lọt hai lần.
 *
 * Đo trên toàn bộ 141 đơn đã đối soát ở production: 141/141 nằm trên lưới sau khi mẫu số đúng,
 * nên chốt này KHÔNG làm mất số của đơn nào đang hiển thị đúng.
 */
export function phanTramFuelDangTin(pct: number): boolean {
  if (!Number.isFinite(pct) || pct <= 0 || pct > 100) return false;
  return Math.abs(pct - Math.round(pct / NAC_FUEL) * NAC_FUEL) <= SAI_SO_NAC;
}
