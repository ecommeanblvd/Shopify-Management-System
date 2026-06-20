import { describe, it, expect } from 'vitest';
import { pdfCmpBadge } from './pdf-cmp-badge';

const fmt = (n: number) => Math.round(n).toLocaleString('vi-VN');
const base = { amount: 100, issueDate: '2025-01-01', dueDate: '2025-02-01' };

describe('pdfCmpBadge', () => {
  it('khớp → nhãn "PDF khớp" (xanh)', () => {
    const b = pdfCmpBadge({ ...base, pdfAmount: 100, pdfIssueDate: '2025-01-01', pdfDueDate: '2025-02-01' }, fmt);
    expect(b?.label).toBe('PDF khớp');
    expect(b?.cls).toContain('emerald');
  });
  it('lệch tiền (> tolerance) → "PDF lệch" + title có số', () => {
    const b = pdfCmpBadge({ ...base, amount: 2000, pdfAmount: 100, pdfIssueDate: '2025-01-01', pdfDueDate: '2025-02-01' }, fmt);
    expect(b?.label).toBe('PDF lệch');
    expect(b?.cls).toContain('amber');
    expect(b?.title).toMatch(/PDF.*XLSX.*lệch/);
  });
  it('pdfAmount null → "chưa đọc được"', () => {
    const b = pdfCmpBadge({ ...base, pdfAmount: null, pdfIssueDate: null, pdfDueDate: null }, fmt);
    expect(b?.label).toBe('PDF chưa đọc được tổng');
  });
  it('lệch ≤ tolerance (1000) → vẫn "PDF khớp" (đồng bộ với đếm header)', () => {
    const b = pdfCmpBadge({ amount: 100600, issueDate: '2025-01-01', dueDate: '2025-02-01', pdfAmount: 100000, pdfIssueDate: '2025-01-01', pdfDueDate: '2025-02-01' }, fmt);
    expect(b?.label).toBe('PDF khớp');
  });
});
