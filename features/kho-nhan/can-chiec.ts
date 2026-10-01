/**
 * THUẦN: đọc cân một chiếc do người gõ tay ở bảng "Nhận hôm nay" (CEO 01/10/2026).
 *
 * CEO chốt: cân điền SAU khi kiểm xong, KHÔNG bắt buộc lúc đó, và bổ sung được sau ngay tại
 * bảng. Nên ô này phải nhận cả "để trống" như một ý định hợp lệ — xoá cân đã gõ nhầm.
 *
 * Dùng chung ngưỡng với đường Lark (`CAN_TOI_DA_KG` = 50): một chiếc quần áo nặng hơn thế gần
 * như chắc chắn là gõ thừa số 0 hoặc gõ gam vào ô ki-lô. Hai đường vào cùng một cột mà ngưỡng
 * khác nhau thì cột đó không còn nghĩa gì.
 */
import { CAN_TOI_DA_KG } from './can-tu-lark';

export type KetQuaCan = { ok: true; kg: number | null } | { ok: false; loi: string };

export function docCanNhap(tho: string | null | undefined): KetQuaCan {
  const s = String(tho ?? '').trim();
  // Để trống là Ý ĐỊNH HỢP LỆ: xoá cân đã gõ nhầm. Không coi là lỗi, không giữ số cũ.
  if (s === '') return { ok: true, kg: null };
  // Bàn phím tiếng Việt hay cho ra dấu phẩy — nhận cả hai, đừng bắt người ta gõ lại.
  const n = Number(s.replace(',', '.'));
  if (!Number.isFinite(n)) return { ok: false, loi: 'Cân phải là số' };
  if (n <= 0) return { ok: false, loi: 'Cân phải lớn hơn 0' };
  if (n > CAN_TOI_DA_KG) return { ok: false, loi: `Cân trên ${CAN_TOI_DA_KG} kg — kiểm lại, thường là gõ thừa số 0` };
  // Làm tròn 3 số lẻ đúng bằng `goods_receipt_items.weight_kg` (numeric 10,3): gõ 4 số lẻ rồi
  // lưu mất chữ số cuối thì lần sau mở ra thấy số khác thứ mình gõ.
  return { ok: true, kg: Math.round(n * 1000) / 1000 };
}
