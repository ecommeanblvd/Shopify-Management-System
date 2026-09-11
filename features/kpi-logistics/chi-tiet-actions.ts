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
import { loaiTruKhoiKpi, layLyDo } from '@/features/shipments/ly-do-cham';
import { canQuyDoi, canTinhCuoc, phanLoaiKien } from '@/features/shipments/lech-can';
import {
  CACH_DO, xepLoaiSla,
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
    const { rows } = await db.execute<{ don: string | null; cc: string | null; ngay: string | null; thu: string | null; bill: string; phan: string | null }>(sql`
      WITH b AS (
        SELECT s.order_id, SUM(c.total_amount::numeric) AS billed, MIN(s.label_created_at)::text AS ngay_gui,
               string_agg(DISTINCT r.status::text, ', ') AS phan_dinh
          FROM shipment_charges c
          JOIN shipments s ON s.id = c.shipment_id
          LEFT JOIN shipment_reconcile_status r ON r.shipment_id = s.id
         WHERE s.label_created_at >= ${tuTs}::timestamp AND s.label_created_at <= ${denTs}::timestamp
         GROUP BY 1)
      SELECT o.shopify_order_number AS don, o.ship_country AS cc, b.ngay_gui AS ngay,
             (o.total_shipping::numeric * COALESCE(st.fx_cost_per_order_currency::numeric, 1))::text AS thu,
             b.billed::text AS bill, b.phan_dinh AS phan
        FROM b JOIN shopify_orders o ON o.id = b.order_id JOIN stores st ON st.id = o.store_id
       WHERE b.billed > o.total_shipping::numeric * COALESCE(st.fx_cost_per_order_currency::numeric, 1)
       ORDER BY (b.billed - o.total_shipping::numeric * COALESCE(st.fx_cost_per_order_currency::numeric, 1)) DESC;`);
    const amCuoc: DongAmCuoc[] = rows.map((r) => {
      const thu = Number(r.thu ?? 0);
      const carrier = Number(r.bill);
      return { maDon: r.don, nuoc: r.cc, ngayGui: ngay(r.ngay), thuKhachVnd: Math.round(thu), carrierVnd: Math.round(carrier), chenhVnd: Math.round(carrier - thu), phanDinh: r.phan };
    });
    return { ...goc, amCuoc };
  }

  if (ma === '1.2') {
    const { rows } = await db.execute<{ don: string | null; tk: string | null; cc: string | null; line: string | null; gui: string; giao: string; ngay: string; ly_do: string | null }>(sql`
      SELECT o.shopify_order_number AS don, s.tracking_number AS tk, COALESCE(o.ship_country, '?') AS cc,
             COALESCE(s.carrier_key, '?') AS line, s.label_created_at::text AS gui, s.delivered_at::text AS giao,
             (EXTRACT(EPOCH FROM (s.delivered_at::timestamp - s.label_created_at)) / 86400)::text AS ngay,
             s.ly_do_cham AS ly_do
        FROM shipments s JOIN shopify_orders o ON o.id = s.order_id
       WHERE s.label_created_at IS NOT NULL AND s.delivered_at IS NOT NULL
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
        maDon: r.don, tracking: r.tk, nuoc, line,
        ngayGui: ngay(r.gui) ?? '', ngayGiao: ngay(r.giao) ?? '',
        soNgay, slaNgay, slaLineNgay: slaCuaLine(nuoc, line), ketQua: xepLoaiSla(soNgay, slaNgay, biLoaiTru),
        lyDoCham: r.ly_do ? (layLyDo(r.ly_do)?.ten ?? r.ly_do) : null,
      };
    });
    return { ...goc, sla: slaRows };
  }

  if (ma === '1.3') {
    const { rows } = await db.execute<{ don: string | null; tk: string | null; cc: string | null; ngay: string | null; phi: string; tong: string | null }>(sql`
      SELECT o.shopify_order_number AS don, s.tracking_number AS tk, o.ship_country AS cc,
             s.label_created_at::text AS ngay, c.address_correction::text AS phi, c.total_amount::text AS tong
        FROM shipment_charges c JOIN shipments s ON s.id = c.shipment_id
        JOIN shopify_orders o ON o.id = s.order_id
       WHERE s.label_created_at >= ${tuTs}::timestamp AND s.label_created_at <= ${denTs}::timestamp
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
      JOIN shopify_orders o ON o.id = s.order_id
     WHERE s.label_created_at >= ${tuTs}::timestamp AND s.label_created_at <= ${denTs}::timestamp;`);
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
