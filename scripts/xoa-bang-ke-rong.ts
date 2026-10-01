/**
 * Xoá bảng kê NHÁP RỖNG (CEO 01/10/2026 "xoá 6 bảng kê rỗng đi em").
 *
 * Vì sao có bản rỗng: luật gán kỳ cũ xếp đơn theo tháng chạy lệnh gom, nên nó tạo bản kê ở kỳ
 * 10 cho năm brand. Sau khi xếp lại theo kỳ chứa mốc, đơn về kỳ 09 và mấy bản kỳ 10 thành vỏ.
 * Kèm một bản `tom-fried` kỳ 07 trùng (sinh 08/09, cách bản kia 16 giây, cửa sổ 07-01→09-08).
 *
 * XOÁ LÀ KHÔNG LÙI ĐƯỢC, nên ba hàng rào, kiểm ngay lúc xoá chứ không tin con số đọc trước đó:
 *   1. chỉ `status = 'draft'` — chưa gửi brand bao giờ;
 *   2. `order_count = 0` VÀ không đơn nào trỏ vào (cả `statement_id` lẫn `duty_statement_id`) —
 *      `order_count` là số đã tính, phải soi ĐƠN THẬT mới chắc;
 *   3. `issued_at` và `file_key` đều NULL — có tệp đính kèm nghĩa là đã có người làm gì với nó.
 * Hàng rào nào không qua thì BỎ QUA bản đó và nói rõ lý do, không xoá kèm.
 *
 * Mặc định CHỈ ĐẾM. Thêm `--ap-dung` mới xoá.
 */
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';

const apDung = process.argv.includes('--ap-dung');

interface Ban extends Record<string, unknown> {
  id: string; brand: string; ky: string; cuoi: string; status: string;
  order_count: number; don_tro_vao: number; co_issued_at: boolean; co_file: boolean;
}

async function soi(): Promise<Ban[]> {
  const r = await db.execute<Ban>(sql`
    SELECT s.id, s.partner_brand_slug AS brand,
           to_char(s.period_start,'YYYY-MM-DD') AS ky, to_char(s.period_end,'YYYY-MM-DD') AS cuoi,
           s.status, s.order_count,
           (SELECT count(*)::int FROM ship_ho_orders o
             WHERE o.statement_id = s.id OR o.duty_statement_id = s.id) AS don_tro_vao,
           (s.issued_at IS NOT NULL) AS co_issued_at,
           (s.file_key IS NOT NULL) AS co_file
      FROM ship_ho_statements s
     WHERE s.order_count = 0
     ORDER BY s.partner_brand_slug, s.period_start`);
  return r.rows;
}

async function main(): Promise<void> {
  const ban = await soi();
  const xoaDuoc: Ban[] = []; const giuLai: { b: Ban; ly: string }[] = [];
  for (const b of ban) {
    if (b.status !== 'draft') giuLai.push({ b, ly: `trạng thái ${b.status}, không phải nháp` });
    else if (Number(b.don_tro_vao) > 0) giuLai.push({ b, ly: `còn ${b.don_tro_vao} đơn trỏ vào` });
    else if (b.co_issued_at) giuLai.push({ b, ly: 'có issued_at' });
    else if (b.co_file) giuLai.push({ b, ly: 'có file đính kèm' });
    else xoaDuoc.push(b);
  }

  console.log(`Bảng kê order_count = 0: ${ban.length}`);
  for (const b of xoaDuoc) console.log(`  XOÁ  ${b.brand} · kỳ ${b.ky}→${b.cuoi} · ${b.id}`);
  for (const g of giuLai) console.log(`  GIỮ  ${g.b.brand} · kỳ ${g.b.ky} · ${g.b.id} — ${g.ly}`);

  if (!apDung) { console.log(`\n(chỉ đếm — thêm --ap-dung để xoá ${xoaDuoc.length} bản)`); return; }
  if (xoaDuoc.length === 0) { console.log('\nKhông có gì để xoá.'); return; }

  // Xoá TỪNG bản với điều kiện lặp lại NGAY TRONG câu lệnh: giữa lúc đọc và lúc xoá, lượt gom
  // có thể vừa gắn đơn vào bản này. Điều kiện trong WHERE là hàng rào duy nhất không có khe hở.
  let xoa = 0;
  for (const b of xoaDuoc) {
    const r = await db.execute(sql`
      DELETE FROM ship_ho_statements s
       WHERE s.id = ${b.id}::uuid AND s.status = 'draft' AND s.order_count = 0
         AND s.issued_at IS NULL AND s.file_key IS NULL
         AND NOT EXISTS (SELECT 1 FROM ship_ho_orders o
                          WHERE o.statement_id = s.id OR o.duty_statement_id = s.id)`);
    const n = (r as unknown as { rowCount?: number }).rowCount ?? 0;
    if (n === 1) { xoa++; console.log(`  đã xoá ${b.brand} · kỳ ${b.ky}`); }
    else console.log(`  BỎ QUA ${b.brand} · kỳ ${b.ky} — không còn thoả điều kiện lúc xoá`);
  }
  console.log(`\nĐã xoá ${xoa}/${xoaDuoc.length}.`);
  console.log(`Kiểm lại: còn ${(await soi()).length} bảng kê order_count = 0.`);
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
