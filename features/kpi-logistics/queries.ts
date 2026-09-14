'use server';

/**
 * Số liệu tự động cho bảng KPI Logistics Operations Specialist — lấy thẳng từ hệ thống, không dùng bảng tự khai
 * (Quy chế mục IX). Kỳ = tháng lịch, lọc theo NGÀY GỬI (tạo vận đơn) để khớp với hoá đơn carrier của kỳ đó.
 */
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { docKienGiao } from '@/features/shipments/tieu-chuan-giao';
import { docKienGiaoShipHo, docChungTuShipHo } from './nguon-ship-ho';
import { STORE_VAN_HANH } from './pham-vi';
import { tomTatSuCo, type SuCoTomTat } from '@/features/ship-ho/su-co';
import { chamKpi, tongKpi, loaiTruDuoc, slaCuaNuoc, cuaSoNhinTuyen, type DongKpiNuoc } from '@/features/shipments/sop-giao-hang';
import { chamSizeThung, type KetQuaSizeThung } from '@/features/shipments/lech-can';
import { demTheoLyDo, loaiTruKhoiKpi, type DemLyDo } from '@/features/shipments/ly-do-cham';

export interface SoLieuTuDong {
  tu: string; den: string;
  /** 1.1 — đơn có cước carrier RÒNG (đã trừ tiền đòi lại được) vẫn vượt cước thu của khách. */
  soDonAmCuoc: number;
  amCuocVnd: number;
  /** 1.1 — trong số đó, bao nhiêu đơn ĐÃ được đối soát chốt là LỖI NỘI BỘ (`internal_error`).
   *  Đây mới là con số đúng để điền vào ô "quy trách nhiệm"; số tổng ở trên gồm cả lỗi hãng
   *  và đơn chưa ai xét. */
  soDonAmCuocLoiNoiBo: number;
  /** 1.1 — đơn âm cước chưa ai phân định đúng/sai. Còn tồn nghĩa là chưa đủ căn cứ chấm 1.1. */
  soDonAmCuocChuaXet: number;
  /** 1.1 — đơn từng âm cước nhưng đã HẾT âm sau khi trừ tiền carrier trả lại. */
  soDonHetAmNhoThuHoi: number;
  /** 1.1 — tổng tiền carrier đã trả lại cho các đơn từng âm cước trong kỳ. */
  thuHoiTruVaoCuocVnd: number;
  /** 1.2 — theo bảng SOP cam kết từng nước (D-067). SLA trong văn bản quy chế chỉ là mẫu, không dùng. */
  slaTong: { n: number; dungHan: number; tyLe: number | null };
  /**
   * 1.2 — chi tiết từng TUYẾN để biết nước nào kéo điểm. Nhìn CỬA SỔ 3 THÁNG kết thúc ở kỳ này,
   * không phải riêng tháng chấm điểm: một tháng cho mỗi tuyến quá ít kiện để kết luận
   * (CEO 14/09/2026 — xem `cuaSoNhinTuyen`). Điểm số vẫn chấm theo tháng ở `slaTong`.
   */
  slaTheoNuoc: DongKpiNuoc[];
  /** Khoảng thời gian thực sự dùng cho `slaTheoNuoc`, để hiện lên bảng cho khỏi hiểu nhầm. */
  cuaSoTuyen: { tu: string; den: string };
  /** 1.2 — kiện bị loại khỏi KPI theo Quy chế mục VII (lý do ngoài tầm kiểm soát), kèm phân loại lý do. */
  slaLoaiTru: number;
  lyDoCham: DemLyDo[];
  /** 1.4 — đóng đúng size thùng, đo bằng lệch cân tính cước vs cân carrier charge. */
  sizeThung: KetQuaSizeThung;
  /** 1.3 — kiện phát sinh phí sửa địa chỉ / xử lý chứng từ trên bill. */
  kienCoBill: number;
  kienLoiChungTu: number;
  tyLeLoiChungTu: number | null;
  /** P2 — đơn ship hộ đã giao/đã chốt cước trong kỳ. */
  soDonShipHo: number;
  /** P2 — sự cố ship hộ trong kỳ: tiền thật, tiền quy điểm, và hai điều kiện Gate. */
  suCo: SuCoTomTat;
  /** P3 Gate — kiện có bill của các kỳ ĐÃ QUA (bill về đủ lâu) mà vẫn chưa phân định đúng/sai. Tồn = 0 thì Gate đạt.
   *  Từ 12/09/2026 Gate còn đòi: mọi sự cố trong kỳ phải được GHI đúng hạn và quy được trách nhiệm. */
  kienCanPhanDinh: number;
  kienDaPhanDinh: number;
  kienTonDong: number;
  gateDat: boolean;
  /** 3C — tiền thu hồi = tổng credit note có NGÀY HOÁ ĐƠN trong kỳ (CEO 10/09/2026), lấy trị tuyệt đối. */
  thuHoiVnd: number;
  soCreditNote: number;
  /** Số cũ: cộng theo ngày ops bấm ghi nhận — giữ để đối chiếu khi số lệch. */
  thuHoiTheoNgayGhiNhan: number;
  thuocDienKhieuNaiVnd: number;
  tyLeThuHoi: number | null;
}

export async function docSoLieuKpi(tu: string, den: string): Promise<SoLieuTuDong> {
  const cuaSoTuyen = cuaSoNhinTuyen(tu);
  const [amCuoc, chungTu, shipHo, gate, creditNote, thuHoi, suCoRows, kienShopify, kienShipHo, kienRongShopify, kienRongShipHo, chungTuShipHo, canRows] = await Promise.all([
    db.execute<{ n: string; tong: string | null; loi_noi_bo: string; chua_xet: string; da_cuu: string; thu_hoi: string | null }>(sql`
      WITH bill AS (
        SELECT s.order_id, SUM(c.total_amount::numeric) AS billed
          FROM shipment_charges c JOIN shipments s ON s.id = c.shipment_id
         WHERE s.label_created_at >= ${`${tu} 00:00:00`}::timestamp AND s.label_created_at <= ${`${den} 23:59:59`}::timestamp
         GROUP BY 1),
      thu AS (
        SELECT s.order_id, SUM(COALESCE(r.recovered_vnd::numeric, 0)) AS thu_hoi,
               string_agg(DISTINCT r.status::text, ',') AS phan_dinh
          FROM shipments s JOIN shipment_reconcile_status r ON r.shipment_id = s.id
         WHERE s.label_created_at >= ${`${tu} 00:00:00`}::timestamp AND s.label_created_at <= ${`${den} 23:59:59`}::timestamp
         GROUP BY 1),
      am AS (
        SELECT bill.billed - COALESCE(thu.thu_hoi, 0) AS rong,
               COALESCE(thu.thu_hoi, 0) AS thu_hoi,
               o.total_shipping::numeric * COALESCE(st.fx_cost_per_order_currency::numeric, 1) AS khach_tra,
               thu.phan_dinh
          FROM bill JOIN shopify_orders o ON o.id = bill.order_id JOIN stores st ON st.id = o.store_id
          LEFT JOIN thu ON thu.order_id = bill.order_id
         WHERE st.shop_domain = ${STORE_VAN_HANH}
           AND bill.billed > o.total_shipping::numeric * COALESCE(st.fx_cost_per_order_currency::numeric, 1))
      SELECT COUNT(*) FILTER (WHERE rong > khach_tra)::text AS n,
             COALESCE(SUM(rong - khach_tra) FILTER (WHERE rong > khach_tra), 0)::text AS tong,
             COUNT(*) FILTER (WHERE rong > khach_tra AND phan_dinh LIKE '%internal_error%')::text AS loi_noi_bo,
             COUNT(*) FILTER (WHERE rong > khach_tra AND phan_dinh IS NULL)::text AS chua_xet,
             COUNT(*) FILTER (WHERE rong <= khach_tra)::text AS da_cuu,
             COALESCE(SUM(thu_hoi), 0)::text AS thu_hoi
        FROM am;`),
    // 1.3 chấm MỌI kiện có hoá đơn, gồm cả ship hộ (CEO 12/09/2026) → không lọc store.
    db.execute<{ tong: string; loi: string }>(sql`
      SELECT COUNT(*)::text AS tong,
             (COUNT(*) FILTER (WHERE COALESCE(c.address_correction::numeric, 0) > 0))::text AS loi
        FROM shipment_charges c JOIN shipments s ON s.id = c.shipment_id
        JOIN shopify_orders o ON o.id = s.order_id JOIN stores st ON st.id = o.store_id
       WHERE s.label_created_at >= ${`${tu} 00:00:00`}::timestamp AND s.label_created_at <= ${`${den} 23:59:59`}::timestamp;`),
    db.execute<{ n: string }>(sql`
      SELECT COUNT(*)::text AS n FROM ship_ho_orders
       WHERE status IN ('delivered', 'billed', 'settled')
         AND COALESCE(delivered_at, created_at) >= ${`${tu} 00:00:00`}::timestamp
         AND COALESCE(delivered_at, created_at) <= ${`${den} 23:59:59`}::timestamp;`),
    // Gate đo TỒN ĐỌNG chứ không đo kiện trong kỳ: hoá đơn carrier về trễ (quy chế chi trả gối 1 kỳ), nên kiện vừa gửi
    // trong tháng chưa thể phân định xong. Đếm kiện có bill mà NGÀY GỬI trước đầu kỳ chấm và vẫn chưa ai phân định.
    // Cùng PHẠM VI với Pillar 1 (D-072): chỉ kiện của store MEAN BLVD. Kiện brand khác
    // đối soát ở luồng ship hộ, để lẫn vào đây thì Gate của nhân sự MEAN bị treo vì
    // tồn đọng của brand mà họ không phụ trách.
    db.execute<{ can: string; da: string; ton: string }>(sql`
      SELECT COUNT(*)::text AS can, (COUNT(r.id))::text AS da,
             (COUNT(*) FILTER (WHERE r.id IS NULL AND s.label_created_at < ${`${tu} 00:00:00`}::timestamp))::text AS ton
        FROM shipment_charges c JOIN shipments s ON s.id = c.shipment_id
        JOIN shopify_orders o ON o.id = s.order_id JOIN stores st ON st.id = o.store_id
        LEFT JOIN shipment_reconcile_status r ON r.shipment_id = s.id
       WHERE st.shop_domain = ${STORE_VAN_HANH}
         AND s.label_created_at <= ${`${den} 23:59:59`}::timestamp;`),
    db.execute<{ tong: string | null; n: string }>(sql`
      SELECT SUM(ABS(tong_cong::numeric))::text AS tong, COUNT(*)::text AS n
        FROM credit_notes WHERE loai = 'credit' AND ngay >= ${tu}::date AND ngay <= ${den}::date;`),
    db.execute<{ thu: string | null; dien: string | null }>(sql`
      SELECT SUM(COALESCE(recovered_vnd::numeric, 0))::text AS thu,
             -- Thuộc diện khiếu nại = mọi dòng ta xác định HÃNG SAI: đang đòi, đã có credit note, hoặc mới flag.
             SUM(ABS(COALESCE(delta_vnd_at_review::numeric, 0))) FILTER (WHERE status IN ('carrier_error', 'disputing', 'credited'))::text AS dien
        FROM shipment_reconcile_status
       WHERE reconciled_at >= ${`${tu} 00:00:00`}::timestamp AND reconciled_at <= ${`${den} 23:59:59`}::timestamp;`),
    db.execute<{ loai: string; thuoc_ve: string; tong: string; thu_hoi: string; ngay: string; ghi: string; dien_bien: unknown; co_tien_hang: boolean; da_chot_tien: boolean }>(sql`
      SELECT loai, thuoc_ve, tong_chi_phi_vnd::text AS tong, da_thu_hoi_vnd::text AS thu_hoi,
             ngay::text AS ngay, created_at::text AS ghi, dien_bien, co_tien_hang, da_chot_tien
        FROM ship_ho_su_co
       WHERE ngay >= ${tu}::date AND ngay <= ${den}::date;`),
    // 1.2 cũng chấm mọi kiện: null = không lọc store; kiện ship hộ từ Lark cộng thêm ngay dưới.
    docKienGiao(tu, den, null),
    docKienGiaoShipHo(tu, den),
    // Cửa sổ rộng CHỈ cho bảng tuyến — đọc riêng, không đụng vào mẫu số chấm điểm.
    docKienGiao(cuaSoTuyen.tu, cuaSoTuyen.den, null),
    docKienGiaoShipHo(cuaSoTuyen.tu, cuaSoTuyen.den),
    docChungTuShipHo(tu, den),
    db.execute<{ thuc: string | null; d: string | null; r: string | null; c: string | null; billed: string | null }>(sql`
      SELECT s.actual_weight_kg::text AS thuc, s.dim_length_cm::text AS d, s.dim_width_cm::text AS r,
             s.dim_height_cm::text AS c, c.billing_weight_kg::text AS billed
        FROM shipments s JOIN shipment_charges c ON c.shipment_id = s.id
        JOIN shopify_orders o ON o.id = s.order_id JOIN stores st ON st.id = o.store_id
       WHERE st.shop_domain = ${STORE_VAN_HANH}
         AND s.label_created_at >= ${`${tu} 00:00:00`}::timestamp AND s.label_created_at <= ${`${den} 23:59:59`}::timestamp;`),
  ]);

  // Quy chế mục VII: kiện chậm vì khách / hải quan ngoài / thiên tai không tính vào KPI nhân sự.
  // (SOP đo trải nghiệm khách thì vẫn tính mọi kiện — xem tab Tiêu chuẩn giao.)
  const kienGiao = [...kienShopify, ...kienShipHo];
  // Lý do ngoài tầm kiểm soát chỉ gỡ được kiện ĐANG TRỄ. Kiện đạt cam kết mà lỡ bị gán lý do
  // vẫn ở lại mẫu số — xem `loaiTruDuoc`.
  const tinhKpi = kienGiao.filter((k) => !(loaiTruKhoiKpi(k.lyDoCham) && loaiTruDuoc(k, slaCuaNuoc(k.country))));
  const sop = tongKpi(chamKpi(tinhKpi, tu), tu);
  // Bảng tuyến chấm trên cửa sổ rộng, dùng cùng luật lọc lý do.
  const kienRong = [...kienRongShopify, ...kienRongShipHo]
    .filter((k) => !(loaiTruKhoiKpi(k.lyDoCham) && loaiTruDuoc(k, slaCuaNuoc(k.country))));
  const theoNuoc = chamKpi(kienRong, tu);
  const so = (v: string | null) => (v == null ? null : Number(v));
  const sizeThung = chamSizeThung(canRows.rows.map((r) => ({
    thucKg: so(r.thuc), daiCm: so(r.d), rongCm: so(r.r), caoCm: so(r.c), billedKg: so(r.billed),
  })));

  const suCo = tomTatSuCo(suCoRows.rows.map((r) => ({
    loai: r.loai, thuocVe: r.thuoc_ve,
    tongChiPhiVnd: Number(r.tong), daThuHoiVnd: Number(r.thu_hoi),
    ngay: r.ngay, ngayGhi: r.ghi,
    dienBien: Array.isArray(r.dien_bien) ? (r.dien_bien as string[]) : [],
    coTienHangThat: r.co_tien_hang,
    daChotTien: r.da_chot_tien,
  })));
  const soKienBill = Number(chungTu.rows[0]?.tong ?? 0) + chungTuShipHo.kienCoBill;
  const kienLoi = Number(chungTu.rows[0]?.loi ?? 0) + chungTuShipHo.kienLoi;
  const can = Number(gate.rows[0]?.can ?? 0);
  const da = Number(gate.rows[0]?.da ?? 0);
  const ton = Number(gate.rows[0]?.ton ?? 0);
  const thuCu = Number(thuHoi.rows[0]?.thu ?? 0);
  const dien = Number(thuHoi.rows[0]?.dien ?? 0);
  const thu = Number(creditNote.rows[0]?.tong ?? 0);

  return {
    tu, den,
    soDonAmCuoc: Number(amCuoc.rows[0]?.n ?? 0),
    amCuocVnd: Math.round(Number(amCuoc.rows[0]?.tong ?? 0)),
    soDonAmCuocLoiNoiBo: Number(amCuoc.rows[0]?.loi_noi_bo ?? 0),
    soDonAmCuocChuaXet: Number(amCuoc.rows[0]?.chua_xet ?? 0),
    soDonHetAmNhoThuHoi: Number(amCuoc.rows[0]?.da_cuu ?? 0),
    thuHoiTruVaoCuocVnd: Math.round(Number(amCuoc.rows[0]?.thu_hoi ?? 0)),
    slaTong: { n: sop.n, dungHan: sop.dungHan, tyLe: sop.tyLeDungHan },
    slaTheoNuoc: theoNuoc,
    cuaSoTuyen,
    slaLoaiTru: kienGiao.length - tinhKpi.length,
    lyDoCham: demTheoLyDo(kienGiao.filter((k) => k.lyDoCham != null || k.soNgay > 20).map((k) => k.lyDoCham)),
    sizeThung,
    kienCoBill: soKienBill,
    kienLoiChungTu: kienLoi,
    tyLeLoiChungTu: soKienBill > 0 ? kienLoi / soKienBill : null,
    soDonShipHo: Number(shipHo.rows[0]?.n ?? 0),
    suCo,
    kienCanPhanDinh: can,
    kienDaPhanDinh: da,
    kienTonDong: ton,
    // Gate đòi CẢ BA: hết tồn đọng đối soát, mọi sự cố ghi đúng hạn, và mọi sự cố đã quy được
    // trách nhiệm. Giấu hoặc ghi muộn một sự cố thì mất toàn bộ Pillar 3 — nếu không, không ai
    // có động cơ ghi sự cố của chính mình (CEO 12/09/2026).
    gateDat: ton === 0 && suCo.nGhiTre === 0 && suCo.nChuaQuyTrachNhiem === 0,
    thuHoiVnd: Math.round(thu),
    soCreditNote: Number(creditNote.rows[0]?.n ?? 0),
    thuHoiTheoNgayGhiNhan: Math.round(thuCu),
    thuocDienKhieuNaiVnd: Math.round(dien),
    tyLeThuHoi: dien > 0 ? thu / dien : null,
  };
}
