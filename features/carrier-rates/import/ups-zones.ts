/**
 * UPS Worldwide Expedited (XPD) — map ISO-2 quốc gia → zone (1-10).
 *
 * Nguồn: bảng zone UPS (202 nước, đã resolve conflict — CN chốt = zone 3,
 * theo "China Mainland (Excluding Southern China Mainland)"). Xem
 * `/private/tmp/.../scratchpad/ups-isozone.json` (isoZone) — file đã verify,
 * copy tay 1:1 vào đây để không phụ thuộc file tạm.
 */
export const UPS_ISO_ZONE: Record<string, number> = {
  AF: 9, DE: 6, MK: 9, AX: 6, GH: 9, GB: 6, AL: 9, GI: 7, MP: 9, DZ: 9,
  GR: 7, NO: 6, AS: 9, GL: 9, OM: 7, AD: 7, GD: 8, PK: 4, AO: 8, GP: 8,
  PA: 8, AI: 8, GU: 7, AG: 8, GT: 8, PY: 8, AR: 8, GG: 7, PE: 8, AM: 9,
  GN: 9, PH: 2, AW: 8, GW: 9, PL: 7, AU: 3, GY: 8, AT: 6, HT: 8, PT: 7,
  AZ: 7, PR: 5, HN: 8, QA: 7, BS: 8, HK: 1, RE: 9, BH: 7, HU: 7, RO: 7,
  BD: 4, IS: 8, BB: 8, IN: 4, SU: 7, BY: 7, ID: 2, RW: 9, BE: 6, IQ: 9,
  BZ: 8, IE: 6, WS: 9, DY: 9, IL: 9, SM: 6, BM: 9, IT: 6, SA: 7, BO: 8,
  JM: 8, BQ: 8, JP: 3, SN: 9, BA: 7, JE: 7, YU: 9, BW: 9, JO: 9, SC: 9,
  BR: 8, KZ: 9, SL: 9, VG: 8, KE: 9, SG: 1, BN: 2, KR: 3, SK: 7, XK: 9,
  SI: 7, BG: 7, KW: 7, ZA: 9, HV: 9, KG: 9, CN: 3, BI: 9, LA: 3, ES: 6,
  KH: 3, LV: 7, LK: 4, CM: 9, LB: 9, BL: 8, LS: 9, KN: 8, CA: 5, LR: 9,
  VI: 8, LI: 6, CV: 9, LT: 7, LC: 8, KY: 8, SX: 9, CF: 9, LU: 6, MO: 2,
  VC: 8, TD: 9, MG: 9, SR: 8, CL: 8, SZ: 9, MW: 9, SE: 6, CO: 8, MY: 2,
  CH: 6, KM: 9, MV: 4, TW: 3, CD: 9, ML: 9, TZ: 9, CG: 9, MT: 7, TH: 1,
  CR: 8, MQ: 8, CI: 9, MR: 9, TG: 9, HR: 7, MU: 9, CW: 8, YT: 9, TT: 8,
  CY: 7, TN: 9, CZ: 7, MX: 5, TR: 7, DK: 6, MD: 9, DJ: 9, MC: 6, TC: 8,
  DM: 8, MN: 9, DO: 8, ME: 9, UG: 9, EC: 8, MS: 8, UA: 7, EG: 7, MA: 9,
  SV: 8, AE: 7, MZ: 9, UK: 6, ER: 9, MM: 3, US: 5, EE: 7, NA: 9, UY: 8,
  ET: 9, NP: 9, UZ: 9, FO: 9, NL: 6, VA: 6, FI: 6, NC: 9, VE: 8, FX: 6,
  NZ: 3, GF: 8, NI: 8, YE: 9, GA: 9, NE: 9, ZM: 9, GM: 9, NG: 9, ZW: 9,
  GE: 9, NF: 3,
};

/** 10 zone UPS, thứ tự cột bảng giá. */
export const UPS_ZONE_LABELS: string[] = Array.from({ length: 10 }, (_, i) => `Zone ${i + 1}`);

/** Bậc cân (upperKg): 1,2,…,20 (cân nguyên kg, không có 0.5). */
export const UPS_TIER_UPPERS: number[] = Array.from({ length: 20 }, (_, i) => i + 1);
