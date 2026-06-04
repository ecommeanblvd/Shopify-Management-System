/* eslint-disable no-console */
/**
 * Import FedEx International ODA/OPA Tier list from the official
 * `ODA_OPA_tiers_codes.xlsx` spreadsheet into
 * `carrier_remote_postcodes`.
 *
 * Two normalisations applied to make the rows lookup-friendly:
 *
 *   1. Postal range → single codes. The engine's lookup is
 *      `Map.get(postcode)`, so a row whose pattern is "10930-10932"
 *      would never match a real postcode. Expand into three rows
 *      (10930, 10931, 10932).
 *
 *   2. City names → UPPERCASED. Some countries (SA, AE, KW, QA, OM,
 *      BH) only have city-level ODA lists. We store the city name
 *      uppercased so the engine's case-insensitive city fallback hits
 *      via the same Map. There is no postal/city collision because
 *      postcodes here are digits-only.
 *
 * Scope: ODA Parcel only (Tier A/B/C). Skip rows with "No" or empty
 * tier — those countries/cities are explicitly not remote. Tier
 * surcharges themselves are NOT touched (already configured manually
 * with the correct VND amounts).
 *
 * Idempotent: for each (account, country) in scope, the script
 * deletes existing rows before inserting the new batch — so re-runs
 * after a FedEx publication refresh don't double up.
 *
 * Defaults to dry-run. Pass --apply to write.
 *
 * Usage:
 *   pnpm tsx scripts/import-fedex-oda.ts \
 *     --file "/Users/macos/Downloads/ODA_OPA_tiers_codes (1).xlsx"
 *
 *   pnpm tsx scripts/import-fedex-oda.ts \
 *     --file ".../ODA_OPA_tiers_codes (1).xlsx" \
 *     --account "FedEx Vietnam — International Priority (IP) 2026" \
 *     --apply
 */
import 'dotenv/config';
import { readFileSync } from 'fs';
import XLSX from 'xlsx';
import { and, eq, inArray } from 'drizzle-orm';
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
  let account = 'FedEx Vietnam — International Priority (IP) 2026';
  let apply = false;
  let source = 'FedEx ODA Jan-2026';
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--file') file = a[++i];
    else if (a[i] === '--account') account = a[++i];
    else if (a[i] === '--apply') apply = true;
    else if (a[i] === '--source') source = a[++i];
  }
  if (!file) throw new Error('--file <xlsx> is required');
  // sanity: confirm file is readable
  readFileSync(file).length;
  return { file, account, apply, source };
}

const VALID_TIERS = new Set(['Tier A', 'Tier B', 'Tier C']);
const HEADER_ROW_INDEX = 7; // 0-indexed: data starts at row 8

interface ParsedRow {
  countryCode: string;
  pattern: string;
  tier: string;
  /** For reporting only. */
  origin: 'postcode' | 'postcode_range' | 'city';
}

/**
 * Read the FedEx tier xlsx, filter to rows with ODA Parcel ∈ {Tier A/B/C},
 * expand postal ranges, uppercase city patterns, and return the deduped
 * list of (country, pattern, tier) ready for insert.
 */
function parseSheet(filePath: string): ParsedRow[] {
  const wb = XLSX.readFile(filePath);
  const sheetName = wb.SheetNames[0]; // 'Postal Codes and Tiers '
  const ws = wb.Sheets[sheetName];
  if (!ws) throw new Error(`Sheet "${sheetName}" not found`);
  const all = XLSX.utils.sheet_to_json<(string | null)[]>(ws, {
    header: 1,
    defval: null,
    raw: false,
  });
  const data = all.slice(HEADER_ROW_INDEX + 1);

  // Column indices in the sheet
  const C = { country: 0, cc: 1, city: 2, pcB: 3, pcE: 4, odaParcel: 7 };

  const parsed: ParsedRow[] = [];
  const seen = new Set<string>(); // dedupe key: cc|pattern

  for (const r of data) {
    const cc = (r[C.cc] ?? '').toString().trim();
    const odaP = (r[C.odaParcel] ?? '').toString().trim();
    if (!cc || cc.length !== 2) continue;
    if (!VALID_TIERS.has(odaP)) continue;

    const pcB = r[C.pcB];
    const pcE = r[C.pcE];
    const city = (r[C.city] ?? '').toString().trim();
    const hasPostcode = pcB !== null && pcB !== '';

    if (hasPostcode) {
      const a = Number(pcB);
      const b = pcE !== null && pcE !== '' ? Number(pcE) : a;
      if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) {
        // Non-numeric postcode (rare) — store as-is, no expansion.
        const key = `${cc}|${String(pcB).trim()}`;
        if (!seen.has(key)) {
          seen.add(key);
          parsed.push({ countryCode: cc, pattern: String(pcB).trim(), tier: odaP, origin: 'postcode' });
        }
      } else {
        // Pad to original width so '10930' stays '10930' (5 digits).
        const width = String(pcB).length;
        for (let n = a; n <= b; n++) {
          const p = String(n).padStart(width, '0');
          const key = `${cc}|${p}`;
          if (!seen.has(key)) {
            seen.add(key);
            parsed.push({
              countryCode: cc,
              pattern: p,
              tier: odaP,
              origin: a === b ? 'postcode' : 'postcode_range',
            });
          }
        }
      }
    } else if (city) {
      // Normalise: uppercase + strip non-alphanumeric. FedEx publishes
      // city names inconsistently — SA cities have spaces stripped at
      // source ("ABAALWOROOD"), BH/KW/QA/OM cities have spaces
      // ("Durrat Al Bahrain"). Normalising both publisher format and
      // incoming order city the same way lets the lookup land regardless.
      // MUST stay in sync with `normalizeCityKey` in the quote engine.
      const p = city.toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (!p) continue;
      const key = `${cc}|${p}`;
      if (!seen.has(key)) {
        seen.add(key);
        parsed.push({ countryCode: cc, pattern: p, tier: odaP, origin: 'city' });
      }
    }
    // Else row has neither postcode nor city — skip silently.
  }

  return parsed;
}

async function main(): Promise<void> {
  const args = parseArgs();
  console.log(`[oda-import] file=${args.file}`);
  console.log(`[oda-import] account="${args.account}" apply=${args.apply}`);

  const [account] = await db
    .select({ id: schema.carrierAccounts.id, name: schema.carrierAccounts.name })
    .from(schema.carrierAccounts)
    .where(eq(schema.carrierAccounts.name, args.account));
  if (!account) throw new Error(`Carrier account not found: ${args.account}`);
  console.log(`[oda-import] account id=${account.id}`);

  const rows = parseSheet(args.file);
  console.log(`[oda-import] parsed ${rows.length} rows after expansion + dedup`);

  // Summary by country.
  const byCC = new Map<string, { total: number; postcode: number; range: number; city: number; tiers: Set<string> }>();
  for (const r of rows) {
    if (!byCC.has(r.countryCode)) {
      byCC.set(r.countryCode, { total: 0, postcode: 0, range: 0, city: 0, tiers: new Set() });
    }
    const e = byCC.get(r.countryCode)!;
    e.total++;
    if (r.origin === 'postcode') e.postcode++;
    else if (r.origin === 'postcode_range') e.range++;
    else if (r.origin === 'city') e.city++;
    e.tiers.add(r.tier);
  }
  console.log(`[oda-import] countries: ${byCC.size}`);

  // Touch only countries that appear in this batch — leaves untouched
  // countries (and their existing rows) alone.
  const touchedCountries = [...byCC.keys()];

  if (args.apply) {
    console.log(`[oda-import] deleting existing rows for ${touchedCountries.length} countries…`);
    await db.delete(schema.carrierRemotePostcodes).where(and(
      eq(schema.carrierRemotePostcodes.carrierAccountId, account.id),
      inArray(schema.carrierRemotePostcodes.countryCode, touchedCountries),
    ));
    console.log(`[oda-import] inserting ${rows.length} rows…`);
    const CHUNK = 1000;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const slice = rows.slice(i, i + CHUNK).map((r) => ({
        carrierAccountId: account.id,
        countryCode: r.countryCode,
        postcodePattern: r.pattern,
        tier: r.tier,
        source: `${args.source} · ${r.tier}`,
      }));
      await db.insert(schema.carrierRemotePostcodes).values(slice);
    }

    // ── IL postal-format workaround ──
    // FedEx publishes IL ODA codes in the legacy 5-digit format
    // (10930, 12230-12232) while Israel Post switched to 7-digit in
    // Feb 2013 — Shopify orders carry the new format. The first 5
    // digits of a new 7-digit code do NOT correspond to the old
    // 5-digit code (verified: 0 / 58 sample orders match by prefix).
    //
    // Every IL row in the published file is Tier B (309/309 — never
    // Tier A or C), so until FedEx publishes a 7-digit replacement
    // we insert a single wildcard row that the engine treats as a
    // country-wide default: any IL destination → Tier B.
    //
    // REMOVE this block once FedEx ships an updated 7-digit file and
    // the imported rows correctly match Shopify postcodes.
    if (touchedCountries.includes('IL')) {
      console.log('[oda-import] adding IL wildcard (legacy 5-digit format workaround)');
      await db.insert(schema.carrierRemotePostcodes).values({
        carrierAccountId: account.id,
        countryCode: 'IL',
        postcodePattern: '*',
        tier: 'Tier B',
        source: `${args.source} · Tier B · country-wide wildcard (5-digit format workaround)`,
      });
    }
  }

  // Report.
  console.log('\n========== REPORT ==========');
  console.log('CC | Country (sample)        | Rows | postcode | range-expanded | city | tiers');
  for (const cc of [...byCC.keys()].sort()) {
    const e = byCC.get(cc)!;
    console.log(
      `${cc} | ${cc.padEnd(23)} | ${String(e.total).padStart(5)} | ${String(e.postcode).padStart(8)} | ${String(e.range).padStart(14)} | ${String(e.city).padStart(4)} | ${[...e.tiers].join(',')}`,
    );
  }
  const grand = rows.length;
  console.log(`\nTotal: ${grand} rows across ${byCC.size} countries`);

  console.log(`\n${args.apply ? '✅ APPLIED' : '🔎 DRY-RUN (no writes)'}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => process.exit());
