'use server';

/**
 * Hai con số cho dải "Chờ quản lý duyệt" mà bảng KPI chưa có sẵn: kiện chờ duyệt tay và món cân
 * chờ đẩy lên Shopify. Các số còn lại (đơn treo, tiêu chí chưa chấm, đã chốt chưa) trang đã có.
 *
 * Cả hai đo TOÀN THỜI GIAN, không theo kỳ: đây là việc tồn đọng của người, đóng một kỳ lại không
 * làm chúng biến mất. Lọc theo kỳ đang xem sẽ giấu mất phần việc nằm ở kỳ khác.
 */
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { LY_DO_CHAM } from '@/features/shipments/ly-do-cham';
import { coLuatDoiChieu } from '@/features/shipments/doi-chieu-fedex';

/** Lý do ngoài tầm kiểm soát CÓ luật đối chiếu — chỉ những lý do này mới rơi vào cảnh chờ duyệt. */
const LY_DO_LOAI_TRU = LY_DO_CHAM.filter((l) => l.loaiTruKpi && coLuatDoiChieu(l.ma)).map((l) => l.ma);

export interface KienChoDuyet {
  nguon: 'shopify' | 'ship_ho';
  id: string;
  maDon: string | null;
  tracking: string | null;
  nuoc: string | null;
  hang: string | null;
  lyDo: string;
  bangChung: string | null;
}

export interface SoChoDuyet {
  kienChoDuyet: number;
  monCanChoDuyet: number;
  /** Chính các kiện đó, để quản lý duyệt ngay tại khu vực quản lý mà không phải đi tìm. */
  danhSachKien: KienChoDuyet[];
}

export async function docSoChoDuyet(): Promise<SoChoDuyet> {
  if (LY_DO_LOAI_TRU.length === 0) return { kienChoDuyet: 0, monCanChoDuyet: 0, danhSachKien: [] };

  const [kien, mon] = await Promise.all([
    /* Đúng điều kiện `duyetTayDuoc`: lý do thuộc nhóm loại trừ VÀ máy báo không kiểm được VÀ
     * chưa ai quyết. Ca 'khong_thay' KHÔNG vào đây — hãng đã tra và không thấy dấu hiệu thì
     * người không được đè lên, nên nó cũng không phải việc đang chờ ai. */
    db.execute<{ n: string }>(sql`
      SELECT (
        (SELECT COUNT(*) FROM shipments
          WHERE ly_do_cham IN ${LY_DO_LOAI_TRU} AND ly_do_doi_chieu = 'khong_kiem_duoc' AND ly_do_duyet IS NULL)
        +
        (SELECT COUNT(*) FROM ship_ho_orders
          WHERE ly_do_cham IN ${LY_DO_LOAI_TRU} AND ly_do_doi_chieu = 'khong_kiem_duoc' AND ly_do_duyet IS NULL)
      )::text AS n`),
    /* Món cân chờ duyệt: đếm SKU khác nhau trong `sanPhamSai` của các giải trình cân web mà cân
     * Shopify hiện tại vẫn THẤP HƠN cân đề xuất. Đã đẩy cân lên rồi thì tự rời danh sách, không
     * cần ai đánh dấu đã làm. */
    db.execute<{ n: string }>(sql`
      SELECT COUNT(DISTINCT x.sku)::text AS n
        FROM am_cuoc_giai_trinh gt
        JOIN shopify_orders o ON o.id = gt.order_id
        CROSS JOIN LATERAL jsonb_to_recordset(COALESCE(gt.chi_tiet->'sanPhamSai', '[]'::jsonb))
             AS x(sku text, "canMoiG" numeric)
       WHERE gt.ly_do = 'can_quy_doi_web' AND x.sku IS NOT NULL
         AND x."canMoiG" > COALESCE(
               (SELECT MAX(v.weight_grams) FROM shopify_variants v
                 WHERE v.store_id = o.store_id AND v.sku = x.sku), 0)`),
  ]);

  /* Lấy luôn danh sách, không chỉ con số: quản lý phải duyệt được NGAY tại chỗ nhìn thấy việc.
   * Giới hạn 50 — nhiều hơn thế thì vấn đề không nằm ở chỗ duyệt tay nữa. */
  const ds = await db.execute<{ nguon: 'shopify' | 'ship_ho'; id: string; don: string | null; tk: string | null; cc: string | null; hang: string | null; ly_do: string; bang_chung: string | null }>(sql`
    SELECT 'shopify'::text AS nguon, s.id, o.shopify_order_number AS don, s.tracking_number AS tk,
           o.ship_country AS cc, s.carrier_key AS hang, s.ly_do_cham AS ly_do, s.ly_do_bang_chung AS bang_chung
      FROM shipments s JOIN shopify_orders o ON o.id = s.order_id
     WHERE s.ly_do_cham IN ${LY_DO_LOAI_TRU} AND s.ly_do_doi_chieu = 'khong_kiem_duoc' AND s.ly_do_duyet IS NULL
    UNION ALL
    SELECT 'ship_ho'::text, o.id, o.code, o.tracking_number, o.country, o.carrier_key, o.ly_do_cham, o.ly_do_bang_chung
      FROM ship_ho_orders o
     WHERE o.ly_do_cham IN ${LY_DO_LOAI_TRU} AND o.ly_do_doi_chieu = 'khong_kiem_duoc' AND o.ly_do_duyet IS NULL
     LIMIT 50`);

  return {
    kienChoDuyet: Number(kien.rows[0]?.n ?? 0),
    monCanChoDuyet: Number(mon.rows[0]?.n ?? 0),
    danhSachKien: ds.rows.map((r) => ({
      nguon: r.nguon, id: r.id, maDon: r.don, tracking: r.tk, nuoc: r.cc, hang: r.hang,
      lyDo: r.ly_do, bangChung: r.bang_chung,
    })),
  };
}
