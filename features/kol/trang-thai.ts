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

/**
 * THUẦN: ô giá vốn của một dòng hàng có đang TRỐNG không.
 *
 * Cột là `numeric` nên về TS là chuỗi; `null`, chuỗi rỗng và chuỗi toàn khoảng
 * trắng đều là chưa có giá. Số 0 thì KHÔNG trống — 0 đồng là một giá đã đặt.
 */
export function giaVonDangTrong(giaVon: string | null): boolean {
  return giaVon == null || giaVon.trim() === '';
}

/**
 * THUẦN: có được GHI giá vốn vào một dòng hàng không — xét CẢ trạng thái đơn
 * LẪN giá hiện có. Đây là luật riêng, KHÔNG phải bản nới lỏng của
 * `suaGiaVonDuoc`: luật kia vẫn nói nguyên văn "đã gửi thì không SỬA được giá",
 * và nó vẫn đúng như vậy.
 *
 * Vì sao cần thêm luật này: lúc chuyển sang `da_gui`, giá vốn được đông cứng từ
 * `sku_costs` — nhưng CỐ Ý để `null` khi không phân giải được cửa hàng của mã
 * hàng đó (đo 23/09/2026: 110 trên 2.911 mã có giá vốn rơi vào diện này). Nếu
 * chỉ dùng `suaGiaVonDuoc` thì những dòng đó vô giá VĨNH VIỄN: không màn nào
 * mở ô nhập, action cũng chặn lại, nên tiền của chúng không bao giờ vào chi phí
 * marketing — đúng thứ mà action sửa giá vốn sinh ra để tránh.
 *
 * Phân biệt then chốt: ĐIỀN vào ô còn trống thì được, ĐỔI một con số đã có thì
 * không. Nhờ vậy "đông cứng lúc gửi" vẫn đúng tuyệt đối với mọi thứ THẬT SỰ đã
 * được đông cứng, mà vẫn bịt được lỗ hổng của những dòng chưa từng có số nào.
 * (Spec §7.2 — ngoại lệ "điền một lần".)
 */
export function ghiGiaVonDuoc(tt: TrangThaiDon, giaVonHienTai: string | null): boolean {
  if (suaGiaVonDuoc(tt)) return true;
  return tt === 'da_gui' && giaVonDangTrong(giaVonHienTai);
}
