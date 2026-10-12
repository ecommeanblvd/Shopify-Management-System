/**
 * Kiện có NGÀY GIAO trước NGÀY TẠO NHÃN — tức giao trước khi gửi. Không thể xảy ra thật,
 * nên nó luôn là dữ liệu sai, và là dấu hiệu của một loại sai rất khó thấy bằng mắt:
 * **một dòng Lark ghi nhầm mã đơn, rồi ngày giao của kiện khác bị đè lên kiện này.**
 *
 * Đã bắt được bằng tay hai lần: `PK-21485` (đè ngày 29/08 lên kiện thật của `#MBLVD29892`)
 * và `PK-21626` (`876817928550` — hoá đơn ghi `#MBLVD30103` mà kiện treo ở `#MBLVD30166`).
 * Cả hai lần đều phải có người tình cờ soi mới ra.
 *
 * Đo 12/10/2026 trên 4.204 kiện có đủ hai mốc: đúng **3** kiện vi phạm, lệch 27 · 8 · 3 ngày,
 * và **cả 3 đều có `delivery_source = 'lark'`**. Không có ca nào lệch 1 ngày — nên so theo
 * NGÀY giờ kinh doanh là đủ, không cần biên dung sai (biên chỉ làm lọt ca thật).
 * Đơn ship hộ: 0 ca, nên phép kiểm này chỉ đặt ở kiện Shopify.
 */
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { ngayKinhDoanh } from '@/lib/timezone';

/** Số ngày giữa hai mốc 'YYYY-MM-DD' (b − a). Chuỗi sai định dạng → null. */
function soNgay(a: string, b: string): number | null {
  const pa = /^(\d{4})-(\d{2})-(\d{2})$/.exec(a);
  const pb = /^(\d{4})-(\d{2})-(\d{2})$/.exec(b);
  if (!pa || !pb) return null;
  const ta = Date.UTC(+pa[1], +pa[2] - 1, +pa[3]);
  const tb = Date.UTC(+pb[1], +pb[2] - 1, +pb[3]);
  return Math.round((tb - ta) / 86_400_000);
}

/**
 * THUẦN: số ngày mà nhãn được tạo SAU khi kiện đã giao. `null` = không vi phạm hoặc
 * thiếu mốc. So theo NGÀY giờ kinh doanh (`MUI_GIO_KINH_DOANH`) vì nhãn lưu lúc nửa đêm
 * còn ngày giao có giờ — so theo mốc thời gian thô sẽ báo giả hàng loạt.
 */
export function lechGiaoTruocNgayGui(o: {
  labelCreatedAt: Date | string | null | undefined;
  deliveredAt: Date | string | null | undefined;
}): number | null {
  const nhan = ngayKinhDoanh(o.labelCreatedAt);
  const giao = ngayKinhDoanh(o.deliveredAt);
  if (!nhan || !giao) return null;
  const lech = soNgay(giao, nhan);
  return lech !== null && lech > 0 ? lech : null;
}

export interface DongGiaoTruoc {
  shipmentId: string;
  tracking: string | null;
  carrierKey: string | null;
  deliverySource: string | null;
  orderNumber: string | null;
  /** Mã dòng Lark (`log_unique_code`) — thứ cần sửa, vì lỗi nằm ở dòng đó. */
  dongLark: string | null;
  ngayNhan: string;
  ngayGiao: string;
  lechNgay: number;
}

export interface TomTatGiaoTruoc {
  tong: number;
  /** Lệch lớn nhất — ca lệch càng xa càng khó là trùng hợp. */
  lechLonNhat: number;
  /** Đếm theo nguồn ngày giao; nguồn `lark` là nghi phạm đã biết. */
  theoNguon: Array<{ nguon: string; n: number }>;
}

/** THUẦN. */
export function tomTatGiaoTruoc(rows: DongGiaoTruoc[]): TomTatGiaoTruoc {
  const dem = new Map<string, number>();
  let lechLonNhat = 0;
  for (const r of rows) {
    const k = r.deliverySource ?? '(không rõ)';
    dem.set(k, (dem.get(k) ?? 0) + 1);
    if (r.lechNgay > lechLonNhat) lechLonNhat = r.lechNgay;
  }
  return {
    tong: rows.length,
    lechLonNhat,
    theoNguon: [...dem.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([nguon, n]) => ({ nguon, n })),
  };
}

/** Lọc ngay trong SQL theo NGÀY giờ kinh doanh — 4.204 kiện có đủ hai mốc, không kéo hết về. */
export async function listGiaoTruocNgayGui(): Promise<DongGiaoTruoc[]> {
  const { rows } = await db.execute<{
    id: string; tr: string | null; hang: string | null; nguon: string | null;
    don: string | null; dong_lark: string | null; ngay_nhan: string; ngay_giao: string; lech: number;
  }>(sql`
    SELECT s.id::text AS id, s.tracking_number AS tr, s.carrier_key AS hang,
           s.delivery_source AS nguon, o.shopify_order_number AS don,
           s.log_unique_code AS dong_lark,
           date(s.label_created_at AT TIME ZONE 'Asia/Bangkok')::text AS ngay_nhan,
           date(s.delivered_at AT TIME ZONE 'Asia/Bangkok')::text AS ngay_giao,
           (date(s.label_created_at AT TIME ZONE 'Asia/Bangkok')
            - date(s.delivered_at AT TIME ZONE 'Asia/Bangkok')) AS lech
      FROM shipments s
      LEFT JOIN shopify_orders o ON o.id = s.order_id
     WHERE s.delivered_at IS NOT NULL AND s.label_created_at IS NOT NULL
       AND date(s.label_created_at AT TIME ZONE 'Asia/Bangkok')
         > date(s.delivered_at AT TIME ZONE 'Asia/Bangkok')
     ORDER BY lech DESC;`);
  return rows.map((r) => ({
    shipmentId: r.id, tracking: r.tr, carrierKey: r.hang, deliverySource: r.nguon,
    orderNumber: r.don, dongLark: r.dong_lark,
    ngayNhan: r.ngay_nhan, ngayGiao: r.ngay_giao, lechNgay: Number(r.lech),
  }));
}
