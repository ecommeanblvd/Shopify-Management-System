import { describe, it, expect } from 'vitest';
import { isAutoReconciled, effStatus, filterReconcileRows, reconcileSummary, paginate } from './reconcile-filter';
import type { ReconcileViewRow } from './reconcile-view';

const row = (o: Partial<ReconcileViewRow> = {}): ReconcileViewRow => ({
  shipmentId: 's', trackingNumber: 't', orderNumber: '#1', storeName: 'S', carrierKey: 'dhl',
  shipCountry: 'SA', shipCity: null, shipPostcode: null, addrClass: null, addrDeliverable: null, addrIssue: null,
  shopifyWeightKg: 1, weightKg: 1, chargeableKg: 1, billedWeightKg: 2, labelDate: null,
  billedTotal: 1_000_000, engineTotal: 900_000, deltaVnd: 100_000, deltaPct: 10, diagnosis: null,
  status: 'pending', staleDispute: false,
  ...o,
} as ReconcileViewRow);

describe('isAutoReconciled / effStatus', () => {
  it('pending + lệch nhỏ < tolerance → auto reconciled', () => {
    expect(isAutoReconciled(row({ deltaVnd: 500 }))).toBe(true);
    expect(effStatus(row({ deltaVnd: 500 }))).toBe('reconciled');
  });
  it('pending + diagnosis passthrough → auto', () => {
    expect(isAutoReconciled(row({ deltaVnd: 500_000, diagnosis: { severity: 'passthrough' } as never }))).toBe(true);
  });
  it('pending + lệch to, không passthrough → vẫn pending', () => {
    expect(effStatus(row({ deltaVnd: 500_000 }))).toBe('pending');
  });
  it('staleDispute → reconciled', () => {
    expect(effStatus(row({ status: 'disputing', staleDispute: true, deltaVnd: 500_000 }))).toBe('reconciled');
  });
  it('billed null + chưa cân (engineReason no_weight) → awaiting_measurement', () => {
    expect(effStatus(row({ billedTotal: null, engineTotal: null, deltaVnd: null, engineReason: 'no_weight' } as never)))
      .toBe('awaiting_measurement');
  });
  it('billed null + đã cân (có engineTotal) → awaiting_billed', () => {
    expect(effStatus(row({ billedTotal: null, engineTotal: 850_000, deltaVnd: null, engineReason: null } as never)))
      .toBe('awaiting_billed');
  });
  it('billed null + đã cân nhưng thiếu bảng giá (no_rate_card) → awaiting_billed (không phải awaiting_measurement)', () => {
    expect(effStatus(row({ billedTotal: null, engineTotal: null, deltaVnd: null, engineReason: 'no_rate_card' } as never)))
      .toBe('awaiting_billed');
  });
  it('billed null KHÔNG bị isAutoReconciled nuốt thành reconciled', () => {
    // deltaVnd null → Math.abs(0) < tolerance từng khiến nó thành "reconciled" — phải tránh.
    expect(effStatus(row({ billedTotal: null, engineTotal: null, deltaVnd: null, engineReason: 'no_weight' } as never)))
      .not.toBe('reconciled');
  });
});

describe('filterReconcileRows', () => {
  const rows = [
    row({ carrierKey: 'dhl', shipCountry: 'SA', deltaPct: 12, orderNumber: '#AAA' }),
    row({ carrierKey: 'fedex', shipCountry: 'US', deltaPct: 3, orderNumber: '#BBB' }),
  ];
  const base = { carrier: 'all', status: 'all', country: '', minPct: '', q: '' } as const;
  it('lọc carrier', () => { expect(filterReconcileRows(rows, { ...base, carrier: 'fedex' }).length).toBe(1); });
  it('lọc country (không phân biệt hoa thường)', () => { expect(filterReconcileRows(rows, { ...base, country: 'sa' }).length).toBe(1); });
  it('lọc minPct (|deltaPct| ≥)', () => { expect(filterReconcileRows(rows, { ...base, minPct: '10' }).length).toBe(1); });
  it('lọc q theo order/tracking', () => { expect(filterReconcileRows(rows, { ...base, q: 'bbb' }).map((r) => r.orderNumber)).toEqual(['#BBB']); });
  it('sort: chưa đối soát (pending) lên đầu, KHÔNG theo |delta|/ngày', () => {
    // resolved + ngày MỚI HƠN vs pending + ngày cũ hơn → pending vẫn lên trước.
    // pending deltaVnd phải > tolerance (1000) để không bị auto-reconciled.
    const r = filterReconcileRows([
      row({ orderNumber: '#resolvedNew', status: 'reconciled', deltaVnd: 999999, labelDate: new Date('2026-06-10') }),
      row({ orderNumber: '#pendingOld', status: 'pending', deltaVnd: 5000, labelDate: new Date('2026-06-01') }),
    ], base);
    expect(r.map((x) => x.orderNumber)).toEqual(['#pendingOld', '#resolvedNew']);
  });
  it('sort: trong cùng nhóm, đơn mới nhất (ngày ship) lên trước', () => {
    const r = filterReconcileRows([
      row({ orderNumber: '#cu', status: 'pending', labelDate: new Date('2026-05-01') }),
      row({ orderNumber: '#moi', status: 'pending', labelDate: new Date('2026-06-20') }),
      row({ orderNumber: '#khongngay', status: 'pending', labelDate: null }),
    ], base);
    expect(r.map((x) => x.orderNumber)).toEqual(['#moi', '#cu', '#khongngay']);
  });
});

describe('reconcileSummary', () => {
  it('auto-reconciled fold engine=billed; pending/over10 chỉ đếm pending', () => {
    const s = reconcileSummary([
      row({ deltaVnd: 500, billedTotal: 100, engineTotal: 80 }),               // auto → engine fold 100
      row({ deltaVnd: 500_000, deltaPct: 20, billedTotal: 200, engineTotal: 150 }), // pending, >10%
    ]);
    expect(s.billed).toBe(300); expect(s.engine).toBe(250); expect(s.delta).toBe(50);
    expect(s.pendingCount).toBe(1); expect(s.over10).toBe(1); expect(s.n).toBe(2);
  });
});

describe('paginate', () => {
  it('slice + totalPages + kẹp safePage', () => {
    const r = Array.from({ length: 250 }, (_, i) => i);
    expect(paginate(r, 0, 100).pageRows.length).toBe(100);
    expect(paginate(r, 2, 100).pageRows[0]).toBe(200);
    expect(paginate(r, 2, 100).pageRows.length).toBe(50);
    expect(paginate(r, 9, 100).safePage).toBe(2);
    expect(paginate(r, 0, 100).totalPages).toBe(3);
  });
});
