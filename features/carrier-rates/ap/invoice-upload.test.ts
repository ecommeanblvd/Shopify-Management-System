import { describe, it, expect } from 'vitest';
import { detectInvoiceFormat, toInvoicePreview, fboPreviewFrom } from './invoice-upload';

describe('detectInvoiceFormat', () => {
  it('dhl + .csv → dhl_csv', () => { expect(detectInvoiceFormat('dhl', 'HANR1.csv')).toBe('dhl_csv'); });
  it('fedex + .xlsx/.xls → fbo_xlsx', () => {
    expect(detectInvoiceFormat('fedex', 'FedEx_x.XLSX')).toBe('fbo_xlsx');
    expect(detectInvoiceFormat('fedex', 'a.xls')).toBe('fbo_xlsx');
  });
  it('sai đuôi theo carrier → unsupported', () => {
    expect(detectInvoiceFormat('dhl', 'a.xlsx')).toBe('unsupported');   // DHL chỉ CSV
    expect(detectInvoiceFormat('fedex', 'a.csv')).toBe('unsupported');  // FedEx chỉ XLSX
    expect(detectInvoiceFormat('dhl', 'a.pdf')).toBe('unsupported');
    expect(detectInvoiceFormat(null, 'a.csv')).toBe('unsupported');
  });
});
describe('toInvoicePreview', () => {
  it('chuẩn hoá DHL; warning khi currency lệch account', () => {
    const pv = toInvoicePreview({ kind: 'dhl', accountCurrency: 'VND', p: {
      billNumber: 'HANR1', amountInclVat: 1000, periodStart: '2026-01-01', periodEnd: '2026-01-05',
      issueDate: '2026-01-06', dueDate: '2026-02-05', currency: 'USD', shipments: [{}, {}] } });
    expect(pv).toMatchObject({ carrier: 'dhl', billNumber: 'HANR1', amount: 1000, lineCount: 2, dueDate: '2026-02-05' });
    expect(pv.warnings.some((w) => /currency|VND|USD/i.test(w))).toBe(true);
  });
  it('chuẩn hoá FBO (FedEx); issue/due = null (FboBillSummary không có)', () => {
    const pv = toInvoicePreview({ kind: 'fbo', accountCurrency: 'VND', b: {
      billNumber: 'FB9', periodStart: '2026-01-01', periodEnd: '2026-01-09', amount: 50000, lineCount: 7 } });
    expect(pv).toMatchObject({ carrier: 'fedex', billNumber: 'FB9', amount: 50000, lineCount: 7, currency: 'VND', warnings: [] });
    expect(pv.issueDate).toBeNull(); expect(pv.dueDate).toBeNull();
  });
});
describe('fboPreviewFrom', () => {
  it('1 bill → delegates to toInvoicePreview (billNumber set, no warning)', () => {
    const pv = fboPreviewFrom(
      [{ billNumber: 'FB1', periodStart: '2026-01-01', periodEnd: '2026-01-31', amount: 10000, lineCount: 5 }],
      'VND',
    );
    expect(pv).toMatchObject({ carrier: 'fedex', billNumber: 'FB1', amount: 10000, lineCount: 5, currency: 'VND' });
    expect(pv.warnings).toHaveLength(0);
  });
  it('2 bills → billNumber null, amount = sum, periodStart = earliest, periodEnd = latest, lineCount = sum, exactly one warning mentioning "2 hoá đơn"', () => {
    const pv = fboPreviewFrom(
      [
        { billNumber: 'FB1', periodStart: '2026-01-01', periodEnd: '2026-01-15', amount: 10000, lineCount: 3 },
        { billNumber: 'FB2', periodStart: '2026-01-10', periodEnd: '2026-01-31', amount: 20000, lineCount: 7 },
      ],
      'VND',
    );
    expect(pv.billNumber).toBeNull();
    expect(pv.amount).toBe(30000);
    expect(pv.periodStart).toBe('2026-01-01');
    expect(pv.periodEnd).toBe('2026-01-31');
    expect(pv.lineCount).toBe(10);
    expect(pv.warnings).toHaveLength(1);
    expect(pv.warnings[0]).toMatch(/2 hoá đơn/);
  });
});
