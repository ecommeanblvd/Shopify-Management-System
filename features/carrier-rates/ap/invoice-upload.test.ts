import { describe, it, expect } from 'vitest';
import { detectInvoiceFormat, toInvoicePreview } from './invoice-upload';

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
