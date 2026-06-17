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
  // Non-Conveyable / Restricted / Residential giờ ĐỐI SOÁT theo từng khoản
  // (bucket riêng + diagnosis) → cột riêng. Đặt TRƯỚC nhánh cước lõi vì
  // "NON-CONVEYABLE PIECE - WEIGHT" chứa "weight" sẽ bị nhầm.
  if (/non.?conveyable|restricted|residential/.test(l)) return 'keep';
  // Phụ phí hiếm còn lại (oversize, adult…) → gộp "Khác".
  if (/oversize|irregular|adult/.test(l)) return 'other';
  if (/weight|fuel|go\s*green|direct signature|demand|remote|address correction|elevated risk/.test(l)) return 'keep';
  return 'other';
}

/**
 * Nhãn CỘT hiển thị cho 1 khoản "keep". Gom các biến thể tên về 1 cột để bảng
 * không vỡ (vd "NON-CONVEYABLE PIECE - IRREGULAR" + "... - WEIGHT" + "NON
 * CONVEYABLE PIECE" → cùng cột "Non-Conveyable"). Khoản khác giữ nguyên tên.
 */
export function chargeColumnLabel(label: string): string {
  const l = (label || '').toLowerCase();
  if (/non.?conveyable/.test(l)) return 'Non-Conveyable';
  if (/restricted/.test(l)) return 'Restricted';
  if (/residential/.test(l)) return 'Residential';
  return label;
}

// Thứ tự cột mong muốn cho các khoản "keep" (DHL). Nhỏ hơn = đứng trước.
const KEEP_RANK: Array<[RegExp, number]> = [
  [/weight/, 0], [/fuel/, 1], [/go\s*green/, 2], [/direct signature/, 3],
  [/demand/, 4], [/remote/, 5], [/address correction/, 6], [/elevated risk/, 7],
  [/non.?conveyable/, 8], [/restricted/, 9], [/residential/, 10],
];

export function feeColumnRank(label: string): number {
  const l = (label || '').toLowerCase();
  for (const [re, r] of KEEP_RANK) if (re.test(l)) return r;
  return 50;
}
