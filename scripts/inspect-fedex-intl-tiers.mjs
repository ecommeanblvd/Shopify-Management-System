import XLSX from 'xlsx';

const FX = '/Users/macos/Downloads/ODA_OPA_tiers_codes (1).xlsx';
const ME = new Set(['SA', 'QA', 'AE', 'KW', 'BH', 'OM', 'JO', 'IL']);

const wb = XLSX.readFile(FX);
const ws = wb.Sheets['Postal Codes and Tiers '];
// Data rows start at row index 8 (after header on row 7)
const all = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: false });
console.log(`Total spreadsheet rows: ${all.length}`);
console.log('Header (row 7):', all[7]);

const data = all.slice(8).filter((r) => r[1]); // require Country Code
console.log(`Data rows: ${data.length}`);

// columns: 0=Country 1=CC 2=City 3=PostalBegin 4=PostalEnd 5=OPA-Parcel 6=OPA-Freight 7=ODA-Parcel 8=ODA-Freight
const I = { country: 0, cc: 1, city: 2, pcB: 3, pcE: 4, opaP: 5, opaF: 6, odaP: 7, odaF: 8 };

// Distinct tier values in each column
const tierSets = {
  opaParcel:  new Set(),
  opaFreight: new Set(),
  odaParcel:  new Set(),
  odaFreight: new Set(),
};
for (const r of data) {
  if (r[I.opaP]) tierSets.opaParcel.add(r[I.opaP]);
  if (r[I.opaF]) tierSets.opaFreight.add(r[I.opaF]);
  if (r[I.odaP]) tierSets.odaParcel.add(r[I.odaP]);
  if (r[I.odaF]) tierSets.odaFreight.add(r[I.odaF]);
}
console.log('\n--- Distinct tier values per column ---');
console.log('OPA Parcel  :', [...tierSets.opaParcel].sort());
console.log('OPA Freight :', [...tierSets.opaFreight].sort());
console.log('ODA Parcel  :', [...tierSets.odaParcel].sort());
console.log('ODA Freight :', [...tierSets.odaFreight].sort());

// Country coverage
const byCC = new Map();
for (const r of data) {
  const cc = r[I.cc];
  if (!byCC.has(cc)) byCC.set(cc, { name: r[I.country], total: 0, opaP: new Map(), odaP: new Map() });
  const e = byCC.get(cc);
  e.total++;
  const tag = (m, v) => m.set(v, (m.get(v) ?? 0) + 1);
  if (r[I.opaP]) tag(e.opaP, r[I.opaP]);
  if (r[I.odaP]) tag(e.odaP, r[I.odaP]);
}
console.log(`\nCountries covered: ${byCC.size}`);

console.log('\n--- Middle East ODA Parcel tier breakdown ---');
console.log('CC | Country               | Rows | ODA-Parcel tiers');
for (const cc of ['SA','QA','AE','KW','BH','OM','JO','IL']) {
  const e = byCC.get(cc);
  if (!e) { console.log(`${cc} | (none)`); continue; }
  const odaSummary = [...e.odaP.entries()].map(([t, c]) => `${t}=${c}`).join(', ');
  console.log(`${cc} | ${(e.name ?? '').padEnd(20)} | ${String(e.total).padStart(4)} | ${odaSummary || '(none)'}`);
}

console.log('\n--- Sample ME rows (first 15 with ODA-Parcel tier set) ---');
let shown = 0;
for (const r of data) {
  if (!ME.has(r[I.cc])) continue;
  if (!r[I.odaP]) continue;
  console.log(`  ${r[I.cc]}  ${(r[I.city] ?? '').padEnd(26)}  pc=${String(r[I.pcB] ?? '').padStart(8)}-${String(r[I.pcE] ?? '').padStart(8)}  OPA-P=${r[I.opaP] ?? '-'}  ODA-P=${r[I.odaP] ?? '-'}`);
  if (++shown >= 15) { console.log('  ...'); break; }
}

// Rows that have postal range vs city-only
let withPostal = 0, withCity = 0, both = 0;
for (const r of data) {
  const hasPC = !!r[I.pcB];
  const hasCity = !!r[I.city];
  if (hasPC && hasCity) both++;
  else if (hasPC) withPostal++;
  else if (hasCity) withCity++;
}
console.log(`\n--- Data shape: postal vs city ---`);
console.log(`with postal only: ${withPostal}`);
console.log(`with city only:   ${withCity}`);
console.log(`with both:        ${both}`);
