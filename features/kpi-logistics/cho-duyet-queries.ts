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

export interface SoChoDuyet { kienChoDuyet: number; monCanChoDuyet: number }

export async function docSoChoDuyet(): Promise<SoChoDuyet> {
  if (LY_DO_LOAI_TRU.length === 0) return { kienChoDuyet: 0, monCanChoDuyet: 0 };

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

  return {
    kienChoDuyet: Number(kien.rows[0]?.n ?? 0),
    monCanChoDuyet: Number(mon.rows[0]?.n ?? 0),
  };
}
