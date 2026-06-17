import { isoToCountryName } from '../shipments/country-name-to-iso';

/**
 * Bảng zone HỆ THỐNG: mỗi zone kết hợp (FedEx×DHL) + danh sách quốc gia trong
 * zone (kèm tên nước). Để tra 1 nước thuộc zone hệ thống nào. THUẦN, không I/O.
 */
export interface SystemZoneCountry {
  iso: string;
  name: string;
}
export interface SystemZoneRow {
  zone: string;
  countries: SystemZoneCountry[];
}

export function buildSystemZoneView(
  zones: Record<string, { countries: string[] }>,
): SystemZoneRow[] {
  const rows: SystemZoneRow[] = Object.entries(zones).map(([zone, z]) => ({
    zone,
    countries: z.countries
      .map((iso) => ({ iso: iso.toUpperCase(), name: isoToCountryName(iso) || iso.toUpperCase() }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  }));
  rows.sort((a, b) => a.zone.localeCompare(b.zone));
  return rows;
}
