/**
 * THUẦN: chia kỳ và quyết định gom cho bảng kê ship-hộ tự động (CEO 28/09/2026).
 *
 * Mốc kỳ KHÔNG đổi so với quyết định 22/09: kỳ tính theo ngày lần đẩy ĐẦU TIÊN
 * của `order.reconciled` sang MMP — tức lúc Đức đối soát xong và chốt giá thu.
 * Việc thêm ở đây chỉ là CHẠY TỰ ĐỘNG: trước nay `generateStatement` chỉ có nút
 * bấm tay trên màn Bảng kê, nên đơn đã chốt giá nằm chờ vô thời hạn (đo 28/09:
 * Kalisa còn 94 đơn chưa kê, 217.817.423đ).
 */

/** Kỳ THÁNG theo lịch VN của một thời điểm. */
export function kyThang(now: Date): { dau: string; cuoi: string; ten: string } {
  const vn = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const y = vn.getUTCFullYear(), m = vn.getUTCMonth();
  const hai = (n: number) => String(n).padStart(2, '0');
  const cuoi = new Date(Date.UTC(y, m + 1, 0));
  return {
    dau: `${y}-${hai(m + 1)}-01`,
    cuoi: `${cuoi.getUTCFullYear()}-${hai(cuoi.getUTCMonth() + 1)}-${hai(cuoi.getUTCDate())}`,
    ten: `${y}-${hai(m + 1)}`,
  };
}

const hai = (n: number): string => String(n).padStart(2, '0');

/** Kỳ THÁNG từ tên `YYYY-MM`. Ném lỗi với tên lạ — im lặng trả kỳ sai là xếp tiền sai kỳ. */
export function kyTuTen(ten: string): { dau: string; cuoi: string; ten: string } {
  const m = /^(\d{4})-(\d{2})$/.exec(ten);
  if (!m) throw new Error(`[ky-bang-ke] tên kỳ không hợp lệ: ${ten}`);
  const y = Number(m[1]), th = Number(m[2]);
  if (th < 1 || th > 12) throw new Error(`[ky-bang-ke] tháng không hợp lệ: ${ten}`);
  // Date.UTC(y, th, 0) = ngày 0 của tháng th+1 (th là 1-based) = ngày cuối tháng th.
  const cuoi = new Date(Date.UTC(y, th, 0));
  return { dau: `${ten}-01`, cuoi: `${y}-${hai(th)}-${hai(cuoi.getUTCDate())}`, ten };
}

/** Kỳ tháng liền sau. */
export function kyTiepTheo(ten: string): string {
  const { dau } = kyTuTen(ten);
  const y = Number(dau.slice(0, 4)), th = Number(dau.slice(5, 7));
  return th === 12 ? `${y + 1}-01` : `${y}-${hai(th + 1)}`;
}

export type ViecGom = 'tao_moi' | 'them_vao_nhap' | 'bo_qua_da_chot';

/**
 * Bảng kê của kỳ này đang ở trạng thái nào thì làm gì.
 *
 * `issued`/`paid` → BỎ QUA: số đã gửi brand phải đứng yên, đơn về muộn sang kỳ
 * sau. Đây cũng là lý do lệnh tự động KHÔNG được tự chốt kỳ (CEO 28/09: máy tạo
 * bản nháp, người bấm chốt).
 */
export function viecGom(trangThaiDaCo: string | null | undefined): ViecGom {
  if (trangThaiDaCo == null) return 'tao_moi';
  return trangThaiDaCo === 'draft' ? 'them_vao_nhap' : 'bo_qua_da_chot';
}

export type LyDoKy = 'dung_moc' | 'ky_moc_da_chot' | 'moc_tuong_lai' | 'khong_con_ky_mo';

/**
 * THUẦN: đơn có mốc kỳ ở `tenMoc` thì xếp vào bảng kê của kỳ nào.
 *
 * LUẬT (CEO 01/10/2026, nhận đề xuất MMP): kỳ của đơn LÀ kỳ chứa mốc — không phải tháng lúc
 * chạy lệnh gom. Luật cũ xếp theo tháng gom nên 14 đơn/32.316.966đ nằm sai kỳ, và chính phép
 * chiếu chéo MMP đề xuất sẽ chặn phát hành vì SMS tự vi phạm nó.
 *
 * Kỳ của mốc đã `issued`/`paid` thì KHÔNG mở lại (số đã gửi brand phải đứng yên) — đơn đi tới
 * KỲ ĐANG MỞ SỚM NHẤT, đúng cách `assignBillingPeriod` bên MMP làm, nên hai sổ không lệch
 * cách xử lý. Đây cũng là lối ra cho bài học D-130: không đơn nào bị kẹt không kỳ nào nhận.
 *
 * Trả `ten: null` cho hai ca KHÔNG xếp được, và nói rõ lý do thay vì gộp thành một số:
 * - `moc_tuong_lai`: mốc nằm sau kỳ đang chạy — dấu hiệu lỗi đồng hồ/dữ liệu, phải nhìn thấy.
 * - `khong_con_ky_mo`: mọi kỳ từ mốc tới nay đều đã chốt — đơn chờ kỳ sau mở.
 */
export function chonKyGom(a: {
  tenMoc: string; tenHienTai: string; trangThai: (ten: string) => string | null | undefined;
}): { ten: string | null; ly: LyDoKy } {
  if (a.tenMoc > a.tenHienTai) return { ten: null, ly: 'moc_tuong_lai' };
  let t = a.tenMoc;
  let dungMoc = true;
  while (t <= a.tenHienTai) {
    if (viecGom(a.trangThai(t)) !== 'bo_qua_da_chot') {
      return { ten: t, ly: dungMoc ? 'dung_moc' : 'ky_moc_da_chot' };
    }
    t = kyTiepTheo(t);
    dungMoc = false;
  }
  return { ten: null, ly: 'khong_con_ky_mo' };
}
