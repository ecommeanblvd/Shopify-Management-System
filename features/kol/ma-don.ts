/**
 * THUẦN: dựng mã đơn KOL từ số sequence.
 *
 * Sequence chạy LIÊN TỤC, cố ý không reset theo tháng: đơn cuối tháng 9 là
 * KOL-2609-0007 thì đơn đầu tháng 10 là KOL-2610-0008. Nhờ vậy mã không bao
 * giờ trùng kể cả khi ai đó sửa giờ hệ thống.
 */
export function maDonKol(soSeq: number, luc: Date): string {
  const nam = String(luc.getUTCFullYear()).slice(-2);
  const thang = String(luc.getUTCMonth() + 1).padStart(2, '0');
  return `KOL-${nam}${thang}-${String(soSeq).padStart(4, '0')}`;
}
