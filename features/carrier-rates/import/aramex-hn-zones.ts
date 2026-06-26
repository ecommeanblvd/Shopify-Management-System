/** Aramex HN (Hợp Nhất) — mỗi nước 1 zone. Thứ tự = cột bảng giá HN. */
export const ARAMEX_COUNTRIES: Array<{ label: string; iso: string }> = [
  { label: 'Bahrain', iso: 'BH' },
  { label: 'Bangladesh', iso: 'BD' },
  { label: 'Egypt', iso: 'EG' },
  { label: 'Jordan', iso: 'JO' },
  { label: 'Kuwait', iso: 'KW' },
  { label: 'South Africa', iso: 'ZA' },
  { label: 'Qatar', iso: 'QA' },
  { label: 'Saudi Arabia', iso: 'SA' },
  { label: 'United Arab Emirates', iso: 'AE' },
  { label: 'Switzerland', iso: 'CH' },
  { label: 'Oman', iso: 'OM' },
  { label: 'United States', iso: 'US' },
  { label: 'Singapore', iso: 'SG' },
  { label: 'Japan', iso: 'JP' },
  { label: 'China', iso: 'CN' },
  { label: 'Hong Kong', iso: 'HK' },
  { label: 'Taiwan', iso: 'TW' },
  { label: 'Thailand', iso: 'TH' },
  { label: 'India', iso: 'IN' },
  { label: 'Indonesia', iso: 'ID' },
];

/** Bậc cân (upperKg): 0.5,1.0,…,20.0. Tier phủ (prev, this]; cân ceil lên bậc 0.5 kế. */
export const ARAMEX_TIER_UPPERS: number[] = Array.from({ length: 40 }, (_, i) => (i + 1) * 0.5);

/** Zone label = tên nước (mỗi nước 1 zone). */
export const ARAMEX_ZONE_LABELS: string[] = ARAMEX_COUNTRIES.map((c) => c.label);
