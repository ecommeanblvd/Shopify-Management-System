import XLSX from 'xlsx';

const files = process.argv.slice(2);
for (const f of files) {
  console.log(`\n========== ${f} ==========`);
  const wb = XLSX.readFile(f);
  console.log(`Sheets: ${wb.SheetNames.join(' | ')}`);
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1');
    const rows = XLSX.utils.sheet_to_json(ws, { defval: null, raw: false });
    console.log(`\n--- Sheet: ${name}  (${range.e.r + 1} rows × ${range.e.c + 1} cols) ---`);
    if (rows.length > 0) {
      console.log(`Columns: ${Object.keys(rows[0]).join(' | ')}`);
      console.log(`First 8 rows:`);
      for (const r of rows.slice(0, 8)) {
        console.log('  ' + JSON.stringify(r));
      }
    } else {
      // header may not be on row 1 — dump raw first 10 rows as cells
      const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: false }).slice(0, 12);
      console.log(`Raw rows (no header detected):`);
      for (const r of raw) console.log('  ' + JSON.stringify(r));
    }
  }
}
