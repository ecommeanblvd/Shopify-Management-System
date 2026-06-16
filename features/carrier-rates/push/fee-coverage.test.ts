import { describe, it, expect } from 'vitest';
import { classifyFeeCoverage, fuelPercentToday } from './fee-coverage';
import type { CarrierAccountSnapshot } from '../engine/quote';

type S = CarrierAccountSnapshot['surcharges'][number];
const s = (kind: string, value = 1, applyMode: 'always' | 'when_billed' = 'always'): S =>
  ({ kind, value, active: true, applyMode } as unknown as S);

const labels = (items: { label: string }[]) => items.map((i) => i.label);

describe('classifyFeeCoverage', () => {
  it('FedEx: remote→không cover, residential/demand→cover, signature opt-in + address correction→không cover', () => {
    const r = classifyFeeCoverage(
      [s('fuel_percent', 42.5), s('demand_per_kg', 39700), s('country_fixed', 68300, 'always'),
        s('residential_fixed', 84400), s('remote_fixed', 475000), s('addon_fixed', 92700, 'when_billed'), s('vat_percent', 8)],
      'FedEx Vietnam — International Priority (IP) 2026',
    );
    expect(labels(r.covered)).toContain('Phụ phí xăng dầu (fuel)');
    expect(labels(r.covered)).toContain('Giao địa chỉ nhà — residential');
    expect(labels(r.notCovered)).toContain('ODA / vùng xa');
    expect(r.notCovered.some((x) => x.label.startsWith('Address Correction'))).toBe(true);
    expect(r.notCovered.some((x) => x.label.startsWith('Dịch vụ opt-in'))).toBe(true);
  });

  it('kèm số tiền/% cụ thể trong detail', () => {
    const r = classifyFeeCoverage([s('fuel_percent', 42.5), s('residential_fixed', 84400)], 'FedEx');
    expect(r.fuelPercent).toBe(42.5);
    expect(r.covered.find((i) => i.label.startsWith('Phụ phí xăng dầu'))?.detail).toBe('42.5%');
    expect(r.covered.find((i) => i.label.startsWith('Giao địa chỉ nhà'))?.detail).toContain('84.400đ');
  });

  it('DHL: không có Address Correction; per_step + addon always→cover', () => {
    const r = classifyFeeCoverage(
      [s('fuel_percent', 30), s('per_step_fixed', 1900), s('addon_fixed', 150000, 'always'), s('remote_fixed', 600000)],
      'DHL Express Vietnam — Worldwide Export 2026',
    );
    expect(labels(r.covered)).toContain('Phí theo bậc cân (GoGreen)');
    expect(labels(r.covered)).toContain('Dịch vụ bổ sung tự áp (ký nhận)');
    expect(r.notCovered.some((x) => x.label.startsWith('Address Correction'))).toBe(false);
  });

  it('row inactive bị bỏ qua', () => {
    const inactive = { kind: 'remote_fixed', value: 1, active: false, applyMode: 'always' } as unknown as S;
    const r = classifyFeeCoverage([inactive], 'DHL');
    expect(r.notCovered).toHaveLength(0);
  });

  it('ký nhận: kỳ when_billed CŨ đã hết hạn KHÔNG hiện opt-in; chỉ còn always (cover)', () => {
    const now = new Date('2026-06-16');
    const oldOptIn = { kind: 'addon_fixed', value: 92700, active: true, applyMode: 'when_billed',
      startsAt: new Date('2026-01-01'), endsAt: new Date('2026-06-15') } as unknown as S;
    const currentAlways = { kind: 'addon_fixed', value: 92700, active: true, applyMode: 'always',
      startsAt: new Date('2026-06-15'), endsAt: null } as unknown as S;
    const r = classifyFeeCoverage([oldOptIn, currentAlways], 'FedEx', now);
    expect(labels(r.covered)).toContain('Dịch vụ bổ sung tự áp (ký nhận)');
    expect(r.notCovered.some((x) => x.label.startsWith('Dịch vụ opt-in'))).toBe(false);
  });

  it('fuelPercentToday tổng các dòng đang áp', () => {
    expect(fuelPercentToday([s('fuel_percent', 42.5)])).toBe(42.5);
    expect(fuelPercentToday([])).toBeNull();
  });
});
