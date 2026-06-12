/**
 * Backfill FedEx `demand_per_kg` theo kỳ từ các PDF Demand-Surcharge của FedEx.
 *
 * Lý do: config hiện tại lưu các dòng demand KHÔNG có khung thời gian (vd Israel
 * 28400 cho mọi thời điểm), nhưng FedEx Demand Surcharge thay đổi theo kỳ —
 * Israel chỉ 11200 VND/kg trong Jul–Sep 2025, lên 28400 gần đây. Điều này khiến
 * đối soát các lô 2025 lệch. Script fetch toàn bộ PDF, parse từng kỳ, dựng các
 * dòng có khung thời gian (buildDemandRows), rồi (khi --apply) THAY THẾ toàn bộ
 * các dòng demand_per_kg của tài khoản FedEx.
 *
 * Dry-run (mặc định) chỉ in ra. Chạy thật cần cờ --apply.
 *
 * Usage:
 *   dotenv -- npx tsx scripts/backfill-fedex-demand.ts          # dry-run
 *   dotenv -- npx tsx scripts/backfill-fedex-demand.ts --apply  # ghi DB
 */

import 'dotenv/config';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { fetchDemandPdfUrls, fetchDemandPdfText } from '@/features/carrier-rates/demand-fetcher/fetch';
import { parseDemandPdfText, type DemandPeriod } from '@/features/carrier-rates/demand-fetcher/parse';
import { buildDemandRows } from '@/features/carrier-rates/demand-fetcher/apply';

const FEDEX_CARRIER_KEY = 'fedex';

function fmtDate(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10) : 'null';
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');

  // 1) Resolve the enabled FedEx carrier account.
  const accounts = await db
    .select({ id: schema.carrierAccounts.id, name: schema.carrierAccounts.name })
    .from(schema.carrierAccounts)
    .leftJoin(schema.carriers, eq(schema.carriers.id, schema.carrierAccounts.carrierId))
    .where(
      and(
        eq(schema.carriers.key, FEDEX_CARRIER_KEY),
        eq(schema.carrierAccounts.enabled, true),
      ),
    );
  if (accounts.length === 0) {
    process.stdout.write('No enabled FedEx accounts; nothing to do.\n');
    return;
  }
  const account = accounts[0];
  process.stdout.write(`FedEx account: ${account.name} (${account.id})\n\n`);

  // 2) Fetch every demand PDF link, parse each into a period. Tolerate
  //    per-PDF parse errors so one bad PDF doesn't abort the whole backfill.
  const urls = await fetchDemandPdfUrls();
  process.stdout.write(`Found ${urls.length} demand PDF link(s).\n`);

  const periods: DemandPeriod[] = [];
  let parsed = 0;
  let failed = 0;
  for (const url of urls) {
    try {
      const text = await fetchDemandPdfText(url);
      periods.push(parseDemandPdfText(text));
      parsed += 1;
    } catch (err) {
      failed += 1;
      process.stdout.write(`  PDF parse FAILED: ${url}\n    ${(err as Error).message}\n`);
    }
  }
  process.stdout.write(`Parsed ${parsed} PDF(s), ${failed} failed.\n\n`);

  if (periods.length === 0) {
    process.stdout.write('No periods parsed; aborting (nothing to write).\n');
    return;
  }

  // 3) Build time-windowed rows.
  const { rows, unmappedRegions } = buildDemandRows(periods);

  process.stdout.write('Periods (chronological):\n');
  const sortedPeriods = [...periods].sort(
    (a, b) => a.effectiveFrom.getTime() - b.effectiveFrom.getTime(),
  );
  for (const p of sortedPeriods) {
    process.stdout.write(
      `  ${fmtDate(p.effectiveFrom)} → ${fmtDate(p.effectiveTo)} | ` +
        `${Object.entries(p.exportRates).map(([k, v]) => `${k}=${v}`).join(', ')}\n`,
    );
  }
  process.stdout.write('\n');

  process.stdout.write(`Rows (${rows.length}):\n`);
  for (const r of rows) {
    process.stdout.write(
      `  ${fmtDate(r.startsAt)} → ${fmtDate(r.endsAt)} | ${r.regionKey} | ` +
        `${r.valueVndPerKg} đ/kg | ${r.countryCodes.length} countries\n`,
    );
  }
  process.stdout.write('\n');

  if (unmappedRegions.length > 0) {
    process.stdout.write('================================================================\n');
    process.stdout.write(`UNMAPPED REGIONS (must map before trusting): ${unmappedRegions.join(', ')}\n`);
    process.stdout.write('================================================================\n\n');
  } else {
    process.stdout.write('unmappedRegions: (none)\n\n');
  }

  if (!apply) {
    process.stdout.write('DRY-RUN — no changes written. Re-run with --apply to write.\n');
    return;
  }

  // 4) Apply: replace all demand_per_kg rows for the FedEx account.
  let inserted = 0;
  await db.transaction(async (tx) => {
    await tx
      .delete(schema.carrierSurcharges)
      .where(
        and(
          eq(schema.carrierSurcharges.carrierAccountId, account.id),
          eq(schema.carrierSurcharges.kind, 'demand_per_kg'),
        ),
      );

    for (const r of rows) {
      await tx.insert(schema.carrierSurcharges).values({
        carrierAccountId: account.id,
        kind: 'demand_per_kg',
        value: String(r.valueVndPerKg),
        countryCodes: r.countryCodes,
        startsAt: r.startsAt,
        endsAt: r.endsAt,
        applyMode: 'always',
        active: true,
        note:
          `FedEx demand ${r.valueVndPerKg}đ/kg ${r.regionKey} — backfill PDF FedEx ` +
          `${fmtDate(r.startsAt)}→${fmtDate(r.endsAt)}. 2026-06-12`,
      });
      inserted += 1;
    }
  });

  process.stdout.write(`Applied. Inserted ${inserted} demand_per_kg row(s).\n`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    process.stderr.write(`${(err as Error).stack ?? err}\n`);
    process.exit(1);
  });
