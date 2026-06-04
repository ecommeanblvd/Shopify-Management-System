// Estimate how many rows IL range expansion would produce
import XLSX from 'xlsx';
const FX = '/Users/macos/Downloads/ODA_OPA_tiers_codes (1).xlsx';
const wb = XLSX.readFile(FX);
const ws = wb.Sheets['Postal Codes and Tiers '];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: false }).slice(8);
const I = { country: 0, cc: 1, city: 2, pcB: 3, pcE: 4, opaP: 5, opaF: 6, odaP: 7, odaF: 8 };

const ME = new Set(['SA','QA','AE','KW','BH','OM','JO','IL']);

let ilSingles = 0, ilRanges = 0, ilExpanded = 0, ilMaxRange = 0;
let meCities = { SA: 0, QA: 0, AE: 0, KW: 0, BH: 0, OM: 0 };
let meCityRows = 0;

const validTiers = new Set(['Tier A', 'Tier B', 'Tier C']);

for (const r of rows) {
  if (!r[I.cc]) continue;
  const odaP = r[I.odaP];
  if (!validTiers.has(odaP)) continue;          // skip 'No' and header noise
  const cc = r[I.cc];
  const pcB = r[I.pcB];
  const pcE = r[I.pcE];
  const city = r[I.city];

  if (cc === 'IL') {
    if (pcB && pcE) {
      const a = Number(pcB), b = Number(pcE);
      if (Number.isFinite(a) && Number.isFinite(b) && b >= a) {
        if (b === a) ilSingles++;
        else { ilRanges++; ilExpanded += (b - a + 1); ilMaxRange = Math.max(ilMaxRange, b - a + 1); }
      }
    }
  } else if (cc in meCities) {
    if (city && !pcB) { meCities[cc]++; meCityRows++; }
  }
}

console.log(`IL singles  : ${ilSingles}`);
console.log(`IL ranges   : ${ilRanges} → expanded ${ilExpanded} rows, max range size ${ilMaxRange}`);
console.log(`IL total after expand: ${ilSingles + ilExpanded}`);
console.log(`\nME city rows by country:`);
for (const [cc, n] of Object.entries(meCities)) console.log(`  ${cc}: ${n}`);
console.log(`ME city total: ${meCityRows}`);
