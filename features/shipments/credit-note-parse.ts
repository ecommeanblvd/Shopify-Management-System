// Một nguồn duy nhất cho CreditNoteLine (định nghĩa ở credit-note-match) — tránh
// lệch shape giữa parser và matcher.
import type { CreditNoteLine } from './credit-note-match';
export type { CreditNoteLine };
export interface CreditNoteParsed { creditNoteNumber: string | null; lines: CreditNoteLine[] }

/** Đọc credit note hoá đơn điện tử TT78 (FedEx/DHL gửi XML). Số tiền trong file là
 *  ÂM (giảm trừ) → creditVnd = trị tuyệt đối. THUẦN. */
export function parseCreditNoteXml(xml: string): CreditNoteParsed {
  const kh = xml.match(/<KHHDon>([^<]+)<\/KHHDon>/)?.[1]?.trim();
  const sh = xml.match(/<SHDon>([^<]+)<\/SHDon>/)?.[1]?.trim();
  const creditNoteNumber = sh ? (kh ? `${kh}-${sh}` : sh) : null;

  const lines: CreditNoteLine[] = [];
  for (const block of xml.match(/<HHDVu>[\s\S]*?<\/HHDVu>/g) ?? []) {
    const desc = block.match(/<THHDVu>([^<]*)<\/THHDVu>/)?.[1]?.trim();
    if (!desc) continue;
    const tracking = desc.split(/\s+/)[0];
    if (!/^\d{6,}$/.test(tracking)) continue;          // AWB/tracking = token số ≥6
    // Số tiền GỒM VAT: extra "Amount"; fallback ThTien (pre-tax) nếu thiếu.
    // \s* quanh "Amount" để chịu được NCC khác (vd DHL) có khoảng trắng trong tag.
    const raw = block.match(/<TTruong>\s*Amount\s*<\/TTruong>\s*<KDLieu>[^<]*<\/KDLieu>\s*<DLieu>(-?\d+)<\/DLieu>/)?.[1]
      ?? block.match(/<ThTien>(-?\d+)<\/ThTien>/)?.[1];
    if (raw == null) continue;
    const creditVnd = Math.abs(Number(raw));
    if (creditVnd === 0) continue;
    lines.push({ tracking, creditVnd });
  }
  return { creditNoteNumber, lines };
}
