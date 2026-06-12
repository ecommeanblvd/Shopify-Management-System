import { describe, it, expect } from 'vitest';
import { suggestCauseKind, needsCarrierClaim, isApprovableMatch } from './carrier-error-flow';
import type { ReconcileDiagnosis } from './reconcile-diagnose';

const diag = (components: any[], severity = 'config'): ReconcileDiagnosis =>
  ({ totalDelta: 0, components, impliedWeight: null, impliedZone: null, verdict: '', severity } as ReconcileDiagnosis);

describe('suggestCauseKind', () => {
  it('chọn khoản |delta| lớn nhất khác KHOP', () => {
    expect(suggestCauseKind(diag([
      { key: 'fuel', billed: 0, engine: 0, delta: 50, cause: 'LECH_FUEL' },
      { key: 'remote', billed: 0, engine: 0, delta: 200, cause: 'REMOTE_KHONG_KHOP' },
    ]))).toBe('remote');
  });
  it('base+SAI_CAN→weight, base+SAI_ZONE→zone, base+LECH_RATE_CARD→ratecard', () => {
    expect(suggestCauseKind(diag([{ key: 'base', billed: 0, engine: 0, delta: 9, cause: 'SAI_CAN' }]))).toBe('weight');
    expect(suggestCauseKind(diag([{ key: 'base', billed: 0, engine: 0, delta: 9, cause: 'SAI_ZONE' }]))).toBe('zone');
    expect(suggestCauseKind(diag([{ key: 'base', billed: 0, engine: 0, delta: 9, cause: 'LECH_RATE_CARD' }]))).toBe('ratecard');
  });
  it('signature/vat theo key', () => {
    expect(suggestCauseKind(diag([{ key: 'signature', billed: 0, engine: 0, delta: 9, cause: 'KHONG_KHOP' }]))).toBe('signature');
    expect(suggestCauseKind(diag([{ key: 'vat', billed: 0, engine: 0, delta: 9, cause: 'KHONG_KHOP' }]))).toBe('vat');
  });
  it('gogreen/elevatedRisk→other; null→""; toàn KHOP→""', () => {
    expect(suggestCauseKind(diag([{ key: 'gogreen', billed: 0, engine: 0, delta: 9, cause: 'KHONG_KHOP' }]))).toBe('other');
    expect(suggestCauseKind(null)).toBe('');
    expect(suggestCauseKind(diag([{ key: 'fuel', billed: 0, engine: 0, delta: 0, cause: 'KHOP' }]))).toBe('');
  });
});
describe('needsCarrierClaim', () => {
  it('>0 đòi, ≤0/null không', () => {
    expect(needsCarrierClaim(100)).toBe(true);
    expect(needsCarrierClaim(-100)).toBe(false);
    expect(needsCarrierClaim(0)).toBe(false);
    expect(needsCarrierClaim(null)).toBe(false);
  });
});
describe('isApprovableMatch', () => {
  it('match/rounding mới duyệt', () => {
    expect(isApprovableMatch('match')).toBe(true);
    expect(isApprovableMatch('rounding')).toBe(true);
    expect(isApprovableMatch('zone')).toBe(false);
    expect(isApprovableMatch(null)).toBe(false);
  });
});
