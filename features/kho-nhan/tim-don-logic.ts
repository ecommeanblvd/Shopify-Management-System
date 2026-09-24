/** THUẦN: luật của ô tìm món chờ nhận. Không I/O. */

/**
 * Dòng đặt 3 chiếc mới về 1 thì VẪN còn nhận được — hàng về nhiều đợt là chuyện
 * thường. Ẩn sớm là kho không nhận nốt được hàng đợt sau.
 */
export function conNhanDuoc(d: { datSl: number; daNhan: number }): boolean {
  return d.daNhan < d.datSl;
}

export type KieuTuKhoa = 'qua_ngan' | 'id' | 'chu';

/** Tem `V:` in ra số trần; id Shopify dài ≥ 10 chữ số nên số ngắn không bị nhầm. */
export function kieuTuKhoa(raw: string): KieuTuKhoa {
  const q = raw.trim();
  if (q.length < 2) return 'qua_ngan';
  return /^\d{10,}$/.test(q) ? 'id' : 'chu';
}

/**
 * THUẦN: phần SỐ trong từ khoá, để tìm dự phòng khi phần chữ gõ sai.
 *
 * Kho gõ nhanh, một tay cầm hàng — đảo chữ là chuyện thường. CEO gõ "MBVLD28543"
 * thay vì "MBLVD28543" (24/09) và màn chỉ trả ô trống, không gợi ý gì. Số trong
 * mã đơn thì hiếm khi gõ sai vì nó đọc từ phiếu, nên lấy nó làm phao.
 *
 * Chỉ trả khi chuỗi số đủ dài (>= 4) để không biến "áo 2" thành tìm mọi đơn có số 2.
 */
export function phanSo(raw: string): string | null {
  const so = raw.trim().replace(/\D/g, '');
  return so.length >= 4 ? so : null;
}
