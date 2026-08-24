/**
 * Xuất dữ liệu cũ ra kho lưu trữ nén (.csv.gz) để gỡ khỏi Postgres mà vẫn nạp
 * lại được — cặp đôi với scripts/restore-db-archive.mjs.
 *
 * Vì sao: Supabase gói free giới hạn 500MB DB. Phần lớn dung lượng là dữ liệu
 * CHỈ CẦN KHI TRA CỨU LẠI (bảng ODA các năm cũ, log webhook) — không đáng nằm
 * thường trực trong DB nóng.
 *
 * Mọi cột được ép ::text NGAY TRONG SQL, không để driver `pg` tự đổi kiểu.
 * Bài học từ 2 lỗi đã bắt được khi đối chiếu round-trip trước lúc xoá:
 *   - cột `date` bị lùi 1 ngày (driver dựng JS Date theo giờ máy UTC+7)
 *   - cột `jsonb` bị ghi thành "[object Object]"
 * Postgres tự serialize mọi kiểu về đúng dạng mà chính nó nhận lại được.
 *
 * Dùng: railway run node scripts/archive-db-tables.mjs [thư_mục_đích] [--only=<tên>]
 */
import { createGzip } from 'node:zlib';
import { createWriteStream, statSync, mkdirSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import pg from 'pg';

const argv = process.argv.slice(2);
const ONLY = argv.find((a) => a.startsWith('--only='))?.slice('--only='.length) ?? null;
const OUT = argv.find((a) => !a.startsWith('--')) || `${process.env.HOME}/Documents/SMS-DB-Archive`;

/** Bộ dữ liệu được đưa vào kho. Thêm mục mới ở đây, script tự lo phần còn lại. */
const JOBS = [
  {
    name: 'carrier_remote_postcodes_het-hieu-luc',
    table: 'carrier_remote_postcodes',
    where: `effective_to IS NOT NULL AND effective_to <= CURRENT_DATE`,
    ghiChu: 'Bảng ODA/remote của các năm đã hết hiệu lực — chỉ cần khi quote lại đơn cũ.',
  },
  {
    name: 'fedex_rate_quotes',
    table: 'fedex_rate_quotes',
    where: `TRUE`,
    ghiChu: 'Quote FedEx API (kèm cột raw 10MB). Sau khi lưu, raw được rỗng hoá trong DB; phục hồi bằng --upsert.',
  },
  {
    name: 'shopify_variants',
    table: 'shopify_variants',
    where: `TRUE`,
    ghiChu: 'Bản sao variant Shopify do scripts/sync-shopify-variants.ts dựng. Không màn hình nào của app đọc bảng này — chỉ dùng để dò/đối chiếu SKU khi cần.',
  },
  {
    name: 'shopify_webhook_log_cu-hon-30-ngay',
    table: 'shopify_webhook_log',
    where: `received_at < now() - interval '30 days'`,
    ghiChu: 'Log webhook Shopify quá 30 ngày (chống xử lý trùng chỉ cần vài ngày gần nhất).',
  },
];

const csvCell = (v) => {
  if (v === null || v === undefined) return '';
  return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
};

const main = async () => {
  mkdirSync(OUT, { recursive: true });
  const c = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    statement_timeout: 600000,
  });
  await c.connect();
  console.log('Kho lưu trữ →', OUT, '\n');

  for (const job of JOBS) {
    if (ONLY && job.name !== ONLY) continue;
    const cols = (await c.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`,
      [job.table],
    )).rows.map((r) => r.column_name);
    if (!cols.length) { console.log(`  ${job.name}: không thấy bảng ${job.table} — bỏ qua`); continue; }

    const total = Number((await c.query(`SELECT count(*) n FROM "${job.table}" WHERE ${job.where}`)).rows[0].n);
    if (!total) { console.log(`  ${job.name}: 0 dòng — bỏ qua`); continue; }

    const selectList = cols.map((c2) => `"${c2}"::text AS "${c2}"`).join(', ');
    const gz = createGzip({ level: 9 });
    const done = pipeline(gz, createWriteStream(`${OUT}/${job.name}.csv.gz`));
    gz.write(cols.join(',') + '\n');

    const PAGE = 50000;
    let written = 0;
    for (let off = 0; off < total; off += PAGE) {
      const rows = (await c.query(
        `SELECT ${selectList} FROM "${job.table}" WHERE ${job.where} ORDER BY id LIMIT $1 OFFSET $2`,
        [PAGE, off],
      )).rows;
      if (!rows.length) break;
      for (const r of rows) gz.write(cols.map((k) => csvCell(r[k])).join(',') + '\n');
      written += rows.length;
    }
    gz.end(); await done;
    const mb = (statSync(`${OUT}/${job.name}.csv.gz`).size / 1024 / 1024).toFixed(2);
    console.log(`  ${job.name}: ${written.toLocaleString('vi-VN')} dòng → ${mb} MB`);
  }
  await c.end();
};

main().catch((e) => { console.error('LỖI:', e.message); process.exit(1); });
