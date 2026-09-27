/**
 * THUẦN: gom tiền tranh chấp THEO TỪNG ĐƠN VỊ TIỀN.
 *
 * File này tồn tại vì một lỗi cụ thể: bảng Lark `Dispute Management` cộng USD,
 * EUR, GBP, HKD, CAD và KRW vào một cột `Total Amount Lost` rồi báo
 * "108.565,54" — con số không có nghĩa gì. Khi đo dữ liệu cho spec này, chính em
 * cũng cộng gộp như thế và báo tinhatelier "284.232", trong đó một ca KRW
 * ₩279.000 (~$200) chiếm gần hết.
 *
 * Nên module này KHÔNG có cột tổng tiền, và mọi con số tiền đi ra UI đều qua đây.
 */

export interface DongTien { soTien: string | number; tienTe: string }
export interface TongTheoTien { tienTe: string; tong: number; soCa: number }

/**
 * Gom theo đơn vị tiền, sắp theo tổng giảm dần.
 *
 * Dòng thiếu đơn vị tiền hoặc số không đọc được bị BỎ QUA — cộng chúng vào một
 * nhóm "?" là tái lập đúng lỗi gộp mà file này tồn tại để chặn.
 */
export function gomTheoTienTe(dong: DongTien[]): TongTheoTien[] {
  const m = new Map<string, { tong: number; soCa: number }>();
  for (const d of dong) {
    const tt = (d.tienTe ?? '').trim().toUpperCase();
    if (!tt) continue;
    const n = typeof d.soTien === 'number' ? d.soTien : Number(d.soTien);
    if (!Number.isFinite(n)) continue;
    const cur = m.get(tt) ?? { tong: 0, soCa: 0 };
    m.set(tt, { tong: cur.tong + n, soCa: cur.soCa + 1 });
  }
  return [...m].map(([tienTe, v]) => ({ tienTe, ...v }))
    .sort((a, b) => b.tong - a.tong);
}

/** Chuỗi hiển thị: `"USD 29.591,01 · HKD 2.353,33"`. Rỗng thì trả dấu gạch. */
export function chuoiTongTien(tong: TongTheoTien[]): string {
  if (tong.length === 0) return '—';
  return tong.map((t) => `${t.tienTe} ${t.tong.toLocaleString('vi-VN', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })}`).join(' · ');
}
