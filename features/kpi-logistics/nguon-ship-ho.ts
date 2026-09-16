/**
 * Đọc kiện SHIP HỘ (đơn Đức lên trên Lark, bảng `ship_ho_orders`) theo đúng hình dạng mà
 * tiêu chí 1.2 và 1.3 của Pillar 1 cần, để cộng cùng kiện Shopify thành một mẫu số
 * (CEO 12/09/2026 — xem `pham-vi.ts`).
 *
 * Vì sao tách file: kiện ship hộ ở bảng khác, MỐC GỬI cũng khác — `shipments` có
 * `label_created_at` là mốc giờ thật, còn `ship_ho_orders.shipped_at` chỉ là NGÀY. Trộn hai
 * truy vấn vào một chỗ thì lần sau không ai nhớ là đang cộng hai thước; để riêng thì chỗ quy
 * đổi nằm đúng một nơi.
 *
 * Số ngày kẹp về 0: `shipped_at` là ngày còn `delivered_at` là mốc giờ, kiện giao ngay trong
 * ngày gửi sẽ ra số âm vì lệch múi giờ — âm không có nghĩa là giao trước khi gửi.
 *
 * `shipmentId` trên dòng bảng chi tiết mang id của ĐƠN SHIP HỘ, không phải id `shipments`;
 * đi kèm `nguon: 'ship_ho'` để ô chọn lý do ghi đúng bảng.
 */
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { slaCuaNuoc, slaCuaLine, NUOC_LOAI_TRU, NGUONG_NGOAI_LE_SOP, type KienGiao } from '@/features/shipments/sop-giao-hang';
import { lyDoCoHieuLuc } from '@/features/shipments/ly-do-cham';
import { xepLoaiSla, type DongSla, type DongChungTu } from './chi-tiet';
import { nhanShipHo } from './pham-vi';

/** Số ngày từ NGÀY gửi tới mốc giao, kẹp về 0 và làm tròn 1 chữ số. */
export function soNgayShipHo(ngayGui: string, mocGiao: string): number {
  const ms = new Date(mocGiao).getTime() - new Date(`${ngayGui.slice(0, 10)}T00:00:00Z`).getTime();
  return Math.max(0, Math.round((ms / 86_400_000) * 10) / 10);
}

type RowGiao = { id: string; code: string; brand: string | null; tk: string | null; cc: string | null; line: string | null; gui: string; giao: string; chua_giao: boolean; dang_hoan: boolean; ly_do: string | null; doi_chieu: string | null; bang_chung: string | null; su_co_noi_bo: number };

/**
 * `su_co_noi_bo` > 0 nghĩa là đơn có sự cố quy về lỗi nội bộ → kiện bị KHOÁ THÀNH TRỄ dù số
 * ngày nằm trong cam kết (CEO 12/09/2026). Ca ship sai địa chỉ thường kết thúc bằng kiện gửi
 * lại giao đúng hạn; chấm theo kiện đó thì lỗi biến mất khỏi tỉ lệ.
 *
 * Kiện có sự cố nội bộ vào mẫu số KỂ CẢ KHI CHƯA GIAO. Kiện bình thường chưa giao thì chưa chấm
 * được nên phải loại, nhưng kiện đi sai địa chỉ rồi hoàn về thì KHÔNG BAO GIỜ có ngày giao — nếu
 * vẫn đòi `delivered_at` thì đúng ca hỏng nặng nhất lại vô hình với tiêu chí 1.2. Kiện như vậy
 * lấy ngày hôm nay làm mốc để ra số ngày, và luôn bị tính trễ.
 */
async function docGiao(tu: string, den: string): Promise<RowGiao[]> {
  const { rows } = await db.execute<RowGiao>(sql`
    SELECT o.id, o.code, o.partner_brand_slug AS brand, o.tracking_number AS tk,
           COALESCE(o.country, '?') AS cc, COALESCE(o.carrier_key, '?') AS line,
           o.shipped_at::text AS gui,
           COALESCE(o.delivered_at::text, now()::text) AS giao,
           (o.delivered_at IS NULL) AS chua_giao,
           (o.delivery_status = 'returning') AS dang_hoan,
           o.ly_do_cham AS ly_do, o.ly_do_doi_chieu AS doi_chieu, o.ly_do_bang_chung AS bang_chung,
           (SELECT COUNT(*) FROM ship_ho_su_co s WHERE s.order_id = o.id AND s.thuoc_ve = 'noi_bo')::int AS su_co_noi_bo
      FROM ship_ho_orders o
     WHERE o.shipped_at IS NOT NULL
       AND o.shipped_at >= ${tu}::date AND o.shipped_at <= ${den}::date
     ORDER BY o.shipped_at, o.code;`);
  return rows;
}

/**
 * 1.2 — kiện ship hộ đã giao xong, dạng dùng cho `chamKpi`/`tongKpi`, cùng hình dạng với
 * `docKienGiao` để cộng thẳng vào cùng một mảng, gồm cả `lyDoCham` để bộ lọc mẫu số dùng
 * chung một luật cho cả hai luồng.
 */
export async function docKienGiaoShipHo(tu: string, den: string): Promise<Array<KienGiao & { lyDoCham: string | null; lyDoDoiChieu: string | null }>> {
  const rows = await docGiao(tu, den);
  return rows.map((r) => ({
    country: (r.cc ?? '?').trim().toUpperCase(),
    line: (r.line ?? '?').trim().toLowerCase(),
    soNgay: soNgayShipHo(r.gui, r.giao),
    // Kiện đang hoàn về sẽ KHÔNG BAO GIỜ tới tay khách — trễ chắc chắn, không chờ hết hạn.
    buocTre: r.su_co_noi_bo > 0 || r.dang_hoan,
    chuaGiao: r.chua_giao,
    lyDoCham: r.ly_do,
    lyDoDoiChieu: r.doi_chieu,
  }));
}

/** 1.2 — cùng số kiện đó nhưng dạng dòng bảng chi tiết. */
export async function docSlaShipHo(tu: string, den: string): Promise<DongSla[]> {
  const rows = await docGiao(tu, den);
  return rows.map((r) => {
    const nuoc = (r.cc ?? '?').trim().toUpperCase();
    const line = (r.line ?? '?').trim().toLowerCase();
    const soNgay = soNgayShipHo(r.gui, r.giao);
    // Kiện có sự cố lỗi nội bộ hoặc đang hoàn về thì KHÔNG được loại, dù có lý do hay nước nằm
    // trong danh sách loại trừ — lỗi của mình phải ở lại mẫu số.
    const buocTre = r.su_co_noi_bo > 0 || r.dang_hoan;
    const slaNgay = slaCuaNuoc(nuoc);
    // Lý do chỉ gỡ được kiện ĐANG TRỄ, giống hệt luật bên kiện Shopify.
    const biLoaiTru = !buocTre && ((lyDoCoHieuLuc(r.ly_do, r.doi_chieu) && soNgay > slaNgay) || nuoc in NUOC_LOAI_TRU);
    const ketQua = buocTre && !biLoaiTru
      ? (soNgay <= NGUONG_NGOAI_LE_SOP ? 'tre' as const : 'ngoai_le' as const)
      : xepLoaiSla(soNgay, slaNgay, biLoaiTru, NGUONG_NGOAI_LE_SOP, r.chua_giao);
    return {
      shipmentId: r.id, nguon: 'ship_ho' as const, thuocVe: nhanShipHo(r.brand),
      maDon: r.code, tracking: r.tk, nuoc, line,
      ngayGui: r.gui.slice(0, 10), ngayGiao: r.chua_giao ? '' : r.giao.slice(0, 10),
      soNgay, slaNgay, slaLineNgay: slaCuaLine(nuoc, line), ketQua, lyDoCham: r.ly_do,
      lyDoDoiChieu: r.doi_chieu, lyDoBangChung: r.bang_chung,
      chuaGiao: r.chua_giao,
    };
  });
}

export interface ChungTuShipHo { kienCoBill: number; kienLoi: number; dong: DongChungTu[] }

/**
 * 1.3 — phí sửa địa chỉ của kiện ship hộ. Nguồn là `actual_bill_breakdown` (JSON bóc từ hoá
 * đơn carrier thật), khoá `addressCorrection`; kiện chưa có hoá đơn KHÔNG vào mẫu số, giống
 * bên Shopify chỉ đếm kiện có bill.
 */
export async function docChungTuShipHo(tu: string, den: string): Promise<ChungTuShipHo> {
  const { rows } = await db.execute<{ code: string; brand: string | null; tk: string | null; cc: string | null; gui: string; phi: string | null; tong: string | null }>(sql`
    SELECT o.code, o.partner_brand_slug AS brand, o.tracking_number AS tk, o.country AS cc,
           o.shipped_at::text AS gui,
           (o.actual_bill_breakdown->>'addressCorrection') AS phi,
           o.actual_carrier_cost_vnd::text AS tong
      FROM ship_ho_orders o
     WHERE o.actual_bill_breakdown IS NOT NULL
       AND o.shipped_at IS NOT NULL AND o.shipped_at >= ${tu}::date AND o.shipped_at <= ${den}::date;`);
  const dong: DongChungTu[] = [];
  for (const r of rows) {
    const phi = Math.round(Number(r.phi ?? 0));
    if (!Number.isFinite(phi) || phi <= 0) continue;
    dong.push({
      nguon: 'ship_ho', thuocVe: nhanShipHo(r.brand),
      maDon: r.code, tracking: r.tk, nuoc: r.cc, ngayGui: r.gui.slice(0, 10),
      phiSuaDiaChiVnd: phi, tongBillVnd: Math.round(Number(r.tong ?? 0)),
    });
  }
  return { kienCoBill: rows.length, kienLoi: dong.length, dong };
}
