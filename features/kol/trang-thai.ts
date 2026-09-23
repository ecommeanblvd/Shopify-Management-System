import type { TrangThaiDon } from './types';

/** Đích hợp lệ cho từng trạng thái. Đã gửi và đã huỷ đều là điểm cuối. */
const DUONG_DI: Record<TrangThaiDon, readonly TrangThaiDon[]> = {
  nhap: ['da_chot', 'huy'],
  // Lùi về nháp để sửa dòng hàng: hệ thống trả lại phần tồn đã giữ chỗ.
  da_chot: ['da_gui', 'nhap', 'huy'],
  // Hàng đã đi khỏi kho — muốn thu lại thì đi đường hàng trả, không phải huỷ đơn.
  da_gui: [],
  huy: [],
};

/** THUẦN: có được chuyển từ trạng thái này sang trạng thái kia không. */
export function chuyenDuoc(tu: TrangThaiDon, den: TrangThaiDon): boolean {
  return DUONG_DI[tu].includes(den);
}

/**
 * THUẦN: có được thêm/bớt/sửa dòng hàng không.
 * Từ 'da_chot' trở đi là đã giữ chỗ tồn, sửa dòng sẽ làm lệch số đã giữ.
 */
export function suaDongDuoc(tt: TrangThaiDon): boolean {
  return tt === 'nhap';
}

/** THUẦN: có được sửa giá vốn không. Giá vốn không dính tồn nên nới tới 'da_chot'. */
export function suaGiaVonDuoc(tt: TrangThaiDon): boolean {
  return tt === 'nhap' || tt === 'da_chot';
}
