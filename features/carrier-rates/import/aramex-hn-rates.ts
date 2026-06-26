/**
 * Parser bảng giá Aramex HN (Hợp Nhất), trích từ `pdftotext -layout`.
 * Bố cục: 2 nhóm 10 nước (ma trận nước × cân 0.5..20.0). Mỗi NƯỚC = 1 zone
 * (zone label = tên nước). Giá all-in USD (fuel+VAT). Package-only, không heavy
 * (>20kg = "Call", ngoài phạm vi).
 *
 * KHÔNG dùng `toCells` chung vì nó prefix "Zone " vào zone — Aramex zone là tên
 * nước. `aramexHnCells` map thẳng zoneLabel = tên nước.
 */
import type { ParsedIpExport, LightRate, RateCellInput } from './fedex-2025-rates';
import { ARAMEX_COUNTRIES, ARAMEX_TIER_UPPERS } from './aramex-hn-zones';

const GROUP1 = ARAMEX_COUNTRIES.slice(0, 10).map((c) => c.label);
const GROUP2 = ARAMEX_COUNTRIES.slice(10).map((c) => c.label);

/** "18,31" → 18.31 ; "1.234,56" → 1234.56 (dấu '.' = nghìn, ',' = thập phân). */
function num(s: string): number {
  return Number(s.replace(/\./g, '').replace(',', '.'));
}

/** Dòng cân: "  0,50  18,31  18,34 …" → {weightKg, prices[10]}. Null nếu không phải. */
function parseWeightRow(line: string): { weightKg: number; prices: number[] } | null {
  const m = line.trim().match(/^(\d{1,2},\d{2})\s+(.+)$/);
  if (!m) return null;
  const weightKg = num(m[1]);
  if (!Number.isFinite(weightKg) || weightKg > 20) return null; // chỉ ≤20kg
  const prices = m[2].trim().split(/\s+/).map(num).filter((n) => Number.isFinite(n));
  if (prices.length < 10) return null; // dòng "Call" → < 10 số → bỏ
  return { weightKg, prices: prices.slice(0, 10) };
}

function sectionRates(
  lines: string[],
  headerMatch: (l: string) => boolean,
  nextMatch: (l: string) => boolean,
  countries: string[],
): LightRate[] {
  const start = lines.findIndex(headerMatch);
  if (start < 0) return [];
  const out: LightRate[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (nextMatch(lines[i])) break;
    const row = parseWeightRow(lines[i]);
    if (!row) continue;
    countries.forEach((zone, idx) => {
      out.push({ packageType: 'package', zone, weightKg: row.weightKg, rate: row.prices[idx] });
    });
  }
  return out;
}

export function parseAramexHn(fullText: string): ParsedIpExport {
  const lines = fullText.split(/\r?\n/);
  const isG1 = (l: string) => /\bBAHRAIN\b/i.test(l) && /\bSWITZERLAND\b/i.test(l);
  const isG2 = (l: string) => /\bOMAN\b/i.test(l) && /\bINDONESIA\b/i.test(l);
  const light = [
    ...sectionRates(lines, isG1, isG2, GROUP1),
    ...sectionRates(lines, isG2, () => false, GROUP2),
  ];
  return { light, heavy: [] };
}

const TIER_SET = new Set(ARAMEX_TIER_UPPERS);

/** parsed → cells (zoneLabel = tên nước, package). Chỉ tier Aramex model. */
export function aramexHnCells(fullText: string): RateCellInput[] {
  return parseAramexHn(fullText).light
    .filter((r) => TIER_SET.has(r.weightKg))
    .map((r) => ({ zoneLabel: r.zone, upperKg: r.weightKg, packageType: r.packageType, cost: r.rate }));
}

/** Shape RateSheetParser tối thiểu (dùng cho script/preview nếu cần). */
export const aramexHnParser = {
  parse: parseAramexHn,
  expectedPackageCells: ARAMEX_COUNTRIES.length * ARAMEX_TIER_UPPERS.length, // 800
  expectedPakCells: 0,
};
