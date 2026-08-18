/**
 * Build & upload geo-dict files — LỊCH SỬ: script này từng đọc geo_cities/geo_postcodes
 * theo nước từ DB, dựng GeoCountryFile (features/geo/geo-store.ts), gzip, ghi ra
 * ./tmp-geo-files/ hoặc upload lên Storage (geo-dict/{CC}.json.gz, upsert).
 *
 * geo_cities/geo_postcodes đã bị DROP khỏi DB (db/migrations/0121_drop-geo-tables.sql —
 * Task 5, xem docs/superpowers/plans/2026-08-18-geo-dict-to-storage.md) sau khi từ điển
 * chuyển hẳn sang Supabase Storage. Đường build-từ-DB KHÔNG còn chạy được nữa.
 *
 * Rebuild lại từ điển: dùng `scripts/import-geonames.ts` — tải tươi từ GeoNames và ghi
 * thẳng geo-dict/{CC}.json.gz lên Storage, không qua DB.
 *
 * File này giữ lại làm CLI lịch sử + `--verify` (đọc round-trip 1 file đã có trên
 * Storage — không đụng DB, vẫn hoạt động bình thường).
 *
 * Usage:
 *   dotenv -- tsx scripts/build-geo-files.ts --verify CC   (round-trip check 1 file đã upload)
 *   dotenv -- tsx scripts/build-geo-files.ts [--country CC,CC] [--upload]  → luôn báo lỗi, xem trên
 */
import { gunzipSync } from 'node:zlib';
import type { GeoCountryFile } from '@/features/geo/geo-store';
import { getObject } from '@/lib/storage/s3';

function args(): { rejected: string[]; verify: string | null } {
  const ci = process.argv.indexOf('--country');
  const list = ci >= 0 ? (process.argv[ci + 1] ?? '') : '';
  const tokens = list ? list.split(',').map((s) => s.trim().toUpperCase()).filter((s) => s.length > 0) : [];
  const rejected = ci >= 0 ? tokens.filter((s) => !/^[A-Z]{2}$/.test(s)) : [];
  const vi = process.argv.indexOf('--verify');
  const verify = vi >= 0 ? (process.argv[vi + 1] ?? '').trim().toUpperCase() : null;
  return { rejected, verify };
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
  const { rejected, verify } = args();

  if (rejected.length > 0) {
    process.stderr.write(`  cảnh báo: bỏ qua mã nước không hợp lệ trong --country: ${rejected.join(', ')}\n`);
  }

  if (verify) {
    if (!/^[A-Z]{2}$/.test(verify)) { process.stderr.write('usage: --verify CC\n'); process.exitCode = 1; return; }
    await verifyCountry(verify);
    return;
  }

  process.stderr.write(
    'build-geo-files: geo_cities/geo_postcodes đã bị XOÁ khỏi DB (db/migrations/0121_drop-geo-tables.sql) '
    + '— script này không còn build được từ DB nữa.\n'
    + 'Dùng `dotenv -- tsx scripts/import-geonames.ts --country CC[,CC...] --apply` để tải lại từ GeoNames '
    + 'và ghi thẳng geo-dict/{CC}.json.gz lên Storage (không qua DB).\n'
    + '(Chỉ `--verify CC` — đọc round-trip 1 file đã có trên Storage — còn hoạt động ở script này.)\n',
  );
  process.exitCode = 1;
}

main().catch((err) => { process.stderr.write(`${String(err?.stack ?? err)}\n`); process.exitCode = 1; }).finally(() => process.exit());
