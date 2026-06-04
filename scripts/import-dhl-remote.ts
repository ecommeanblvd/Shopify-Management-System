/* eslint-disable no-console */
/**
 * Import DHL Express Remote Area Locations from the official
 * `dhl_express_remote_areas_en.xlsx` spreadsheet into
 * `carrier_remote_postcodes`, then ensure the catch-all
 * `remote_fixed` surcharge row exists with the published price
 * (735,000 VND per shipment OR 15,000 VND per kg, whichever higher).
 *
 * DHL doesn't tier its remote areas — anything in the list is "remote"
 * with the same flat-or-per-kg surcharge. We store `tier = NULL` on
 * both the surcharge row and the postcode rows so the engine's
 * tier-equality match (null === null) lands them together.
 *
 * Two normalisations applied (same rules as the FedEx importer so the
 * engine sees the same key format both ways):
 *   1. Postal range → individual codes ("1024100-1024100" stays one row;
 *      ranges spanning many codes get expanded).
 *   2. City names → uppercased + non-alnum stripped
 *      (e.g. "Al Khor" → "ALKHOR").
 *
 * Idempotent: deletes existing DHL rows for the touched countries
 * before inserting. The surcharge row is upserted only when missing
 * so re-running won't duplicate.
 *
 * Defaults to dry-run. Pass --apply to write.
 *
 * Usage:
 *   pnpm tsx scripts/import-dhl-remote.ts \
 *     --file "/Users/macos/Downloads/dhl_express_remote_areas_en.xlsx"
 *
 *   pnpm tsx scripts/import-dhl-remote.ts \
 *     --file ".../dhl_express_remote_areas_en.xlsx" --apply
 */
import 'dotenv/config';
import { readFileSync } from 'fs';
import XLSX from 'xlsx';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { db, schema } from '@/db/client';

interface Args {
  file: string;
  account: string;
  apply: boolean;
  source: string;
}

function parseArgs(): Args {
  const a = process.argv.slice(2);
  let file = '';
  let account = 'DHL Express Vietnam — Worldwide Export 2026';
  let apply = false;
  let source = 'DHL Remote Areas Jan-2026';
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--file') file = a[++i];
    else if (a[i] === '--account') account = a[++i];
    else if (a[i] === '--apply') apply = true;
    else if (a[i] === '--source') source = a[++i];
  }
  if (!file) throw new Error('--file <xlsx> is required');
  readFileSync(file).length; // probe readable
  return { file, account, apply, source };
}

const REMOTE_VALUE_VND = 735_000;
const REMOTE_VALUE_PER_KG_VND = 15_000;
const SHEET_NAME = 'Remote Area Locations';
const HEADER_ROW_INDEX = 1; // row 0 = effective date, row 1 = headers, row 2 = data

interface ParsedRow {
  countryCode: string;
  pattern: string;
  origin: 'postcode' | 'postcode_range' | 'city';
}

function parseSheet(filePath: string): ParsedRow[] {
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[SHEET_NAME];
  if (!ws) throw new Error(`Sheet "${SHEET_NAME}" not found`);
  const all = XLSX.utils.sheet_to_json<(string | null)[]>(ws, {
    header: 1,
    defval: null,
    raw: false,
  });
  const data = all.slice(HEADER_ROW_INDEX + 1);

  // Columns: 0 Country Name | 1 Country Code | 2 City Name | 3 Postal from | 4 Postal to
  const C = { country: 0, cc: 1, city: 2, pcFrom: 3, pcTo: 4 };

  const parsed: ParsedRow[] = [];
  const seen = new Set<string>();

  for (const r of data) {
    const cc = (r[C.cc] ?? '').toString().trim();
    if (!cc || cc.length !== 2) continue;

    const pcFrom = r[C.pcFrom];
    const pcTo = r[C.pcTo];
    const city = (r[C.city] ?? '').toString().trim();
    const hasPostcode = pcFrom !== null && pcFrom !== '';

    if (hasPostcode) {
      const a = Number(pcFrom);
      const b = pcTo !== null && pcTo !== '' ? Number(pcTo) : a;
      if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) {
        const key = `${cc}|${String(pcFrom).trim()}`;
        if (!seen.has(key)) {
          seen.add(key);
          parsed.push({ countryCode: cc, pattern: String(pcFrom).trim(), origin: 'postcode' });
        }
      } else {
        const width = String(pcFrom).length;
        for (let n = a; n <= b; n++) {
          const p = String(n).padStart(width, '0');
          const key = `${cc}|${p}`;
          if (!seen.has(key)) {
            seen.add(key);
            parsed.push({
              countryCode: cc,
              pattern: p,
              origin: a === b ? 'postcode' : 'postcode_range',
            });
          }
        }
      }
    } else if (city) {
      // Same normalisation as the FedEx importer + quote engine — keep
      // these three in lockstep or remote lookups will silently miss.
      const p = city.toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (!p) continue;
      const key = `${cc}|${p}`;
      if (!seen.has(key)) {
        seen.add(key);
        parsed.push({ countryCode: cc, pattern: p, origin: 'city' });
      }
    }
  }

  return parsed;
}

async function ensureSurcharge(accountId: string, apply: boolean): Promise<void> {
  // Catch-all remote_fixed row keyed off tier IS NULL — DHL doesn't
  // tier its remote areas, so the engine's null-tier match lands here.
  const existing = await db
    .select({ id: schema.carrierSurcharges.id, value: schema.carrierSurcharges.value, valuePerKg: schema.carrierSurcharges.valuePerKg })
    .from(schema.carrierSurcharges)
    .where(and(
      eq(schema.carrierSurcharges.carrierAccountId, accountId),
      eq(schema.carrierSurcharges.kind, 'remote_fixed'),
      isNull(schema.carrierSurcharges.tier),
    ));
  if (existing.length > 0) {
    const e = existing[0];
    const valueOk = Number(e.value) === REMOTE_VALUE_VND;
    const perKgOk = e.valuePerKg !== null && Number(e.valuePerKg) === REMOTE_VALUE_PER_KG_VND;
    if (valueOk && perKgOk) {
      console.log(`[dhl-import] remote_fixed surcharge already correct: ${REMOTE_VALUE_VND} VND + ${REMOTE_VALUE_PER_KG_VND}/kg`);
      return;
    }
    console.log(`[dhl-import] updating existing remote_fixed surcharge → ${REMOTE_VALUE_VND} VND + ${REMOTE_VALUE_PER_KG_VND}/kg`);
    if (apply) {
      await db.update(schema.carrierSurcharges)
        .set({
          value: String(REMOTE_VALUE_VND),
          valuePerKg: String(REMOTE_VALUE_PER_KG_VND),
          active: true,
          note: 'DHL Express remote area surcharge (Jan 2026): 735,000 VND per shipment OR 15,000 VND/kg, whichever higher.',
        })
        .where(eq(schema.carrierSurcharges.id, e.id));
    }
    return;
  }
  console.log(`[dhl-import] inserting remote_fixed surcharge: ${REMOTE_VALUE_VND} VND + ${REMOTE_VALUE_PER_KG_VND}/kg`);
  if (apply) {
    await db.insert(schema.carrierSurcharges).values({
      carrierAccountId: accountId,
      kind: 'remote_fixed',
      tier: null,
      value: String(REMOTE_VALUE_VND),
      valuePerKg: String(REMOTE_VALUE_PER_KG_VND),
      active: true,
      note: 'DHL Express remote area surcharge (Jan 2026): 735,000 VND per shipment OR 15,000 VND/kg, whichever higher.',
    });
  }
}

async function main(): Promise<void> {
  const args = parseArgs();
  console.log(`[dhl-import] file=${args.file}`);
  console.log(`[dhl-import] account="${args.account}" apply=${args.apply}`);

  const [account] = await db
    .select({ id: schema.carrierAccounts.id })
    .from(schema.carrierAccounts)
    .where(eq(schema.carrierAccounts.name, args.account));
  if (!account) throw new Error(`Carrier account not found: ${args.account}`);
  console.log(`[dhl-import] account id=${account.id}`);

  await ensureSurcharge(account.id, args.apply);

  const rows = parseSheet(args.file);
  console.log(`[dhl-import] parsed ${rows.length} rows after expansion + dedup`);

  const byCC = new Map<string, { total: number; postcode: number; range: number; city: number }>();
  for (const r of rows) {
    if (!byCC.has(r.countryCode)) byCC.set(r.countryCode, { total: 0, postcode: 0, range: 0, city: 0 });
    const e = byCC.get(r.countryCode)!;
    e.total++;
    if (r.origin === 'postcode') e.postcode++;
    else if (r.origin === 'postcode_range') e.range++;
    else e.city++;
  }
  console.log(`[dhl-import] countries: ${byCC.size}`);

  const touchedCountries = [...byCC.keys()];
  if (args.apply) {
    console.log(`[dhl-import] deleting existing rows for ${touchedCountries.length} countries…`);
    await db.delete(schema.carrierRemotePostcodes).where(and(
      eq(schema.carrierRemotePostcodes.carrierAccountId, account.id),
      inArray(schema.carrierRemotePostcodes.countryCode, touchedCountries),
    ));
    console.log(`[dhl-import] inserting ${rows.length} rows…`);
    const CHUNK = 1000;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const slice = rows.slice(i, i + CHUNK).map((r) => ({
        carrierAccountId: account.id,
        countryCode: r.countryCode,
        postcodePattern: r.pattern,
        tier: null,
        source: args.source,
      }));
      await db.insert(schema.carrierRemotePostcodes).values(slice);
    }
  }

  // Report
  console.log('\n========== REPORT ==========');
  const totals = { postcode: 0, range: 0, city: 0 };
  for (const [, e] of byCC) {
    totals.postcode += e.postcode;
    totals.range += e.range;
    totals.city += e.city;
  }
  console.log(`Countries: ${byCC.size}`);
  console.log(`Postcodes (singles): ${totals.postcode}`);
  console.log(`Postcodes (range-expanded): ${totals.range}`);
  console.log(`Cities (normalised): ${totals.city}`);
  console.log(`Total rows: ${rows.length}`);

  // Spotlight ME for sanity
  console.log('\n--- Middle East ---');
  for (const cc of ['SA','QA','AE','KW','BH','OM','JO','IL']) {
    const e = byCC.get(cc);
    if (!e) { console.log(`  ${cc} | (none)`); continue; }
    console.log(`  ${cc} | total=${String(e.total).padStart(4)}  postcode=${e.postcode}  range=${e.range}  city=${e.city}`);
  }

  console.log(`\n${args.apply ? '✅ APPLIED' : '🔎 DRY-RUN (no writes)'}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => process.exit());
