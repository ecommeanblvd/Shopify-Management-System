import { isoToCountryName } from '../shipments/country-name-to-iso';

/**
 * Bảng zone HỆ THỐNG: mỗi zone (mã vùng ME1/EU1/…) + zone FedEx/DHL gốc + danh
 * sách quốc gia (tên + cờ). Tra 1 nước thuộc zone hệ thống nào. THUẦN, không I/O.
 */
export interface SystemZoneCountry {
  iso: string;
  name: string;
  flag: string;
}
export interface SystemZoneRow {
  zone: string;
  fedexZone: string | null;
  dhlZone: string | null;
  countries: SystemZoneCountry[];
}

/** ISO2 → cờ emoji (regional indicator). Không phải ISO2 hợp lệ → ''. */
export function flagEmoji(iso: string): string {
  const cc = iso.toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) return '';
  return String.fromCodePoint(...[...cc].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

export function buildSystemZoneView(
  zones: Record<string, { countries: string[] }>,
  fedexByIso: Record<string, string> = {},
  dhlByIso: Record<string, string> = {},
): SystemZoneRow[] {
  const rows: SystemZoneRow[] = Object.entries(zones).map(([zone, z]) => {
    const countries: SystemZoneCountry[] = z.countries
      .map((iso) => {
        const cc = iso.toUpperCase();
        return { iso: cc, name: isoToCountryName(cc) || cc, flag: flagEmoji(cc) };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    // Mọi nước trong 1 zone hệ thống cùng (FedEx, DHL) zone — suy từ nước đầu.
    const first = z.countries[0]?.toUpperCase();
    return {
      zone,
      fedexZone: first ? fedexByIso[first] ?? null : null,
      dhlZone: first ? dhlByIso[first] ?? null : null,
      countries,
    };
  });
  rows.sort((a, b) => a.zone.localeCompare(b.zone, undefined, { numeric: true }));
  return rows;
}
