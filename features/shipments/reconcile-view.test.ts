import { describe, expect, it } from 'vitest';
import { mergeStatus, netBase, type StatusRecord } from './reconcile-view';
import type { ReconcileRow } from './reconcile';

function row(over: Partial<ReconcileRow> = {}): ReconcileRow {
  return {
    shipmentId: 's1', trackingNumber: 't1', orderNumber: '#1', storeName: 'S',
    carrierKey: 'fedex', shipCountry: 'SA', shipCity: null, shipPostcode: null, shopifyWeightKg: 1, weightKg: 1, chargeableKg: 1, labelDate: null,
    billedTotal: 2_388_966, billedBase: 5_079_100, billedFuel: 513_729,
    billedRemote: 550_000, billedDemand: 71_000, billedSignature: 0, billedResidential: 0, residentialClass: null,
    billedVat: 176_960, billedGogreen: null, billedDiscount: -4_001_823,
    billedElevatedRisk: null, billedImportHandling: null, engineCountryFixed: 0,
    engineTotal: 1_270_649, engineBase: 1_075_196, engineFuel: 310_312,
    engineFuelPercent: 28.85, billedFuelPercent: 28.85,
    engineRemote: 0, engineDemand: 76_920, engineResidential: 0,
    enginePeak: 0, engineAddons: 0, enginePerStep: 0,
    engineVat: 119_020, engineDiscount: 0, engineReason: null,
    deltaVnd: 1_118_317, deltaPct: 46.8, diagnosis: null,
    ...over,
  };
}

describe('netBase', () => {
  it('nets the negative discount into the list base', () => {
    // 5,079,100 + (-4,001,823) = 1,077,277
    expect(netBase(5_079_100, -4_001_823)).toBe(1_077_277);
  });
  it('returns null when base is null', () => {
    expect(netBase(null, -100)).toBeNull();
  });
  it('treats a null discount as zero', () => {
    expect(netBase(1000, null)).toBe(1000);
  });
});

describe('mergeStatus', () => {
  it('marks rows with no status record as pending', () => {
    const [r] = mergeStatus([row()], new Map());
    expect(r.status).toBe('pending');
    expect(r.note).toBeNull();
    expect(r.billedChangedSinceReview).toBe(false);
  });

  it('applies a stored reconciled status', () => {
    const map = new Map<string, StatusRecord>([
      ['s1', { status: 'reconciled', note: 'ok', billedTotalAtReview: 2_388_966 }],
    ]);
    const [r] = mergeStatus([row()], map);
    expect(r.status).toBe('reconciled');
    expect(r.note).toBe('ok');
    expect(r.billedChangedSinceReview).toBe(false);
  });

  it('flags billedChangedSinceReview when billed differs from snapshot', () => {
    const map = new Map<string, StatusRecord>([
      ['s1', { status: 'reconciled', note: null, billedTotalAtReview: 2_000_000 }],
    ]);
    const [r] = mergeStatus([row({ billedTotal: 2_388_966 })], map);
    expect(r.billedChangedSinceReview).toBe(true);
  });

  it('computes net base on the view row', () => {
    const [r] = mergeStatus([row()], new Map());
    expect(r.billedBaseNet).toBe(1_077_277);
    expect(r.engineBaseNet).toBe(1_075_196);
  });

  it('dòng carrier_error mang status + carrierErrorKind; dòng khác kind=null', () => {
    const base = [row({ shipmentId: 'a' }), row({ shipmentId: 'b' })];
    const map = new Map<string, StatusRecord>([
      ['a', { status: 'carrier_error', note: 'FedEx sai cân', carrierErrorKind: 'weight', deltaVndAtReview: 120000, billedTotalAtReview: 500000 }],
    ]);
    const rows = mergeStatus(base, map);
    expect(rows[0].status).toBe('carrier_error');
    expect(rows[0].carrierErrorKind).toBe('weight');
    expect(rows[1].status).toBe('pending');
    expect(rows[1].carrierErrorKind).toBeNull();
  });

  it('dòng disputing mang status + carrierErrorKind + deltaVndAtReview', () => {
    const base = [row({ shipmentId: 'a' }), row({ shipmentId: 'b' })];
    const map = new Map<string, StatusRecord>([
      ['a', { status: 'disputing', note: 'đòi NCC', carrierErrorKind: 'zone', deltaVndAtReview: 194306, billedTotalAtReview: 1741581 }],
    ]);
    const rows = mergeStatus(base, map);
    expect(rows[0].status).toBe('disputing');
    expect(rows[0].carrierErrorKind).toBe('zone');
    expect(rows[0].deltaVndAtReview).toBe(194306);
    expect(rows[1].deltaVndAtReview).toBeNull();
  });

  it('flag staleDispute khi disputing nhưng Δ hiện tại đã về ~0 (engine đổi sau lúc duyệt)', () => {
    const map = new Map<string, StatusRecord>([
      ['s1', { status: 'disputing', note: 'đòi NCC', carrierErrorKind: 'demand', deltaVndAtReview: 4213, billedTotalAtReview: 681584 }],
    ]);
    const [r] = mergeStatus([row({ deltaVnd: 1 })], map);
    expect(r.staleDispute).toBe(true);
  });

  it('không flag staleDispute khi Δ hiện tại vẫn còn lớn', () => {
    const map = new Map<string, StatusRecord>([
      ['s1', { status: 'disputing', note: null, carrierErrorKind: 'zone', deltaVndAtReview: 194306, billedTotalAtReview: 1741581 }],
    ]);
    const [r] = mergeStatus([row({ deltaVnd: 194306 })], map);
    expect(r.staleDispute).toBe(false);
  });

  it('không flag staleDispute cho status khác disputing dù Δ nhỏ', () => {
    const map = new Map<string, StatusRecord>([
      ['s1', { status: 'carrier_error', note: null, carrierErrorKind: 'demand', billedTotalAtReview: 681584 }],
    ]);
    const [r] = mergeStatus([row({ deltaVnd: 1 })], map);
    expect(r.staleDispute).toBe(false);
  });

  it('không flag staleDispute khi Δ hiện tại null (chưa tính được engine)', () => {
    const map = new Map<string, StatusRecord>([
      ['s1', { status: 'disputing', note: null, carrierErrorKind: 'demand', deltaVndAtReview: 4213, billedTotalAtReview: 681584 }],
    ]);
    const [r] = mergeStatus([row({ deltaVnd: null })], map);
    expect(r.staleDispute).toBe(false);
  });

  it('không flag staleDispute với khiếu nại cố ý một khoản nhỏ (Δ lúc duyệt vốn < ngưỡng)', () => {
    const map = new Map<string, StatusRecord>([
      ['s1', { status: 'disputing', note: null, carrierErrorKind: 'ratecard', deltaVndAtReview: 600, billedTotalAtReview: 681584 }],
    ]);
    const [r] = mergeStatus([row({ deltaVnd: 600 })], map);
    expect(r.staleDispute).toBe(false);
  });

  it('không flag staleDispute khi thiếu Δ lúc duyệt (không đủ căn cứ gap từng tồn tại)', () => {
    const map = new Map<string, StatusRecord>([
      ['s1', { status: 'disputing', note: null, carrierErrorKind: 'demand', billedTotalAtReview: 681584 }],
    ]);
    const [r] = mergeStatus([row({ deltaVnd: 1 })], map);
    expect(r.staleDispute).toBe(false);
  });

  it('flag demandUncovered: bill có demand nhưng engine=0 dù đã tính được (thiếu config nước)', () => {
    const [r] = mergeStatus([row({ engineTotal: 500_000, billedDemand: 32_000, engineDemand: 0 })], new Map());
    expect(r.demandUncovered).toBe(true);
  });

  it('không flag demandUncovered khi engine CÓ áp demand', () => {
    const [r] = mergeStatus([row({ engineTotal: 500_000, billedDemand: 32_000, engineDemand: 32_000 })], new Map());
    expect(r.demandUncovered).toBe(false);
  });

  it('không flag demandUncovered khi bill không có demand', () => {
    const [r] = mergeStatus([row({ engineTotal: 500_000, billedDemand: 0, engineDemand: 0 })], new Map());
    expect(r.demandUncovered).toBe(false);
  });

  it('không flag demandUncovered khi engine chưa tính được (no rate card / no ship date)', () => {
    const [r] = mergeStatus([row({ engineTotal: null, billedDemand: 32_000, engineDemand: null })], new Map());
    expect(r.demandUncovered).toBe(false);
  });
});
