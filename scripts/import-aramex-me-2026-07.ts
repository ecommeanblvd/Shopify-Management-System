/**
 * Import "Updated Middle East Rates (HNC-Inecso).pdf" — bảng giá Aramex HN áp dụng
 * 01/07/2026 (all-in USD, gồm fuel + VAT), 20 nước × bậc 0.5–10.0 kg.
 *
 * - Cập nhật cell trên rate card ĐANG MỞ (Aramex 2026-07 Rev) cho 10 nước ME cũ.
 * - Tạo zone mới cho 10 nước chưa có (LB, YE, IQ, IL, TR, SY, CY, NP, RS, NG).
 * - Bậc >10kg của nước cũ GIỮ NGUYÊN theo Rev (bảng mới không có); nước mới chỉ
 *   có tới 10kg.
 *
 *   railway run npx tsx scripts/import-aramex-me-2026-07.ts
 */
import { and, eq, isNull } from 'drizzle-orm';
import { db, schema } from '@/db/client';

const G1: Array<[string, string]> = [
  ['Bahrain', 'BH'], ['Bangladesh', 'BD'], ['Egypt', 'EG'], ['Jordan', 'JO'], ['Kuwait', 'KW'],
  ['Lebanon', 'LB'], ['Qatar', 'QA'], ['Saudi Arabia', 'SA'], ['United Arab Emirates', 'AE'], ['South Africa', 'ZA'],
];
const G2: Array<[string, string]> = [
  ['Oman', 'OM'], ['Yemen', 'YE'], ['Iraq', 'IQ'], ['Israel', 'IL'], ['Turkey', 'TR'],
  ['Syria', 'SY'], ['Cyprus', 'CY'], ['Nepal', 'NP'], ['Republic of Serbia', 'RS'], ['Nigeria', 'NG'],
];
const WEIGHTS = Array.from({ length: 20 }, (_, i) => (i + 1) * 0.5); // 0.5 → 10.0

// Ma trận giá (hàng = bậc cân, cột = nước theo thứ tự G1/G2) — chép nguyên từ PDF.
const R1: number[][] = [
  [18.05, 18.08, 19.61, 20.11, 19.71, 20.24, 20.18, 19.22, 16.74, 25.92],
  [27.79, 28.80, 31.43, 31.43, 29.20, 30.41, 30.92, 29.33, 25.17, 38.29],
  [37.54, 39.12, 43.26, 42.76, 38.71, 40.17, 42.05, 39.45, 34.04, 50.67],
  [47.28, 49.85, 55.08, 54.11, 48.22, 50.34, 53.19, 49.16, 42.47, 63.03],
  [57.02, 60.16, 66.89, 65.44, 57.30, 60.08, 64.31, 59.28, 50.90, 75.39],
  [66.76, 70.89, 78.24, 76.78, 66.81, 70.26, 75.06, 69.40, 59.76, 87.76],
  [76.52, 81.62, 90.05, 88.11, 76.31, 80.02, 86.18, 79.11, 68.21, 99.70],
  [86.26, 91.94, 101.87, 99.93, 85.82, 90.19, 97.31, 89.23, 77.07, 112.06],
  [95.56, 102.66, 113.69, 111.26, 95.31, 100.37, 108.45, 99.36, 85.50, 124.43],
  [105.30, 113.39, 125.52, 117.46, 104.41, 110.11, 119.57, 109.06, 93.92, 136.79],
  [107.79, 121.86, 137.82, 128.79, 111.87, 118.32, 126.25, 114.58, 100.75, 147.46],
  [117.28, 130.81, 150.13, 140.11, 119.79, 126.98, 137.34, 124.69, 107.95, 158.69],
  [126.79, 136.31, 162.44, 151.43, 124.56, 132.50, 148.44, 134.78, 112.50, 165.98],
  [136.29, 146.65, 174.76, 162.76, 133.76, 142.42, 159.53, 144.88, 120.78, 178.75],
  [145.79, 156.98, 187.06, 174.09, 142.96, 152.32, 170.63, 154.97, 129.05, 191.51],
  [155.29, 167.32, 199.37, 185.41, 152.16, 162.23, 181.73, 165.07, 137.33, 204.28],
  [164.80, 177.67, 211.67, 196.74, 161.37, 172.15, 192.84, 175.16, 145.61, 217.05],
  [174.30, 188.01, 223.98, 208.06, 170.57, 182.06, 203.93, 185.27, 153.89, 229.82],
  [183.80, 198.35, 236.28, 219.39, 179.77, 191.96, 215.03, 195.36, 162.16, 242.58],
  [193.30, 208.68, 248.60, 223.50, 188.97, 201.87, 226.12, 199.45, 170.44, 255.35],
];
const R2: number[][] = [
  [18.75, 47.06, 45.75, 49.41, 23.36, 37.57, 29.06, 20.28, 51.05, 27.44],
  [27.56, 60.00, 58.33, 63.00, 33.12, 50.30, 41.89, 30.71, 52.15, 45.48],
  [37.19, 72.40, 70.39, 76.02, 43.33, 63.03, 55.17, 41.12, 62.67, 63.08],
  [46.83, 84.79, 82.44, 89.03, 53.54, 75.78, 68.45, 51.99, 73.19, 81.10],
  [56.47, 97.73, 95.02, 102.62, 63.30, 88.10, 75.89, 62.42, 83.70, 99.14],
  [60.52, 110.13, 107.07, 115.64, 68.26, 100.83, 68.53, 72.85, 68.84, 112.27],
  [69.34, 123.08, 119.66, 129.23, 76.14, 113.57, 76.39, 83.26, 76.39, 129.56],
  [77.78, 136.55, 132.76, 143.38, 83.47, 126.30, 83.95, 93.69, 83.95, 142.13],
  [83.28, 149.50, 145.34, 156.97, 88.49, 139.03, 91.50, 104.12, 91.50, 158.90],
  [91.77, 162.97, 158.44, 171.12, 97.25, 151.76, 99.07, 114.54, 99.07, 171.71],
  [100.25, 176.46, 171.56, 185.28, 106.38, 164.92, 112.47, 123.23, 112.47, 188.53],
  [108.72, 189.93, 184.66, 199.43, 115.49, 178.05, 120.08, 134.30, 120.08, 202.17],
  [117.21, 203.42, 197.77, 213.59, 124.62, 191.19, 127.69, 145.39, 127.69, 217.02],
  [125.69, 216.90, 210.88, 227.75, 133.74, 204.33, 135.30, 156.47, 135.30, 229.75],
  [128.81, 230.38, 223.98, 241.90, 142.87, 217.47, 142.91, 167.55, 142.91, 241.98],
  [136.96, 243.87, 237.09, 256.06, 148.19, 230.61, 150.52, 178.63, 150.52, 253.68],
  [145.10, 257.34, 250.19, 270.21, 157.09, 243.76, 158.13, 189.72, 158.13, 262.65],
  [153.25, 270.83, 263.31, 284.37, 163.15, 256.90, 165.75, 200.81, 165.75, 277.90],
  [161.39, 284.30, 276.41, 298.52, 171.88, 270.04, 173.36, 211.88, 173.36, 293.16],
  [166.71, 297.79, 289.52, 312.68, 180.62, 283.18, 180.97, 222.97, 180.97, 303.18],
];

async function main() {
  // Account Aramex + rate card đang mở
  const [acc] = await db.select({ id: schema.carrierAccounts.id, name: schema.carrierAccounts.name })
    .from(schema.carrierAccounts)
    .innerJoin(schema.carriers, eq(schema.carriers.id, schema.carrierAccounts.carrierId))
    .where(and(eq(schema.carriers.key, 'aramex'), eq(schema.carrierAccounts.enabled, true))).limit(1);
  if (!acc) throw new Error('Không thấy account Aramex');
  const [card] = await db.select({ id: schema.carrierRateCards.id, label: schema.carrierRateCards.label })
    .from(schema.carrierRateCards)
    .where(and(eq(schema.carrierRateCards.carrierAccountId, acc.id), isNull(schema.carrierRateCards.effectiveTo)))
    .limit(1);
  if (!card) throw new Error('Không thấy rate card đang mở');
  console.log(`Account: ${acc.name} | Card: ${card.label}`);

  // Weight tiers hiện có (upper → id)
  const tiers = await db.select({ id: schema.carrierWeightTiers.id, upperKg: schema.carrierWeightTiers.upperKg })
    .from(schema.carrierWeightTiers).where(eq(schema.carrierWeightTiers.carrierAccountId, acc.id));
  const tierByUpper = new Map(tiers.map((t) => [Number(t.upperKg), t.id]));
  for (const w of WEIGHTS) if (!tierByUpper.has(w)) throw new Error(`Thiếu weight tier ${w}kg`);

  // Zone hiện có (label → id)
  const zones = await db.select({ id: schema.carrierZones.id, label: schema.carrierZones.label })
    .from(schema.carrierZones).where(eq(schema.carrierZones.carrierAccountId, acc.id));
  const zoneByLabel = new Map(zones.map((z) => [z.label, z.id]));

  let zonesCreated = 0, cellsUpdated = 0, cellsInserted = 0;
  const all = [...G1.map((c, i) => ({ c, col: i, m: R1 })), ...G2.map((c, i) => ({ c, col: i, m: R2 }))];

  for (const { c: [label, iso], col, m } of all) {
    let zoneId = zoneByLabel.get(label);
    if (!zoneId) {
      const [z] = await db.insert(schema.carrierZones)
        .values({ carrierAccountId: acc.id, label }).returning({ id: schema.carrierZones.id });
      zoneId = z.id;
      await db.insert(schema.carrierZoneCountries)
        .values({ carrierAccountId: acc.id, carrierZoneId: zoneId, countryCode: iso })
        .onConflictDoNothing();
      zonesCreated++;
      console.log(`+ zone mới: ${label} (${iso})`);
    }
    for (let row = 0; row < WEIGHTS.length; row++) {
      const upper = WEIGHTS[row];
      const cost = m[row][col];
      const tierId = tierByUpper.get(upper)!;
      const [existing] = await db.select({ id: schema.carrierRateCells.id, cost: schema.carrierRateCells.costAmount })
        .from(schema.carrierRateCells)
        .where(and(
          eq(schema.carrierRateCells.rateCardId, card.id),
          eq(schema.carrierRateCells.carrierZoneId, zoneId),
          eq(schema.carrierRateCells.carrierWeightTierId, tierId),
          eq(schema.carrierRateCells.packageType, 'package'),
        )).limit(1);
      if (existing) {
        if (Number(existing.cost) !== cost) {
          await db.update(schema.carrierRateCells)
            .set({ costAmount: String(cost), updatedAt: new Date() })
            .where(eq(schema.carrierRateCells.id, existing.id));
          cellsUpdated++;
        }
      } else {
        await db.insert(schema.carrierRateCells).values({
          rateCardId: card.id, carrierZoneId: zoneId, carrierWeightTierId: tierId,
          packageType: 'package', costAmount: String(cost),
        });
        cellsInserted++;
      }
    }
  }

  console.log(`\nXong: ${zonesCreated} zone mới, ${cellsUpdated} cell cập nhật, ${cellsInserted} cell thêm mới.`);
  // Verify chốt: AE 0.5kg phải = 16.74
  const [chk] = await db.select({ cost: schema.carrierRateCells.costAmount })
    .from(schema.carrierRateCells)
    .innerJoin(schema.carrierZones, eq(schema.carrierZones.id, schema.carrierRateCells.carrierZoneId))
    .innerJoin(schema.carrierWeightTiers, eq(schema.carrierWeightTiers.id, schema.carrierRateCells.carrierWeightTierId))
    .where(and(
      eq(schema.carrierRateCells.rateCardId, card.id),
      eq(schema.carrierZones.label, 'United Arab Emirates'),
      eq(schema.carrierWeightTiers.upperKg, '0.5'),
    )).limit(1);
  console.log(`Verify AE 0.5kg = $${Number(chk?.cost)} (kỳ vọng 16.74)`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
