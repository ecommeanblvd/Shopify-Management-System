/**
 * THUẦN: đọc cân một chiếc từ một dòng bảng Lark "WH - Inventory" (CEO 30/09/2026).
 *
 * Vì sao cần: đội kho điền cân từng chiếc vào cột Lark `Weight (kg)` — đo 30/09 thấy
 * 3.628/6.000 dòng có số. Phía SMS thì 26 chiếc nhận trong 30 ngày gần nhất có ĐÚNG 0 chiếc
 * ghi cân, và modal kiểm không hề có ô nhập cân. Dữ liệu có thật, chỉ là SMS chưa đọc về.
 *
 * KHÔNG đọc cột `Lineitem weight`: đó là cột KHÁC (1.417 dòng, ít dùng hơn hẳn). Lấy nhầm cột
 * là lấy nhầm số, và không ai phát hiện ra vì cả hai đều là số ki-lô trông hợp lý.
 */

/** Tên cột trên Lark. Sai một ký tự là đọc ra `undefined` và im lặng bỏ qua cả bảng. */
export const COT_CAN_LARK = 'Weight (kg)';

/**
 * Cân nặng ngoài dải này là gõ nhầm, không phải hàng thật.
 *
 * Trên 50 kg: không chiếc quần áo nào nặng thế — gần như chắc chắn gõ thừa số 0, hoặc gõ gam
 * vào ô ki-lô. Nhận vào thì nó chảy thẳng sang cân kiện rồi ra cước sai.
 */
export const CAN_TOI_DA_KG = 50;

/**
 * Lấy cân hợp lệ, hoặc null.
 *
 * Trả `null` cho mọi thứ không chắc chắn — KHÔNG tự sửa thành số khác. Sửa hộ là bịa ra một
 * con số không ai cân, và nó trông y hệt số thật ở mọi màn phía sau.
 */
export function canTuDongLark(fields: Record<string, unknown> | null | undefined): number | null {
  if (!fields) return null;
  const tho = fields[COT_CAN_LARK];
  if (tho == null || tho === '') return null;
  // Lark trả số ở cột Number, nhưng ô nhập tay từng lưu chuỗi — nhận cả hai, từ chối phần còn lại.
  const n = typeof tho === 'number' ? tho : typeof tho === 'string' ? Number(tho.trim()) : NaN;
  if (!Number.isFinite(n)) return null;
  if (n <= 0 || n > CAN_TOI_DA_KG) return null;
  // Làm tròn 3 số lẻ đúng bằng độ chính xác cột `goods_receipt_items.weight_kg` (numeric 10,3).
  return Math.round(n * 1000) / 1000;
}
