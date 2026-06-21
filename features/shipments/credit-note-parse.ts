// Một nguồn duy nhất cho CreditNoteLine (định nghĩa ở credit-note-match) — tránh
// lệch shape giữa parser và matcher.
import type { CreditNoteLine } from './credit-note-match';
export type { CreditNoteLine };
export interface CreditNoteParsed { creditNoteNumber: string | null; lines: CreditNoteLine[] }

// `A` = "open tag có thể kèm thuộc tính" (vd <HHDVu Id="...">). Hoá đơn điện tử có
// chữ ký TT78 hay gắn Id trên element → regex phải chịu được, không thì parse ra 0 dòng âm thầm.
const A = '(?:\\s[^>]*)?';

/** Đọc credit note hoá đơn điện tử TT78 (FedEx/DHL gửi XML). Số tiền trong file là
 *  ÂM (giảm trừ) → creditVnd = trị tuyệt đối. THUẦN. */
export function parseCreditNoteXml(xml: string): CreditNoteParsed {
  const kh = xml.match(new RegExp(`<KHHDon${A}>([^<]+)</KHHDon>`))?.[1]?.trim();
  const sh = xml.match(new RegExp(`<SHDon${A}>([^<]+)</SHDon>`))?.[1]?.trim();
  const creditNoteNumber = sh ? (kh ? `${kh}-${sh}` : sh) : null;

  const lines: CreditNoteLine[] = [];
  for (const block of xml.match(new RegExp(`<HHDVu${A}>[\\s\\S]*?</HHDVu>`, 'g')) ?? []) {
    const desc = block.match(new RegExp(`<THHDVu${A}>([^<]*)</THHDVu>`))?.[1]?.trim();
    if (!desc) continue;
    const tracking = desc.split(/\s+/)[0];
    if (!/^\d{6,}$/.test(tracking)) continue;          // AWB/tracking = token số ≥6
    // Số tiền GỒM VAT: extra "Amount"; fallback ThTien (pre-tax) nếu thiếu.
    // \s* quanh "Amount" để chịu khoảng trắng; A chịu thuộc tính trên tag.
    const raw = block.match(new RegExp(`<TTruong${A}>\\s*Amount\\s*</TTruong>\\s*<KDLieu${A}>[^<]*</KDLieu>\\s*<DLieu${A}>(-?\\d+)</DLieu>`))?.[1]
      ?? block.match(new RegExp(`<ThTien${A}>(-?\\d+)</ThTien>`))?.[1];
    if (raw == null) continue;
    const creditVnd = Math.abs(Number(raw));
    if (creditVnd === 0) continue;
    lines.push({ tracking, creditVnd });
  }
  return { creditNoteNumber, lines };
}
