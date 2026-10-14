/**
 * THUẦN: tra Ô BẢNG GIÁ theo CÂN, thay cho việc neo vào số tiền trên hoá đơn hãng.
 *
 * CEO chốt 14/10/2026 (đảo D-022): bảng giá ship hộ phát hành cho mỗi brand là bảng giá
 * CỐ ĐỊNH. Cân, phụ phí, %fuel thì lấy theo bill của hãng; nhưng CƯỚC CƠ BẢN phải là ô
 * trong bảng giá của mình, không phải con số hãng in ra rồi nhân markup.
 *
 * Vì sao đảo: "net trên bill ≡ ô bảng giá" là tính chất RIÊNG của hợp đồng FedEx. Đo
 * 14/10/2026 trên 83 đơn đã đối soát và được kiểm: FedEx trùng 72/74, còn **UPS 0/5 và
 * Aramex 0/4 — chưa đơn nào trùng**. Với hai hãng đó, neo bill nghĩa là brand đang trả
 * theo con số của hãng (UPS +46.913đ, Aramex −40.234đ) chứ không theo bảng giá mình
 * phát hành cho họ.
 *
 * CÂN nào: cân trên bill, LÀM TRÒN LÊN bậc của bảng giá. Đo 14/10/2026 trên 663 kiện
 * FedEx có cân quy đổi áp đảo (qd ≥ thực + 1kg): cân bill khớp CÂN QUY ĐỔI 604/663 (91%)
 * và chỉ khớp cân thực 36/663 (5%) — tức cân hãng in ra ĐÃ là cân tính cước (đã so thực
 * với thể tích), chỉ chưa làm tròn lên bậc. Trung bình: thực 1,73 · quy đổi 3,27 · bill
 * 3,36 kg. (Cùng phép đo đó xác nhận hệ số quy đổi là 5000, không phải 6000.)
 *
 * KHÔNG suy bậc từ số tiền như `canTinhCuocTuO`: cách đó chỉ chạy được khi net bill trùng
 * một ô, mà UPS/Aramex thì không bao giờ trùng.
 */
import type { OBangGia } from './bill-base-check';

/** Sai số so cân (kg) — số thập phân từ DB (numeric) và từ file bill không bao giờ khớp bit. */
export const SAI_SO_CAN_KG = 0.0001;

/**
 * Ô bảng giá cho MỘT mốc cân: ô rẻ nhất mà vẫn PHỦ ĐƯỢC cân này (upper_kg ≥ cân).
 * Đó chính là "làm tròn lên bậc" — bậc biểu giá vốn khai theo `upper_kg`.
 *
 * `null` khi không ô nào phủ được: cân vượt bậc cao nhất của bảng giá (bảng giá tính theo
 * kg vượt), hoặc bảng giá chưa có loại gói này. Người gọi phải tự quyết rơi về đâu —
 * hàm này KHÔNG BAO GIỜ bịa một ô gần đúng.
 */
export function oTheoCan(
  cells: readonly OBangGia[], canKg: number, loaiGoi: string = 'package',
): OBangGia | null {
  if (!(canKg > 0)) return null;
  const lg = loaiGoi.trim().toLowerCase();
  let chon: OBangGia | null = null;
  for (const c of cells) {
    if (c.loaiGoi.trim().toLowerCase() !== lg) continue;
    if (!(c.kg + SAI_SO_CAN_KG >= canKg)) continue;
    if (chon == null || c.kg < chon.kg) chon = c;
  }
  return chon;
}
