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

describe('payload mang KHOẢN PHÍ chi tiết cho kế toán MMP (CEO 30/09/2026)', () => {
  const st = { id: 'st-1', type: 'freight' as const, periodStart: '2026-07-01', periodEnd: '2026-07-31', partnerBrandSlug: 'kalisa' };
  const dong = [{
    code: 'X1', mmpRef: 'X1', brandReference: '#KLS1983', trackingNumber: '873911051364',
    shippedAt: '2026-07-03', amountVnd: 1_882_846,
    carrier: 'fedex', country: 'United States', weightKg: 1.7, chargeableWeightKg: 2, dimensions: '30x24x11',
    fees: [
      { code: 'base' as const, label: 'Cước cơ bản', amountVnd: 996_240 },
      { code: 'fuel' as const, label: 'Phụ phí xăng dầu', amountVnd: 451_736, percent: 38.5 },
      { code: 'signature' as const, label: 'Ký nhận (direct signature)', amountVnd: 177_100 },
      { code: 'import_handling' as const, label: 'Phí xử lý hàng nhập khẩu', amountVnd: 68_300 },
      { code: 'vat' as const, label: 'VAT', amountVnd: 139_470, percent: 8 },
      { code: 'processing' as const, label: 'Phí xử lý đơn hàng', amountVnd: 50_000 },
    ],
  }];

  it('cộng fees ra ĐÚNG amountVnd của đơn — thứ kế toán MMP kiểm đầu tiên', () => {
    const p = payloadStatementIssued(st, dong) as { orders: Array<{ amountVnd: number; fees: Array<{ amountVnd: number }> }> };
    const o = p.orders[0];
    expect(o.fees.reduce((t, f) => t + f.amountVnd, 0)).toBe(o.amountVnd);
  });

  it('giữ nguyên các trường CŨ — MMP đang đọc chúng, thêm trường không được phá', () => {
    /* Payload này là hợp đồng với hệ thống của đối tác. Thêm được, đổi tên hay bỏ thì KHÔNG. */
    const p = payloadStatementIssued(st, dong) as { orders: Array<Record<string, unknown>> };
    for (const k of ['code', 'mmpRef', 'brandReference', 'trackingNumber', 'shippedAt', 'amountVnd']) {
      expect(p.orders[0]).toHaveProperty(k);
    }
  });

  it('đơn KHÔNG có khoản phí thì vắng hẳn trường `fees`, không gửi mảng rỗng', () => {
    // Mảng rỗng đọc thành "đơn này không có khoản phí nào", khác hẳn "chưa dựng được bảng".
    const p = payloadStatementIssued(st, [{ ...dong[0], fees: undefined }]) as { orders: Array<Record<string, unknown>> };
    expect(p.orders[0]).not.toHaveProperty('fees');
  });

  it('tổng bảng kê vẫn cộng từ amountVnd, không cộng nhầm sang fees', () => {
    const p = payloadStatementIssued(st, dong) as { totalVnd: number };
    expect(p.totalVnd).toBe(1_882_846);
  });
});
