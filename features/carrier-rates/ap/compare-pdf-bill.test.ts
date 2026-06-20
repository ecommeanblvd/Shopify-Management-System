import { describe, it, expect } from 'vitest';
import { comparePdfToBill } from './compare-pdf-bill';

const bill = { amount: 132509041, issueDate: '2025-07-28', dueDate: '2025-08-17' };

describe('comparePdfToBill', () => {
  it('khớp khi tổng = nhau, ngày = nhau', () => {
    const r = comparePdfToBill(bill, { pdfAmount: 132509041, pdfIssueDate: '2025-07-28', pdfDueDate: '2025-08-17' });
    expect(r).toEqual({ amountStatus: 'match', amountDeltaVnd: 0, issueDateStatus: 'match', dueDateStatus: 'match', overall: 'match' });
  });
  it('lệch ≤ tolerance vẫn match', () => {
    expect(comparePdfToBill(bill, { pdfAmount: 132509041 - 800, pdfIssueDate: '2025-07-28', pdfDueDate: '2025-08-17' }).amountStatus).toBe('match');
  });
  it('lệch tiền > tolerance → mismatch + overall mismatch', () => {
    const r = comparePdfToBill(bill, { pdfAmount: 130000000, pdfIssueDate: '2025-07-28', pdfDueDate: '2025-08-17' });
    expect(r.amountStatus).toBe('mismatch');
    expect(r.amountDeltaVnd).toBe(2509041);
    expect(r.overall).toBe('mismatch');
  });
  it('lệch ngày HĐ → overall mismatch dù tiền khớp', () => {
    const r = comparePdfToBill(bill, { pdfAmount: 132509041, pdfIssueDate: '2025-07-29', pdfDueDate: '2025-08-17' });
    expect(r.issueDateStatus).toBe('mismatch');
    expect(r.overall).toBe('mismatch');
  });
  it('pdfAmount null → unknown (chưa đọc được tổng)', () => {
    const r = comparePdfToBill(bill, { pdfAmount: null, pdfIssueDate: null, pdfDueDate: null });
    expect(r.amountStatus).toBe('unknown');
    expect(r.amountDeltaVnd).toBeNull();
    expect(r.overall).toBe('unknown');
  });
  it('DHL: dueDate phía PDF null → dueDateStatus unknown, overall match nếu tiền+ngày HĐ khớp', () => {
    const r = comparePdfToBill({ amount: 34696865, issueDate: '2026-05-13', dueDate: '2026-06-12' }, { pdfAmount: 34696865, pdfIssueDate: '2026-05-13', pdfDueDate: null });
    expect(r.dueDateStatus).toBe('unknown');
    expect(r.overall).toBe('match');
  });
  it('bill.issueDate null (FBO) + pdf có ngày → issueDate unknown, không mismatch', () => {
    const r = comparePdfToBill({ amount: 132509041, issueDate: null, dueDate: null }, { pdfAmount: 132509041, pdfIssueDate: '2025-07-28', pdfDueDate: '2025-08-17' });
    expect(r.issueDateStatus).toBe('unknown');
    expect(r.overall).toBe('match');
  });
});
