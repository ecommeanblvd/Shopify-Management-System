/**
 * Parity check: geo_cities/geo_postcodes (Postgres, sắp bị drop — Task 5) so với
 * geo-dict files trên Supabase Storage (geoStore) — PHẢI chạy PASS trước khi backup CSV
 * + apply migration drop 2 bảng (xem docs/superpowers/plans/2026-08-18-geo-dict-to-storage.md §Task 5).
 *
 * 2 bảng geo_cities/geo_postcodes được định nghĩa LẠI (inline, ngay dưới) thay vì import
 * từ db/schema.ts — vì Task 5 xoá 2 định nghĩa đó khỏi schema chính (bảng sắp không còn
 * tồn tại trong DB), nhưng script này vẫn cần đọc DB ở lần chạy CUỐI, TRƯỚC KHI migration
 * drop được apply. tsc vẫn sạch vì các pgTable ở đây độc lập với db/schema.ts.
 *
 * So sánh, với mỗi nước trong geo_imports:
 *  - Cities: count DB (geo_cities) == count geoStore.getCities(cc); so khớp mảng ĐẦY ĐỦ
 *    theo đúng thứ tự — nếu lệch thứ tự (DB dùng collation Postgres, geoStore dùng JS
 *    localeCompare) nhưng CÙNG tập hợp → báo ORDER-DIFF (không chặn drop, vấn đề collation
 *    đã biết — xem features/geo/build-file.ts). Lệch TẬP HỢP thật sự → FAIL (chặn).
 *  - Postcodes: sample 200 postcodeNorm ngẫu nhiên (hoặc tất cả nếu nước có < 200) — so
 *    candidates (city/stateCode) DB vs geoStore.getPostcode(cc, norm), cùng logic
 *    ORDER-DIFF/FAIL ở trên.
 *
 * Usage: dotenv -- tsx scripts/verify-geo-parity.ts [--country CC,CC]
 * Mặc định: kiểm tra MỌI nước có trong geo_imports.
 * Exit 0: tất cả PASS (ORDER-DIFF không chặn). Exit 1: có nước FAIL (lệch tập hợp thật).
 */
import { and, asc, eq, inArray } from 'drizzle-orm';
import { numeric, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { db, schema } from '@/db/client';
import { geoStore } from '@/features/geo/geo-store';

// Bản sao độc lập của 2 bảng sắp bị drop — CHỈ dùng để đọc trong script này (xem ghi chú
// ở đầu file). Cấu trúc phải khớp geo_cities/geo_postcodes hiện có trong DB (trước Task 5).
const geoCitiesLocal = pgTable('geo_cities', {
  id: uuid('id').defaultRandom().primaryKey(),
  countryCode: text('country_code').notNull(),
  stateCode: text('state_code'),
  name: text('name').notNull(),
  nameNorm: text('name_norm').notNull(),
});

const geoPostcodesLocal = pgTable('geo_postcodes', {
  id: uuid('id').defaultRandom().primaryKey(),
  countryCode: text('country_code').notNull(),
  postcode: text('postcode').notNull(),
  postcodeNorm: text('postcode_norm').notNull(),
  city: text('city').notNull(),
  stateCode: text('state_code'),
  lat: numeric('lat', { precision: 9, scale: 5 }),
  lng: numeric('lng', { precision: 9, scale: 5 }),
});

const SAMPLE_SIZE = 200;

type Status = 'PASS' | 'ORDER-DIFF' | 'FAIL' | 'SKIP';

interface CountryResult {
  cc: string;
  citiesDbCount: number;
  citiesStoreCount: number;
  citiesStatus: Status;
  postcodesSampled: number;
  postcodesFail: number;
  postcodesOrderDiff: number;
  postcodesStatus: Status;
  errors: string[];
}

function args(): { countries: string[] | null } {
  const ci = process.argv.indexOf('--country');
  if (ci < 0) return { countries: null };
  const list = process.argv[ci + 1] ?? '';
  const countries = list.split(',').map((s) => s.trim().toUpperCase()).filter((s) => /^[A-Z]{2}$/.test(s));
  return { countries: countries.length > 0 ? countries : null };
}

async function listImportedCountries(): Promise<string[]> {
  const rows = await db.select({ cc: schema.geoImports.countryCode }).from(schema.geoImports)
    .orderBy(asc(schema.geoImports.countryCode));
  return rows.map((r) => r.cc);
}

/** Fisher-Yates — chỉ dùng cho mẫu ngẫu nhiên trong JS (tránh ORDER BY random() nặng trên DB). */
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const candKey = (c: { city: string; stateCode: string | null }): string => JSON.stringify([c.city, c.stateCode]);

function arraysEqualOrdered<T>(a: T[], b: T[], key: (x: T) => string): boolean {
  if (a.length !== b.length) return false;
  return a.every((x, i) => key(x) === key(b[i]));
}

function multisetEqual<T>(a: T[], b: T[], key: (x: T) => string): boolean {
  if (a.length !== b.length) return false;
  const ak = a.map(key).sort();
  const bk = b.map(key).sort();
  return ak.every((x, i) => x === bk[i]);
}

async function checkCities(cc: string): Promise<{ status: Status; dbCount: number; storeCount: number; detail?: string }> {
  const dbRows = await db.select({ name: geoCitiesLocal.name })
    .from(geoCitiesLocal).where(eq(geoCitiesLocal.countryCode, cc)).orderBy(asc(geoCitiesLocal.name));
  const dbNames = dbRows.map((r) => r.name);

  const storeNames = await geoStore.getCities(cc);
  if (storeNames === null) {
    return { status: 'FAIL', dbCount: dbNames.length, storeCount: 0, detail: 'geoStore trả null (file Storage thiếu dù geo_imports nói đã nạp)' };
  }

  if (dbNames.length !== storeNames.length) {
    return { status: 'FAIL', dbCount: dbNames.length, storeCount: storeNames.length, detail: `count lệch: DB=${dbNames.length} store=${storeNames.length}` };
  }

  if (arraysEqualOrdered(dbNames, storeNames, (x) => x)) {
    return { status: 'PASS', dbCount: dbNames.length, storeCount: storeNames.length };
  }

  if (multisetEqual(dbNames, storeNames, (x) => x)) {
    return { status: 'ORDER-DIFF', dbCount: dbNames.length, storeCount: storeNames.length, detail: 'thứ tự lệch (collation DB vs localeCompare JS) nhưng CÙNG tập hợp' };
  }

  const dbSet = new Set(dbNames);
  const storeSet = new Set(storeNames);
  const onlyDb = dbNames.filter((n) => !storeSet.has(n)).slice(0, 5);
  const onlyStore = storeNames.filter((n) => !dbSet.has(n)).slice(0, 5);
  return {
    status: 'FAIL', dbCount: dbNames.length, storeCount: storeNames.length,
    detail: `TẬP HỢP lệch — chỉ-DB: [${onlyDb.join(', ')}] chỉ-store: [${onlyStore.join(', ')}]`,
  };
}

async function samplePostcodeNorms(cc: string): Promise<string[]> {
  const rows = await db.selectDistinct({ postcodeNorm: geoPostcodesLocal.postcodeNorm })
    .from(geoPostcodesLocal).where(eq(geoPostcodesLocal.countryCode, cc));
  const all = rows.map((r) => r.postcodeNorm);
  if (all.length <= SAMPLE_SIZE) return all;
  return shuffle(all).slice(0, SAMPLE_SIZE);
}

async function checkPostcodes(
  cc: string, norms: string[],
): Promise<{ status: Status; failCount: number; orderDiffCount: number; details: string[] }> {
  if (norms.length === 0) return { status: 'SKIP', failCount: 0, orderDiffCount: 0, details: [] };

  const rows = await db.select({
    postcodeNorm: geoPostcodesLocal.postcodeNorm, city: geoPostcodesLocal.city, stateCode: geoPostcodesLocal.stateCode,
  }).from(geoPostcodesLocal)
    .where(and(eq(geoPostcodesLocal.countryCode, cc), inArray(geoPostcodesLocal.postcodeNorm, norms)))
    .orderBy(asc(geoPostcodesLocal.postcodeNorm), asc(geoPostcodesLocal.city));

  const byNorm = new Map<string, Array<{ city: string; stateCode: string | null }>>();
  for (const r of rows) {
    let bucket = byNorm.get(r.postcodeNorm);
    if (!bucket) { bucket = []; byNorm.set(r.postcodeNorm, bucket); }
    bucket.push({ city: r.city, stateCode: r.stateCode });
  }

  let failCount = 0;
  let orderDiffCount = 0;
  const details: string[] = [];

  for (const norm of norms) {
    const dbCands = byNorm.get(norm) ?? [];
    const storeCands = await geoStore.getPostcode(cc, norm);
    if (storeCands === null) {
      failCount += 1;
      details.push(`${norm}: geoStore trả null`);
      continue;
    }
    if (arraysEqualOrdered(dbCands, storeCands, candKey)) continue;
    if (multisetEqual(dbCands, storeCands, candKey)) { orderDiffCount += 1; continue; }
    failCount += 1;
    details.push(`${norm}: DB=[${dbCands.map(candKey).join('; ')}] store=[${storeCands.map(candKey).join('; ')}]`);
  }

  const status: Status = failCount > 0 ? 'FAIL' : orderDiffCount > 0 ? 'ORDER-DIFF' : 'PASS';
  return { status, failCount, orderDiffCount, details: details.slice(0, 10) };
}

async function checkCountry(cc: string): Promise<CountryResult> {
  const errors: string[] = [];

  let citiesStatus: Status = 'SKIP';
  let citiesDbCount = 0;
  let citiesStoreCount = 0;
  try {
    const c = await checkCities(cc);
    citiesStatus = c.status; citiesDbCount = c.dbCount; citiesStoreCount = c.storeCount;
    if (c.detail) errors.push(`cities: ${c.detail}`);
  } catch (e) {
    citiesStatus = 'FAIL';
    errors.push(`cities: lỗi khi kiểm tra — ${e instanceof Error ? e.message : String(e)}`);
  }

  let postcodesStatus: Status = 'SKIP';
  let postcodesSampled = 0;
  let postcodesFail = 0;
  let postcodesOrderDiff = 0;
  try {
    const norms = await samplePostcodeNorms(cc);
    postcodesSampled = norms.length;
    const p = await checkPostcodes(cc, norms);
    postcodesStatus = p.status; postcodesFail = p.failCount; postcodesOrderDiff = p.orderDiffCount;
    errors.push(...p.details.map((d) => `postcode ${d}`));
  } catch (e) {
    postcodesStatus = 'FAIL';
    errors.push(`postcodes: lỗi khi kiểm tra — ${e instanceof Error ? e.message : String(e)}`);
  }

  return { cc, citiesDbCount, citiesStoreCount, citiesStatus, postcodesSampled, postcodesFail, postcodesOrderDiff, postcodesStatus, errors };
}

function overallStatus(r: CountryResult): Status {
  if (r.citiesStatus === 'FAIL' || r.postcodesStatus === 'FAIL') return 'FAIL';
  if (r.citiesStatus === 'ORDER-DIFF' || r.postcodesStatus === 'ORDER-DIFF') return 'ORDER-DIFF';
  return 'PASS';
}

async function main(): Promise<void> {
  const { countries } = args();
  const targets = countries ?? await listImportedCountries();

  if (targets.length === 0) {
    process.stdout.write('verify-geo-parity: geo_imports rỗng — không có nước nào để kiểm tra\n');
    return;
  }

  process.stdout.write(`verify-geo-parity: kiểm tra ${targets.length} nước (mẫu tối đa ${SAMPLE_SIZE} postcode/nước)\n\n`);

  const results: CountryResult[] = [];
  for (const cc of targets) {
    const r = await checkCountry(cc);
    results.push(r);
    const status = overallStatus(r);
    process.stdout.write(
      `[${status}] ${r.cc}: cities DB=${r.citiesDbCount}/store=${r.citiesStoreCount} (${r.citiesStatus}) — `
      + `postcodes mẫu=${r.postcodesSampled} lệch=${r.postcodesFail} lệch-thứ-tự=${r.postcodesOrderDiff} (${r.postcodesStatus})\n`,
    );
    for (const e of r.errors) process.stdout.write(`    ${e}\n`);
  }

  const failed = results.filter((r) => overallStatus(r) === 'FAIL');
  const orderDiffs = results.filter((r) => overallStatus(r) === 'ORDER-DIFF');
  const clean = results.length - failed.length - orderDiffs.length;

  process.stdout.write(
    `\nTổng kết: ${results.length} nước — ${clean} PASS sạch, ${orderDiffs.length} ORDER-DIFF (không chặn), ${failed.length} FAIL\n`,
  );

  if (failed.length > 0) {
    process.stdout.write(`\nBLOCKED: nước FAIL (lệch tập hợp thật) — KHÔNG được backup/drop bảng: ${failed.map((r) => r.cc).join(', ')}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write('\nTất cả nước PASS hoặc chỉ ORDER-DIFF (không chặn) — an toàn để backup CSV + apply migration drop bảng.\n');
  }
}

main().catch((err) => { process.stderr.write(`${String(err?.stack ?? err)}\n`); process.exitCode = 1; }).finally(() => process.exit());
