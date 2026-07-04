/**
 * Import GeoNames postal per-country vào geo_* tables.
 * Usage: dotenv -- tsx scripts/import-geonames.ts --country US,CA,GB [--apply]
 * (mặc định dry-run in số liệu; --apply mới ghi DB)
 *
 * Delete-first per country CHỈ SAU KHI tải + parse OK. Chunk 1000. Idempotent.
 */
import AdmZip from 'adm-zip';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { parseGeonamesZipTsv } from '@/features/geo/geonames-parse';

const CHUNK = 1000;

function args(): { countries: string[]; apply: boolean } {
  const i = process.argv.indexOf('--country');
  const list = i >= 0 ? (process.argv[i + 1] ?? '') : '';
  return {
    countries: list.split(',').map((s) => s.trim().toUpperCase()).filter((s) => /^[A-Z]{2}$/.test(s)),
    apply: process.argv.includes('--apply'),
  };
}

async function fetchTsv(cc: string): Promise<string> {
  const res = await fetch(`https://download.geonames.org/export/zip/${cc}.zip`);
  if (!res.ok) throw new Error(`download ${cc}: HTTP ${res.status}`);
  const zip = new AdmZip(Buffer.from(await res.arrayBuffer()));
  const entry = zip.getEntry(`${cc}.txt`);
  if (!entry) throw new Error(`${cc}.zip thiếu ${cc}.txt`);
  return entry.getData().toString('utf8');
}

async function importCountry(cc: string, apply: boolean): Promise<void> {
  const tsv = await fetchTsv(cc); // lỗi → throw TRƯỚC khi động DB
  const { rows, states, cities, skipped } = parseGeonamesZipTsv(tsv, cc);
  if (rows.length === 0) throw new Error(`${cc}: 0 rows sau parse — nghi file đổi format`);
  process.stdout.write(`${cc}: ${rows.length} postcodes, ${states.length} states, ${cities.length} cities, skip ${skipped}${apply ? '' : ' (dry-run)'}\n`);
  if (!apply) return;

  await db.transaction(async (tx) => {
    await tx.delete(schema.geoPostcodes).where(eq(schema.geoPostcodes.countryCode, cc));
    await tx.delete(schema.geoCities).where(eq(schema.geoCities.countryCode, cc));
    await tx.delete(schema.geoStates).where(eq(schema.geoStates.countryCode, cc));
    for (let i = 0; i < states.length; i += CHUNK) await tx.insert(schema.geoStates).values(states.slice(i, i + CHUNK));
    for (let i = 0; i < cities.length; i += CHUNK) await tx.insert(schema.geoCities).values(cities.slice(i, i + CHUNK));
    for (let i = 0; i < rows.length; i += CHUNK) await tx.insert(schema.geoPostcodes).values(rows.slice(i, i + CHUNK));
    await tx.insert(schema.geoImports).values({ countryCode: cc, rows: rows.length })
      .onConflictDoUpdate({ target: schema.geoImports.countryCode, set: { importedAt: new Date(), rows: rows.length } });
  });
}

async function main(): Promise<void> {
  const { countries, apply } = args();
  if (countries.length === 0) { process.stderr.write('usage: --country US,CA[,...] [--apply]\n'); process.exitCode = 1; return; }
  const errors: string[] = [];
  for (const cc of countries) {
    try { await importCountry(cc, apply); }
    catch (e) { errors.push(`${cc}: ${e instanceof Error ? e.message : String(e)}`); }
  }
  for (const e of errors) process.stderr.write(`  FAIL ${e}\n`);
  if (errors.length) process.exitCode = 1;
}

main().catch((err) => { process.stderr.write(String(err?.stack ?? err) + '\n'); process.exitCode = 1; }).finally(() => process.exit());
