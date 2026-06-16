import { describe, it, expect } from 'vitest';
import { classifyFeeCoverage } from './fee-coverage';
import type { CarrierAccountSnapshot } from '../engine/quote';

type S = CarrierAccountSnapshot['surcharges'][number];
const s = (kind: string, applyMode: 'always' | 'when_billed' = 'always'): S =>
  ({ kind, value: 1, active: true, applyMode } as unknown as S);

describe('classifyFeeCoverage', () => {
  it('FedEx: remote→không cover, residential/demand/country_fixed→cover, signature opt-in + address correction→không cover', () => {
    const r = classifyFeeCoverage(
      [s('fuel_percent'), s('demand_per_kg'), s('country_fixed', 'always'), s('residential_fixed'),
        s('remote_fixed'), s('addon_fixed', 'when_billed'), s('vat_percent')],
      'FedEx Vietnam — International Priority (IP) 2026',
    );
    expect(r.covered).toContain('Phụ phí xăng dầu (fuel)');
    expect(r.covered).toContain('Giao địa chỉ nhà — residential (nước áp dụng)');
    expect(r.notCovered).toContain('ODA / vùng xa — cần địa chỉ cụ thể, matrix phẳng không kích hoạt');
    expect(r.notCovered.some((x) => x.startsWith('Address Correction'))).toBe(true);
    expect(r.notCovered.some((x) => x.startsWith('Dịch vụ opt-in'))).toBe(true);
  });

  it('DHL: không có Address Correction; per_step + addon always→cover', () => {
    const r = classifyFeeCoverage(
      [s('fuel_percent'), s('per_step_fixed'), s('addon_fixed', 'always'), s('remote_fixed')],
      'DHL Express Vietnam — Worldwide Export 2026',
    );
    expect(r.covered).toContain('Phí theo bậc cân (GoGreen)');
    expect(r.covered).toContain('Dịch vụ bổ sung tự áp (vd ký nhận DHL)');
    expect(r.notCovered.some((x) => x.startsWith('Address Correction'))).toBe(false);
  });

  it('row inactive bị bỏ qua', () => {
    const inactive = { kind: 'remote_fixed', value: 1, active: false, applyMode: 'always' } as unknown as S;
    const r = classifyFeeCoverage([inactive], 'DHL');
    expect(r.notCovered).toHaveLength(0);
  });

  it('ký nhận: kỳ when_billed CŨ đã hết hạn KHÔNG hiện opt-in; chỉ còn always (cover)', () => {
    const now = new Date('2026-06-16');
    const oldOptIn = { kind: 'addon_fixed', value: 92700, active: true, applyMode: 'when_billed',
      startsAt: new Date('2026-01-01'), endsAt: new Date('2026-06-15') } as unknown as S; // đã hết
    const currentAlways = { kind: 'addon_fixed', value: 92700, active: true, applyMode: 'always',
      startsAt: new Date('2026-06-15'), endsAt: null } as unknown as S; // hiệu lực
    const r = classifyFeeCoverage([oldOptIn, currentAlways], 'FedEx', now);
    expect(r.covered).toContain('Dịch vụ bổ sung tự áp (vd ký nhận DHL)');
    expect(r.notCovered.some((x) => x.startsWith('Dịch vụ opt-in'))).toBe(false);
  });
});
