/**
 * Import the DHL Express Vietnam 2025 "WORLDWIDE EXPORT" (Non-documents from
 * 0.5 KG & Documents from 2.5 KG) rate sheet into a carrier account.
 *
 * Parsing + cell-mapping live in the shared module
 * (`@/features/carrier-rates/import/*`) so this CLI and the in-app PDF upload
 * stay identical. This script ALSO seeds the prerequisites the upload flow
 * assumes already exist — Zones 1–10, the weight-tier set, and the
 * country→zone map — because DHL ships as a fresh account.
 *
 * Defaults to DRY-RUN — prints what it WOULD write. Pass --apply to write.
 *
 * Usage:
 *   DATABASE_URL=… npx tsx scripts/import-dhl-2025.ts \
 *     --account-id <carrier_account_uuid> \
 *     [--pdf "/path/to/Bảng giá DHL 2025.pdf"] \
 *     [--card <rate_card_uuid>] [--apply]
 *
 * Without --card in --apply mode, a new open-ended rate card is created with
 * effectiveFrom = 2025-01-01 (read from the PDF footer).
 */
import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { and, eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { dhlExportParser } from '@/features/carrier-rates/import/parsers/dhl-export';
import { buildRateCardCells } from '@/features/carrier-rates/import/preview';
import {
  DHL_2025_ZONE_BY_COUNTRY,
  DHL_2025_ZONE_LABELS,
  dhl2025TierUppers,
} from '@/features/carrier-rates/import/dhl-2025-zones';

const DEFAULT_PDF = '/Users/macos/Downloads/Bảng giá DHL 2025.pdf';
const CARD_LABEL = 'DHL 2025 Worldwide Export (Non-doc)';

interface Args {
  pdf: string;
  accountId: string | null;
  cardId: string | null;
  apply: boolean;
}

function parseArgs(): Args {
  const a = process.argv.slice(2);
  let pdf = DEFAULT_PDF;
  let accountId: string | null = null;
  let cardId: string | null = null;
  let apply = false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--pdf') pdf = a[++i];
    else if (a[i] === '--account-id') accountId = a[++i];
    else if (a[i] === '--card') cardId = a[++i];
    else if (a[i] === '--apply') apply = true;
  }
  return { pdf, accountId, cardId, apply };
}

function vnd(n: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(n);
}

/** Ensure Zones 1–10 exist for the account; return label → id. */
async function ensureZones(accountId: string, apply: boolean): Promise<Map<string, string>> {
  const existing = await db
    .select({ id: schema.carrierZones.id, label: schema.carrierZones.label })
    .from(schema.carrierZones)
    .where(eq(schema.carrierZones.carrierAccountId, accountId));
  const byLabel = new Map(existing.map((z) => [z.label, z.id]));
  const missing = DHL_2025_ZONE_LABELS.filter((l) => !byLabel.has(l));
  console.log(`Zones: ${byLabel.size} present, ${missing.length} to create${missing.length ? ` (${missing.join(', ')})` : ''}.`);
  if (apply && missing.length) {
    const rows = missing.map((label) => ({
      carrierAccountId: accountId,
      label,
      position: DHL_2025_ZONE_LABELS.indexOf(label) + 1,
    }));
    const inserted = await db.insert(schema.carrierZones).values(rows).returning({ id: schema.carrierZones.id, label: schema.carrierZones.label });
    for (const r of inserted) byLabel.set(r.label, r.id);
  }
  return byLabel;
}

/** Ensure the DHL weight-tier set exists; return upperKg(number) → id. */
async function ensureTiers(accountId: string, apply: boolean): Promise<Map<number, string>> {
  const wanted = dhl2025TierUppers();
  const existing = await db
    .select({ id: schema.carrierWeightTiers.id, upperKg: schema.carrierWeightTiers.upperKg })
    .from(schema.carrierWeightTiers)
    .where(eq(schema.carrierWeightTiers.carrierAccountId, accountId));
  const byUpper = new Map(existing.map((t) => [Number(t.upperKg), t.id]));
  const missing = wanted.filter((u) => !byUpper.has(u));
  console.log(`Tiers: ${byUpper.size} present, ${missing.length} to create (of ${wanted.length} wanted).`);
  if (apply && missing.length) {
    const rows = missing.map((u) => ({
      carrierAccountId: accountId,
      upperKg: String(u),
      position: wanted.indexOf(u),
    }));
    // Chunk to keep the insert statement a sane size.
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200);
      const inserted = await db.insert(schema.carrierWeightTiers).values(chunk)
        .returning({ id: schema.carrierWeightTiers.id, upperKg: schema.carrierWeightTiers.upperKg });
      for (const r of inserted) byUpper.set(Number(r.upperKg), r.id);
    }
  }
  return byUpper;
}

/** Ensure each country sits in its DHL zone (account+country is unique). */
async function ensureCountries(accountId: string, zoneByLabel: Map<string, string>, apply: boolean): Promise<void> {
  const existing = await db
    .select({ countryCode: schema.carrierZoneCountries.countryCode, zoneId: schema.carrierZoneCountries.carrierZoneId })
    .from(schema.carrierZoneCountries)
    .where(eq(schema.carrierZoneCountries.carrierAccountId, accountId));
  const existingCode = new Map(existing.map((c) => [c.countryCode, c.zoneId]));
  const entries = Object.entries(DHL_2025_ZONE_BY_COUNTRY);
  let toAdd = 0;
  let toMove = 0;
  for (const [code, zone] of entries) {
    const targetZoneId = zoneByLabel.get(`Zone ${zone}`);
    if (!targetZoneId) continue;
    const cur = existingCode.get(code);
    if (cur === undefined) toAdd++;
    else if (cur !== targetZoneId) toMove++;
  }
  console.log(`Countries: ${entries.length} in map — ${toAdd} to add, ${toMove} to re-zone, ${entries.length - toAdd - toMove} already correct.`);
  if (apply && (toAdd || toMove)) {
    for (const [code, zone] of entries) {
      const targetZoneId = zoneByLabel.get(`Zone ${zone}`);
      if (!targetZoneId) continue;
      await db.insert(schema.carrierZoneCountries)
        .values({ carrierAccountId: accountId, carrierZoneId: targetZoneId, countryCode: code })
        .onConflictDoUpdate({
          target: [schema.carrierZoneCountries.carrierAccountId, schema.carrierZoneCountries.countryCode],
          set: { carrierZoneId: targetZoneId },
        });
    }
  }
}

async function main(): Promise<void> {
  const args = parseArgs();
  console.log(`PDF:        ${args.pdf}`);
  console.log(`Account:    ${args.accountId ?? '(required for --apply)'}`);
  console.log(`Card:       ${args.cardId ?? '(none — will create on --apply)'}`);
  console.log(`Mode:       ${args.apply ? 'APPLY (writes)' : 'DRY-RUN'}\n`);

  const text = execFileSync('pdftotext', ['-layout', args.pdf, '-'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });

  // Parse + validate against ground truth BEFORE touching the DB.
  const tierUppers = dhl2025TierUppers();
  const built = buildRateCardCells(dhlExportParser, text, tierUppers, DHL_2025_ZONE_LABELS);
  const { preview, cells, problems } = built;

  console.log('=== Parse summary ===');
  console.log(`  Effective from:  ${preview.effectiveFromGuess ?? '—'}`);
  console.log(`  Package cells:   ${preview.packageCells}  (expect ${dhlExportParser.expectedPackageCells})`);
  console.log(`  Pak cells:       ${preview.pakCells}  (expect ${dhlExportParser.expectedPakCells})`);
  console.log(`  Zones covered:   ${preview.zonesCovered} / ${DHL_2025_ZONE_LABELS.length}`);
  console.log('  Spot checks:');
  for (const s of preview.spotChecks) console.log(`    ${s.ok ? '✓' : '✗'} ${s.label}`);
  console.log('  Heavy per-kg bands (VND/kg):');
  for (const h of preview.heavy) {
    console.log(`    ${h.band.padEnd(16)}${h.rates.map((r) => `${r.zone}:${vnd(r.perKg)}`).join('  ')}`);
  }
  console.log('');

  if (problems.length) {
    console.log('=== ✗ SELF-CHECK FAILED — refusing to write ===');
    for (const p of problems) console.log(`  - ${p}`);
    process.exitCode = 1;
    return;
  }
  console.log('=== ✓ All parse self-checks passed ===\n');

  if (!args.accountId) {
    console.log('No --account-id: dry-run only. Pass --account-id <uuid> [--apply] to seed + import.');
    return;
  }

  const [account] = await db
    .select({ id: schema.carrierAccounts.id, name: schema.carrierAccounts.name, cur: schema.carrierAccounts.costCurrency })
    .from(schema.carrierAccounts)
    .where(eq(schema.carrierAccounts.id, args.accountId))
    .limit(1);
  if (!account) {
    console.log(`ERROR: carrier account ${args.accountId} not found. Create the DHL account in the app first.`);
    process.exitCode = 1;
    return;
  }
  console.log(`Account: "${account.name}" (cost currency ${account.cur})`);
  if (account.cur !== 'VND') {
    console.log(`WARNING: account cost currency is ${account.cur}, but the DHL sheet is in VND.`);
  }

  console.log('\n=== Seeding prerequisites ===');
  const zoneByLabel = await ensureZones(args.accountId, args.apply);
  const tierByUpper = await ensureTiers(args.accountId, args.apply);
  await ensureCountries(args.accountId, zoneByLabel, args.apply);

  if (!args.apply) {
    console.log('\nDRY-RUN: nothing written. Re-run with --apply to seed zones/tiers/countries and write cells.');
    return;
  }

  // Resolve / create the rate card.
  let cardId = args.cardId;
  if (!cardId) {
    const effectiveFrom = preview.effectiveFromGuess ?? '2025-01-01';
    const [card] = await db.insert(schema.carrierRateCards).values({
      carrierAccountId: args.accountId,
      label: CARD_LABEL,
      effectiveFrom,
      effectiveTo: null,
      sourcePdfFilename: args.pdf.split('/').pop() ?? null,
    }).returning({ id: schema.carrierRateCards.id });
    cardId = card.id;
    console.log(`\nCreated rate card ${cardId} (${CARD_LABEL}, effective ${effectiveFrom} → open).`);
  } else {
    const [card] = await db.select().from(schema.carrierRateCards)
      .where(and(eq(schema.carrierRateCards.id, cardId), eq(schema.carrierRateCards.carrierAccountId, args.accountId)))
      .limit(1);
    if (!card) {
      console.log(`ERROR: card ${cardId} not found for account ${args.accountId}.`);
      process.exitCode = 1;
      return;
    }
    console.log(`\nUsing existing card ${cardId} (${card.label}).`);
  }

  // Re-read tiers/zones to be safe (post-seed), then write cells.
  const zoneIdByLabel = zoneByLabel;
  const tierIdByUpper = tierByUpper;
  console.log(`Writing ${cells.length} cells…`);
  let written = 0;
  for (let i = 0; i < cells.length; i += 200) {
    const chunk = cells.slice(i, i + 200);
    const rows = chunk.map((c) => ({
      rateCardId: cardId!,
      carrierZoneId: zoneIdByLabel.get(c.zoneLabel)!,
      carrierWeightTierId: tierIdByUpper.get(c.upperKg)!,
      packageType: c.packageType,
      costAmount: c.cost.toFixed(2),
    }));
    await db.insert(schema.carrierRateCells).values(rows).onConflictDoUpdate({
      target: [
        schema.carrierRateCells.rateCardId,
        schema.carrierRateCells.carrierZoneId,
        schema.carrierRateCells.carrierWeightTierId,
        schema.carrierRateCells.packageType,
      ],
      set: { costAmount: sql`excluded.cost_amount`, updatedAt: new Date() },
    });
    written += rows.length;
  }
  console.log(`✓ Wrote ${written} cells into card ${cardId}.`);
  console.log('\nDone. View at /f/carrier-rates/' + args.accountId + '/workspace');
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
