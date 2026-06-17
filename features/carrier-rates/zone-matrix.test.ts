import { describe, it, expect } from 'vitest';
import { buildZoneMatrix } from './zone-matrix';
import type { ZoneWithCountries } from './zones-actions';

const z = (label: string, countries: string[]): ZoneWithCountries => ({ id: label, label, position: 0, countries });

describe('buildZoneMatrix', () => {
  it('gộp country của FedEx + DHL → mỗi nước 1 dòng, kèm zone 2 bên', () => {
    const fedex = [z('Zone H', ['US', 'CA']), z('Zone A', ['SG'])];
    const dhl = [z('Zone 9', ['US']), z('Zone 4', ['SG', 'CA'])];
    const rows = buildZoneMatrix(fedex, dhl);
    const us = rows.find((r) => r.iso === 'US')!;
    expect(us).toMatchObject({ iso: 'US', fedexZone: 'Zone H', dhlZone: 'Zone 9' });
    const ca = rows.find((r) => r.iso === 'CA')!;
    expect(ca).toMatchObject({ fedexZone: 'Zone H', dhlZone: 'Zone 4' });
  });

  it('nước chỉ có ở 1 carrier → bên kia null', () => {
    const rows = buildZoneMatrix([z('Zone A', ['JP'])], [z('Zone 3', ['KR'])]);
    expect(rows.find((r) => r.iso === 'JP')!.dhlZone).toBeNull();
    expect(rows.find((r) => r.iso === 'KR')!.fedexZone).toBeNull();
  });

  it('có tên nước (isoToCountryName) + sắp xếp theo tên', () => {
    const rows = buildZoneMatrix([z('Z', ['US', 'JP'])], []);
    expect(rows.every((r) => r.name.length > 0)).toBe(true);
    // sorted by name ascending
    expect([...rows].sort((a, b) => a.name.localeCompare(b.name))).toEqual(rows);
  });

  it('rỗng → []', () => {
    expect(buildZoneMatrix([], [])).toEqual([]);
  });
});
