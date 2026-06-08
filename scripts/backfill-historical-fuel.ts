/**
 * Backfill historical fuel-surcharge windows so reconciliation can price
 * 2025-era shipments correctly (the cron only keeps the recent ~13 weeks).
 *
 *   - DHL: monthly rates Jan–Nov 2025 (source: gatewayexpress.vn). DHL switched
 *     monthly→weekly in late 2025; existing weekly windows start 2025-11-24, so
 *     we fill up to that boundary only.
 *   - FedEx: weekly rates 03-Mar-2025 → 08-Mar-2026 (source: wingo.vn). Existing
 *     FedEx windows start 2026-03-09, so we fill up to that boundary only.
 *
 * Each entry's ends_at is the next entry's starts_at (contiguous); the last
 * entry ends at the boundary where existing coverage begins. Idempotent: skips
 * any (account, starts_at) that already exists. Dry-run unless --apply.
 *
 *   DATABASE_URL=… npx tsx scripts/backfill-historical-fuel.ts [--apply]
 */
import 'dotenv/config';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';

const FEDEX = '5683f3c0-9249-40c1-a3e7-d967f0d62c29';
const DHL = '67c5b5eb-ae96-4260-990b-8dd1126f3166';

interface Pt { start: string; value: number }

// DHL monthly (gatewayexpress.vn), Jan 2025 → boundary 2025-11-24.
const DHL_MONTHLY: Pt[] = [
  { start: '2025-01-01', value: 25.75 },
  { start: '2025-02-01', value: 29.25 },
  { start: '2025-03-01', value: 29.75 },
  { start: '2025-04-01', value: 28.25 },
  { start: '2025-05-01', value: 27.50 },
  { start: '2025-06-01', value: 26.75 },
  { start: '2025-07-01', value: 27.00 },
  { start: '2025-08-01', value: 31.00 },
  { start: '2025-09-01', value: 30.00 },
  { start: '2025-10-01', value: 29.75 },
  { start: '2025-11-01', value: 30.00 },
];
const DHL_END = '2025-11-24';

// FedEx weekly (wingo.vn), Monday starts, 03-Mar-2025 → boundary 2026-03-09.
const FEDEX_WEEKLY: Pt[] = [
  { start: '2025-03-03', value: 30.00 }, { start: '2025-03-10', value: 28.75 },
  { start: '2025-03-17', value: 28.00 }, { start: '2025-03-24', value: 27.50 },
  { start: '2025-03-31', value: 27.75 }, { start: '2025-04-07', value: 28.25 },
  { start: '2025-04-14', value: 28.00 }, { start: '2025-04-21', value: 26.50 },
  { start: '2025-04-28', value: 27.00 }, { start: '2025-05-05', value: 27.50 },
  { start: '2025-05-12', value: 27.00 }, { start: '2025-05-19', value: 26.25 },
  { start: '2025-05-26', value: 27.50 }, { start: '2025-06-02', value: 27.00 },
  { start: '2025-06-09', value: 28.50 }, { start: '2025-06-16', value: 28.75 },
  { start: '2025-06-23', value: 29.75 }, { start: '2025-06-30', value: 32.00 },
  { start: '2025-07-07', value: 30.50 }, { start: '2025-07-14', value: 31.00 },
  { start: '2025-07-21', value: 31.50 }, { start: '2025-07-28', value: 31.50 },
  { start: '2025-08-04', value: 31.75 }, { start: '2025-08-11', value: 31.00 },
  { start: '2025-08-18', value: 29.50 }, { start: '2025-08-25', value: 29.25 },
  { start: '2025-09-01', value: 29.75 }, { start: '2025-09-08', value: 29.75 },
  { start: '2025-09-15', value: 30.00 }, { start: '2025-09-22', value: 29.75 },
  { start: '2025-09-29', value: 30.25 }, { start: '2025-10-06', value: 30.50 },
  { start: '2025-10-13', value: 29.75 }, { start: '2025-10-20', value: 30.50 },
  { start: '2025-10-27', value: 30.00 }, { start: '2025-11-03', value: 30.75 },
  { start: '2025-11-10', value: 31.50 }, { start: '2025-11-17', value: 31.75 },
  { start: '2025-11-24', value: 32.00 }, { start: '2025-12-01', value: 32.25 },
  { start: '2025-12-08', value: 30.00 }, { start: '2025-12-15', value: 30.00 },
  { start: '2025-12-22', value: 29.25 }, { start: '2025-12-29', value: 29.25 },
  { start: '2026-01-05', value: 29.00 }, { start: '2026-01-12', value: 28.50 },
  { start: '2026-01-19', value: 28.25 }, { start: '2026-01-26', value: 29.50 },
  { start: '2026-02-02', value: 30.25 }, { start: '2026-02-09', value: 31.00 },
  { start: '2026-02-16', value: 30.50 }, { start: '2026-02-23', value: 30.75 },
  { start: '2026-03-02', value: 32.00 },
];
const FEDEX_END = '2026-03-09';

interface Row { accountId: string; startsAt: string; endsAt: string; value: number }

function expand(accountId: string, pts: Pt[], finalEnd: string): Row[] {
  return pts.map((p, i) => ({
    accountId,
    startsAt: p.start,
    endsAt: i + 1 < pts.length ? pts[i + 1].start : finalEnd,
    value: p.value,
  }));
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const rows = [...expand(DHL, DHL_MONTHLY, DHL_END), ...expand(FEDEX, FEDEX_WEEKLY, FEDEX_END)];

  // Sanity: contiguity + ascending within each carrier.
  for (const [label, set] of [['DHL', expand(DHL, DHL_MONTHLY, DHL_END)], ['FedEx', expand(FEDEX, FEDEX_WEEKLY, FEDEX_END)]] as const) {
    for (let i = 0; i < set.length; i++) {
      if (set[i].endsAt <= set[i].startsAt) throw new Error(`${label} bad window at ${set[i].startsAt}`);
      if (i + 1 < set.length && set[i].endsAt !== set[i + 1].startsAt) throw new Error(`${label} gap after ${set[i].startsAt}`);
    }
  }

  console.log(`Mode: ${apply ? 'APPLY' : 'DRY-RUN'} — ${rows.length} windows (DHL ${DHL_MONTHLY.length} + FedEx ${FEDEX_WEEKLY.length})`);

  let inserted = 0, skipped = 0;
  for (const r of rows) {
    const existing = await db
      .select({ id: schema.carrierSurcharges.id })
      .from(schema.carrierSurcharges)
      .where(and(
        eq(schema.carrierSurcharges.carrierAccountId, r.accountId),
        eq(schema.carrierSurcharges.kind, 'fuel_percent'),
        eq(schema.carrierSurcharges.startsAt, new Date(r.startsAt)),
      ))
      .limit(1);
    if (existing.length) { skipped++; continue; }
    if (apply) {
      await db.insert(schema.carrierSurcharges).values({
        carrierAccountId: r.accountId,
        kind: 'fuel_percent',
        value: r.value.toFixed(4),
        active: true,
        startsAt: new Date(r.startsAt),
        endsAt: new Date(r.endsAt),
        note: 'Historical backfill (2025) — gatewayexpress/wingo',
      });
    }
    inserted++;
  }
  console.log(`${apply ? 'Inserted' : 'Would insert'}: ${inserted} · Skipped (already present): ${skipped}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
