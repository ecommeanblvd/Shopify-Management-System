import { describe, it, expect } from 'vitest';
import { buildSystemZoneView, flagEmoji } from './zone-matrix';

describe('flagEmoji', () => {
  it('ISO2 → cờ emoji', () => {
    expect(flagEmoji('VN')).toBe('🇻🇳');
    expect(flagEmoji('us')).toBe('🇺🇸');
  });
  it('không hợp lệ → rỗng', () => {
    expect(flagEmoji('ZZZ')).toBe('');
  });
});

describe('buildSystemZoneView', () => {
  it('zone + FedEx/DHL gốc (suy từ nước) + nước (tên, cờ); sắp xếp', () => {
    const rows = buildSystemZoneView(
      {
        OC2: { countries: ['NZ', 'AU'] },
        ME1: { countries: ['AE'] },
      },
      { AU: 'Zone U', NZ: 'Zone U', AE: 'Zone H' },
      { AU: 'Zone 6', NZ: 'Zone 6', AE: 'Zone 9' },
    );
    // sắp theo mã vùng (numeric-aware)
    expect(rows.map((r) => r.zone)).toEqual(['ME1', 'OC2']);
    const oc = rows.find((r) => r.zone === 'OC2')!;
    expect(oc).toMatchObject({ fedexZone: 'Zone U', dhlZone: 'Zone 6' });
    // nước sắp theo tên: Australia trước New Zealand, kèm cờ
    expect(oc.countries.map((c) => c.iso)).toEqual(['AU', 'NZ']);
    expect(oc.countries[0].flag).toBe('🇦🇺');
  });

  it('không có map carrier → fedexZone/dhlZone null', () => {
    const rows = buildSystemZoneView({ RW1: { countries: ['CU'] } });
    expect(rows[0]).toMatchObject({ fedexZone: null, dhlZone: null });
  });

  it('rỗng → []', () => {
    expect(buildSystemZoneView({})).toEqual([]);
  });
});
