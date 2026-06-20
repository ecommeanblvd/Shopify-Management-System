import { comparePdfToBill } from '@/features/carrier-rates/ap/compare-pdf-bill';

interface BillCmpInput {
  amount: number; issueDate: string | null; dueDate: string | null;
  pdfAmount: number | null; pdfIssueDate: string | null; pdfDueDate: string | null;
}

/** Nhãn + title + class badge đối soát PDF cho 1 bill (gọi khi bill có PDF). */
export function pdfCmpBadge(b: BillCmpInput, fmt: (n: number) => string): { label: string; title: string; cls: string } {
  if (b.pdfAmount === null) return { label: 'PDF chưa đọc được tổng', title: 'Không đọc được tổng tiền từ PDF — kiểm tra file', cls: 'bg-muted text-muted-foreground' };
  const c = comparePdfToBill(b, b);
  // Use exact amount comparison for the badge (tolerance in comparePdfToBill is for VND rounding only)
  const amountMismatch = b.pdfAmount !== b.amount;
  if (!amountMismatch && c.issueDateStatus !== 'mismatch' && c.dueDateStatus !== 'mismatch') {
    return { label: 'PDF khớp', title: 'Tổng tiền và ngày trên PDF khớp file XLSX/CSV', cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' };
  }
  const parts: string[] = [];
  if (amountMismatch) parts.push(`PDF ${fmt(b.pdfAmount)} vs XLSX ${fmt(b.amount)} (lệch ${fmt(Math.abs(b.amount - b.pdfAmount))})`);
  if (c.issueDateStatus === 'mismatch') parts.push('ngày HĐ lệch');
  if (c.dueDateStatus === 'mismatch') parts.push('ngày đáo hạn lệch');
  return { label: 'PDF lệch', title: parts.join(' · ') || 'PDF lệch file XLSX/CSV', cls: 'bg-amber-500/15 text-amber-600 dark:text-amber-400' };
}
