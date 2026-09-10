'use server';

/**
 * Số liệu tự động cho bảng KPI Logistics Operations Specialist — lấy thẳng từ hệ thống, không dùng bảng tự khai
 * (Quy chế mục IX). Kỳ = tháng lịch, lọc theo NGÀY GỬI (tạo vận đơn) để khớp với hoá đơn carrier của kỳ đó.
 */
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { docKienGiao } from '@/features/shipments/tieu-chuan-giao';
import { chamKpi, tongKpi } from '@/features/shipments/sop-giao-hang';

export interface SoLieuTuDong {
  tu: string; den: string;
  /** 1.1 — đơn có cước carrier THỰC TRẢ vượt cước thu của khách (chưa quy trách nhiệm). */
  soDonAmCuoc: number;
  amCuocVnd: number;
  /** 1.2 — theo SOP nội bộ (D-067). */
  slaTong: { n: number; dungHan: number; tyLe: number | null };
  /** 1.2 — theo chuẩn cố định ghi trong quy chế (Mỹ ≤2, Saudi ≤5 ngày). */
  slaQuyChe: { n: number; dungHan: number; tyLe: number | null };
  /** 1.3 — kiện phát sinh phí sửa địa chỉ / xử lý chứng từ trên bill. */
  kienCoBill: number;
  kienLoiChungTu: number;
  tyLeLoiChungTu: number | null;
  /** P2 — đơn ship hộ đã giao/đã chốt cước trong kỳ. */
  soDonShipHo: number;
  /** P3 Gate — kiện có bill của các kỳ ĐÃ QUA (bill về đủ lâu) mà vẫn chưa phân định đúng/sai. Tồn = 0 thì Gate đạt. */
  kienCanPhanDinh: number;
  kienDaPhanDinh: number;
  kienTonDong: number;
  gateDat: boolean;
  /** 3C — tiền thu hồi và tổng thuộc diện khiếu nại (chốt theo ngày duyệt đối soát). */
  thuHoiVnd: number;
  thuocDienKhieuNaiVnd: number;
  tyLeThuHoi: number | null;
}

/** Chuẩn cố định trong quy chế (mục 1.2) — chỉ khai 2 tuyến, dùng để đối chiếu với SOP nội bộ. */
const SLA_QUY_CHE: Record<string, number> = { US: 2, SA: 5 };

export async function docSoLieuKpi(tu: string, den: string): Promise<SoLieuTuDong> {
  const [amCuoc, chungTu, shipHo, gate, thuHoi, kienGiao] = await Promise.all([
    db.execute<{ n: string; tong: string | null }>(sql`
      WITH b AS (
        SELECT s.order_id, SUM(c.total_amount::numeric) AS billed
          FROM shipment_charges c JOIN shipments s ON s.id = c.shipment_id
         WHERE s.label_created_at >= ${`${tu} 00:00:00`}::timestamp AND s.label_created_at <= ${`${den} 23:59:59`}::timestamp
         GROUP BY 1)
      SELECT COUNT(*)::text AS n, SUM(b.billed - o.total_shipping::numeric * COALESCE(st.fx_cost_per_order_currency::numeric, 1))::text AS tong
        FROM b JOIN shopify_orders o ON o.id = b.order_id JOIN stores st ON st.id = o.store_id
       WHERE b.billed > o.total_shipping::numeric * COALESCE(st.fx_cost_per_order_currency::numeric, 1);`),
    db.execute<{ tong: string; loi: string }>(sql`
      SELECT COUNT(*)::text AS tong,
             (COUNT(*) FILTER (WHERE COALESCE(c.address_correction::numeric, 0) > 0))::text AS loi
        FROM shipment_charges c JOIN shipments s ON s.id = c.shipment_id
       WHERE s.label_created_at >= ${`${tu} 00:00:00`}::timestamp AND s.label_created_at <= ${`${den} 23:59:59`}::timestamp;`),
    db.execute<{ n: string }>(sql`
      SELECT COUNT(*)::text AS n FROM ship_ho_orders
       WHERE status IN ('delivered', 'billed', 'settled')
         AND COALESCE(delivered_at, created_at) >= ${`${tu} 00:00:00`}::timestamp
         AND COALESCE(delivered_at, created_at) <= ${`${den} 23:59:59`}::timestamp;`),
    // Gate đo TỒN ĐỌNG chứ không đo kiện trong kỳ: hoá đơn carrier về trễ (quy chế chi trả gối 1 kỳ), nên kiện vừa gửi
    // trong tháng chưa thể phân định xong. Đếm kiện có bill mà NGÀY GỬI trước đầu kỳ chấm và vẫn chưa ai phân định.
    db.execute<{ can: string; da: string; ton: string }>(sql`
      SELECT COUNT(*)::text AS can, (COUNT(r.id))::text AS da,
             (COUNT(*) FILTER (WHERE r.id IS NULL AND s.label_created_at < ${`${tu} 00:00:00`}::timestamp))::text AS ton
        FROM shipment_charges c JOIN shipments s ON s.id = c.shipment_id
        LEFT JOIN shipment_reconcile_status r ON r.shipment_id = s.id
       WHERE s.label_created_at <= ${`${den} 23:59:59`}::timestamp;`),
    db.execute<{ thu: string | null; dien: string | null }>(sql`
      SELECT SUM(COALESCE(recovered_vnd::numeric, 0))::text AS thu,
             -- Thuộc diện khiếu nại = mọi dòng ta xác định HÃNG SAI: đang đòi, đã có credit note, hoặc mới flag.
             SUM(ABS(COALESCE(delta_vnd_at_review::numeric, 0))) FILTER (WHERE status IN ('carrier_error', 'disputing', 'credited'))::text AS dien
        FROM shipment_reconcile_status
       WHERE reconciled_at >= ${`${tu} 00:00:00`}::timestamp AND reconciled_at <= ${`${den} 23:59:59`}::timestamp;`),
    docKienGiao(tu, den),
  ]);

  const sop = tongKpi(chamKpi(kienGiao, tu), tu);
  const theoQuyChe = kienGiao.filter((k) => k.country in SLA_QUY_CHE);
  const datQuyChe = theoQuyChe.filter((k) => k.soNgay <= SLA_QUY_CHE[k.country]).length;

  const soKienBill = Number(chungTu.rows[0]?.tong ?? 0);
  const kienLoi = Number(chungTu.rows[0]?.loi ?? 0);
  const can = Number(gate.rows[0]?.can ?? 0);
  const da = Number(gate.rows[0]?.da ?? 0);
  const ton = Number(gate.rows[0]?.ton ?? 0);
  const thu = Number(thuHoi.rows[0]?.thu ?? 0);
  const dien = Number(thuHoi.rows[0]?.dien ?? 0);

  return {
    tu, den,
    soDonAmCuoc: Number(amCuoc.rows[0]?.n ?? 0),
    amCuocVnd: Math.round(Number(amCuoc.rows[0]?.tong ?? 0)),
    slaTong: { n: sop.n, dungHan: sop.dungHan, tyLe: sop.tyLeDungHan },
    slaQuyChe: { n: theoQuyChe.length, dungHan: datQuyChe, tyLe: theoQuyChe.length ? datQuyChe / theoQuyChe.length : null },
    kienCoBill: soKienBill,
    kienLoiChungTu: kienLoi,
    tyLeLoiChungTu: soKienBill > 0 ? kienLoi / soKienBill : null,
    soDonShipHo: Number(shipHo.rows[0]?.n ?? 0),
    kienCanPhanDinh: can,
    kienDaPhanDinh: da,
    kienTonDong: ton,
    gateDat: ton === 0,
    thuHoiVnd: Math.round(thu),
    thuocDienKhieuNaiVnd: Math.round(dien),
    tyLeThuHoi: dien > 0 ? thu / dien : null,
  };
}
