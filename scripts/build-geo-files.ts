/**
 * Build & upload geo-dict files: đọc geo_cities/geo_postcodes theo nước từ DB,
 * dựng GeoCountryFile (features/geo/geo-store.ts), gzip, ghi ra ./tmp-geo-files/
 * (kiểm tra) hoặc upload lên Storage (geo-dict/{CC}.json.gz, upsert).
 *
 * Order phải khớp query cũ (parity contract với geo-store):
 * cities by name asc; postcodes order theo (postcodeNorm asc, city asc) rồi group theo postcodeNorm.
 *
 * Usage:
 *   dotenv -- tsx scripts/build-geo-files.ts [--country CC,CC] [--upload]
 *   dotenv -- tsx scripts/build-geo-files.ts --verify CC   (round-trip check 1 file đã upload)
 * Mặc định: build tất cả nước có trong geo_imports. Không --upload → chỉ ghi file cục bộ.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import { asc, eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import type { GeoCountryFile } from '@/features/geo/geo-store';
import { getObject, putObject } from '@/lib/storage/s3';

const OUT_DIR = './tmp-geo-files';

function args(): { countries: string[] | null; upload: boolean; verify: string | null } {
  const ci = process.argv.indexOf('--country');
  const list = ci >= 0 ? (process.argv[ci + 1] ?? '') : '';
  const countries = list
    ? list.split(',').map((s) => s.trim().toUpperCase()).filter((s) => /^[A-Z]{2}$/.test(s))
    : null;
  const vi = process.argv.indexOf('--verify');
  const verify = vi >= 0 ? (process.argv[vi + 1] ?? '').trim().toUpperCase() : null;
  return { countries, upload: process.argv.includes('--upload'), verify };
}

async function listImportedCountries(): Promise<string[]> {
  const rows = await db.select({ cc: schema.geoImports.countryCode }).from(schema.geoImports)
    .orderBy(asc(schema.geoImports.countryCode));
  return rows.map((r) => r.cc);
}

async function buildCountryFile(cc: string): Promise<{ file: GeoCountryFile; cityRows: number; postcodeRows: number }> {
  const cities = await db.select({ name: schema.geoCities.name, stateCode: schema.geoCities.stateCode })
    .from(schema.geoCities).where(eq(schema.geoCities.countryCode, cc)).orderBy(asc(schema.geoCities.name));

  // Order theo (postcodeNorm, city) rồi group tuần tự — giữ city asc trong từng nhóm, khớp lookupPostcode() cũ.
  const postcodeRows = await db.select({
    postcodeNorm: schema.geoPostcodes.postcodeNorm,
    city: schema.geoPostcodes.city,
    stateCode: schema.geoPostcodes.stateCode,
  }).from(schema.geoPostcodes).where(eq(schema.geoPostcodes.countryCode, cc))
    .orderBy(asc(schema.geoPostcodes.postcodeNorm), asc(schema.geoPostcodes.city));

  const postcodes: GeoCountryFile['postcodes'] = {};
  for (const r of postcodeRows) {
    (postcodes[r.postcodeNorm] ??= []).push({ city: r.city, stateCode: r.stateCode });
  }

  return {
    file: { cities: cities.map((c) => ({ name: c.name, stateCode: c.stateCode })), postcodes },
    cityRows: cities.length,
    postcodeRows: postcodeRows.length,
  };
}

async function processCountry(cc: string, upload: boolean): Promise<number> {
  const { file, cityRows, postcodeRows } = await buildCountryFile(cc);
  const gz = gzipSync(Buffer.from(JSON.stringify(file), 'utf-8'));
  process.stdout.write(
    `${cc}: ${cityRows} cities, ${postcodeRows} postcodes → ${(gz.length / 1024).toFixed(1)} KB gz`
    + `${upload ? ' (uploading...)' : ''}\n`,
  );

  if (upload) {
    await putObject(`geo-dict/${cc}.json.gz`, gz, 'application/gzip');
  } else {
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(`${OUT_DIR}/${cc}.json.gz`, gz);
  }
  return gz.length;
}

async function verifyCountry(cc: string): Promise<void> {
  const bytes = await getObject(`geo-dict/${cc}.json.gz`);
  const json = gunzipSync(Buffer.from(bytes)).toString('utf-8');
  const parsed = JSON.parse(json) as GeoCountryFile;
  process.stdout.write(
    `verify ${cc}: OK — cities=${parsed.cities.length}, postcodeKeys=${Object.keys(parsed.postcodes).length}\n`,
  );
}

async function main(): Promise<void> {
  const { countries, upload, verify } = args();

  if (verify) {
    if (!/^[A-Z]{2}$/.test(verify)) { process.stderr.write('usage: --verify CC\n'); process.exitCode = 1; return; }
    await verifyCountry(verify);
    return;
  }

  const targets = countries ?? await listImportedCountries();
  if (targets.length === 0) {
    process.stdout.write('build-geo-files: chưa có nước nào trong geo_imports — bỏ qua\n');
    return;
  }

  process.stdout.write(`build-geo-files: ${targets.length} nước (${upload ? 'upload lên Storage' : `ghi ra ${OUT_DIR}`})\n`);
  const errors: string[] = [];
  let totalGz = 0;
  for (const cc of targets) {
    try {
      totalGz += await processCountry(cc, upload);
    } catch (e) {
      errors.push(`${cc}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  process.stdout.write(`Tổng: ${(totalGz / 1024 / 1024).toFixed(2)} MB gz, ${targets.length - errors.length}/${targets.length} nước OK\n`);
  for (const e of errors) process.stderr.write(`  FAIL ${e}\n`);
  if (errors.length) process.exitCode = 1;
}

main().catch((err) => { process.stderr.write(String(err?.stack ?? err) + '\n'); process.exitCode = 1; }).finally(() => process.exit());
