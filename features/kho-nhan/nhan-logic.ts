import { thangKinhDoanh } from '@/lib/timezone';

/**
 * THUẦN: mã của MỘT CHIẾC hàng vật lý (`goods_receipt_items.unit_code`).
 *
 * Năm-tháng theo giờ kinh doanh (Asia/Bangkok) chứ không UTC — chiếc nhận lúc
 * 00:30 ngày 1/10 VN phải ghi tháng 10. Sequence chạy liên tục, không reset theo
 * tháng, nên mã không bao giờ trùng kể cả khi ai đó sửa giờ hệ thống.
 */
export function maChiec(soSeq: number, luc: Date): string {
  if (!Number.isInteger(soSeq) || soSeq <= 0) {
    throw new Error(`Số thứ tự chiếc phải là số nguyên dương, nhận được: ${soSeq}`);
  }
  const thang = thangKinhDoanh(luc);
  if (!thang) throw new Error(`Không lấy được tháng kinh doanh từ: ${luc}`);
  const namThang = thang.replace('-', '').slice(-4);
  return `WH-${namThang}-${String(soSeq).padStart(5, '0')}`;
}

/**
 * THUẦN: mã phiếu nhận, gom theo NGÀY KINH DOANH + brand.
 *
 * Gom chiếc về một phiếu để biên bản và tra cứu đi theo lô, thay vì mỗi chiếc
 * một phiếu. Brand trống thì vẫn có phiếu riêng chứ không trộn vào phiếu brand khác.
 */
export function maPhieuNhan(ngayKinhDoanhStr: string, vendor: string | null): string {
  const brand = (vendor ?? '').trim() || 'KHONG-BRAND';
  return `WH-${ngayKinhDoanhStr}-${brand.replace(/\s+/g, '-').toUpperCase()}`;
}
