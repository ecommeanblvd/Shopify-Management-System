/**
 * Khớp 1 PDF hoá đơn carrier với bill trong hệ thống theo SỐ HOÁ ĐƠN.
 * PDF (PART_N) không mang số invoice trong tên → đọc nội dung: "Reference
 * Number / Invoice No.: <số>" trùng billNumber. MỘT PDF có thể gom NHIỀU hoá
 * đơn → trả TẤT CẢ billNumber xuất hiện (đính PDF vào mọi bill đó).
 *
 * Hỗ trợ cả hai định dạng billNumber:
 *   - Số thuần (FedEx)          : 734005869 (9 chữ số)
 *   - Alphanumeric/tiền tố HANR (DHL): HANR000269158
 *
 * Tokenizer tách theo chuỗi ký tự KHÔNG phải chữ-số ([^A-Za-z0-9]+) để giữ
 * nguyên token alphanumeric. Giao tập với knownBillNumbers theo exact membership
 * → an toàn, không nhầm AWB (12 chữ số) hay mã số thuế (10–13 chữ số). Pure. */
export function matchInvoiceNumbers(pdfText: string, knownBillNumbers: Set<string>): string[] {
  const tokens = pdfText.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const hits = new Set<string>();
  for (const t of tokens) if (knownBillNumbers.has(t)) hits.add(t);
  return [...hits];
}
