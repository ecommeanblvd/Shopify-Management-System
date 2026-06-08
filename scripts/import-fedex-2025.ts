/**
 * Import the FedEx Vietnam INECSO 2025 "International Priority Export" (IP)
 * rate sheet into a specific carrier_rate_card.
 *
 * Parsing, cell-mapping, and the self-check all live in the shared module
 * (`@/features/carrier-rates/import/*`) so the CLI and the in-app upload flow
 * stay identical. This script just wires CLI args + DB I/O around them.
 *
 * Defaults to DRY-RUN — prints what it WOULD write. Pass --apply to write.
 *
 * Usage:
 *   DATABASE_URL=… npx tsx scripts/import-fedex-2025.ts \
 *     --card <rate_card_uuid> \
 *     [--pdf "/path/to/FedEx 2025.pdf"] \
 *     [--account-id <uuid>] [--apply]
 */
import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { and, asc, eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { fedexIpParser } from '@/features/carrier-rates/import/parsers/fedex-ip';
import { buildRateCardCells } from '@/features/carrier-rates/import/preview';

const DEFAULT_PDF =
  '/Users/macos/Downloads/FedEx Express - Bảng giá tham khảo 2025- INECSO c1 từ 28.10.26.pdf';
const DEFAULT_ACCOUNT_ID = '5683f3c0-9249-40c1-a3e7-d967f0d62c29';

interface Args {
  pdf: string;
  accountId: string;
  cardId: string | null;
  apply: boolean;
}

function parseArgs(): Args {
  const a = process.argv.slice(2);
  let pdf = DEFAULT_PDF;
  let accountId = DEFAULT_ACCOUNT_ID;
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

async function main(): Promise<void> {
  const args = parseArgs();
  console.log(`PDF:        ${args.pdf}`);
  console.log(`Account:    ${args.accountId}`);
  console.log(`Card:       ${args.cardId ?? '(none — dry-run only)'}`);
  console.log(`Mode:       ${args.apply ? 'APPLY (writes cells)' : 'DRY-RUN'}\n`);

  const text = execFileSync('pdftotext', ['-layout', args.pdf, '-'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });

  const zones = await db
    .select({ id: schema.carrierZones.id, label: schema.carrierZones.label })
    .from(schema.carrierZones)
    .where(eq(schema.carrierZones.carrierAccountId, args.accountId))
    .orderBy(asc(schema.carrierZones.position));
  const tiers = await db
    .select({ id: schema.carrierWeightTiers.id, upperKg: schema.carrierWeightTiers.upperKg })
    .from(schema.carrierWeightTiers)
    .where(eq(schema.carrierWeightTiers.carrierAccountId, args.accountId))
    .orderBy(asc(sql`(${schema.carrierWeightTiers.upperKg})::numeric`));

  const built = buildRateCardCells(
    fedexIpParser, text, tiers.map((t) => Number(t.upperKg)), zones.map((z) => z.label),
  );
  const { preview, cells, problems } = built;

  console.log('=== Parse summary ===');
  console.log(`  Effective from:      ${preview.effectiveFromGuess ?? '—'}`);
  console.log(`  Cells (Package):     ${preview.packageCells}  (expect ${fedexIpParser.expectedPackageCells})`);
  console.log(`  Cells (Pak):         ${preview.pakCells}  (expect ${fedexIpParser.expectedPakCells})`);
  console.log(`  Zones covered:       ${preview.zonesCovered} / ${zones.length}\n`);

  console.log('=== Spot checks (PDF ground truth) ===');
  for (const s of preview.spotChecks) console.log(`  ${s.ok ? '✓' : '✗'} ${s.label}`);
  console.log('');

  console.log('=== Heavy per-kg rates (VND/kg) ===');
  for (const h of preview.heavy) {
    console.log(`  ${h.band.padEnd(16)}${h.rates.map((r) => `${r.zone}:${vnd(r.perKg)}`).join('  ')}`);
  }
  console.log('');

  if (problems.length) {
    console.log('=== ✗ SELF-CHECK FAILED — refusing to write ===');
    for (const p of problems) console.log(`  - ${p}`);
    process.exitCode = 1;
    return;
  }
  console.log('=== ✓ All self-checks passed ===\n');

  if (!args.apply) {
    console.log('DRY-RUN: no changes written. Re-run with --card <uuid> --apply to import.');
    return;
  }
  if (!args.cardId) {
    console.log('ERROR: --apply requires --card <rate_card_uuid>.');
    process.exitCode = 1;
    return;
  }

  const [card] = await db
    .select()
    .from(schema.carrierRateCards)
    .where(and(
      eq(schema.carrierRateCards.id, args.cardId),
      eq(schema.carrierRateCards.carrierAccountId, args.accountId),
    ))
    .limit(1);
  if (!card) {
    console.log(`ERROR: card ${args.cardId} not found for account ${args.accountId}.`);
    process.exitCode = 1;
    return;
  }
  console.log(`Writing ${cells.length} cells into card "${card.label}" (${card.effectiveFrom} → ${card.effectiveTo ?? 'open'})…`);

  const zoneIdByLabel = new Map(zones.map((z) => [z.label, z.id]));
  const tierIdByUpper = new Map(tiers.map((t) => [Number(t.upperKg), t.id]));
  let written = 0;
  for (const c of cells) {
    await db
      .insert(schema.carrierRateCells)
      .values({
        rateCardId: args.cardId,
        carrierZoneId: zoneIdByLabel.get(c.zoneLabel)!,
        carrierWeightTierId: tierIdByUpper.get(c.upperKg)!,
        packageType: c.packageType,
        costAmount: c.cost.toFixed(2),
      })
      .onConflictDoUpdate({
        target: [
          schema.carrierRateCells.rateCardId,
          schema.carrierRateCells.carrierZoneId,
          schema.carrierRateCells.carrierWeightTierId,
          schema.carrierRateCells.packageType,
        ],
        set: { costAmount: c.cost.toFixed(2), updatedAt: new Date() },
      });
    written += 1;
  }
  console.log(`✓ Wrote ${written} cells.`);
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
