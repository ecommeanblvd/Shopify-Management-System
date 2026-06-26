/**
 * Seed carrier Aramex (Hợp Nhất) — bảng giá "XUẤT HÀ NỘI" (HN) vào hệ thống.
 *
 * Tạo (idempotent): carrier account (cost USD, display VND, fx 1/26000),
 * 20 zone (mỗi nước 1 zone), 40 weight tier (0.5..20kg), 1 rate card mở
 * (effective 2025-10-01), ~800 rate cell (USD).
 *
 * Carrier row 'aramex' do migration 0080 tạo. Giá đọc trực tiếp từ PDF qua
 * `pdftotext -layout` (parser: features/carrier-rates/import/aramex-hn-rates.ts).
 *
 * Mặc định DRY-RUN — chỉ in. `--apply` mới ghi DB.
 *   DATABASE_URL=… npx tsx scripts/import-aramex-hn.ts            # dry-run
 *   DATABASE_URL=… npx tsx scripts/import-aramex-hn.ts --apply    # ghi thật
 *   [--pdf "/path/BẢNG GIÁ INECSO XUẤT HAN.pdf"]
 */
import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { and, eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { aramexHnCells } from '@/features/carrier-rates/import/aramex-hn-rates';
import { ARAMEX_COUNTRIES, ARAMEX_TIER_UPPERS, ARAMEX_ZONE_LABELS } from '@/features/carrier-rates/import/aramex-hn-zones';

const DEFAULT_PDF = '/Users/macos/Downloads/BẢNG GIÁ INECSO XUẤT HAN.pdf';
const ACCOUNT_NAME = 'Aramex HN (Hợp Nhất)';
const CARD_LABEL = 'Aramex HN 2025-10';
const EFFECTIVE_FROM = '2025-10-01';
const FX = '0.0000384615'; // 1/26000: USD cost cho 1 VND display

function parseArgs() {
  const a = process.argv.slice(2);
  let pdf = DEFAULT_PDF;
  let apply = false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--pdf') pdf = a[++i];
    else if (a[i] === '--apply') apply = true;
  }
  return { pdf, apply };
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
    costCurrency: 'USD',
    displayCurrency: 'VND',
    fxCostPerDisplay: FX,
    dimDivisorCm3PerKg: '5000',
    chargeableRoundingKg: null,
    enabled: true,
    notes: 'Aramex qua Hợp Nhất (HNC). Bảng giá HN, giá all-in (fuel+VAT). Seed bằng scripts/import-aramex-hn.ts.',
  }).returning({ id: schema.carrierAccounts.id });
  console.log(`  → tạo account ${created.id}`);
  return created.id;
}

async function ensureZones(accountId: string, apply: boolean): Promise<Map<string, string>> {
  const existing = await db.select({ id: schema.carrierZones.id, label: schema.carrierZones.label })
    .from(schema.carrierZones).where(eq(schema.carrierZones.carrierAccountId, accountId));
  const byLabel = new Map(existing.map((z) => [z.label, z.id]));
  const missing = ARAMEX_ZONE_LABELS.filter((l) => !byLabel.has(l));
  console.log(`Zones: ${byLabel.size} có, ${missing.length} cần tạo.`);
  if (apply && missing.length) {
    const rows = missing.map((label) => ({ carrierAccountId: accountId, label, position: ARAMEX_ZONE_LABELS.indexOf(label) + 1 }));
    const ins = await db.insert(schema.carrierZones).values(rows).returning({ id: schema.carrierZones.id, label: schema.carrierZones.label });
    for (const r of ins) byLabel.set(r.label, r.id);
  }
  return byLabel;
}

async function ensureTiers(accountId: string, apply: boolean): Promise<Map<number, string>> {
  const existing = await db.select({ id: schema.carrierWeightTiers.id, upperKg: schema.carrierWeightTiers.upperKg })
    .from(schema.carrierWeightTiers).where(eq(schema.carrierWeightTiers.carrierAccountId, accountId));
  const byUpper = new Map(existing.map((t) => [Number(t.upperKg), t.id]));
  const missing = ARAMEX_TIER_UPPERS.filter((u) => !byUpper.has(u));
  console.log(`Tiers: ${byUpper.size} có, ${missing.length} cần tạo (của ${ARAMEX_TIER_UPPERS.length}).`);
  if (apply && missing.length) {
    const rows = missing.map((u) => ({ carrierAccountId: accountId, upperKg: String(u), position: ARAMEX_TIER_UPPERS.indexOf(u) }));
    const ins = await db.insert(schema.carrierWeightTiers).values(rows).returning({ id: schema.carrierWeightTiers.id, upperKg: schema.carrierWeightTiers.upperKg });
    for (const r of ins) byUpper.set(Number(r.upperKg), r.id);
  }
  return byUpper;
}

async function ensureCountries(accountId: string, zoneByLabel: Map<string, string>, apply: boolean): Promise<void> {
  const existing = await db.select({ countryCode: schema.carrierZoneCountries.countryCode })
    .from(schema.carrierZoneCountries).where(eq(schema.carrierZoneCountries.carrierAccountId, accountId));
  const have = new Set(existing.map((c) => c.countryCode));
  const toAdd = ARAMEX_COUNTRIES.filter((c) => !have.has(c.iso));
  console.log(`Countries: ${have.size} có, ${toAdd.length} cần map.`);
  if (apply && toAdd.length) {
    for (const c of ARAMEX_COUNTRIES) {
      const zoneId = zoneByLabel.get(c.label);
      if (!zoneId) continue;
      await db.insert(schema.carrierZoneCountries)
        .values({ carrierAccountId: accountId, carrierZoneId: zoneId, countryCode: c.iso })
        .onConflictDoUpdate({
          target: [schema.carrierZoneCountries.carrierAccountId, schema.carrierZoneCountries.countryCode],
          set: { carrierZoneId: zoneId },
        });
    }
  }
}

async function main(): Promise<void> {
  const { pdf, apply } = parseArgs();
  console.log(`PDF:   ${pdf}`);
  console.log(`Mode:  ${apply ? 'APPLY (ghi)' : 'DRY-RUN'}\n`);

  const text = execFileSync('pdftotext', ['-layout', pdf, '-'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const cells = aramexHnCells(text);
  console.log('=== Parse ===');
  console.log(`  Cells: ${cells.length} (kỳ vọng ${ARAMEX_COUNTRIES.length * ARAMEX_TIER_UPPERS.length})`);
  const spot = (z: string, w: number) => cells.find((c) => c.zoneLabel === z && c.upperKg === w)?.cost;
  console.log(`  Spot: Bahrain 0.5=${spot('Bahrain', 0.5)} (18.31) · Japan 1.0=${spot('Japan', 1.0)} (19.72) · Indonesia 20=${spot('Indonesia', 20)} (241.54)`);
  if (cells.length !== ARAMEX_COUNTRIES.length * ARAMEX_TIER_UPPERS.length) {
    console.log('=== ✗ Số cell không khớp — dừng, không ghi ==='); process.exitCode = 1; return;
  }

  const [carrier] = await db.select({ id: schema.carriers.id }).from(schema.carriers).where(eq(schema.carriers.key, 'aramex')).limit(1);
  if (!carrier) { console.log('ERROR: chưa có carrier key=aramex (chạy migration 0080 trước).'); process.exitCode = 1; return; }

  const accountId = await ensureAccount(carrier.id, apply);
  if (!accountId) { console.log('\nDRY-RUN: chưa tạo account → dừng. Chạy --apply để seed.'); return; }

  const zoneByLabel = await ensureZones(accountId, apply);
  const tierByUpper = await ensureTiers(accountId, apply);
  await ensureCountries(accountId, zoneByLabel, apply);

  if (!apply) { console.log('\nDRY-RUN: không ghi gì. Chạy lại với --apply.'); return; }

  let [card] = await db.select({ id: schema.carrierRateCards.id }).from(schema.carrierRateCards)
    .where(and(eq(schema.carrierRateCards.carrierAccountId, accountId), eq(schema.carrierRateCards.label, CARD_LABEL))).limit(1);
  if (!card) {
    [card] = await db.insert(schema.carrierRateCards).values({
      carrierAccountId: accountId, label: CARD_LABEL, effectiveFrom: EFFECTIVE_FROM, effectiveTo: null,
      sourcePdfFilename: pdf.split('/').pop() ?? null,
    }).returning({ id: schema.carrierRateCards.id });
    console.log(`Rate card: tạo ${card.id} (${CARD_LABEL}, từ ${EFFECTIVE_FROM}).`);
  } else { console.log(`Rate card: dùng lại ${card.id}.`); }

  console.log(`Ghi ${cells.length} cells…`);
  let written = 0;
  for (let i = 0; i < cells.length; i += 200) {
    const rows = cells.slice(i, i + 200).map((c) => ({
      rateCardId: card.id,
      carrierZoneId: zoneByLabel.get(c.zoneLabel)!,
      carrierWeightTierId: tierByUpper.get(c.upperKg)!,
      packageType: c.packageType,
      costAmount: c.cost.toFixed(2),
    }));
    await db.insert(schema.carrierRateCells).values(rows).onConflictDoUpdate({
      target: [schema.carrierRateCells.rateCardId, schema.carrierRateCells.carrierZoneId, schema.carrierRateCells.carrierWeightTierId, schema.carrierRateCells.packageType],
      set: { costAmount: sql`excluded.cost_amount`, updatedAt: new Date() },
    });
    written += rows.length;
  }
  console.log(`✓ Ghi ${written} cells vào card ${card.id}.`);
}

main().then(() => process.exit(process.exitCode ?? 0)).catch((e) => { console.error(e); process.exit(1); });
