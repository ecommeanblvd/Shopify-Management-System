/**
 * Bóc mã đơn từ ô "order number" của hoá đơn hãng — ô này là chữ TỰ DO do người
 * nhập, không phải khoá chuẩn.
 *
 * Khảo sát 04/09 trên 8.060 dòng bill: 39 dòng ghi kiểu không khớp nổi bằng so
 * bằng tuyệt đối, tổng 105,7 triệu. Các kiểu gặp thật:
 *   "TA2300 + TA2301"            → một kiện gộp HAI đơn
 *   "#MBLVD24249+#MBLVD24250"    → như trên, không khoảng trắng
 *   "24-INSLG-0274 (24-INSLG-0278)" → mã thứ hai nằm trong ngoặc
 *   "#MBLVD28958 (1)"            → MỘT đơn, (1) là số thứ tự kiện — KHÔNG phải mã
 *   "#MBLVD26931 Complete"       → mã kèm ghi chú
 *   "RETURN OF 872181045003"     → hàng hoàn, số đó là mã VẬN ĐƠN không phải đơn
 *   "TME SO# 104802", "KSA UAE MR." → không phải mã đơn
 */

/** Mã đơn hợp lệ: tiền tố chữ + số (MBLVD/TA/TINH…), hoặc dạng 24-INSLG-0274. */
const MA_DON = /\b(?:\d{2}-[A-Z]{2,8}-[A-Z0-9]+|[A-Z]{2,8}\d{3,})\b/gi;

/** Dòng hàng hoàn — cước hoàn đi đường riêng (return_of_order_id), KHÔNG cộng
 *  vào cước chiều đi của đơn. Nhận diện trước khi bóc mã. */
export function laHangHoan(chuoi: string | null | undefined): boolean {
  return /\b(return|rts)\b|_\s*r$|-\s*r$/i.test((chuoi ?? '').trim());
}

/**
 * Bóc DANH SÁCH mã đơn. Trả mảng rỗng khi không có mã nào nhận ra được (chuỗi
 * rác, hoặc dòng hàng hoàn chỉ ghi mã vận đơn).
 *
 * Số trần (mã vận đơn, "104802") KHÔNG được coi là mã đơn — phải có phần chữ,
 * nếu không thì mọi dòng "RETURN OF 872181045003" sẽ bị gán nhầm.
 */
export function tachMaDon(chuoi: string | null | undefined): string[] {
  const s = (chuoi ?? '').trim();
  if (!s) return [];
  const found = s.match(MA_DON) ?? [];
  const out: string[] = [];
  for (const m of found) {
    const ma = m.toUpperCase().replace(/^#/, '');
    // "AWB" trong "RTS AWB 880880928072" khớp mẫu chữ+số? Không — không có số dính.
    if (!out.includes(ma)) out.push(ma);
  }
  return out;
}

export interface DonChiaCan {
  /** Mã đơn (không dấu #). */
  so: string;
  /** Cân của đơn (kg). null/0 = chưa biết. */
  kg: number | null;
}

export interface PhanBo {
  so: string;
  /** Số tiền phân cho đơn này (đã làm tròn về đồng). */
  tien: number;
  /** true khi phải chia đều vì thiếu cân — cần người soát lại. */
  chiaDeuVìThieuCan: boolean;
}

/**
 * Chia tiền một dòng bill cho nhiều đơn THEO CÂN (CEO chốt 04/09).
 *
 * Thiếu cân ở bất kỳ đơn nào thì chia ĐỀU cho cả nhóm và bật cờ cảnh báo — đoán
 * cân cho một đơn rồi chia theo tỉ lệ là tự bịa ra con số lãi lỗ.
 *
 * Tổng các phần LUÔN bằng đúng số tiền gốc: phần dư do làm tròn dồn vào đơn cuối,
 * để cộng lại không bao giờ lệch một vài đồng so với hoá đơn.
 */
export function chiaTheoCan(tongTien: number, don: DonChiaCan[]): PhanBo[] {
  if (don.length === 0) return [];
  if (don.length === 1) return [{ so: don[0].so, tien: Math.round(tongTien), chiaDeuVìThieuCan: false }];

  const thieuCan = don.some((d) => d.kg == null || d.kg <= 0);
  const tongCan = don.reduce((s, d) => s + (d.kg ?? 0), 0);
  const ty = (d: DonChiaCan) => (thieuCan || tongCan <= 0 ? 1 / don.length : (d.kg ?? 0) / tongCan);

  const out: PhanBo[] = [];
  let daChia = 0;
  for (let i = 0; i < don.length; i++) {
    const cuoi = i === don.length - 1;
    // Đơn cuối nhận phần CÒN LẠI → tổng luôn khớp tuyệt đối với hoá đơn.
    const tien = cuoi ? Math.round(tongTien) - daChia : Math.round(tongTien * ty(don[i]));
    daChia += tien;
    out.push({ so: don[i].so, tien, chiaDeuVìThieuCan: thieuCan });
  }
  return out;
}

/** Cửa sổ thời gian hợp lý giữa ngày đặt đơn và ngày gửi trên hoá đơn. */
export const NGAY_TRUOC_TOI_DA = 180;
export const NGAY_SAU_TOI_DA = 30;

/**
 * Đơn có HỢP LÝ để gán vào dòng bill này không, xét theo ngày.
 *
 * Vì sao bắt buộc: ô mã đơn trên hoá đơn bị CẮT CỤT ở 24 ký tự, nên
 * "#MBLVD24598 + #MBLVD24599" bị cắt thành "...+ #MBLVD2484" — và "MBLVD2484"
 * lại trùng một đơn THẬT năm 2021. Không có rào này thì 1,8 triệu cước của đơn
 * 2026 rơi vào đơn 2021 (bắt được 04/09 khi soát kết quả chạy thật).
 *
 * Không biết ngày gửi → KHÔNG gán, thà bỏ sót còn hơn gán sai.
 */
export function hopLyTheoNgay(ngayDatDon: Date | null, ngayGuiBill: Date | null): boolean {
  if (!ngayDatDon || !ngayGuiBill) return false;
  const ngay = (ngayGuiBill.getTime() - ngayDatDon.getTime()) / 86_400_000;
  return ngay >= -NGAY_SAU_TOI_DA && ngay <= NGAY_TRUOC_TOI_DA;
}
