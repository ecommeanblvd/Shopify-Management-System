import { describe, it, expect } from 'vitest';
import { parsePdfInvoiceTotals } from './pdf-invoice-totals';

const FEDEX = `
FREIGHT INVOICE SUMMARY
ANH NGUYEN                                                       Invoice No.:                 734005869
CÔNG TY CỔ PHẦN INESCO                                           Invoice Date:                28 Jul 2025
                                                                 VAT Invoice No.:             1K25TFA-00006666
International Services                          Total (VND)
Express Charges                                132,509,041
Grand Total (VAT included)                     132,509,041
Your payment is due by 17 Aug 2025
Ngày đến hạn thanh toán 17 Aug 2025
`;

const DHL = `
                                       Invoice no.                                     HANR000269158
                                       Date                                               13/05/2026
DATE                 ORG             HAWB NO          DEST          PIECE       WEIGHT
21/04/2026           SGN         2154097234            FYV               1       2.00            605,447
TOTAL FOR SHIPMENT                                  17      39.00          32,126,727       2,570,138    34,696,865
                                                   Total VND                              34,696,865
`;

describe('parsePdfInvoiceTotals — FedEx', () => {
  it('đọc Invoice No. (9 số, KHÔNG bắt VAT Invoice No.), Grand Total, ngày', () => {
    const r = parsePdfInvoiceTotals(FEDEX, 'fedex');
    expect(r['734005869']).toEqual({ total: 132509041, issueDate: '2025-07-28', dueDate: '2025-08-17' });
    expect(r['00006666']).toBeUndefined();
    expect(r['1']).toBeUndefined();
  });

  it('PDF nhiều hoá đơn FedEx → mỗi invoice lấy đúng total/ngày của block mình', () => {
    const TWO = `
FREIGHT INVOICE SUMMARY
                              Invoice No.:                 734005869
                              Invoice Date:                28 Jul 2025
Grand Total (VAT included)    132,509,041
Your payment is due by 17 Aug 2025

FREIGHT INVOICE SUMMARY
                              Invoice No.:                 800111222
                              Invoice Date:                03 Aug 2025
Grand Total (VAT included)    45,000,000
Your payment is due by 02 Sep 2025
`;
    const r = parsePdfInvoiceTotals(TWO, 'fedex');
    expect(r['734005869']).toEqual({ total: 132509041, issueDate: '2025-07-28', dueDate: '2025-08-17' });
    expect(r['800111222']).toEqual({ total: 45000000, issueDate: '2025-08-03', dueDate: '2025-09-02' });
  });
});

describe('parsePdfInvoiceTotals — DHL', () => {
  it('đọc HANR, Total VND, Date (dd/mm/yyyy), dueDate null', () => {
    const r = parsePdfInvoiceTotals(DHL, 'dhl');
    expect(r['HANR000269158']).toEqual({ total: 34696865, issueDate: '2026-05-13', dueDate: null });
  });
});

describe('parsePdfInvoiceTotals — fail an toàn', () => {
  it('block thiếu total → entry vắng (không total:0)', () => {
    const r = parsePdfInvoiceTotals('Invoice No.:   999999999\nInvoice Date: 01 Jan 2025\n', 'fedex');
    expect(r['999999999']).toBeUndefined();
  });
  it('text rác → map rỗng', () => {
    expect(parsePdfInvoiceTotals('blah blah', 'fedex')).toEqual({});
    expect(parsePdfInvoiceTotals('blah blah', 'dhl')).toEqual({});
  });
});
