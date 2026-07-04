# Geo Master P1 — schema + importer GeoNames + queries — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps dùng checkbox (`- [ ]`).
> Spec: `docs/superpowers/specs/2026-07-04-geo-master-design.md` (§3–§5, §7).

**Goal:** 4 bảng geo (states/cities/postcodes/imports) + importer GeoNames per-country (delete-first, chunk 1000) + queries lookup/validate thuần + cron refresh. CHƯA có API/UI (P2/P3).

**Architecture:** Migration tay `0088` + journal; parser TSV thuần (test đầy đủ); script import tải `download.geonames.org/export/zip/{CC}.zip` (adm-zip); queries mỏng + helper thuần. Migration/nạp prod CHỈ chạy sau khi user xác nhận (sau merge).

**Tech Stack:** Drizzle (Postgres), tsx script, adm-zip, Vitest.

## Global Constraints

- Migration số **0088**, tag `0088_geo-master`, journal idx 88 (pattern 0087).
- Normalize DÙNG CHUNG quy tắc quote engine: postcodeNorm = `toUpperCase().replace(/[^A-Z0-9]/g,'')`; cityNorm tương tự trên tên city.
- Import **delete-first per country CHỈ SAU KHI tải + parse OK** (lỗi mạng/parse → abort nước đó, giữ data cũ).
- Idempotent: chạy 2 lần = 1 kết quả. Chunk 1000 (pattern `import-fedex-oda.ts`).
- KHÔNG chạy migration/nạp vào prod trong lúc build — chỉ file + test. Apply sau merge khi user xác nhận.
- Thêm dependency: `adm-zip` (deps) + `@types/adm-zip` (devDeps).

---

### Task 1: Schema 4 bảng + migration 0088

**Files:** Modify `db/schema.ts` · Create `db/migrations/0088_geo-master.sql` · Modify `db/migrations/meta/_journal.json`

**Interfaces (Produces):** `geoStates`, `geoCities`, `geoPostcodes`, `geoImports` export từ schema.

- [ ] **Step 1: Thêm vào cuối `db/schema.ts`**

```ts
// ---------- Geo master (spec 2026-07-04-geo-master-design.md §3) ----------
// Nguồn GeoNames per-country; nước chưa nạp → app fallback static lib/geo.

export const geoStates = pgTable('geo_states', {
  id: uuid('id').defaultRandom().primaryKey(),
  countryCode: text('country_code').notNull(), // ISO-3166-1 alpha-2
  code: text('code').notNull(),                // admin1 code (vd 'CA')
  name: text('name').notNull(),
}, (t) => [
  uniqueIndex('geo_states_country_code_uq').on(t.countryCode, t.code),
]);

export const geoCities = pgTable('geo_cities', {
  id: uuid('id').defaultRandom().primaryKey(),
  countryCode: text('country_code').notNull(),
  stateCode: text('state_code'),
  name: text('name').notNull(),
  nameNorm: text('name_norm').notNull(), // UPPERCASE alnum — khớp quote engine
}, (t) => [
  uniqueIndex('geo_cities_uq').on(t.countryCode, t.stateCode, t.nameNorm),
  index('geo_cities_country_idx').on(t.countryCode),
]);

export const geoPostcodes = pgTable('geo_postcodes', {
  id: uuid('id').defaultRandom().primaryKey(),
  countryCode: text('country_code').notNull(),
  postcode: text('postcode').notNull(),       // raw như GeoNames
  postcodeNorm: text('postcode_norm').notNull(),
  city: text('city').notNull(),
  stateCode: text('state_code'),
  lat: numeric('lat', { precision: 9, scale: 5 }),
  lng: numeric('lng', { precision: 9, scale: 5 }),
}, (t) => [
  uniqueIndex('geo_postcodes_uq').on(t.countryCode, t.postcodeNorm, t.city),
  index('geo_postcodes_lookup_idx').on(t.countryCode, t.postcodeNorm),
]);

export const geoImports = pgTable('geo_imports', {
  id: uuid('id').defaultRandom().primaryKey(),
  countryCode: text('country_code').notNull().unique(),
  source: text('source').notNull().default('geonames'),
  importedAt: timestamp('imported_at').defaultNow().notNull(),
  rows: integer('rows').notNull().default(0),
});
```
(Kiểm import `uniqueIndex` đã có ở đầu schema.ts — nếu chưa, thêm vào import drizzle pg-core.)

- [ ] **Step 2: Migration `db/migrations/0088_geo-master.sql`**

```sql
CREATE TABLE "geo_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"country_code" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "geo_cities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"country_code" text NOT NULL,
	"state_code" text,
	"name" text NOT NULL,
	"name_norm" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "geo_postcodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"country_code" text NOT NULL,
	"postcode" text NOT NULL,
	"postcode_norm" text NOT NULL,
	"city" text NOT NULL,
	"state_code" text,
	"lat" numeric(9, 5),
	"lng" numeric(9, 5)
);
--> statement-breakpoint
CREATE TABLE "geo_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"country_code" text NOT NULL,
	"source" text DEFAULT 'geonames' NOT NULL,
	"imported_at" timestamp DEFAULT now() NOT NULL,
	"rows" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "geo_imports_country_code_unique" UNIQUE("country_code")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "geo_states_country_code_uq" ON "geo_states" ("country_code","code");
--> statement-breakpoint
CREATE UNIQUE INDEX "geo_cities_uq" ON "geo_cities" ("country_code","state_code","name_norm");
--> statement-breakpoint
CREATE INDEX "geo_cities_country_idx" ON "geo_cities" ("country_code");
--> statement-breakpoint
CREATE UNIQUE INDEX "geo_postcodes_uq" ON "geo_postcodes" ("country_code","postcode_norm","city");
--> statement-breakpoint
CREATE INDEX "geo_postcodes_lookup_idx" ON "geo_postcodes" ("country_code","postcode_norm");
```

- [ ] **Step 3: Journal** — append entry `{ "idx": 88, "version": "7", "when": <epoch ms hợp lệ tăng dần>, "tag": "0088_geo-master", "breakpoints": true }` vào `db/migrations/meta/_journal.json`.

- [ ] **Step 4: tsc + commit** — `npx tsc --noEmit` → 0. KHÔNG chạy db:migrate.

```bash
git add db/schema.ts db/migrations/0088_geo-master.sql db/migrations/meta/_journal.json
git commit -m "feat(geo): schema geo master (states/cities/postcodes/imports) + migration 0088"
```

---

### Task 2: Parser + normalize thuần + test

**Files:** Create `features/geo/geonames-parse.ts` · Test `features/geo/geonames-parse.test.ts`

**Interfaces (Produces):** `normPostcode(s)`, `normCity(s)`, `parseGeonamesZipTsv(tsv, country)` → `{ rows: GeoPostcodeRow[]; states: GeoStateRow[]; cities: GeoCityRow[]; skipped: number }`.

- [ ] **Step 1: Test (FAIL trước)**

```ts
// features/geo/geonames-parse.test.ts
import { describe, it, expect } from 'vitest';
import { normPostcode, normCity, parseGeonamesZipTsv } from './geonames-parse';

// Format GeoNames zip TSV (12 cột): country, postal, place, admin1name, admin1code,
// admin2name, admin2code, admin3name, admin3code, lat, lng, accuracy
const TSV = [
  'US\t90210\tBeverly Hills\tCalifornia\tCA\tLos Angeles\t037\t\t\t34.0901\t-118.4065\t4',
  'US\t10001\tNew York\tNew York\tNY\tNew York\t061\t\t\t40.7484\t-73.9967\t4',
  'US\t90210\tBeverly Hills\tCalifornia\tCA\tLos Angeles\t037\t\t\t34.0901\t-118.4065\t4', // dup
  'US\tbad-line-thiếu-cột', // lỗi → skip
  'GB\tSW1A 1AA\tLondon\tEngland\tENG\t\t\t\t\t51.501\t-0.1416\t6', // country khác filter
].join('\n');

describe('norm', () => {
  it('postcode: upper + alnum', () => {
    expect(normPostcode('sw1a 1aa')).toBe('SW1A1AA');
    expect(normPostcode('90210-1234')).toBe('902101234');
  });
  it('city: upper + alnum', () => { expect(normCity('Beverly Hills')).toBe('BEVERLYHILLS'); });
});

describe('parseGeonamesZipTsv', () => {
  it('parse đúng cột, dedup, skip dòng lỗi, filter country', () => {
    const r = parseGeonamesZipTsv(TSV, 'US');
    expect(r.rows).toHaveLength(2); // dup bị loại
    expect(r.rows[0]).toMatchObject({
      countryCode: 'US', postcode: '90210', postcodeNorm: '90210',
      city: 'Beverly Hills', stateCode: 'CA', lat: '34.09010', lng: '-118.40650',
    });
    expect(r.skipped).toBe(1); // dòng lỗi
    expect(r.states).toEqual([
      { countryCode: 'US', code: 'CA', name: 'California' },
      { countryCode: 'US', code: 'NY', name: 'New York' },
    ]);
    expect(r.cities.map((c) => c.nameNorm)).toEqual(['BEVERLYHILLS', 'NEWYORK']);
  });
  it('admin1 code rỗng → stateCode null, vẫn nhận', () => {
    const r = parseGeonamesZipTsv('AE\t00000\tDubai\t\t\t\t\t\t\t25.2\t55.3\t4', 'AE');
    expect(r.rows[0].stateCode).toBeNull();
    expect(r.states).toHaveLength(0);
  });
});
```

- [ ] **Step 2: FAIL** — `npx vitest run features/geo/geonames-parse.test.ts`

- [ ] **Step 3: Implement**

```ts
// features/geo/geonames-parse.ts
/** THUẦN: parse GeoNames postal TSV + normalize (khớp quote engine). Không I/O. */

export const normPostcode = (s: string): string => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
export const normCity = (s: string): string => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

export interface GeoPostcodeRow {
  countryCode: string; postcode: string; postcodeNorm: string;
  city: string; stateCode: string | null; lat: string | null; lng: string | null;
}
export interface GeoStateRow { countryCode: string; code: string; name: string }
export interface GeoCityRow { countryCode: string; stateCode: string | null; name: string; nameNorm: string }

const fixed5 = (s: string): string | null => {
  const n = Number(s);
  return Number.isFinite(n) ? n.toFixed(5) : null;
};

/** Parse TSV GeoNames (12 cột), chỉ giữ dòng đúng country; dedup theo (postcodeNorm, cityNorm). */
export function parseGeonamesZipTsv(tsv: string, country: string) {
  const rows: GeoPostcodeRow[] = [];
  const stateMap = new Map<string, GeoStateRow>();
  const cityMap = new Map<string, GeoCityRow>();
  const seen = new Set<string>();
  let skipped = 0;

  for (const line of tsv.split('\n')) {
    if (!line.trim()) continue;
    const c = line.split('\t');
    if (c.length < 11) { skipped++; continue; }
    const [cc, postal, place, admin1Name, admin1Code, , , , , lat, lng] = c;
    if (cc !== country) continue;
    if (!postal || !place) { skipped++; continue; }
    const stateCode = admin1Code?.trim() ? admin1Code.trim() : null;
    const key = `${normPostcode(postal)}|${normCity(place)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      countryCode: cc, postcode: postal, postcodeNorm: normPostcode(postal),
      city: place, stateCode, lat: fixed5(lat), lng: fixed5(lng),
    });
    if (stateCode && admin1Name?.trim()) {
      stateMap.set(stateCode, { countryCode: cc, code: stateCode, name: admin1Name.trim() });
    }
    const cityKey = `${stateCode ?? ''}|${normCity(place)}`;
    if (!cityMap.has(cityKey)) {
      cityMap.set(cityKey, { countryCode: cc, stateCode, name: place, nameNorm: normCity(place) });
    }
  }
  return { rows, states: [...stateMap.values()], cities: [...cityMap.values()], skipped };
}
```

- [ ] **Step 4: PASS + tsc + commit**

```bash
git add features/geo/geonames-parse.ts features/geo/geonames-parse.test.ts
git commit -m "feat(geo): parser GeoNames TSV thuần + normalize khớp quote engine"
```

---

### Task 3: Importer script + cron

**Files:** Create `scripts/import-geonames.ts` · Create `scripts/cron/sync-geo.ts` · Create `railway.cron-geo.json` · Modify `package.json`

**Interfaces:**
- Consumes: `parseGeonamesZipTsv` (T2); `db, schema` (`@/db/client` — kiểm path import script hiện có: `import-fedex-oda.ts` dùng gì thì theo đó); adm-zip.
- Produces: `npm run import:geonames -- --country US,CA` + `npm run cron:sync-geo`.

- [ ] **Step 1: Cài dependency**

```bash
npm i adm-zip && npm i -D @types/adm-zip
```

- [ ] **Step 2: `scripts/import-geonames.ts`**

```ts
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
```
(Kiểm alias `@/` có chạy trong scripts/ — các script hiện có dùng kiểu import nào thì theo y hệt, vd relative `../db/client`.)

- [ ] **Step 3: `scripts/cron/sync-geo.ts`** — re-import các nước đã có trong `geo_imports` (pattern sync-lifecycle):

```ts
/**
 * Cron: refresh geo master cho các nước đã nạp (geo_imports). Railway monthly.
 * Exit 0 xong; 1 fatal.
 */
import { db, schema } from '@/db/client';

async function main(): Promise<void> {
  const imported = await db.select({ cc: schema.geoImports.countryCode }).from(schema.geoImports);
  if (imported.length === 0) { process.stdout.write('sync-geo: chưa có nước nào — bỏ qua\n'); return; }
  const { spawnSync } = await import('node:child_process');
  const list = imported.map((r) => r.cc).join(',');
  const r = spawnSync('npx', ['tsx', 'scripts/import-geonames.ts', '--country', list, '--apply'], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`import-geonames exit ${r.status}`);
}

main().catch((err) => { process.stderr.write(`sync-geo: fatal: ${err instanceof Error ? err.stack : String(err)}\n`); process.exitCode = 1; }).finally(() => process.exit());
```

- [ ] **Step 4: Wiring** — `railway.cron-geo.json` (copy shape `railway.cron-lifecycle.json`, startCommand `npm run cron:sync-geo`); package.json thêm:
```json
    "import:geonames": "dotenv -- tsx scripts/import-geonames.ts",
    "cron:sync-geo": "dotenv -- tsx scripts/cron/sync-geo.ts"
```

- [ ] **Step 5: Dry-run thật (không ghi DB)** — `npx tsx scripts/import-geonames.ts --country US` (KHÔNG --apply): kỳ vọng in `US: ~40000+ postcodes...` (tải mạng thật, parse OK). Nếu môi trường chặn mạng → báo lại, đừng bỏ qua im lặng.

- [ ] **Step 6: tsc + commit**

```bash
git add scripts/import-geonames.ts scripts/cron/sync-geo.ts railway.cron-geo.json package.json package-lock.json
git commit -m "feat(geo): importer GeoNames per-country (dry-run/apply, delete-first, chunk 1000) + cron sync-geo"
```

---

### Task 4: Queries lookup/validate + test helper thuần

**Files:** Create `features/geo/queries.ts` · Create `features/geo/lookup-logic.ts` · Test `features/geo/lookup-logic.test.ts`

**Interfaces (Produces):**
- `lookup-logic.ts` (thuần): `pickLookupResult(cands: Array<{city:string; stateCode:string|null}>): { valid: boolean; city: string|null; stateCode: string|null; candidates: Array<{city:string; stateCode:string|null}> }` — rỗng→invalid; 1→city/state; nhiều→dòng đầu + candidates đủ.
- `queries.ts` (mỏng): `isCountryImported(cc)`, `listStates(cc)`, `listCities(cc, state?)` (DB → fallback `CITIES_BY_ISO[cc] ?? []` khi chưa import), `lookupPostcode(cc, code)` (norm bằng `normPostcode` → select `geo_postcodes` → `pickLookupResult`; nước chưa import → `{ valid: null, ... }` nghĩa "không biết").

- [ ] **Step 1: Test lookup-logic (FAIL trước)**

```ts
// features/geo/lookup-logic.test.ts
import { describe, it, expect } from 'vitest';
import { pickLookupResult } from './lookup-logic';

describe('pickLookupResult', () => {
  it('rỗng → invalid', () => {
    expect(pickLookupResult([])).toEqual({ valid: false, city: null, stateCode: null, candidates: [] });
  });
  it('1 kết quả → valid + city/state', () => {
    const r = pickLookupResult([{ city: 'Beverly Hills', stateCode: 'CA' }]);
    expect(r).toMatchObject({ valid: true, city: 'Beverly Hills', stateCode: 'CA' });
  });
  it('nhiều → dòng đầu + candidates đầy đủ', () => {
    const r = pickLookupResult([
      { city: 'A', stateCode: 'X' }, { city: 'B', stateCode: 'X' },
    ]);
    expect(r.valid).toBe(true);
    expect(r.city).toBe('A');
    expect(r.candidates).toHaveLength(2);
  });
});
```

- [ ] **Step 2: FAIL → implement**

```ts
// features/geo/lookup-logic.ts
/** THUẦN: chọn kết quả lookup postcode từ danh sách ứng viên. */
export interface GeoCandidate { city: string; stateCode: string | null }
export interface GeoLookupResult {
  valid: boolean; city: string | null; stateCode: string | null; candidates: GeoCandidate[];
}
export function pickLookupResult(cands: GeoCandidate[]): GeoLookupResult {
  if (cands.length === 0) return { valid: false, city: null, stateCode: null, candidates: [] };
  return { valid: true, city: cands[0].city, stateCode: cands[0].stateCode, candidates: cands };
}
```

```ts
// features/geo/queries.ts
import { and, asc, eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { CITIES_BY_ISO } from '@/lib/geo/cities';
import { normPostcode } from './geonames-parse';
import { pickLookupResult, type GeoLookupResult } from './lookup-logic';

export async function isCountryImported(cc: string): Promise<boolean> {
  const [r] = await db.select({ id: schema.geoImports.id }).from(schema.geoImports)
    .where(eq(schema.geoImports.countryCode, cc)).limit(1);
  return !!r;
}

export async function listStates(cc: string): Promise<Array<{ code: string; name: string }>> {
  return db.select({ code: schema.geoStates.code, name: schema.geoStates.name })
    .from(schema.geoStates).where(eq(schema.geoStates.countryCode, cc)).orderBy(asc(schema.geoStates.name));
}

/** DB khi đã import; fallback curated static khi chưa (không vỡ MMP hiện tại). */
export async function listCities(cc: string, state?: string): Promise<string[]> {
  if (!(await isCountryImported(cc))) return CITIES_BY_ISO[cc] ?? [];
  const conds = [eq(schema.geoCities.countryCode, cc)];
  if (state) conds.push(eq(schema.geoCities.stateCode, state));
  const rows = await db.select({ name: schema.geoCities.name }).from(schema.geoCities)
    .where(and(...conds)).orderBy(asc(schema.geoCities.name));
  return rows.map((r) => r.name);
}

/** valid=null nghĩa "nước chưa nạp — không biết" (form không chặn). */
export async function lookupPostcode(cc: string, code: string): Promise<GeoLookupResult & { valid: boolean | null }> {
  if (!(await isCountryImported(cc))) return { valid: null, city: null, stateCode: null, candidates: [] };
  const rows = await db.select({ city: schema.geoPostcodes.city, stateCode: schema.geoPostcodes.stateCode })
    .from(schema.geoPostcodes)
    .where(and(eq(schema.geoPostcodes.countryCode, cc), eq(schema.geoPostcodes.postcodeNorm, normPostcode(code))))
    .orderBy(asc(schema.geoPostcodes.city));
  return pickLookupResult(rows);
}
```

- [ ] **Step 3: PASS + tsc + commit**

```bash
git add features/geo/lookup-logic.ts features/geo/lookup-logic.test.ts features/geo/queries.ts
git commit -m "feat(geo): queries lookup/validate (fallback nước chưa nạp) + logic thuần"
```

---

## Sau merge (KHÔNG thuộc plan — cần user xác nhận vì ghi prod)

1. `railway run npm run db:migrate` (áp 0088).
2. `railway run npm run import:geonames -- --country <20 nước> --apply` (nạp lần đầu).
3. Tạo service cron `cron-sync-geo` trên Railway (config `railway.cron-geo.json`, schedule tháng/lần) — user tự tạo như cron lifecycle.

## Self-Review (đã chạy)

- **Spec coverage:** 4 bảng §3 (T1) ✓ · importer §4 delete-first-sau-parse + chunk + idempotent (T3) ✓ · queries lookup/validate + fallback §5 (T4) ✓ · normalize khớp quote engine (T2) ✓ · không đụng remote-area ✓.
- **Placeholder scan:** sạch; mọi step có code/SQL thật.
- **Type consistency:** `GeoPostcodeRow.lat/lng: string|null` (numeric drizzle nhận string) khớp `fixed5`; `parseGeonamesZipTsv` dùng ở T3; `normPostcode` dùng ở T4; tên bảng schema khớp SQL 0088.
- **Rủi ro:** alias `@/` trong scripts — implementer kiểm script hiện có rồi theo; mạng khi dry-run US (T3 step 5) — nếu bị chặn thì báo; transaction lớn (~50k row/nước) chấp nhận được (chunk trong 1 tx, pattern hiện có).
