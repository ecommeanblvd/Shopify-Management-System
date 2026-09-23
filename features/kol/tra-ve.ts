import type { DongDon } from './types';

/** THUẦN: còn nợ bao nhiêu món. Hàng tặng không nợ gì. */
export function conNo(d: DongDon): number {
  return d.hinhThuc === 'muon' ? d.soLuong - d.soLuongDaTra : 0;
}

/**
 * THUẦN: một lần nhận trả về có hợp lệ không.
 *
 * Chỉ dòng MƯỢN mới có đường trả (spec §6): đã tặng thì không đòi, và giữ hẹp
 * để số chi phí đã chốt không bị sửa ngược.
 */
export function kiemTraVe(
  d: DongDon, soLuong: number, nhapLaiKho: boolean, lyDo: string | null,
): { ok: true } | { ok: false; loi: string } {
  if (d.hinhThuc !== 'muon') {
    return { ok: false, loi: 'Dòng này là hàng tặng, không có đường trả về.' };
  }
  if (!Number.isInteger(soLuong) || soLuong <= 0) {
    return { ok: false, loi: 'Số lượng trả phải là số nguyên dương.' };
  }
  const no = conNo(d);
  if (soLuong > no) {
    return { ok: false, loi: `Trả ${soLuong} nhưng dòng này chỉ còn nợ ${no}.` };
  }
  if (!nhapLaiKho && !lyDo?.trim()) {
    return { ok: false, loi: 'Không nhập lại kho thì phải ghi lý do.' };
  }
  return { ok: true };
}
