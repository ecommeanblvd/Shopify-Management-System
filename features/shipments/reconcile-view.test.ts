import { describe, expect, it } from 'vitest';
import { mergeStatus, netBase, type StatusRecord } from './reconcile-view';
import type { ReconcileRow } from './reconcile';

function row(over: Partial<ReconcileRow> = {}): ReconcileRow {
  return {
    shipmentId: 's1', trackingNumber: 't1', orderNumber: '#1', storeName: 'S',
    carrierKey: 'fedex', shipCountry: 'SA', shopifyWeightKg: 1, weightKg: 1, chargeableKg: 1, labelDate: null,
    billedTotal: 2_388_966, billedBase: 5_079_100, billedFuel: 513_729,
    billedRemote: 550_000, billedDemand: 71_000, billedSignature: 0,
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
});
