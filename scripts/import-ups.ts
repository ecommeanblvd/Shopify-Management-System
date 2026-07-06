/**
 * Seed carrier UPS (Worldwide Expedited) vào hệ thống.
 *
 * Tạo (idempotent): carrier account (cost VND, display VND, fx 1), 10 zone
 * (zone 1-10), 20 weight tier (1..20kg nguyên), map 202 nước → zone, 1 rate
 * card mở (effective 2025-12-21), 200 rate cell (VND), + surcharges (fuel/VAT
 * always-on, còn residential/remote/addon KHÔNG tự cộng vào quote so sánh
 * thường — engine chỉ áp khi có flag/postcode/opt-in tương ứng).
 *
 * Carrier row 'ups' do migration 0097 tạo. Data: features/carrier-rates/import/
 * ups-zones.ts (UPS_ISO_ZONE/UPS_ZONE_LABELS/UPS_TIER_UPPERS) + ups-rates.ts
 * (UPS_RATES, 200 cell VND từ bảng giá UPS đã verify).
 *
 * Mặc định DRY-RUN — chỉ in summary. `--apply` mới ghi DB.
 *   DATABASE_URL=… npx tsx scripts/import-ups.ts            # dry-run
 *   DATABASE_URL=… npx tsx scripts/import-ups.ts --apply    # ghi thật
 */
import 'dotenv/config';
import { and, eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { UPS_RATES } from '@/features/carrier-rates/import/ups-rates';
import { UPS_ISO_ZONE, UPS_TIER_UPPERS, UPS_ZONE_LABELS } from '@/features/carrier-rates/import/ups-zones';

const ACCOUNT_NAME = 'UPS Worldwide Expedited';
const CARD_LABEL = 'UPS Expedited 2025-12';
const EFFECTIVE_FROM = '2025-12-21';

// Fuel surcharge % — CHƯA có số chính thức (chờ đối chiếu ups.com/vn tracker).
// Để 0 tạm, controller/operator sẽ cập nhật sau. KHÔNG bịa số.
const UPS_FUEL_PERCENT = 0;

function parseArgs() {
  const a = process.argv.slice(2);
  let apply = false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--apply') apply = true;
  }
  return { apply };
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
    chargeableRoundingKg: null,
    enabled: true,
    notes: 'UPS Worldwide Expedited. Bảng giá VND (zone 1-10 × 1-20kg). Seed bằng scripts/import-ups.ts.',
  }).returning({ id: schema.carrierAccounts.id });
  console.log(`  → tạo account ${created.id}`);
  return created.id;
}

async function ensureZones(accountId: string, apply: boolean): Promise<Map<string, string>> {
  const existing = await db.select({ id: schema.carrierZones.id, label: schema.carrierZones.label })
    .from(schema.carrierZones).where(eq(schema.carrierZones.carrierAccountId, accountId));
  const byLabel = new Map(existing.map((z) => [z.label, z.id]));
  const missing = UPS_ZONE_LABELS.filter((l) => !byLabel.has(l));
  console.log(`Zones: ${byLabel.size} có, ${missing.length} cần tạo (của ${UPS_ZONE_LABELS.length}).`);
  if (apply && missing.length) {
    const rows = missing.map((label) => ({ carrierAccountId: accountId, label, position: UPS_ZONE_LABELS.indexOf(label) + 1 }));
    const ins = await db.insert(schema.carrierZones).values(rows).returning({ id: schema.carrierZones.id, label: schema.carrierZones.label });
    for (const r of ins) byLabel.set(r.label, r.id);
  }
  return byLabel;
}

async function ensureTiers(accountId: string, apply: boolean): Promise<Map<number, string>> {
  const existing = await db.select({ id: schema.carrierWeightTiers.id, upperKg: schema.carrierWeightTiers.upperKg })
    .from(schema.carrierWeightTiers).where(eq(schema.carrierWeightTiers.carrierAccountId, accountId));
  const byUpper = new Map(existing.map((t) => [Number(t.upperKg), t.id]));
  const missing = UPS_TIER_UPPERS.filter((u) => !byUpper.has(u));
  console.log(`Tiers: ${byUpper.size} có, ${missing.length} cần tạo (của ${UPS_TIER_UPPERS.length}).`);
  if (apply && missing.length) {
    const rows = missing.map((u) => ({ carrierAccountId: accountId, upperKg: String(u), position: UPS_TIER_UPPERS.indexOf(u) }));
    const ins = await db.insert(schema.carrierWeightTiers).values(rows).returning({ id: schema.carrierWeightTiers.id, upperKg: schema.carrierWeightTiers.upperKg });
    for (const r of ins) byUpper.set(Number(r.upperKg), r.id);
  }
  return byUpper;
}

async function ensureCountries(accountId: string, zoneByLabel: Map<string, string>, apply: boolean): Promise<number> {
  const existing = await db.select({ countryCode: schema.carrierZoneCountries.countryCode })
    .from(schema.carrierZoneCountries).where(eq(schema.carrierZoneCountries.carrierAccountId, accountId));
  const have = new Set(existing.map((c) => c.countryCode));
  const entries = Object.entries(UPS_ISO_ZONE);
  const toAdd = entries.filter(([iso]) => !have.has(iso));
  console.log(`Countries: ${have.size} có, ${toAdd.length} cần map (của ${entries.length}).`);
  if (apply && toAdd.length) {
    for (const [iso, zoneNum] of entries) {
      const zoneId = zoneByLabel.get(`Zone ${zoneNum}`);
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

/**
 * Surcharges UPS — idempotent theo (kind, note): nếu đã có dòng cùng kind+note
 * thì bỏ qua (không nhân đôi). CHỈ fuel_percent + vat_percent always-on;
 * residential/remote/addon_fixed KHÔNG applyMode='always' theo cách tự cộng
 * vào 1 quote so sánh thường — residential/remote engine chỉ áp khi có
 * isResidential flag / postcode khớp remote tier (xem quote.ts); addon_fixed
 * dùng applyMode='when_billed' (mirror FedEx Direct Signature) — chỉ là giá
 * tham chiếu đối soát, KHÔNG vào total trừ khi signatureOptIn=true.
 */
interface SurchargeSeed {
  kind: 'fuel_percent' | 'vat_percent' | 'residential_fixed' | 'remote_fixed' | 'addon_fixed';
  value: number;
  valuePerKg?: number;
  tier?: string;
  countryCodes?: string[] | null;
  note: string;
  active: boolean;
  applyMode?: 'always' | 'when_billed';
}

function upsSurchargeSeeds(): SurchargeSeed[] {
  return [
    { kind: 'fuel_percent', value: UPS_FUEL_PERCENT, note: 'UPS fuel — cập nhật từ ups.com/vn tracker', active: true, applyMode: 'always' },
    { kind: 'vat_percent', value: 8, note: 'Vietnam VAT 8%', active: true, applyMode: 'always' },
    { kind: 'residential_fixed', value: 95410, countryCodes: null, note: 'UPS phụ phí khu dân cư 95.410đ/lô', active: true },
    { kind: 'remote_fixed', value: 721450, valuePerKg: 10340, tier: 'Remote', note: 'UPS Vùng sâu vùng xa max(721.450đ/lô, 10.340đ/kg)', active: true },
    { kind: 'remote_fixed', value: 646720, tier: 'Extended', note: 'UPS Khu vực mở rộng 646.720đ/lô', active: true },
    { kind: 'addon_fixed', value: 65330, note: 'UPS Chữ ký xác nhận giao hàng 65.330đ/lô', active: true, applyMode: 'when_billed' },
    { kind: 'addon_fixed', value: 89065, note: 'UPS Chữ ký người trưởng thành 89.065đ/lô', active: true, applyMode: 'when_billed' },
    { kind: 'addon_fixed', value: 258500, note: 'UPS Giao thứ 7 258.500đ/lô', active: true, applyMode: 'when_billed' },
    { kind: 'addon_fixed', value: 600425, note: 'UPS Chuyển thuế hải quan 600.425đ/lô', active: true, applyMode: 'when_billed' },
    { kind: 'addon_fixed', value: 235000, note: 'UPS Lập lại hóa đơn 235.000đ', active: true, applyMode: 'when_billed' },
    { kind: 'addon_fixed', value: 423940, note: 'UPS Phụ phí xử lý (Additional Handling) 423.940đ/gói', active: true, applyMode: 'when_billed' },
    { kind: 'addon_fixed', value: 300800, note: 'UPS Sai địa chỉ 300.800đ/gói (tối đa 863.390đ/lô)', active: true, applyMode: 'when_billed' },
  ];
}

async function ensureSurcharges(accountId: string, apply: boolean): Promise<{ existing: number; toCreate: number }> {
  const seeds = upsSurchargeSeeds();
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
        valuePerKg: s.valuePerKg !== undefined ? String(s.valuePerKg) : null,
        tier: s.tier ?? null,
        countryCodes: s.countryCodes === undefined ? null : s.countryCodes,
        active: s.active,
        applyMode: s.applyMode ?? 'always',
        note: s.note,
      });
    }
  }
  return { existing: have.size, toCreate: toCreate.length };
}

async function main(): Promise<void> {
  const { apply } = parseArgs();
  console.log(`Mode:  ${apply ? 'APPLY (ghi)' : 'DRY-RUN'}\n`);

  console.log('=== Parse ===');
  console.log(`  Cells: ${UPS_RATES.length} (kỳ vọng ${UPS_TIER_UPPERS.length * UPS_ZONE_LABELS.length})`);
  const spot = (z: string, w: number) => UPS_RATES.find((c) => c.zoneLabel === z && c.upperKg === w)?.cost;
  console.log(`  Spot: Zone 1 @1kg=${spot('Zone 1', 1)} (kỳ vọng 343927) · Zone 5 @10kg=${spot('Zone 5', 10)} (kỳ vọng 2257474) · Zone 10 @20kg=${spot('Zone 10', 20)} (kỳ vọng 808741)`);
  if (UPS_RATES.length !== UPS_TIER_UPPERS.length * UPS_ZONE_LABELS.length) {
    console.log('=== ✗ Số cell không khớp — dừng, không ghi ==='); process.exitCode = 1; return;
  }

  const [carrier] = await db.select({ id: schema.carriers.id }).from(schema.carriers).where(eq(schema.carriers.key, 'ups')).limit(1);
  if (!carrier) { console.log('ERROR: chưa có carrier key=ups (chạy migration 0097 trước).'); process.exitCode = 1; return; }

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

  console.log(`Ghi ${UPS_RATES.length} cells…`);
  let written = 0;
  for (let i = 0; i < UPS_RATES.length; i += 200) {
    const rows = UPS_RATES.slice(i, i + 200).map((c) => ({
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
