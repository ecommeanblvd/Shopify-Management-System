/** So tổng tiền + ngày của bill (từ XLSX/CSV) với số liệu đọc từ PDF. THUẦN.
 *  either-side null → unknown (không báo lệch sai). date unknown KHÔNG chặn match. */
export type PdfCmpStatus = 'match' | 'mismatch' | 'unknown';
export interface PdfBillCompare {
  amountStatus: PdfCmpStatus; amountDeltaVnd: number | null;
  issueDateStatus: PdfCmpStatus; dueDateStatus: PdfCmpStatus;
  overall: PdfCmpStatus;
}
export const PDF_MATCH_TOLERANCE_VND = 1000;

function dateStatus(billDate: string | null, pdfDate: string | null): PdfCmpStatus {
  if (!billDate || !pdfDate) return 'unknown';
  return billDate === pdfDate ? 'match' : 'mismatch';
}

export function comparePdfToBill(
  bill: { amount: number; issueDate: string | null; dueDate: string | null },
  pdf: { pdfAmount: number | null; pdfIssueDate: string | null; pdfDueDate: string | null },
): PdfBillCompare {
  let amountStatus: PdfCmpStatus = 'unknown';
  let amountDeltaVnd: number | null = null;
  if (pdf.pdfAmount !== null) {
    amountDeltaVnd = bill.amount - pdf.pdfAmount;
    amountStatus = Math.abs(amountDeltaVnd) <= PDF_MATCH_TOLERANCE_VND ? 'match' : 'mismatch';
  }
  const issueDateStatus = dateStatus(bill.issueDate, pdf.pdfIssueDate);
  const dueDateStatus = dateStatus(bill.dueDate, pdf.pdfDueDate);
  let overall: PdfCmpStatus;
  if (amountStatus === 'unknown') overall = 'unknown';
  else if (amountStatus === 'mismatch' || issueDateStatus === 'mismatch' || dueDateStatus === 'mismatch') overall = 'mismatch';
  else overall = 'match';
  return { amountStatus, amountDeltaVnd, issueDateStatus, dueDateStatus, overall };
}
