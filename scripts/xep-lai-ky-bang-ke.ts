/**
 * Xếp lại kỳ cho đơn đang gắn SAI kỳ trên bảng kê NHÁP (CEO 01/10/2026).
 *
 * Vì sao cần: luật cũ xếp đơn theo THÁNG LÚC CHẠY LỆNH GOM, không phải kỳ chứa mốc
 * `order.reconciled` lần đầu. Đo 01/10: 14 đơn / 32.316.966đ nằm sai kỳ.
 *
 * KHÔNG ĐỤNG bảng kê `issued`/`paid`: số đã gửi brand phải đứng yên (4 đơn / 13.532.293đ của
 * Kalisa kỳ 08 thuộc nhóm này — MMP và CEO đã thống nhất giữ nguyên, chênh lệch đi đường điều
 * chỉnh). Script chỉ sửa bản NHÁP, nơi chưa ai nhìn thấy số.
 *
 * Cách làm: GỠ đơn sai kỳ khỏi bản nháp rồi gọi lại `goBangKeNhap` — dùng chính luật mới đã
 * có test, không viết lại phép xếp lần thứ hai ở đây (hai bản sao của một luật tiền là cách
 * chắc chắn nhất để chúng lệch nhau).
 *
 * Mặc định CHỈ ĐẾM. Thêm `--ap-dung` mới ghi.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { goBangKeNhap, tinhLaiTongBangKe } from '@/features/ship-ho/statement-core';

const apDung = process.argv.includes('--ap-dung');

interface DongLech extends Record<string, unknown> {
  order_id: string; code: string; brand: string; loai: string; ke_id: string;
  ky_ke: string; ky_moc: string | null; trang_thai: string; tien: string | null;
}

async function main(): Promise<void> {
  const r = await db.execute<DongLech>(sql`
    SELECT o.id AS order_id, o.code, o.partner_brand_slug AS brand, s.type AS loai,
           s.id AS ke_id, to_char(s.period_start, 'YYYY-MM') AS ky_ke,
           to_char(p.push_dau, 'YYYY-MM') AS ky_moc, s.status AS trang_thai,
           COALESCE(o.actual_charged_vnd, o.charged_vnd)::text AS tien
      FROM ship_ho_orders o
      JOIN ship_ho_statements s ON s.id = o.statement_id
      LEFT JOIN LATERAL (
        SELECT min(e.occurred_at) AS push_dau FROM ship_ho_order_events e
         WHERE e.order_id = o.id AND e.event = 'order.reconciled'
      ) p ON TRUE
     WHERE s.type = 'freight'
       AND (p.push_dau IS NULL OR p.push_dau::date NOT BETWEEN s.period_start AND s.period_end)
     ORDER BY s.status, o.partner_brand_slug, o.code`);

  const lech = r.rows;
  const nhap = lech.filter((x) => x.trang_thai === 'draft');
  const daChot = lech.filter((x) => x.trang_thai !== 'draft');
  const tong = (xs: DongLech[]) => xs.reduce((a, x) => a + Number(x.tien ?? 0), 0);

  console.log(`Đơn gắn SAI kỳ: ${lech.length} · ${tong(lech).toLocaleString('vi-VN')}đ`);
  console.log(`  — trên bản NHÁP (sửa được): ${nhap.length} · ${tong(nhap).toLocaleString('vi-VN')}đ`);
  console.log(`  — trên bản ĐÃ CHỐT (GIỮ NGUYÊN): ${daChot.length} · ${tong(daChot).toLocaleString('vi-VN')}đ`);
  for (const x of lech) {
    console.log(`   ${x.trang_thai === 'draft' ? 'sửa ' : 'GIỮ '} ${x.code} · ${x.brand} · kê ${x.ky_ke} ← mốc ${x.ky_moc ?? 'KHÔNG CÓ MỐC'} · ${Number(x.tien ?? 0).toLocaleString('vi-VN')}đ`);
  }

  if (!apDung) { console.log('\n(chỉ đếm — thêm --ap-dung để ghi)'); return; }
  if (nhap.length === 0) { console.log('\nKhông có gì phải sửa.'); return; }

  // GỠ khỏi bản nháp. freight: status 'billed' lùi về 'shipped' để lượt gom nhặt lại được.
  const ids = nhap.map((x) => x.order_id);
  await db.update(schema.shipHoOrders).set({ statementId: null }).where(inArray(schema.shipHoOrders.id, ids));
  await db.update(schema.shipHoOrders).set({ status: 'shipped' })
    .where(and(inArray(schema.shipHoOrders.id, ids), eq(schema.shipHoOrders.status, 'billed')));
  console.log(`\nĐã gỡ ${ids.length} đơn khỏi bản nháp.`);

  // Tính lại tổng các bản nháp vừa bị gỡ bớt, rồi gom lại theo luật mới.
  for (const keId of new Set(nhap.map((x) => x.ke_id))) {
    const lai = await tinhLaiTongBangKe(keId);
    console.log(`  kê ${keId.slice(0, 8)} → ${lai.orderCount} đơn · ${lai.totalChargedVnd.toLocaleString('vi-VN')}đ`);
  }

  console.log('\nGom lại theo luật mới:');
  for (const k of await goBangKeNhap()) {
    console.log(`  ${k.brand} · ${k.type} · ${k.viec}${k.ky ? ` · kỳ ${k.ky}` : ''}${k.ly ? ` · ${k.ly}` : ''} · ${k.don} đơn · ${k.tien.toLocaleString('vi-VN')}đ`);
  }

  const sau = await db.execute<{ n: string }>(sql`
    SELECT count(*)::text AS n FROM ship_ho_orders o
      JOIN ship_ho_statements s ON s.id = o.statement_id
      LEFT JOIN LATERAL (
        SELECT min(e.occurred_at) AS push_dau FROM ship_ho_order_events e
         WHERE e.order_id = o.id AND e.event = 'order.reconciled'
      ) p ON TRUE
     WHERE s.type = 'freight' AND s.status = 'draft'
       AND (p.push_dau IS NULL OR p.push_dau::date NOT BETWEEN s.period_start AND s.period_end)`);
  console.log(`\nKiểm lại: còn ${sau.rows[0]?.n} đơn sai kỳ trên bản NHÁP (phải là 0).`);
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
