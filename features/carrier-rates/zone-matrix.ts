import { isoToCountryName } from '../shipments/country-name-to-iso';
import type { ZoneWithCountries } from './zones-actions';

/**
 * Bảng tham chiếu zone hợp nhất: mỗi nước 1 dòng, kèm zone của FedEx & DHL
 * (theo phân chia zone đã set up trong carrier_zones). Để tra 1 nước thuộc
 * zone nào lúc set up giá. THUẦN, không I/O.
 */
export interface ZoneMatrixRow {
  iso: string;
  name: string;
  fedexZone: string | null;
  dhlZone: string | null;
}

function indexByIso(zones: ZoneWithCountries[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const z of zones) for (const c of z.countries) m.set(c.toUpperCase(), z.label);
  return m;
}

export function buildZoneMatrix(
  fedexZones: ZoneWithCountries[],
  dhlZones: ZoneWithCountries[],
): ZoneMatrixRow[] {
  const fedexByIso = indexByIso(fedexZones);
  const dhlByIso = indexByIso(dhlZones);
  const isos = new Set<string>([...fedexByIso.keys(), ...dhlByIso.keys()]);
  const rows: ZoneMatrixRow[] = [...isos].map((iso) => ({
    iso,
    name: isoToCountryName(iso) || iso,
    fedexZone: fedexByIso.get(iso) ?? null,
    dhlZone: dhlByIso.get(iso) ?? null,
  }));
  rows.sort((a, b) => a.name.localeCompare(b.name));
  return rows;
}
