'use server';

/**
 * Report CHI TIẾT từng tiêu chí Pillar 1: liệt kê đúng những đơn/kiện làm nên con
 * số KPI, để người bị chấm và quản lý cùng soi được (CEO 11/09/2026).
 * Quyền xem = quyền xem bảng KPI (admin hoặc nhân sự logistics).
 */
import { headers } from 'next/headers';
import { sql } from 'drizzle-orm';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { db } from '@/db/client';
import { slaCuaNuoc, slaCuaLine, NUOC_LOAI_TRU } from '@/features/shipments/sop-giao-hang';
import { loaiTruKhoiKpi } from '@/features/shipments/ly-do-cham';
import { canQuyDoi, canTinhCuoc, phanLoaiKien } from '@/features/shipments/lech-can';
import { STORE_VAN_HANH } from './pham-vi';
import {
  CACH_DO, xepLoaiSla, chenhSauThuHoi,
  type ChiTietKpi, type MaTieuChi, type DongAmCuoc, type DongSla, type DongChungTu, type DongSizeThung,
} from './chi-tiet';

async function requireXem(): Promise<void> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error('Chưa đăng nhập');
  const role = await getRole(session.user.id);
  if (role !== 'admin' && !(role && hasPermission(role, 'view_kpi_logistics'))) {
    throw new Error('Không có quyền xem bảng KPI logistics');
  }
}

const so = (v: string | null | undefined): number | null => (v == null ? null : Number(v));
const ngay = (v: string | null): string | null => (v ? v.slice(0, 10) : null);

export async function docChiTietKpi(ma: MaTieuChi, tu: string, den: string): Promise<ChiTietKpi> {
  await requireXem();
  const tuTs = `${tu} 00:00:00`;
  const denTs = `${den} 23:59:59`;
  const goc: ChiTietKpi = { ma, tu, den, cachDo: CACH_DO[ma] };

  if (ma === '1.1') {
    // Bill và thu hồi gộp ở HAI subquery riêng: gộp chung một JOIN sẽ nhân đôi số
    // tiền khi một kiện có nhiều dòng phí hoặc nhiều kiện cùng đơn.
    const { rows } = await db.execute<{ don: string | null; cc: string | null; ngay: string | null; thu: string | null; bill: string; thu_hoi: string | null; phan: string | null; so_cn: string | null }>(sql`
      WITH bill AS (
        SELECT s.order_id, SUM(c.total_amount::numeric) AS billed, MIN(s.label_created_at)::text AS ngay_gui
          FROM shipment_charges c JOIN shipments s ON s.id = c.shipment_id
         WHERE s.label_created_at >= ${tuTs}::timestamp AND s.label_created_at <= ${denTs}::timestamp
         GROUP BY 1),
      thu AS (
        SELECT s.order_id, SUM(COALESCE(r.recovered_vnd::numeric, 0)) AS thu_hoi,
               string_agg(DISTINCT r.status::text, ', ') AS phan_dinh,
               string_agg(DISTINCT r.credit_note_number, ', ') AS so_cn
          FROM shipments s JOIN shipment_reconcile_status r ON r.shipment_id = s.id
         WHERE s.label_created_at >= ${tuTs}::timestamp AND s.label_created_at <= ${denTs}::timestamp
         GROUP BY 1)
      SELECT o.shopify_order_number AS don, o.ship_country AS cc, bill.ngay_gui AS ngay,
             (o.total_shipping::numeric * COALESCE(st.fx_cost_per_order_currency::numeric, 1))::text AS thu,
             bill.billed::text AS bill, thu.thu_hoi::text AS thu_hoi, thu.phan_dinh AS phan, thu.so_cn AS so_cn
        FROM bill
        JOIN shopify_orders o ON o.id = bill.order_id
        JOIN stores st ON st.id = o.store_id
        LEFT JOIN thu ON thu.order_id = bill.order_id
       WHERE st.shop_domain = ${STORE_VAN_HANH}
         AND bill.billed > o.total_shipping::numeric * COALESCE(st.fx_cost_per_order_currency::numeric, 1);`);
    const amCuoc: DongAmCuoc[] = [];
    for (const r of rows) {
      const thuKhachVnd = Math.round(Number(r.thu ?? 0));
      const carrierVnd = Math.round(Number(r.bill));
      const thuHoiVnd = Math.round(Number(r.thu_hoi ?? 0));
      const { carrierRongVnd, chenhVnd, conAm } = chenhSauThuHoi(carrierVnd, thuHoiVnd, thuKhachVnd);
      // Đơn đã đòi lại đủ tiền thì KHÔNG còn là đơn âm cước — rời danh sách.
      if (!conAm) continue;
      amCuoc.push({ maDon: r.don, nuoc: r.cc, ngayGui: ngay(r.ngay), thuKhachVnd, carrierVnd, thuHoiVnd, carrierRongVnd, chenhVnd, phanDinh: r.phan, soCreditNote: r.so_cn });
    }
    amCuoc.sort((a, b) => b.chenhVnd - a.chenhVnd);
    return { ...goc, amCuoc };
  }

  if (ma === '1.2') {
    const { rows } = await db.execute<{ id: string; don: string | null; tk: string | null; cc: string | null; line: string | null; gui: string; giao: string; ngay: string; ly_do: string | null }>(sql`
      SELECT s.id AS id, o.shopify_order_number AS don, s.tracking_number AS tk, COALESCE(o.ship_country, '?') AS cc,
             COALESCE(s.carrier_key, '?') AS line, s.label_created_at::text AS gui, s.delivered_at::text AS giao,
             (EXTRACT(EPOCH FROM (s.delivered_at::timestamp - s.label_created_at)) / 86400)::text AS ngay,
             s.ly_do_cham AS ly_do
        FROM shipments s JOIN shopify_orders o ON o.id = s.order_id JOIN stores st ON st.id = o.store_id
       WHERE st.shop_domain = ${STORE_VAN_HANH}
         AND s.label_created_at IS NOT NULL AND s.delivered_at IS NOT NULL
         AND s.delivered_at::timestamp >= s.label_created_at
         AND s.label_created_at >= ${tuTs}::timestamp AND s.label_created_at <= ${denTs}::timestamp
       ORDER BY (EXTRACT(EPOCH FROM (s.delivered_at::timestamp - s.label_created_at)) / 86400) DESC;`);
    const slaRows: DongSla[] = rows.map((r) => {
      const nuoc = (r.cc ?? '?').trim().toUpperCase();
      const line = (r.line ?? '?').trim().toLowerCase();
      const soNgay = Math.round(Number(r.ngay) * 10) / 10;
      // Chấm theo cam kết của NƯỚC để khớp đúng điểm KPI (`tongKpi` cộng theo mức
      // nước). Thước riêng của hãng chặt hơn ở vài tuyến — dùng nó để chấm sẽ ra
      // tỉ lệ thấp hơn bảng điểm và người bị chấm mất lòng tin vào report.
      const slaNgay = slaCuaNuoc(nuoc);
      // Bị loại vì lý do ngoài tầm kiểm soát (mục VII) HOẶC nước không nằm trong
      // phạm vi chấm (VN nội địa) — khớp đúng bộ lọc của `chamKpi`.
      const biLoaiTru = loaiTruKhoiKpi(r.ly_do) || nuoc in NUOC_LOAI_TRU;
      return {
        shipmentId: r.id, maDon: r.don, tracking: r.tk, nuoc, line,
        ngayGui: ngay(r.gui) ?? '', ngayGiao: ngay(r.giao) ?? '',
        soNgay, slaNgay, slaLineNgay: slaCuaLine(nuoc, line), ketQua: xepLoaiSla(soNgay, slaNgay, biLoaiTru),
        lyDoCham: r.ly_do,
      };
    });
    return { ...goc, sla: slaRows };
  }

  if (ma === '1.3') {
    const { rows } = await db.execute<{ don: string | null; tk: string | null; cc: string | null; ngay: string | null; phi: string; tong: string | null }>(sql`
      SELECT o.shopify_order_number AS don, s.tracking_number AS tk, o.ship_country AS cc,
             s.label_created_at::text AS ngay, c.address_correction::text AS phi, c.total_amount::text AS tong
        FROM shipment_charges c JOIN shipments s ON s.id = c.shipment_id
        JOIN shopify_orders o ON o.id = s.order_id JOIN stores st ON st.id = o.store_id
       WHERE st.shop_domain = ${STORE_VAN_HANH}
         AND s.label_created_at >= ${tuTs}::timestamp AND s.label_created_at <= ${denTs}::timestamp
         AND COALESCE(c.address_correction::numeric, 0) > 0
       ORDER BY c.address_correction::numeric DESC;`);
    const chungTu: DongChungTu[] = rows.map((r) => ({
      maDon: r.don, tracking: r.tk, nuoc: r.cc, ngayGui: ngay(r.ngay),
      phiSuaDiaChiVnd: Math.round(Number(r.phi)), tongBillVnd: Math.round(Number(r.tong ?? 0)),
    }));
    return { ...goc, chungTu };
  }

  const { rows } = await db.execute<{ don: string | null; tk: string | null; ngay: string | null; thuc: string | null; d: string | null; r: string | null; c: string | null; billed: string | null }>(sql`
    SELECT o.shopify_order_number AS don, s.tracking_number AS tk, s.label_created_at::text AS ngay,
           s.actual_weight_kg::text AS thuc, s.dim_length_cm::text AS d, s.dim_width_cm::text AS r,
           s.dim_height_cm::text AS c, ch.billing_weight_kg::text AS billed
      FROM shipments s JOIN shipment_charges ch ON ch.shipment_id = s.id
      JOIN shopify_orders o ON o.id = s.order_id JOIN stores st ON st.id = o.store_id
     WHERE st.shop_domain = ${STORE_VAN_HANH}
       AND s.label_created_at >= ${tuTs}::timestamp AND s.label_created_at <= ${denTs}::timestamp;`);
  const sizeThung: DongSizeThung[] = rows.map((r) => {
    const kien = { thucKg: so(r.thuc), daiCm: so(r.d), rongCm: so(r.r), caoCm: so(r.c), billedKg: so(r.billed) };
    const { loai, lech } = phanLoaiKien(kien);
    const quyDoi = kien.daiCm != null && kien.rongCm != null && kien.caoCm != null ? canQuyDoi(kien.daiCm, kien.rongCm, kien.caoCm) : null;
    return {
      maDon: r.don, tracking: r.tk, ngayGui: ngay(r.ngay),
      canThucKg: kien.thucKg, canQuyDoiKg: quyDoi, canTinhCuocKg: canTinhCuoc(kien), canBillKg: kien.billedKg,
      lechKg: lech == null ? null : Math.round(lech * 100) / 100,
      phanLoai: loai,
    };
  }).sort((a, b) => (b.lechKg ?? -Infinity) - (a.lechKg ?? -Infinity));
  return { ...goc, sizeThung };
}
