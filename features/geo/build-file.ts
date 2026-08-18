/**
 * Shared: dựng GeoCountryFile (xem geo-store.ts) + gzip + upload lên Storage.
 * Dùng chung bởi scripts/build-geo-files.ts (rows đã ORDER BY từ Postgres) và
 * scripts/import-geonames.ts (rows tự sort trong JS từ dữ liệu GeoNames tươi tải về,
 * KHÔNG qua DB — geo_cities/geo_postcodes không còn được ghi kể từ Task 4).
 *
 * Parity contract với geo-store/lookup cũ: cities sort theo name asc; postcodes group
 * theo postcodeNorm, city asc trong từng nhóm.
 */
import { gzipSync } from 'node:zlib';
import type { GeoCountryFile } from './geo-store';
import type { GeoCityRow, GeoPostcodeRow } from './geonames-parse';
import { putObject } from '@/lib/storage/s3';

export interface CityInput { name: string; stateCode: string | null }
export interface PostcodeRowInput { postcodeNorm: string; city: string; stateCode: string | null }

/**
 * So sánh string kiểu "binary" trên raw string (KHÔNG dùng localeCompare).
 * Chọn cách này để giữ parity với file build từ build-geo-files.ts, nơi thứ tự đến
 * từ Postgres ORDER BY (collation mặc định của DB này thường là en_US.UTF-8/ICU).
 * Rủi ro: với city/postcode có dấu, binary compare (theo code unit) có thể cho thứ tự
 * KHÁC với collation ICU/en_US thật của Postgres (vd cách sắp xếp chữ có dấu tiếng Việt/
 * Latin mở rộng). Vì lookupPostcode() chỉ dùng thứ tự để chọn candidate đầu tiên khi có
 * nhiều city trùng postcode, lệch thứ tự hiếm khi đổi kết quả nhưng KHÔNG loại trừ hoàn
 * toàn — xem ghi chú parity trong task-4-report.md.
 */
export const rawCompare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Gộp postcodeRows (PHẢI đã sort postcodeNorm asc, city asc trước khi gọi) thành Record
 * group theo postcodeNorm, giữ nguyên thứ tự city trong nhóm. Hàm này KHÔNG tự sort.
 */
export function groupPostcodeRows(rows: PostcodeRowInput[]): GeoCountryFile['postcodes'] {
  const postcodes: GeoCountryFile['postcodes'] = {};
  for (const r of rows) {
    (postcodes[r.postcodeNorm] ??= []).push({ city: r.city, stateCode: r.stateCode });
  }
  return postcodes;
}

/** Dựng GeoCountryFile từ cities + postcodeRows ĐÃ đúng thứ tự (không tự sort ở đây). */
export function buildGeoCountryFile(cities: CityInput[], postcodeRows: PostcodeRowInput[]): GeoCountryFile {
  return {
    cities: cities.map((c) => ({ name: c.name, stateCode: c.stateCode })),
    postcodes: groupPostcodeRows(postcodeRows),
  };
}

/**
 * Dựng GeoCountryFile trực tiếp từ output parseGeonamesZipTsv() (chưa sort) — tự sort
 * trong JS bằng rawCompare trước khi group, dùng cho scripts/import-geonames.ts.
 */
export function buildGeoCountryFileFromParsed(cities: GeoCityRow[], rows: GeoPostcodeRow[]): GeoCountryFile {
  const sortedCities = [...cities].sort((a, b) => rawCompare(a.name, b.name));
  const sortedRows = [...rows].sort(
    (a, b) => rawCompare(a.postcodeNorm, b.postcodeNorm) || rawCompare(a.city, b.city),
  );
  return buildGeoCountryFile(sortedCities, sortedRows);
}

export function gzipGeoCountryFile(file: GeoCountryFile): Buffer {
  return gzipSync(Buffer.from(JSON.stringify(file), 'utf-8'));
}

/** Upload gzip lên Storage key geo-dict/{CC}.json.gz (upsert). */
export async function uploadGeoCountryFile(cc: string, gz: Buffer): Promise<void> {
  await putObject(`geo-dict/${cc.toUpperCase()}.json.gz`, gz, 'application/gzip');
}
