/**
 * Khôi phục dữ liệu đã đưa vào kho lưu trữ (.csv.gz) trở lại Postgres.
 *
 * Vì sao có script này: DB Supabase gói free giới hạn 500MB, mà bảng ODA
 * (carrier_remote_postcodes) giữ cả các năm hiệu lực cũ — 681k dòng hết hạn
 * chiếm ~160MB nhưng chỉ cần khi TRA CỨU LẠI đơn cũ (re-quote, đối soát bill
 * năm ngoái). Giải pháp: xuất ra .csv.gz cất ngoài DB, cần thì nạp lại đúng
 * phần cần bằng script này.
 *
 * Dùng:
 *   railway run node scripts/restore-db-archive.mjs <file.csv.gz> <ten_bang> [--dry] [--upsert]
 *
 * Ví dụ:
 *   railway run node scripts/restore-db-archive.mjs \
 *     ~/Documents/SMS-DB-Archive/carrier_remote_postcodes_het-hieu-luc.csv.gz \
 *     carrier_remote_postcodes
 *
 * An toàn: mặc định ON CONFLICT (id) DO NOTHING — chạy lại nhiều lần không
 * nhân đôi dữ liệu và không đè lên dòng đang có trong DB.
 *
 * --upsert: ghi đè cột của dòng trùng id. Cần khi phục hồi cột đã được rỗng
 * hoá để tiết kiệm chỗ mà DÒNG vẫn còn (vd fedex_rate_quotes.raw — JSON gốc
 * FedEx trả về, 10MB/1.310 dòng, chỉ dùng khi cần parse lại).
 */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import pg from 'pg';

const [file, table, ...flags] = process.argv.slice(2);
const DRY = flags.includes('--dry');
const UPSERT = flags.includes('--upsert');
if (!file || !table) {
  console.error('Thiếu tham số. Dùng: node scripts/restore-db-archive.mjs <file.csv.gz> <ten_bang> [--dry]');
  process.exit(1);
}
if (!/^[a-z_][a-z0-9_]*$/.test(table)) {
  console.error('Tên bảng không hợp lệ:', table);
  process.exit(1);
}

/** Parser CSV đúng chuẩn RFC4180: field có dấu " được escape thành "", và có
 *  thể chứa xuống dòng (payload webhook, error message hay dính). */
function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false, started = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"' && cell === '') { quoted = true; started = true; continue; }
    if (ch === ',') { row.push(started || cell !== '' ? cell : null); cell = ''; started = false; continue; }
    if (ch === '\n') { row.push(started || cell !== '' ? cell : null); rows.push(row); row = []; cell = ''; started = false; continue; }
    if (ch === '\r') continue;
    cell += ch;
  }
  if (cell !== '' || row.length) { row.push(started || cell !== '' ? cell : null); rows.push(row); }
  return rows;
}

const main = async () => {
  const text = gunzipSync(readFileSync(file)).toString('utf8');
  const rows = parseCsv(text);
  const header = rows.shift();
  while (rows.length && rows[rows.length - 1].every((c) => c === null || c === '')) rows.pop();
  console.log(`Đọc ${rows.length.toLocaleString('vi-VN')} dòng, ${header.length} cột → bảng ${table}`);
  if (DRY) { console.log('--dry: không ghi DB. Cột:', header.join(', ')); return; }

  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    statement_timeout: 600000,
  });
  await client.connect();
  const cols = header.map((h) => `"${h}"`).join(',');
  const hasId = header.includes('id');
  const BATCH = 1000;
  let done = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const params = [];
    const values = chunk.map((r) => {
      const ph = r.map((v) => { params.push(v); return `$${params.length}`; });
      return `(${ph.join(',')})`;
    }).join(',');
    const onConflict = !hasId ? ''
      : UPSERT
        ? ` ON CONFLICT (id) DO UPDATE SET ${header.filter((h) => h !== 'id').map((h) => `"${h}" = EXCLUDED."${h}"`).join(', ')}`
        : ' ON CONFLICT (id) DO NOTHING';
    await client.query(`INSERT INTO "${table}" (${cols}) VALUES ${values}${onConflict}`, params);
    done += chunk.length;
    process.stdout.write(`\r  đã nạp ${done.toLocaleString('vi-VN')}/${rows.length.toLocaleString('vi-VN')}`);
  }
  console.log(`\nXong. Nhớ chạy ANALYZE "${table}"; nếu vừa nạp lượng lớn.`);
  await client.end();
};

main().catch((e) => { console.error('LỖI:', e.message); process.exit(1); });
