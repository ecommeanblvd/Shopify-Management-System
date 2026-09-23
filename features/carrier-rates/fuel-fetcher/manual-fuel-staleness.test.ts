import { describe, it, expect } from 'vitest';
import {
  AUTO_FUEL_CARRIER_KEYS,
  findStaleAutoFuel,
  findStaleManualFuel,
  type AutoFuelRow,
  type ManualFuelRow,
} from './manual-fuel-staleness';

const NOW = new Date('2026-07-06T00:00:00.000Z');

function row(overrides: Partial<ManualFuelRow>): ManualFuelRow {
  return {
    accountId: 'acc-1',
    accountName: 'Test Account',
    carrierKey: 'some-manual-carrier',
    fuelPercent: 27,
    updatedAt: NOW,
    ...overrides,
  };
}

describe('findStaleManualFuel', () => {
  it('ignores fedex accounts even when stale', () => {
    const rows = [
      row({ carrierKey: 'fedex', fuelPercent: null, updatedAt: null }),
    ];
    expect(findStaleManualFuel(rows, NOW, 7)).toEqual([]);
  });

  it('ignores dhl accounts even when stale', () => {
    const rows = [
      row({ carrierKey: 'dhl', fuelPercent: 0, updatedAt: new Date('2026-01-01T00:00:00.000Z') }),
    ];
    expect(findStaleManualFuel(rows, NOW, 7)).toEqual([]);
  });

  it('ignores ups accounts (auto-fetched from assets.ups.com) even when stale', () => {
    const rows = [
      row({ carrierKey: 'ups', fuelPercent: 0, updatedAt: new Date('2026-01-01T00:00:00.000Z') }),
    ];
    expect(findStaleManualFuel(rows, NOW, 7)).toEqual([]);
  });

  /**
   * Đổi chiều 23/09/2026: SF Express bị gỡ khỏi `AUTO_FUEL_CARRIER_KEYS` vì
   * nguồn CHN ngừng đăng tuần mới từ 29/06/2026. Gỡ khỏi auto thì nó PHẢI rơi
   * vào đường nhập tay như Aramex — nếu không, giá SF cũ đi sẽ không còn hiện ở
   * đâu cả, tức đổi một lỗi ồn lấy một lỗi câm.
   */
  it('SF Express nay đi đường nhập tay: fuel cũ PHẢI bị nêu, không được bỏ qua', () => {
    const rows = [
      row({ carrierKey: 'sf-express', fuelPercent: 25, updatedAt: new Date('2026-07-06T00:00:00.000Z') }),
    ];
    const result = findStaleManualFuel(rows, new Date('2026-09-23T00:00:00.000Z'), 7);
    expect(result).toHaveLength(1);
    expect(result[0].reason).toBe('stale');
    expect(result[0].daysSince).toBe(79);
  });

  it('SF Express không còn nằm trong danh sách auto', () => {
    expect(AUTO_FUEL_CARRIER_KEYS).not.toContain('sf-express');
    expect(AUTO_FUEL_CARRIER_KEYS).toEqual(['fedex', 'dhl', 'ups']);
  });

  it('flags manual-carrier fuel=0 as unset', () => {
    const rows = [row({ carrierKey: 'some-manual-carrier', fuelPercent: 0 })];
    const result = findStaleManualFuel(rows, NOW, 7);
    expect(result).toHaveLength(1);
    expect(result[0].reason).toBe('unset');
    expect(result[0].daysSince).toBeNull();
  });

  it('flags manual-carrier fuel=27 updated 10 days ago as stale with daysSince 10 (staleDays 7)', () => {
    const tenDaysAgo = new Date('2026-06-26T00:00:00.000Z');
    const rows = [row({ carrierKey: 'some-manual-carrier', fuelPercent: 27, updatedAt: tenDaysAgo })];
    const result = findStaleManualFuel(rows, NOW, 7);
    expect(result).toHaveLength(1);
    expect(result[0].reason).toBe('stale');
    expect(result[0].daysSince).toBe(10);
  });

  it('does not flag manual-carrier fuel=27 updated today', () => {
    const rows = [row({ carrierKey: 'some-manual-carrier', fuelPercent: 27, updatedAt: NOW })];
    expect(findStaleManualFuel(rows, NOW, 7)).toEqual([]);
  });

  it('ignores fuelPercent null (all-in carrier, e.g. Aramex — no fuel_percent row at all)', () => {
    const rows = [
      row({ carrierKey: 'aramex', fuelPercent: null, updatedAt: null }),
    ];
    expect(findStaleManualFuel(rows, NOW, 7)).toEqual([]);
  });

  it('flags manual-carrier fuel=0 (placeholder row present but value 0) as unset', () => {
    const rows = [row({ carrierKey: 'some-manual-carrier', fuelPercent: 0, updatedAt: NOW })];
    const result = findStaleManualFuel(rows, NOW, 7);
    expect(result).toHaveLength(1);
    expect(result[0].reason).toBe('unset');
    expect(result[0].daysSince).toBeNull();
  });
});

/**
 * Điểm mù đã khiến UPS + SF Express đứng im 11 tuần: `findStaleManualFuel` cố ý
 * bỏ qua hãng auto vì tin rằng "đã có cron lo", mà cron thì không bao giờ gọi
 * tới hai hãng đó. `findStaleAutoFuel` bịt đúng lỗ này.
 */
describe('findStaleAutoFuel', () => {
  const HOM_NAY = new Date('2026-09-23T00:00:00.000Z');

  function auto(over: Partial<AutoFuelRow>): AutoFuelRow {
    return {
      accountId: 'acc-ups',
      accountName: 'UPS Worldwide Expedited',
      carrierKey: 'ups',
      newestWeekStart: new Date('2026-09-21T00:00:00.000Z'),
      ...over,
    };
  }

  it('không kêu khi tuần mới nhất vừa cập nhật', () => {
    expect(findStaleAutoFuel([auto({})], HOM_NAY, 14)).toEqual([]);
  });

  it('kêu khi hãng auto đứng im 11 tuần (đúng ca UPS 06/07 → 23/09/2026)', () => {
    const result = findStaleAutoFuel(
      [auto({ newestWeekStart: new Date('2026-07-06T00:00:00.000Z') })],
      HOM_NAY,
      14,
    );
    expect(result).toHaveLength(1);
    expect(result[0].reason).toBe('stale');
    expect(result[0].daysSince).toBe(79);
    expect(result[0].carrierKey).toBe('ups');
  });

  it('kêu khi hãng auto chưa có dòng fuel_percent nào', () => {
    const result = findStaleAutoFuel([auto({ newestWeekStart: null })], HOM_NAY, 14);
    expect(result).toHaveLength(1);
    expect(result[0].reason).toBe('unset');
    expect(result[0].daysSince).toBeNull();
  });

  it('không đụng hãng nhập tay — đó là việc của findStaleManualFuel', () => {
    const result = findStaleAutoFuel(
      [auto({ carrierKey: 'aramex', newestWeekStart: new Date('2026-01-01T00:00:00.000Z') })],
      HOM_NAY,
      14,
    );
    expect(result).toEqual([]);
  });

  it('canh MỌI hãng auto, không riêng UPS', () => {
    const cu = new Date('2026-06-29T00:00:00.000Z');
    const rows = AUTO_FUEL_CARRIER_KEYS.map((k) =>
      auto({ accountId: `acc-${k}`, accountName: `TK ${k}`, carrierKey: k, newestWeekStart: cu }));
    expect(findStaleAutoFuel(rows, HOM_NAY, 14)).toHaveLength(AUTO_FUEL_CARRIER_KEYS.length);
  });
});
