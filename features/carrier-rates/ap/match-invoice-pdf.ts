/**
 * Khớp 1 PDF hoá đơn FedEx với bill trong hệ thống theo SỐ HOÁ ĐƠN.
 * PDF (PART_N) không mang số invoice trong tên → đọc nội dung: "Reference
 * Number / Invoice No.: <số>" trùng billNumber. MỘT PDF có thể gom NHIỀU hoá
 * đơn → trả TẤT CẢ billNumber xuất hiện (đính PDF vào mọi bill đó). AWB 12 chữ
 * số + mã số thuế 10–13 chữ số không trùng billNumber (9 chữ số) nên giao tập
 * số-thuần với billNumber đã biết là khớp chắc chắn. Pure. */
export function matchInvoiceNumbers(pdfText: string, knownBillNumbers: Set<string>): string[] {
  const tokens = pdfText.split(/\D+/).filter(Boolean);
  const hits = new Set<string>();
  for (const t of tokens) if (knownBillNumbers.has(t)) hits.add(t);
  return [...hits];
}
