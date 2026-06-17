import { describe, it, expect } from 'vitest';
import { buildSystemZoneView } from './zone-matrix';

describe('buildSystemZoneView', () => {
  it('mỗi zone hệ thống + nước (kèm tên), zone sắp theo tên, nước sắp theo tên', () => {
    const rows = buildSystemZoneView({
      'Zone U · Zone 6': { countries: ['NZ', 'AU'] },
      'Zone V · Zone 1': { countries: ['HK'] },
    });
    // zone sắp xếp theo tên zone
    expect(rows.map((r) => r.zone)).toEqual(['Zone U · Zone 6', 'Zone V · Zone 1']);
    // nước trong zone sắp theo TÊN: Australia (AU) trước New Zealand (NZ)
    expect(rows[0].countries.map((c) => c.iso)).toEqual(['AU', 'NZ']);
    expect(rows[0].countries.every((c) => c.name.length > 0)).toBe(true);
  });

  it('iso viết hoa + fallback tên = iso nếu không tra được', () => {
    const rows = buildSystemZoneView({ Z: { countries: ['zz'] } });
    expect(rows[0].countries[0]).toMatchObject({ iso: 'ZZ', name: 'ZZ' });
  });

  it('rỗng → []', () => {
    expect(buildSystemZoneView({})).toEqual([]);
  });
});
