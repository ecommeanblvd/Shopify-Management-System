/**
 * THUẦN: nhận hãng vận chuyển từ DẠNG mã vận đơn (CEO 19/09/2026).
 *
 * Vì sao: hãng chọn tay hay sai (mã 1Z… bị ghi FedEx, 23 kiện 17/09) hoặc bị bỏ trống (3 đơn
 * ship hộ có mã nhưng không hãng → không tra được, MMP không nhận sự kiện nào). Dạng mã của
 * bốn hãng đang dùng tách bạch hoàn toàn — kiểm trên 6.100 mã trong DB 19/09/2026:
 *   FedEx  12 chữ số   (2.772 + 142 mã, 0 va chạm)
 *   DHL    10 chữ số   (3.042)
 *   Aramex 11 chữ số   (118)
 *   UPS    "1Z" + 16 ký tự chữ-số (23)
 * Dạng lạ → null: KHÔNG đoán, để người chọn.
 */
export type HangTheoMa = 'fedex' | 'dhl' | 'aramex' | 'ups';

export function hangTheoMaVanDon(tn: string | null | undefined): HangTheoMa | null {
  if (!tn) return null;
  const m = tn.replace(/\s+/g, '').toUpperCase();
  if (/^1Z[0-9A-Z]{16}$/.test(m)) return 'ups';
  if (/^\d{12}$/.test(m)) return 'fedex';
  if (/^\d{11}$/.test(m)) return 'aramex';
  if (/^\d{10}$/.test(m)) return 'dhl';
  return null;
}
