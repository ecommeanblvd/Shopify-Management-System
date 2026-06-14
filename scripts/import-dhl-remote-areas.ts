/* eslint-disable no-console */
/**
 * Import DHL Express "Remote Area List" PDF (post codes + suburb/town names by
 * country) into `carrier_remote_postcodes`, year-versioned via effective_from/to.
 *
 * Structure of the DHL RAL PDF (parsed via pdf-parse):
 *   REMOTE AREA BY COUNTRY
 *   AFGHANISTAN            ← ALL-CAPS country header (exact name in COUNTRY_ISO)
 *   Jalalabad             ← town (Title Case) OR
 *   02000                 ← post code, OR
 *   13093 - 13096         ← post code RANGE (expanded to individual codes)
 *   ALBANIA               ← next country…
 *
 * Two normalisations (same as the FedEx ODA importer, so the engine's single
 * Map lookup hits regardless of source):
 *   1. Post-code ranges → individual codes (engine does Map.get(postcode)).
 *   2. Town names → UPPERCASE + strip non-alphanumeric. MUST stay in sync with
 *      `normalizeCityKey` in the quote engine.
 *
 * Country detection is EXACT-match against COUNTRY_ISO only — an unrecognised
 * ALL-CAPS line is treated as data under the current country, never as a new
 * section. This prevents the cross-country "bleed" that a heuristic header
 * detector causes (e.g. a town leaking from Kuwait into Laos).
 *
 * Idempotent per (account, country, effective_from): re-running one period
 * deletes only that period's rows for the touched countries before insert.
 *
 * Defaults to dry-run. Pass --apply to write.
 *
 * Usage:
 *   pnpm tsx scripts/import-dhl-remote-areas.ts \
 *     --file "/Users/macos/Downloads/dhl-express-remote-area-list-2025.pdf" \
 *     --source "DHL Remote Areas 2025" \
 *     --effective-from 2025-01-01 --effective-to 2026-01-01 [--apply]
 */
import 'dotenv/config';
import { readFileSync } from 'fs';
import { PDFParse } from 'pdf-parse';
import { and, eq, inArray, notLike } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { classifyLine } from '@/features/carrier-rates/engine/dhl-ral-parse';

/** Exact DHL RAL country-header spellings → ISO-3166 alpha-2. */
const COUNTRY_ISO: Record<string, string> = {
  AFGHANISTAN: 'AF', ALBANIA: 'AL', ALGERIA: 'DZ', ANDORRA: 'AD', ANGOLA: 'AO',
  ANTIGUA: 'AG', ARGENTINA: 'AR', AUSTRALIA: 'AU', AUSTRIA: 'AT', BAHAMAS: 'BS',
  BANGLADESH: 'BD', BELARUS: 'BY', BELIZE: 'BZ', BENIN: 'BJ', BHUTAN: 'BT',
  BOLIVIA: 'BO', 'BOSNIA & HERZEGOVINA': 'BA', BOTSWANA: 'BW', BRAZIL: 'BR',
  BRUNEI: 'BN', BULGARIA: 'BG', 'BURKINA FASO': 'BF', CAMBODIA: 'KH',
  CAMEROON: 'CM', CANADA: 'CA', 'CANARY ISLANDS, THE': 'ES', 'CAPE VERDE': 'CV',
  'CAYMAN ISLANDS': 'KY', CHAD: 'TD', CHILE: 'CL', COLOMBIA: 'CO', CONGO: 'CG',
  'CONGO, THE DEM. REP. OF': 'CD', 'COOK ISLANDS': 'CK', 'COSTA RICA': 'CR',
  CROATIA: 'HR', CYPRUS: 'CY', 'CZECH REPUBLIC, THE': 'CZ', DENMARK: 'DK',
  ECUADOR: 'EC', EGYPT: 'EG', 'EL SALVADOR': 'SV', ESTONIA: 'EE', ETHIOPIA: 'ET',
  'FAROE ISLANDS': 'FO', FIJI: 'FJ', FINLAND: 'FI', FRANCE: 'FR',
  'FRENCH GUYANA': 'GF', GABON: 'GA', GAMBIA: 'GM', GERMANY: 'DE', GHANA: 'GH',
  GREECE: 'GR', GREENLAND: 'GL', GUADELOUPE: 'GP', GUATEMALA: 'GT',
  GUERNSEY: 'GG', 'GUINEA REPUBLIC': 'GN', 'GUINEA-EQUATORIAL': 'GQ',
  'GUYANA (BRITISH)': 'GY', HONDURAS: 'HN', HUNGARY: 'HU', ICELAND: 'IS',
  INDIA: 'IN', INDONESIA: 'ID', 'IRAN (ISLAMIC REP. OF)': 'IR',
  'IRELAND, REPUBLIC OF': 'IE', ISRAEL: 'IL', ITALY: 'IT', JAMAICA: 'JM',
  JAPAN: 'JP', JORDAN: 'JO', 'KOREA, REP. OF (S. K.)': 'KR',
  'KOREA, D.P.R OF (N. K.)': 'KP', KAZAKHSTAN: 'KZ', KENYA: 'KE', KOSOVO: 'XK',
  KUWAIT: 'KW', LATVIA: 'LV', LEBANON: 'LB', LESOTHO: 'LS', LIBERIA: 'LR',
  LIBYA: 'LY', LITHUANIA: 'LT', MADAGASCAR: 'MG', MALAWI: 'MW', MALAYSIA: 'MY',
  MALDIVES: 'MV', MALI: 'ML', MALTA: 'MT', MAURITIUS: 'MU', MEXICO: 'MX',
  MONGOLIA: 'MN', 'MONTENEGRO, REP. OF': 'ME', MOROCCO: 'MA', MOZAMBIQUE: 'MZ',
  MYANMAR: 'MM', NAMIBIA: 'NA', NEPAL: 'NP', 'NEW CALEDONIA': 'NC',
  'NEW ZEALAND': 'NZ', NICARAGUA: 'NI', NIGER: 'NE', NIGERIA: 'NG', NIUE: 'NU',
  'NORTH MACEDONIA': 'MK', NORWAY: 'NO', OMAN: 'OM', PAKISTAN: 'PK', PANAMA: 'PA',
  PARAGUAY: 'PY', PERU: 'PE', 'PHILIPPINES, THE': 'PH', POLAND: 'PL',
  PORTUGAL: 'PT', 'PUERTO RICO': 'PR', QATAR: 'QA', ROMANIA: 'RO',
  'RUSSIAN FED., THE': 'RU', SAMOA: 'WS', 'SAUDI ARABIA': 'SA', SENEGAL: 'SN',
  'SERBIA, REPUBLIC OF': 'RS', 'SIERRA LEONE': 'SL', SLOVAKIA: 'SK',
  SLOVENIA: 'SI', 'SOLOMON ISLANDS': 'SB', 'SOUTH AFRICA': 'ZA',
  'SOUTH SUDAN': 'SS', SPAIN: 'ES', 'SRI LANKA': 'LK', 'ST. VINCENT': 'VC',
  SUDAN: 'SD', SWAZILAND: 'SZ', SWEDEN: 'SE', SWITZERLAND: 'CH', SYRIA: 'SY',
  TAHITI: 'PF', 'TAIWAN, CHINA': 'TW', TAJIKISTAN: 'TJ', TANZANIA: 'TZ',
  THAILAND: 'TH', TOGO: 'TG', TONGA: 'TO', 'TRINIDAD AND TOBAGO': 'TT',
  TUNISIA: 'TN', 'TURKS & CAICOS ISLNDS.': 'TC', UGANDA: 'UG', UKRAINE: 'UA',
  'UNITED ARAB EMIRATES': 'AE', 'UNITED KINGDOM': 'GB', 'UNITED STATES, USA': 'US',
  URUGUAY: 'UY', UZBEKISTAN: 'UZ', VANUATU: 'VU', VENEZUELA: 'VE', VIETNAM: 'VN',
  ZAMBIA: 'ZM', ZIMBABWE: 'ZW',
};

interface Args {
  file: string;
  account: string;
  apply: boolean;
  source: string;
  effectiveFrom: string;
  effectiveTo: string | null;
}

function parseArgs(): Args {
  const a = process.argv.slice(2);
  let file = '';
  let account = 'DHL Express Vietnam — Worldwide Export 2026';
  let apply = false;
  let source = 'DHL Remote Areas 2025';
  let effectiveFrom = '2025-01-01';
  let effectiveTo: string | null = '2026-01-01';
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--file') file = a[++i];
    else if (a[i] === '--account') account = a[++i];
    else if (a[i] === '--apply') apply = true;
    else if (a[i] === '--source') source = a[++i];
    else if (a[i] === '--effective-from') effectiveFrom = a[++i];
    else if (a[i] === '--effective-to') effectiveTo = a[++i] === 'null' ? null : a[i];
  }
  if (!file) throw new Error('--file <pdf> is required');
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRe.test(effectiveFrom)) throw new Error(`--effective-from must be YYYY-MM-DD`);
  if (effectiveTo !== null && !dateRe.test(effectiveTo)) throw new Error(`--effective-to must be YYYY-MM-DD or null`);
  return { file, account, apply, source, effectiveFrom, effectiveTo };
}

const SKIP_RE = /^(--\s*\d+\s*of\s*\d+\s*--|remote area list 2025|remote area$|list 2025$|remote area by country$|a remote area is defined|post codes and towns|would attract|effective date)/i;

interface ParsedRow { countryCode: string; pattern: string; origin: 'postcode' | 'postcode_range' | 'town'; }

async function parsePdf(filePath: string): Promise<{ rows: ParsedRow[]; unmappedHeaders: string[]; orphanLines: number }> {
  const buf = readFileSync(filePath);
  const res = await new PDFParse({ data: new Uint8Array(buf) }).getText();
  const lines = res.text.split('\n').map((l) => l.replace(/[ \t ]+/g, ' ').trim());

  const rows: ParsedRow[] = [];
  const seen = new Set<string>();
  const unmapped = new Set<string>();
  let currentCC: string | null = null;
  let orphanLines = 0;

  const add = (cc: string, pattern: string, origin: ParsedRow['origin']) => {
    const key = `${cc}|${pattern}`;
    if (!seen.has(key)) { seen.add(key); rows.push({ countryCode: cc, pattern, origin }); }
  };

  for (const raw of lines) {
    if (!raw || SKIP_RE.test(raw)) continue;

    // Country header? EXACT match against the known list only.
    if (Object.prototype.hasOwnProperty.call(COUNTRY_ISO, raw)) {
      currentCC = COUNTRY_ISO[raw];
      continue;
    }
    // An ALL-CAPS line that's NOT a known country: could be a mislabeled header.
    if (/^[A-Z][A-Z .,'&()\-]{3,}$/.test(raw) && /[A-Z]{4}/.test(raw) && !/[0-9]/.test(raw)) {
      unmapped.add(raw);
      // fall through: still attribute as a town under currentCC (towns CAN be all-caps)
    }

    if (!currentCC) { orphanLines++; continue; }
    const cc = currentCC;

    const cls = classifyLine(raw);
    if (cls.kind === 'town') {
      if (cls.value) add(cc, cls.value, 'town');
    } else if (cls.kind === 'postcode') {
      // Drop bare ≤3-char numeric prefixes (JP lists area prefixes like "104"
      // that the engine's prefix-lookup would over-match onto every 104-xxxx
      // Tokyo address — DHL bills them non-remote). Keep real postcodes (≥4).
      if (cls.value.length >= 4) add(cc, cls.value, 'postcode');
    } else {
      for (const p of cls.values) add(cc, p, 'postcode_range');
    }
  }
  return { rows, unmappedHeaders: [...unmapped], orphanLines };
}

async function main(): Promise<void> {
  const args = parseArgs();
  console.log(`[dhl-ral] file=${args.file}`);
  console.log(`[dhl-ral] account="${args.account}" apply=${args.apply} period=${args.effectiveFrom}..${args.effectiveTo ?? '∞'}`);

  const [account] = await db
    .select({ id: schema.carrierAccounts.id, name: schema.carrierAccounts.name })
    .from(schema.carrierAccounts)
    .where(eq(schema.carrierAccounts.name, args.account));
  if (!account) throw new Error(`Carrier account not found: ${args.account}`);

  const { rows, unmappedHeaders, orphanLines } = await parsePdf(args.file);
  console.log(`[dhl-ral] parsed ${rows.length} rows; orphan(before first country)=${orphanLines}; unmapped-ALLCAPS=${unmappedHeaders.length}`);
  if (unmappedHeaders.length) console.log('  unmapped ALL-CAPS (attributed as towns):', unmappedHeaders.slice(0, 40).join(' | '));

  const byCC = new Map<string, { total: number; postcode: number; range: number; town: number }>();
  for (const r of rows) {
    const e = byCC.get(r.countryCode) ?? { total: 0, postcode: 0, range: 0, town: 0 };
    e.total++;
    if (r.origin === 'postcode') e.postcode++;
    else if (r.origin === 'postcode_range') e.range++;
    else e.town++;
    byCC.set(r.countryCode, e);
  }
  const touched = [...byCC.keys()];
  console.log(`[dhl-ral] countries: ${touched.length}`);

  if (args.apply) {
    console.log(`[dhl-ral] deleting period ${args.effectiveFrom} rows for ${touched.length} countries…`);
    await db.delete(schema.carrierRemotePostcodes).where(and(
      eq(schema.carrierRemotePostcodes.carrierAccountId, account.id),
      inArray(schema.carrierRemotePostcodes.countryCode, touched),
      eq(schema.carrierRemotePostcodes.effectiveFrom, args.effectiveFrom),
      // Never delete manual evidence-based corrections — they coexist with the
      // official list (same period) and represent billed-invoice fixes.
      notLike(schema.carrierRemotePostcodes.source, 'manual%'),
    ));
    console.log(`[dhl-ral] inserting ${rows.length} rows…`);
    const CHUNK = 1000;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const slice = rows.slice(i, i + CHUNK).map((r) => ({
        carrierAccountId: account.id,
        countryCode: r.countryCode,
        postcodePattern: r.pattern,
        tier: null,
        source: args.source,
        effectiveFrom: args.effectiveFrom,
        effectiveTo: args.effectiveTo,
      }));
      await db.insert(schema.carrierRemotePostcodes).values(slice);
    }
  }

  console.log('\n========== REPORT (by country) ==========');
  console.log('CC | total | postcode | range-exp | town');
  for (const cc of touched.sort()) {
    const e = byCC.get(cc)!;
    console.log(`${cc} | ${String(e.total).padStart(6)} | ${String(e.postcode).padStart(8)} | ${String(e.range).padStart(9)} | ${String(e.town).padStart(5)}`);
  }
  console.log(`\nTotal: ${rows.length} rows across ${touched.length} countries`);
  console.log(`\n${args.apply ? '✅ APPLIED' : '🔎 DRY-RUN (no writes)'}`);
}

// Run only as a CLI entry point — importing classifyLine in tests must not
// trigger the DB import.
if (process.argv[1]?.includes('import-dhl-remote-areas')) {
  main().catch((e) => { console.error(e); process.exit(1); }).finally(() => process.exit());
}
