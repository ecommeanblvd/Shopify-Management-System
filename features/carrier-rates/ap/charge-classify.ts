/**
 * Phân loại 1 khoản phí (theo nhãn billed của carrier) cho BẢNG theo-tracking:
 *  - 'hide'  : thuế & duty nhập khẩu — pass-through cho khách, KHÔNG phải cước
 *              mình trả → không hiện cột (vẫn nằm trong Tổng & breakdown của bill).
 *  - 'keep'  : cước lõi + phụ phí có nghĩa (weight/fuel/gogreen/direct signature/
 *              demand/remote/address correction/elevated risk) → giữ cột riêng.
 *  - 'other' : mọi khoản còn lại (hiếm gặp) → gộp vào 1 cột "Khác".
 *
 * Thuần, không I/O.
 */
export type ChargeCategory = 'keep' | 'hide' | 'other';

export const OTHER_LABEL = 'Khác';
/** Nhãn cột gom toàn bộ VAT của các khoản → 1 tổng, để dễ đối soát phí net. */
export const VAT_LABEL = 'VAT';

export function classifyCharge(label: string): ChargeCategory {
  const l = (label || '').toLowerCase();
  if (/dut(y|ies)|tax|regulator|penalt|customs/.test(l)) return 'hide';
  // Phụ phí hiếm chứa từ khoá trùng với cước lõi (vd "NON-CONVEYABLE PIECE - WEIGHT"
  // chứa "weight") → chặn thành 'other' TRƯỚC, kẻo bị nhầm thành cột riêng.
  if (/non.?conveyable|oversize|irregular|restricted|residential|adult/.test(l)) return 'other';
  if (/weight|fuel|go\s*green|direct signature|demand|remote|address correction|elevated risk/.test(l)) return 'keep';
  return 'other';
}

// Thứ tự cột mong muốn cho các khoản "keep" (DHL). Nhỏ hơn = đứng trước.
const KEEP_RANK: Array<[RegExp, number]> = [
  [/weight/, 0], [/fuel/, 1], [/go\s*green/, 2], [/direct signature/, 3],
  [/demand/, 4], [/remote/, 5], [/address correction/, 6], [/elevated risk/, 7],
];

export function feeColumnRank(label: string): number {
  const l = (label || '').toLowerCase();
  for (const [re, r] of KEEP_RANK) if (re.test(l)) return r;
  return 50;
}
