/**
 * Read-only audit: list time-sensitive surcharges (demand_per_kg,
 * remote_fixed, country_fixed, vat_percent, fuel_percent) per carrier
 * account with their effective windows, so the operator can confirm
 * 2025 rows end at the cutover and 2026 rows start after it.
 *
 *   DATABASE_URL=... npx tsx scripts/verify-carrier-surcharge-windows.ts
 */
import { and, asc, eq, inArray } from 'drizzle-orm';
import { db, schema } from '@/db/client';

const KINDS = ['demand_per_kg', 'remote_fixed', 'country_fixed', 'vat_percent', 'fuel_percent'] as const;

async function main(): Promise<void> {
  const accounts = await db
    .select({ id: schema.carrierAccounts.id, name: schema.carrierAccounts.name, key: schema.carriers.key })
    .from(schema.carrierAccounts)
    .leftJoin(schema.carriers, eq(schema.carriers.id, schema.carrierAccounts.carrierId))
    .orderBy(asc(schema.carrierAccounts.name));

  for (const a of accounts) {
    const mine = await db
      .select()
      .from(schema.carrierSurcharges)
      .where(and(
        eq(schema.carrierSurcharges.carrierAccountId, a.id),
        inArray(schema.carrierSurcharges.kind, KINDS as unknown as string[]),
      ))
      .orderBy(asc(schema.carrierSurcharges.kind));

    process.stdout.write(`\n=== ${a.name} (${a.key ?? '?'}) — ${mine.length} time-sensitive surcharges ===\n`);
    for (const r of mine) {
      const from = r.startsAt ? r.startsAt.toISOString().slice(0, 10) : '—';
      const to = r.endsAt ? r.endsAt.toISOString().slice(0, 10) : 'open';
      process.stdout.write(`  ${r.kind.padEnd(16)} value=${String(r.value).padStart(12)}  [${from} → ${to}]  active=${r.active}\n`);
    }
  }
}

main()
  .catch((e) => { process.stderr.write(String(e instanceof Error ? e.stack : e) + '\n'); process.exit(1); })
  .finally(() => process.exit());
