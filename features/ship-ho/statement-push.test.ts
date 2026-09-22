import { describe, it, expect } from 'vitest';
import { payloadStatementIssued } from './statement-push';

describe('payloadStatementIssued', () => {
  it('tổng orders[].amountVnd = totalVnd; periodBasis theo loại', () => {
    const st = { id: 's1', type: 'freight' as const, periodStart: '2026-07-01', periodEnd: '2026-07-31', partnerBrandSlug: 'kalisa' };
    const p = payloadStatementIssued(st, [
      { code: '26-INSLG-SV-0002', mmpRef: '26-INSLG-SV-0002', brandReference: '#KLS1990', trackingNumber: '873968744599', shippedAt: '2026-07-06', amountVnd: 1_567_050 },
      { code: '26-INSLG-SV-0003', mmpRef: null, brandReference: '#KLS1989', trackingNumber: '873913098571', shippedAt: '2026-07-03', amountVnd: 1_704_470 },
    ]);
    expect(p.totalVnd).toBe(3_271_520);
    expect(p.orderCount).toBe(2);
    expect(p.periodBasis).toBe('first_push_at');
    expect((p.orders as Array<{ mmpRef: string }>)[1].mmpRef).toBe('26-INSLG-SV-0003'); // thiếu mmpRef → dùng code
  });
  it('duty → periodBasis first_push_at, dòng kèm hoá đơn', () => {
    const p = payloadStatementIssued({ id: 's2', type: 'duty', periodStart: '2026-09-01', periodEnd: '2026-09-30', partnerBrandSlug: 'kalisa' },
      [{ code: 'x', mmpRef: 'x', brandReference: null, trackingNumber: 't', shippedAt: '2026-07-20', amountVnd: 682_298, fedexInvoiceNumber: '736059786', invoiceDate: '2026-08-20' }]);
    expect(p.periodBasis).toBe('first_push_at');
    expect((p.orders as Array<{ fedexInvoiceNumber: string }>)[0].fedexInvoiceNumber).toBe('736059786');
  });
  it('có mmpRef khác code → giữ nguyên mmpRef, KHÔNG bị thay bằng code', () => {
    const st = { id: 's3', type: 'freight' as const, periodStart: '2026-07-01', periodEnd: '2026-07-31', partnerBrandSlug: 'kalisa' };
    const p = payloadStatementIssued(st, [
      { code: '26-INSLG-SV-0002', mmpRef: 'MMP-REF-9999', brandReference: '#KLS1990', trackingNumber: '873968744599', shippedAt: '2026-07-06', amountVnd: 1_567_050 },
    ]);
    expect((p.orders as Array<{ mmpRef: string }>)[0].mmpRef).toBe('MMP-REF-9999');
  });
});
