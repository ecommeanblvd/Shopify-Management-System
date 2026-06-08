/**
 * Import the FedEx Vietnam INECSO 2025 "International Priority Export" (IP)
 * rate sheet into a specific carrier_rate_card.
 *
 * Pipeline:
 *   PDF → pdftotext -layout → parseIpExport (light Package/Pak + heavy
 *   per-kg bands) → toCells (heavy = perKg × tier.upperKg) → upsert.
 *
 * Storage convention is identical to the invoice-verified 2026 card:
 *   - light Package/Pak (0.5–20.5 / 0.5–2.5 kg) stored direct
 *   - heavy Package (21 kg+) stored as perKg × tier.upperKg
 *   - Envelope ignored; tabulated rates are already NET (no discount).
 *
 * A self-check asserts the parse reproduces the 2026 cell structure
 * (1298 Package + 110 Pak cells across 22 zones) before anything writes.
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
import {
  parseIpExport,
  toCells,
  type RateCellInput,
} from '@/features/carrier-rates/import/fedex-2025-rates';

const DEFAULT_PDF =
  '/Users/macos/Downloads/FedEx Express - Bảng giá tham khảo 2025- INECSO c1 từ 28.10.26.pdf';
const DEFAULT_ACCOUNT_ID = '5683f3c0-9249-40c1-a3e7-d967f0d62c29';

// Expected cell counts, locked to the 2026 card structure (22 zones).
const EXPECT_PACKAGE = 1298;
const EXPECT_PAK = 110;

// Ground-truth spot checks straight from the PDF (catch column drift).
const SPOT_CHECKS: { zone: string; type: 'package' | 'pak'; upperKg: number; cost: number }[] = [
  { zone: 'Zone A', type: 'package', upperKg: 0.5, cost: 592155 },
  { zone: 'Zone A', type: 'pak', upperKg: 0.5, cost: 574857 },
  { zone: 'Zone O', type: 'package', upperKg: 0.5, cost: 588448 },
  { zone: 'Zone Y', type: 'package', upperKg: 0.5, cost: 413587 },
  { zone: 'Zone Y', type: 'package', upperKg: 1.0, cost: 414822 },
  { zone: 'Zone Z', type: 'package', upperKg: 20.5, cost: 1680768 },
  { zone: 'Zone A', type: 'package', upperKg: 25, cost: 112600 * 25 }, // heavy band 21-44
  { zone: 'Zone A', type: 'package', upperKg: 1500, cost: 86681 * 1500 }, // heavy band 1000+
  { zone: 'Zone Y', type: 'package', upperKg: 25, cost: 90981 * 25 },
];

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
  console.log(`Mode:       ${args.apply ? 'APPLY (writes cells)' : 'DRY-RUN'}`);
  console.log('');

  // 1. Extract + parse.
  const text = execFileSync('pdftotext', ['-layout', args.pdf, '-'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const parsed = parseIpExport(text);

  // 2. Load the account's zones + tiers (the cell key-space).
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

  const zoneIdByLabel = new Map(zones.map((z) => [z.label, z.id]));
  const tierIdByUpper = new Map(tiers.map((t) => [Number(t.upperKg), t.id]));
  const tierUppers = tiers.map((t) => Number(t.upperKg));

  const cells = toCells(parsed, tierUppers);

  // 3. Self-checks — fail loudly before any write.
  const problems: string[] = [];
  const nPackage = cells.filter((c) => c.packageType === 'package').length;
  const nPak = cells.filter((c) => c.packageType === 'pak').length;
  if (nPackage !== EXPECT_PACKAGE) problems.push(`package count ${nPackage} ≠ ${EXPECT_PACKAGE}`);
  if (nPak !== EXPECT_PAK) problems.push(`pak count ${nPak} ≠ ${EXPECT_PAK}`);

  for (const c of cells) {
    if (!zoneIdByLabel.has(c.zoneLabel)) problems.push(`unknown zone ${c.zoneLabel}`);
    if (!tierIdByUpper.has(c.upperKg)) problems.push(`unknown tier ${c.upperKg}`);
  }

  for (const s of SPOT_CHECKS) {
    const hit = cells.find(
      (c) => c.zoneLabel === s.zone && c.packageType === s.type && c.upperKg === s.upperKg,
    );
    if (!hit) problems.push(`spot-check missing: ${s.zone} ${s.type} ${s.upperKg}kg`);
    else if (hit.cost !== s.cost) {
      problems.push(`spot-check ${s.zone} ${s.type} ${s.upperKg}kg = ${vnd(hit.cost)} ≠ ${vnd(s.cost)}`);
    }
  }

  // 4. Report.
  const zonesSeen = new Set(cells.map((c) => c.zoneLabel));
  console.log('=== Parse summary ===');
  console.log(`  Light rows parsed:   ${parsed.light.length}`);
  console.log(`  Heavy band rows:     ${parsed.heavy.length}`);
  console.log(`  Cells (Package):     ${nPackage}  (expect ${EXPECT_PACKAGE})`);
  console.log(`  Cells (Pak):         ${nPak}  (expect ${EXPECT_PAK})`);
  console.log(`  Zones covered:       ${zonesSeen.size} / ${zones.length}`);
  console.log('');

  console.log('=== Spot checks (PDF ground truth) ===');
  for (const s of SPOT_CHECKS) {
    const hit = cells.find(
      (c) => c.zoneLabel === s.zone && c.packageType === s.type && c.upperKg === s.upperKg,
    );
    const ok = hit && hit.cost === s.cost;
    console.log(
      `  ${ok ? '✓' : '✗'} ${s.zone.padEnd(7)} ${s.type.padEnd(7)} ${String(s.upperKg).padStart(6)}kg → ${vnd(s.cost).padStart(14)}`,
    );
  }
  console.log('');

  // Heavy per-kg table (the high-value rows) for human review.
  console.log('=== Heavy per-kg rates (VND/kg) ===');
  const bandKeys = Array.from(
    new Set(parsed.heavy.map((b) => `${b.lo}-${b.hi}`)),
  );
  const zoneLetters = Array.from(new Set(parsed.heavy.map((b) => b.zone)));
  console.log(`  ${'band'.padEnd(16)}${zoneLetters.map((z) => z.padStart(9)).join('')}`);
  for (const bk of bandKeys) {
    const [lo, hi] = bk.split('-').map(Number);
    const row = zoneLetters.map((z) => {
      const b = parsed.heavy.find((x) => x.zone === z && x.lo === lo && x.hi === hi);
      return (b ? vnd(b.perKg) : '—').padStart(9);
    });
    console.log(`  ${bk.padEnd(16)}${row.join('')}`);
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

  // 5. Verify the card belongs to the account, then upsert.
  const [card] = await db
    .select()
    .from(schema.carrierRateCards)
    .where(
      and(
        eq(schema.carrierRateCards.id, args.cardId),
        eq(schema.carrierRateCards.carrierAccountId, args.accountId),
      ),
    )
    .limit(1);
  if (!card) {
    console.log(`ERROR: card ${args.cardId} not found for account ${args.accountId}.`);
    process.exitCode = 1;
    return;
  }
  console.log(`Writing ${cells.length} cells into card "${card.label}" (${card.effectiveFrom} → ${card.effectiveTo ?? 'open'})…`);

  let written = 0;
  for (const c of cells as RateCellInput[]) {
    const zoneId = zoneIdByLabel.get(c.zoneLabel)!;
    const tierId = tierIdByUpper.get(c.upperKg)!;
    await db
      .insert(schema.carrierRateCells)
      .values({
        rateCardId: args.cardId,
        carrierZoneId: zoneId,
        carrierWeightTierId: tierId,
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
