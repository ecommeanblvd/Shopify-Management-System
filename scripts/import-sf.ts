/**
 * Seed carrier SF Express (ShunFeng) — VN Export — vào hệ thống.
 *
 * Tạo (idempotent): carrier account (cost VND, display VND, fx 1, dim 5000,
 * rounding 0.5kg ceil theo Remark 5 của SF), 11 zone (A-K), 39 weight tier
 * (0.5..19.5kg), map 46 nước nêu đích danh → zone, 1 rate card mở (effective
 * 2025-02-01), 429 rate cell VND (Non-Documents 0.5-2.5 + bảng chung 3-19.5),
 * + surcharges: fuel_percent=0 (MANUAL — nhập tay, banner nhắc) và vat_percent=8.
 *
 * KHÔNG seed Remote/Special-Handling: bảng giá SF chỉ NÊU TÊN các phụ phí đó,
 * KHÔNG công bố số tiền trong PDF này → không bịa. Bậc per-kg ≥20kg cũng không
 * seed (model tier là giá cố định/mốc, không phải giá×cân).
 *
 * Carrier row 'sf-express' do migration 0098 tạo. Data: features/carrier-rates/
 * import/sf-zones.ts + sf-rates.ts (sinh từ PDF, verify vs pdftotext).
 *
 * Mặc định DRY-RUN — chỉ in summary. `--apply` mới ghi DB.
 *   DATABASE_URL=… npx tsx scripts/import-sf.ts            # dry-run
 *   DATABASE_URL=… npx tsx scripts/import-sf.ts --apply    # ghi thật
 */
import 'dotenv/config';
import { and, eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { SF_RATES } from '@/features/carrier-rates/import/sf-rates';
import { SF_ISO_ZONE, SF_TIER_UPPERS, SF_ZONE_LABELS } from '@/features/carrier-rates/import/sf-zones';

const ACCOUNT_NAME = 'SF Express (ShunFeng) — VN Export';
const CARD_LABEL = 'SF Export 2025-02';
const EFFECTIVE_FROM = '2025-02-01';

// Fuel surcharge % — SF công bố hàng tuần (USGC jet fuel, EIA) nhưng KHÔNG có
// nguồn máy-đọc công khai (site đã migrate Nuxt SPA; trang fuel chỉ đăng ví dụ).
// Để 0 tạm — banner nhắc operator nhập. KHÔNG bịa số. KHÔNG vào AUTO_FUEL keys.
const SF_FUEL_PERCENT = 0;

function parseArgs() {
  return { apply: process.argv.slice(2).includes('--apply') };
}

async function ensureAccount(carrierId: string, apply: boolean): Promise<string | null> {
  const [existing] = await db.select({ id: schema.carrierAccounts.id })
    .from(schema.carrierAccounts)
    .where(and(eq(schema.carrierAccounts.carrierId, carrierId), eq(schema.carrierAccounts.name, ACCOUNT_NAME)))
    .limit(1);
  if (existing) { console.log(`Account: đã có (${existing.id}).`); return existing.id; }
  console.log(`Account: chưa có — ${apply ? 'sẽ tạo' : '(dry-run, chưa tạo)'} "${ACCOUNT_NAME}".`);
  if (!apply) return null;
  const [created] = await db.insert(schema.carrierAccounts).values({
    carrierId,
    name: ACCOUNT_NAME,
    weightUnit: 'kg',
    costCurrency: 'VND',
    displayCurrency: 'VND',
    fxCostPerDisplay: '1',
    dimDivisorCm3PerKg: '5000',
    // Remark 5: ≤20kg tính theo bước 0.5kg, làm tròn LÊN 0.5kg gần nhất → ceil.
    chargeableRoundingKg: '0.5',
    chargeableRoundingMode: 'ceil',
    enabled: true,
    notes: 'SF Express (ShunFeng) VN Export. Non-Documents, zone A-K × 0.5-19.5kg (VND). Seed bằng scripts/import-sf.ts.',
  }).returning({ id: schema.carrierAccounts.id });
  console.log(`  → tạo account ${created.id}`);
  return created.id;
}

async function ensureZones(accountId: string, apply: boolean): Promise<Map<string, string>> {
  const existing = await db.select({ id: schema.carrierZones.id, label: schema.carrierZones.label })
    .from(schema.carrierZones).where(eq(schema.carrierZones.carrierAccountId, accountId));
  const byLabel = new Map(existing.map((z) => [z.label, z.id]));
  const missing = SF_ZONE_LABELS.filter((l) => !byLabel.has(l));
  console.log(`Zones: ${byLabel.size} có, ${missing.length} cần tạo (của ${SF_ZONE_LABELS.length}).`);
  if (apply && missing.length) {
    const rows = missing.map((label) => ({ carrierAccountId: accountId, label, position: SF_ZONE_LABELS.indexOf(label) + 1 }));
    const ins = await db.insert(schema.carrierZones).values(rows).returning({ id: schema.carrierZones.id, label: schema.carrierZones.label });
    for (const r of ins) byLabel.set(r.label, r.id);
  }
  return byLabel;
}

async function ensureTiers(accountId: string, apply: boolean): Promise<Map<number, string>> {
  const existing = await db.select({ id: schema.carrierWeightTiers.id, upperKg: schema.carrierWeightTiers.upperKg })
    .from(schema.carrierWeightTiers).where(eq(schema.carrierWeightTiers.carrierAccountId, accountId));
  const byUpper = new Map(existing.map((t) => [Number(t.upperKg), t.id]));
  const missing = SF_TIER_UPPERS.filter((u) => !byUpper.has(u));
  console.log(`Tiers: ${byUpper.size} có, ${missing.length} cần tạo (của ${SF_TIER_UPPERS.length}).`);
  if (apply && missing.length) {
    const rows = missing.map((u) => ({ carrierAccountId: accountId, upperKg: String(u), position: SF_TIER_UPPERS.indexOf(u) }));
    const ins = await db.insert(schema.carrierWeightTiers).values(rows).returning({ id: schema.carrierWeightTiers.id, upperKg: schema.carrierWeightTiers.upperKg });
    for (const r of ins) byUpper.set(Number(r.upperKg), r.id);
  }
  return byUpper;
}

async function ensureCountries(accountId: string, zoneByLabel: Map<string, string>, apply: boolean): Promise<number> {
  const existing = await db.select({ countryCode: schema.carrierZoneCountries.countryCode })
    .from(schema.carrierZoneCountries).where(eq(schema.carrierZoneCountries.carrierAccountId, accountId));
  const have = new Set(existing.map((c) => c.countryCode));
  const entries = Object.entries(SF_ISO_ZONE);
  const toAdd = entries.filter(([iso]) => !have.has(iso));
  console.log(`Countries: ${have.size} có, ${toAdd.length} cần map (của ${entries.length}).`);
  if (apply && toAdd.length) {
    for (const [iso, letter] of entries) {
      const zoneId = zoneByLabel.get(`Zone ${letter}`);
      if (!zoneId) continue;
      await db.insert(schema.carrierZoneCountries)
        .values({ carrierAccountId: accountId, carrierZoneId: zoneId, countryCode: iso })
        .onConflictDoUpdate({
          target: [schema.carrierZoneCountries.carrierAccountId, schema.carrierZoneCountries.countryCode],
          set: { carrierZoneId: zoneId },
        });
    }
  }
  return entries.length;
}

interface SurchargeSeed {
  kind: 'fuel_percent' | 'vat_percent';
  value: number;
  note: string;
}

function sfSurchargeSeeds(): SurchargeSeed[] {
  return [
    { kind: 'fuel_percent', value: SF_FUEL_PERCENT, note: 'SF fuel (FSC) — nhập tay từ sf-international.com (weekly USGC)' },
    { kind: 'vat_percent', value: 8, note: 'Vietnam VAT 8%' },
  ];
}

async function ensureSurcharges(accountId: string, apply: boolean): Promise<{ existing: number; toCreate: number }> {
  const seeds = sfSurchargeSeeds();
  const existingRows = await db.select({ kind: schema.carrierSurcharges.kind, note: schema.carrierSurcharges.note })
    .from(schema.carrierSurcharges).where(eq(schema.carrierSurcharges.carrierAccountId, accountId));
  const have = new Set(existingRows.map((r) => `${r.kind}::${r.note}`));
  const toCreate = seeds.filter((s) => !have.has(`${s.kind}::${s.note}`));
  console.log(`Surcharges: ${have.size} có (tổng account), ${toCreate.length} cần tạo (của ${seeds.length} seed).`);
  if (apply) {
    for (const s of toCreate) {
      await db.insert(schema.carrierSurcharges).values({
        carrierAccountId: accountId,
        kind: s.kind,
        value: String(s.value),
        active: true,
        applyMode: 'always',
        note: s.note,
      });
    }
  }
  return { existing: have.size, toCreate: toCreate.length };
}

async function main(): Promise<void> {
  const { apply } = parseArgs();
  console.log(`Mode:  ${apply ? 'APPLY (ghi)' : 'DRY-RUN'}\n`);

  const expected = SF_TIER_UPPERS.length * SF_ZONE_LABELS.length;
  console.log('=== Parse ===');
  console.log(`  Cells: ${SF_RATES.length} (kỳ vọng ${expected})`);
  const spot = (z: string, w: number) => SF_RATES.find((c) => c.zoneLabel === z && c.upperKg === w)?.cost;
  console.log(`  Spot: Zone A @0.5kg=${spot('Zone A', 0.5)} (kv 491000) · Zone F @2.5kg=${spot('Zone F', 2.5)} (kv 1665000) · Zone K @19.5kg=${spot('Zone K', 19.5)} (kv 10118500)`);
  if (SF_RATES.length !== expected) {
    console.log('=== ✗ Số cell không khớp — dừng, không ghi ==='); process.exitCode = 1; return;
  }

  const [carrier] = await db.select({ id: schema.carriers.id }).from(schema.carriers).where(eq(schema.carriers.key, 'sf-express')).limit(1);
  if (!carrier) { console.log('ERROR: chưa có carrier key=sf-express (chạy migration 0098 trước).'); process.exitCode = 1; return; }

  const accountId = await ensureAccount(carrier.id, apply);
  if (!accountId) { console.log('\nDRY-RUN: chưa tạo account → dừng. Chạy --apply để seed.'); return; }

  const zoneByLabel = await ensureZones(accountId, apply);
  const tierByUpper = await ensureTiers(accountId, apply);
  const countryCount = await ensureCountries(accountId, zoneByLabel, apply);
  const surchargeSummary = await ensureSurcharges(accountId, apply);
  console.log(`Countries kỳ vọng map: ${countryCount}`);

  if (!apply) { console.log('\nDRY-RUN: không ghi gì. Chạy lại với --apply.'); return; }

  let [card] = await db.select({ id: schema.carrierRateCards.id }).from(schema.carrierRateCards)
    .where(and(eq(schema.carrierRateCards.carrierAccountId, accountId), eq(schema.carrierRateCards.label, CARD_LABEL))).limit(1);
  if (!card) {
    [card] = await db.insert(schema.carrierRateCards).values({
      carrierAccountId: accountId, label: CARD_LABEL, effectiveFrom: EFFECTIVE_FROM, effectiveTo: null,
    }).returning({ id: schema.carrierRateCards.id });
    console.log(`Rate card: tạo ${card.id} (${CARD_LABEL}, từ ${EFFECTIVE_FROM}).`);
  } else { console.log(`Rate card: dùng lại ${card.id}.`); }

  console.log(`Ghi ${SF_RATES.length} cells…`);
  let written = 0;
  for (let i = 0; i < SF_RATES.length; i += 200) {
    const rows = SF_RATES.slice(i, i + 200).map((c) => ({
      rateCardId: card.id,
      carrierZoneId: zoneByLabel.get(c.zoneLabel)!,
      carrierWeightTierId: tierByUpper.get(c.upperKg)!,
      packageType: 'package' as const,
      costAmount: c.cost.toFixed(2),
    }));
    await db.insert(schema.carrierRateCells).values(rows).onConflictDoUpdate({
      target: [schema.carrierRateCells.rateCardId, schema.carrierRateCells.carrierZoneId, schema.carrierRateCells.carrierWeightTierId, schema.carrierRateCells.packageType],
      set: { costAmount: sql`excluded.cost_amount`, updatedAt: new Date() },
    });
    written += rows.length;
  }
  console.log(`✓ Ghi ${written} cells vào card ${card.id}.`);
  console.log(`✓ Surcharges: ${surchargeSummary.toCreate} tạo mới (đã có ${surchargeSummary.existing}).`);
}

main().then(() => process.exit(process.exitCode ?? 0)).catch((e) => { console.error(e); process.exit(1); });
