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
