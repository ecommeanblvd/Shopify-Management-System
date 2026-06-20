import { describe, expect, it } from 'vitest';
import { matchInvoiceNumbers } from './match-invoice-pdf';

const known = new Set(['734001324', '734005000', '734009999']);

describe('matchInvoiceNumbers', () => {
  it('khớp số hoá đơn trong text (Reference/Invoice No.)', () => {
    const text = `
      Số tham chiếu (Reference Number): 734001324
      1  881907346391 VN HK  1.011.958
      Invoice No.: 734001324   VAT Invoice No.: 1K25TFA-00001627
      Mã số thuế: 0100112613`;
    expect(matchInvoiceNumbers(text, known)).toEqual(['734001324']);
  });

  it('1 PDF gom NHIỀU hoá đơn → trả tất cả billNumber khớp', () => {
    expect(matchInvoiceNumbers('734001324 ... 734005000 ...', known).sort())
      .toEqual(['734001324', '734005000']);
  });

  it('AWB 12 chữ số + mã số thuế KHÔNG nhầm thành billNumber', () => {
    expect(matchInvoiceNumbers('881907346391 0100112613 0109894073', known)).toEqual([]);
  });

  it('không có số hoá đơn nào trong danh sách → rỗng', () => {
    expect(matchInvoiceNumbers('Reference Number: 999888777', known)).toEqual([]);
  });

  it('cùng số lặp nhiều lần → dedup', () => {
    expect(matchInvoiceNumbers('734001324 734001324 734001324', known)).toEqual(['734001324']);
  });

  it('khớp billNumber DHL có tiền tố HANR', () => {
    const dhlKnown = new Set(['HANR000269158', 'HANR000268253']);
    const text = `Invoice no.   HANR000269158
      Số tham chiếu (Reference DHL Invoice no): 527888723 - HANR000269158
      21/04/2026  SGN  2154097234  FYV  605,447`;
    expect(matchInvoiceNumbers(text, dhlKnown)).toEqual(['HANR000269158']);
  });

  it('DHL: token số thuần (account no) KHÔNG nhầm thành billNumber HANR', () => {
    expect(matchInvoiceNumbers('527888723 000269158', new Set(['HANR000269158']))).toEqual([]);
  });
});
