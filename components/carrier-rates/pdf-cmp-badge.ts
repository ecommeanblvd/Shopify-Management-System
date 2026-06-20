import { comparePdfToBill } from '@/features/carrier-rates/ap/compare-pdf-bill';

interface BillCmpInput {
  amount: number; issueDate: string | null; dueDate: string | null;
  pdfAmount: number | null; pdfIssueDate: string | null; pdfDueDate: string | null;
}

/** Nhãn + title + class badge đối soát PDF cho 1 bill (gọi khi bill có PDF). */
export function pdfCmpBadge(b: BillCmpInput, fmt: (n: number) => string): { label: string; title: string; cls: string } {
  const c = comparePdfToBill(b, b);
  if (c.overall === 'unknown') return { label: 'PDF chưa đọc được tổng', title: 'Không đọc được tổng tiền từ PDF — kiểm tra file', cls: 'bg-muted text-muted-foreground' };
  if (c.overall === 'match') return { label: 'PDF khớp', title: 'Tổng tiền và ngày trên PDF khớp file XLSX/CSV', cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' };
  const parts: string[] = [];
  if (c.amountStatus === 'mismatch' && b.pdfAmount !== null) parts.push(`PDF ${fmt(b.pdfAmount)} vs XLSX ${fmt(b.amount)} (lệch ${fmt(Math.abs(c.amountDeltaVnd ?? 0))})`);
  if (c.issueDateStatus === 'mismatch') parts.push('ngày HĐ lệch');
  if (c.dueDateStatus === 'mismatch') parts.push('ngày đáo hạn lệch');
  return { label: 'PDF lệch', title: parts.join(' · ') || 'PDF lệch file XLSX/CSV', cls: 'bg-amber-500/15 text-amber-600 dark:text-amber-400' };
}
