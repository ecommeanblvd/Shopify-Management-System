import XLSX from 'xlsx';

const FEDEX = '/Users/macos/Downloads/ODA_OPA_postal_codes.xlsx';
const DHL   = '/Users/macos/Downloads/dhl_express_remote_areas_en.xlsx';

const ME = new Set(['SA', 'QA', 'AE', 'KW', 'BH', 'OM', 'JO', 'IL']);

function readSheet(path, sheetName, headerRow) {
  const wb = XLSX.readFile(path);
  const ws = wb.Sheets[sheetName];
  // header:1 → 2D array, then slice from headerRow.
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: false });
  const headers = rows[headerRow].map((h) => String(h ?? '').trim());
  const data = rows.slice(headerRow + 1).map((r) => {
    const o = {};
    headers.forEach((h, i) => { o[h] = r[i]; });
    return o;
  });
  return { headers, data };
}

console.log('============ FedEx ODA / OPA ============');
const fx = readSheet(FEDEX, 'OPA ODA Postal Codes', 2);
console.log('Headers:', fx.headers);
console.log('Total rows:', fx.data.length);

// Group by country code; count rows where ODA Parcel = Yes
const fxByCountry = new Map();
for (const r of fx.data) {
  const cc = r['Country Code'];
  if (!cc) continue;
  if (!fxByCountry.has(cc)) {
    fxByCountry.set(cc, { name: r['Country '] ?? r['Country'] ?? cc, total: 0, odaParcelYes: 0, opaParcelYes: 0 });
  }
  const e = fxByCountry.get(cc);
  e.total++;
  // ODA Parcel = column index 6 → IntraCountry Out-of-Delivery Area Surcharge / Parcel
  // OPA Parcel = column index 4
  // Header names had duplicate "IntraCountry Parcel Services" — use index map.
  if (r['IntraCountry Parcel Services'] === 'Yes') e.odaParcelYes++;  // last-overwritten by ODA bucket
}
// Re-do with index access because two headers collide on the name.
const wb = XLSX.readFile(FEDEX);
const raw = XLSX.utils.sheet_to_json(wb.Sheets['OPA ODA Postal Codes'], { header: 1, defval: null, raw: false }).slice(3);
const idx = { country: 0, code: 1, city: 2, pcStart: 3, pcEnd: 4, opaParcel: 5, opaFreight: 6, odaParcel: 7, odaFreight: 8 };
const fxByCC = new Map();
for (const r of raw) {
  const cc = r[idx.code];
  if (!cc) continue;
  if (!fxByCC.has(cc)) {
    fxByCC.set(cc, { name: r[idx.country], total: 0, opaParcelY: 0, opaFreightY: 0, odaParcelY: 0, odaFreightY: 0 });
  }
  const e = fxByCC.get(cc);
  e.total++;
  if (r[idx.opaParcel] === 'Yes') e.opaParcelY++;
  if (r[idx.opaFreight] === 'Yes') e.opaFreightY++;
  if (r[idx.odaParcel] === 'Yes') e.odaParcelY++;
  if (r[idx.odaFreight] === 'Yes') e.odaFreightY++;
}
console.log(`Countries with at least 1 row: ${fxByCC.size}`);
console.log('\n--- Middle East focus ---');
console.log('CC | Country         | Total | OPA-Parcel | ODA-Parcel');
for (const cc of ['SA','QA','AE','KW','BH','OM','JO','IL']) {
  const e = fxByCC.get(cc);
  if (!e) { console.log(`${cc} | (none)`); continue; }
  console.log(`${cc} | ${(e.name ?? '').padEnd(15)} | ${String(e.total).padStart(5)} | ${String(e.opaParcelY).padStart(10)} | ${String(e.odaParcelY).padStart(10)}`);
}
console.log('\n--- ME ODA Parcel = Yes (sample rows) ---');
for (const r of raw.slice(0, 0)) {} // noop
let shown = 0;
for (const r of raw) {
  if (!ME.has(r[idx.code])) continue;
  if (r[idx.odaParcel] !== 'Yes') continue;
  console.log(`  ${r[idx.code]}  ${(r[idx.city] ?? '').padEnd(28)}  ${String(r[idx.pcStart] ?? '').padEnd(10)} → ${r[idx.pcEnd] ?? ''}`);
  if (++shown >= 25) { console.log('  ...'); break; }
}

console.log('\n\n============ DHL Remote Areas ============');
const wb2 = XLSX.readFile(DHL);
const raw2 = XLSX.utils.sheet_to_json(wb2.Sheets['Remote Area Locations'], { header: 1, defval: null, raw: false }).slice(2);
const dIdx = { country: 0, code: 1, city: 2, pcFrom: 3, pcTo: 4 };
const dhByCC = new Map();
for (const r of raw2) {
  const cc = r[dIdx.code];
  if (!cc) continue;
  if (!dhByCC.has(cc)) dhByCC.set(cc, { name: r[dIdx.country], total: 0, withPostal: 0, withCity: 0 });
  const e = dhByCC.get(cc);
  e.total++;
  if (r[dIdx.pcFrom]) e.withPostal++;
  if (r[dIdx.city]) e.withCity++;
}
console.log(`Total rows: ${raw2.length}, Countries: ${dhByCC.size}`);
console.log('\n--- Middle East focus ---');
console.log('CC | Country               | Total | with-postal | with-city');
for (const cc of ['SA','QA','AE','KW','BH','OM','JO','IL']) {
  const e = dhByCC.get(cc);
  if (!e) { console.log(`${cc} | (none)`); continue; }
  console.log(`${cc} | ${(e.name ?? '').padEnd(20)} | ${String(e.total).padStart(5)} | ${String(e.withPostal).padStart(11)} | ${String(e.withCity).padStart(9)}`);
}

console.log('\n--- ME sample (first 20) ---');
shown = 0;
for (const r of raw2) {
  if (!ME.has(r[dIdx.code])) continue;
  console.log(`  ${r[dIdx.code]}  ${(r[dIdx.city] ?? '').padEnd(28)}  ${String(r[dIdx.pcFrom] ?? '').padEnd(10)} → ${r[dIdx.pcTo] ?? ''}`);
  if (++shown >= 20) { console.log('  ...'); break; }
}

// Also dump small sanity: SA all rows showing ODA flag distribution from FedEx
console.log('\n--- FedEx SA rows: ODA-Parcel flag distribution ---');
const saCount = { yes: 0, no: 0 };
for (const r of raw) {
  if (r[idx.code] !== 'SA') continue;
  if (r[idx.odaParcel] === 'Yes') saCount.yes++;
  else if (r[idx.odaParcel] === 'No') saCount.no++;
}
console.log(`SA total=${saCount.yes + saCount.no}, ODA-Parcel Yes=${saCount.yes}, No=${saCount.no}`);
console.log('\nSample SA rows (any flag combination):');
let saShown = 0;
for (const r of raw) {
  if (r[idx.code] !== 'SA') continue;
  console.log(`  ${(r[idx.city] ?? '').padEnd(28)} pc=${String(r[idx.pcStart] ?? '').padStart(8)}-${String(r[idx.pcEnd] ?? '').padStart(8)} OPA-P=${r[idx.opaParcel]} ODA-P=${r[idx.odaParcel]}`);
  if (++saShown >= 8) break;
}
