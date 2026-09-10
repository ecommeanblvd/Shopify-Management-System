/**
 * Tiêu chuẩn thời gian giao hàng: từ NGÀY GỬI (tạo vận đơn, `shipments.label_created_at`) đến NGÀY KHÁCH NHẬN
 * (`shipments.delivered_at`), tính trên TOÀN BỘ kiện đã ghi nhận giao — tách theo line ship (carrier) và quốc gia.
 * CEO 10/09/2026: "để chúng ta có được standard cho việc vận chuyển tiêu chuẩn".
 *
 * Vì sao dùng phân vị chứ không chỉ trung bình: vài kiện kẹt hải quan kéo dài (max 244 ngày) làm trung bình lệch hẳn.
 * Chuẩn cam kết lấy P90 làm tròn lên — "9/10 kiện giao trong ≤ X ngày"; P50 là mức thường gặp.
 *
 * NGOẠI LỆ (CEO 10/09/2026): kiện quá `nguongNgoaiLe` ngày gần như luôn là hàng ĐÃ TỚI NƠI nhưng không liên hệ được khách
 * để giao, hoặc kẹt thông quan vì thiếu giấy tờ — không phải tốc độ của line ship. Những kiện này bị TÁCH khỏi phần tính
 * chuẩn và đếm riêng thành tỉ lệ ngoại lệ; hệ thống chưa có trường ghi NGUYÊN NHÂN nên chỉ tách được theo ngưỡng.
 *
 * Lưu ý dữ liệu: ngày giao nhập từ Lark (ops) + POD bill carrier + tracking. Trước 12/2025 hầu như không ghi nhận
 * (xem `doPhuTheoNam`) nên số của 2025 chỉ là những kiện có người nhập tay — lệch cao. Bảng UI phải nói rõ điều này.
 */
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';

export const PHAM_VI = ['tat-ca', '12t', '6t', '3t'] as const;
export type PhamVi = (typeof PHAM_VI)[number];
export const NHAN_PHAM_VI: Record<PhamVi, string> = {
  'tat-ca': 'Toàn bộ', '12t': '12 tháng', '6t': '6 tháng', '3t': '3 tháng',
};
/** Số tháng lùi lại của phạm vi; null = không giới hạn. */
export const THANG_CUA_PHAM_VI: Record<PhamVi, number | null> = { 'tat-ca': null, '12t': 12, '6t': 6, '3t': 3 };

export function chuanHoaPhamVi(raw: string | undefined | null): PhamVi {
  return (PHAM_VI as readonly string[]).includes(raw ?? '') ? (raw as PhamVi) : 'tat-ca';
}

/** Dưới ngưỡng này thì mẫu quá nhỏ để chốt chuẩn — UI hiện "ít dữ liệu" thay vì con số cam kết. */
export const NGUONG_DU_LIEU = 10;

/** Ngưỡng ngày để coi một kiện là NGOẠI LỆ (giao chậm do khách/thông quan, không phải do line). null = không tách. */
export const NGUONG_NGOAI_LE = [14, 20, 30] as const;
export type NguongNgoaiLe = (typeof NGUONG_NGOAI_LE)[number] | null;
export const NGUONG_MAC_DINH: NguongNgoaiLe = 20;

export function chuanHoaNguong(raw: string | undefined | null): NguongNgoaiLe {
  if (raw === 'tat-ca') return null;
  const n = Number(raw);
  return (NGUONG_NGOAI_LE as readonly number[]).includes(n) ? (n as NguongNgoaiLe) : NGUONG_MAC_DINH;
}

export interface DongTieuChuan {
  /** Line ship: 'fedex' | 'dhl' | 'aramex' | '?' (chưa gán). Rỗng ở dòng gộp mọi line. */
  line: string;
  /** ISO-2 nước đích; rỗng ở dòng gộp mọi nước. */
  country: string;
  /** Kiện đã tạo vận đơn trong phạm vi (mẫu số độ phủ). */
  soDaGui: number;
  /** Trong đó đã ghi nhận giao và ngày giao ≥ ngày gửi. */
  soDaGiao: number;
  /** Kiện đã giao nhưng quá ngưỡng ngoại lệ — KHÔNG tính vào các số dưới. 0 khi không tách ngoại lệ. */
  soNgoaiLe: number;
  /** Kiện thực sự dùng để tính chuẩn = soDaGiao − soNgoaiLe. */
  soTinhChuan: number;
  tbNgay: number | null;
  p50: number | null;
  p75: number | null;
  p90: number | null;
  minNgay: number | null;
  /** Chậm nhất trong nhóm giao BÌNH THƯỜNG (đã trừ ngoại lệ). */
  maxNgay: number | null;
  /** Chậm nhất trong nhóm NGOẠI LỆ — để thấy đuôi dài tới đâu. */
  maxNgoaiLe: number | null;
}

/** Chuẩn cam kết đề xuất = P90 làm tròn LÊN (ngày), tính trên nhóm giao bình thường. null khi mẫu < NGUONG_DU_LIEU. */
export function chuanDeXuat(row: Pick<DongTieuChuan, 'p90' | 'soTinhChuan'>): number | null {
  if (row.p90 == null || row.soTinhChuan < NGUONG_DU_LIEU) return null;
  return Math.max(1, Math.ceil(row.p90));
}

/** Tỉ lệ kiện ngoại lệ trên tổng kiện đã giao — 0..1; null khi chưa có kiện giao nào. */
export function tyLeNgoaiLe(row: Pick<DongTieuChuan, 'soDaGiao' | 'soNgoaiLe'>): number | null {
  return row.soDaGiao > 0 ? row.soNgoaiLe / row.soDaGiao : null;
}

/** Độ phủ ghi nhận giao (soDaGiao / soDaGui) — 0..1; null khi chưa gửi kiện nào. */
export function doPhu(row: Pick<DongTieuChuan, 'soDaGui' | 'soDaGiao'>): number | null {
  return row.soDaGui > 0 ? row.soDaGiao / row.soDaGui : null;
}

export interface NhomNuoc {
  /** Dòng gộp mọi line của nước đó. */
  tong: DongTieuChuan;
  /** Từng line chạy tuyến này, sắp theo số kiện giao giảm dần. */
  lines: DongTieuChuan[];
}

/**
 * THUẦN: ghép dòng gộp theo nước với các dòng line của chính nước đó để bảng hiện "nước → từng line".
 * Nước sắp theo số kiện đã giao giảm dần (tuyến nhiều dữ liệu lên trước); nước chưa có kiện giao nào bị bỏ.
 */
export function gomTheoNuoc(theoNuoc: DongTieuChuan[], theoLineNuoc: DongTieuChuan[]): NhomNuoc[] {
  return theoNuoc
    .filter((n) => n.soDaGiao > 0)
    .map((tong) => ({
      tong,
      lines: theoLineNuoc
        .filter((l) => l.country === tong.country && l.soDaGiao > 0)
        .sort((a, b) => b.soDaGiao - a.soDaGiao),
    }))
    .sort((a, b) => b.tong.soDaGiao - a.tong.soDaGiao);
}

export interface DoPhuNam { nam: string; soDaGui: number; soDaGiao: number }

/** Một kiện ngoại lệ để ops truy nguyên nhân (hệ thống chưa lưu lý do). */
export interface KienNgoaiLe {
  maDon: string; country: string; line: string; soNgay: number; ngayGui: string; ngayGiao: string;
}

export interface TieuChuanGiao {
  phamVi: PhamVi;
  /** Ngưỡng ngày tách ngoại lệ đang áp dụng; null = không tách. */
  nguongNgoaiLe: NguongNgoaiLe;
  /** Gộp toàn bộ (mọi line, mọi nước). */
  tong: DongTieuChuan;
  theoLine: DongTieuChuan[];
  theoNuoc: DongTieuChuan[];
  theoLineNuoc: DongTieuChuan[];
  /** Độ phủ ghi nhận giao theo năm gửi — để lộ khoảng thời gian dữ liệu không đáng tin. */
  doPhuTheoNam: DoPhuNam[];
  /** Kiện ngoại lệ chậm nhất (tối đa 30) — danh sách để ops truy. */
  dsNgoaiLe: KienNgoaiLe[];
  /** Ngày gửi đầu/cuối và ngày giao mới nhất có trong phạm vi (ISO date). */
  guiTu: string | null;
  guiDen: string | null;
  giaoMoiNhat: string | null;
}

type Row = {
  line: string | null; country: string | null;
  da_gui: string; da_giao: string; ngoai_le: string;
  tb: string | null; p50: string | null; p75: string | null; p90: string | null; min_d: string | null; max_d: string | null; max_nl: string | null;
};
const so = (v: string | null) => (v == null ? null : Number(v));
const doc = (r: Row): DongTieuChuan => {
  const soDaGiao = Number(r.da_giao); const soNgoaiLe = Number(r.ngoai_le);
  return {
    line: r.line ?? '?', country: r.country ?? '?',
    soDaGui: Number(r.da_gui), soDaGiao, soNgoaiLe, soTinhChuan: soDaGiao - soNgoaiLe,
    tbNgay: so(r.tb), p50: so(r.p50), p75: so(r.p75), p90: so(r.p90),
    minNgay: so(r.min_d), maxNgay: so(r.max_d), maxNgoaiLe: so(r.max_nl),
  };
};

export async function docTieuChuanGiao(phamVi: PhamVi, nguongNgoaiLe: NguongNgoaiLe = NGUONG_MAC_DINH): Promise<TieuChuanGiao> {
  const thang = THANG_CUA_PHAM_VI[phamVi];
  // Lọc phạm vi theo NGÀY GỬI (không phải ngày giao) — "kiện đi trong khoảng này mất bao lâu".
  const trongPhamVi = thang == null
    ? sql`TRUE`
    : sql`s.label_created_at >= date_trunc('month', NOW()) - (${thang}::int * INTERVAL '1 month')`;
  // Kiện tính được số ngày: có cả hai mốc và ngày giao KHÔNG sớm hơn ngày gửi (64 dòng nhập tay bị ngược — loại).
  const daGiao = sql`s.delivered_at IS NOT NULL AND s.delivered_at::timestamp >= s.label_created_at`;
  const ngay = sql`EXTRACT(EPOCH FROM (s.delivered_at::timestamp - s.label_created_at)) / 86400`;
  // Ngoại lệ: đã giao nhưng quá ngưỡng. Không tách → mọi kiện đã giao đều vào phần tính chuẩn.
  const laNgoaiLe = nguongNgoaiLe == null ? sql`FALSE` : sql`${daGiao} AND ${ngay} > ${nguongNgoaiLe}::numeric`;
  const tinhChuan = sql`${daGiao} AND NOT (${laNgoaiLe})`;
  const cot = sql`
    COUNT(*)::text AS da_gui,
    (COUNT(*) FILTER (WHERE ${daGiao}))::text AS da_giao,
    (COUNT(*) FILTER (WHERE ${laNgoaiLe}))::text AS ngoai_le,
    ROUND((AVG(${ngay}) FILTER (WHERE ${tinhChuan}))::numeric, 1)::text AS tb,
    ROUND((percentile_cont(0.5) WITHIN GROUP (ORDER BY ${ngay}) FILTER (WHERE ${tinhChuan}))::numeric, 1)::text AS p50,
    ROUND((percentile_cont(0.75) WITHIN GROUP (ORDER BY ${ngay}) FILTER (WHERE ${tinhChuan}))::numeric, 1)::text AS p75,
    ROUND((percentile_cont(0.9) WITHIN GROUP (ORDER BY ${ngay}) FILTER (WHERE ${tinhChuan}))::numeric, 1)::text AS p90,
    ROUND((MIN(${ngay}) FILTER (WHERE ${tinhChuan}))::numeric, 1)::text AS min_d,
    ROUND((MAX(${ngay}) FILTER (WHERE ${tinhChuan}))::numeric, 1)::text AS max_d,
    ROUND((MAX(${ngay}) FILTER (WHERE ${laNgoaiLe}))::numeric, 1)::text AS max_nl`;
  const tuBang = sql`FROM shipments s JOIN shopify_orders o ON o.id = s.order_id
    WHERE s.label_created_at IS NOT NULL AND ${trongPhamVi}`;

  const [tong, theoLine, theoNuoc, theoLineNuoc, moc, doPhuNam, dsNgoaiLe] = await Promise.all([
    db.execute<Row>(sql`SELECT NULL::text AS line, NULL::text AS country, ${cot} ${tuBang};`),
    db.execute<Row>(sql`SELECT s.carrier_key AS line, NULL::text AS country, ${cot} ${tuBang} GROUP BY 1 ORDER BY 3 DESC;`),
    db.execute<Row>(sql`SELECT NULL::text AS line, COALESCE(o.ship_country, '?') AS country, ${cot} ${tuBang} GROUP BY 2;`),
    db.execute<Row>(sql`SELECT s.carrier_key AS line, COALESCE(o.ship_country, '?') AS country, ${cot} ${tuBang} GROUP BY 1, 2;`),
    db.execute<{ tu: string | null; den: string | null; giao: string | null }>(sql`
      SELECT MIN(s.label_created_at)::date::text AS tu, MAX(s.label_created_at)::date::text AS den,
             MAX(s.delivered_at)::date::text AS giao ${tuBang};`),
    db.execute<{ nam: string; gui: string; giao: string }>(sql`
      SELECT to_char(s.label_created_at, 'YYYY') AS nam, COUNT(*)::text AS gui,
             (COUNT(*) FILTER (WHERE ${daGiao}))::text AS giao
      FROM shipments s WHERE s.label_created_at IS NOT NULL AND ${trongPhamVi} GROUP BY 1 ORDER BY 1;`),
    db.execute<{ ma: string; country: string | null; line: string | null; ngay: string; gui: string; giao: string }>(sql`
      SELECT o.shopify_order_number AS ma, o.ship_country AS country, s.carrier_key AS line,
             ROUND(${ngay}::numeric, 1)::text AS ngay,
             s.label_created_at::date::text AS gui, s.delivered_at::date::text AS giao
      ${tuBang} AND ${laNgoaiLe} ORDER BY ${ngay} DESC LIMIT 30;`),
  ]);

  return {
    phamVi,
    nguongNgoaiLe,
    tong: doc(tong.rows[0]),
    theoLine: theoLine.rows.map(doc),
    theoNuoc: theoNuoc.rows.map(doc),
    theoLineNuoc: theoLineNuoc.rows.map(doc),
    doPhuTheoNam: doPhuNam.rows.map((r) => ({ nam: r.nam, soDaGui: Number(r.gui), soDaGiao: Number(r.giao) })),
    dsNgoaiLe: dsNgoaiLe.rows.map((r) => ({
      maDon: r.ma, country: r.country ?? '?', line: r.line ?? '?', soNgay: Number(r.ngay), ngayGui: r.gui, ngayGiao: r.giao,
    })),
    guiTu: moc.rows[0]?.tu ?? null,
    guiDen: moc.rows[0]?.den ?? null,
    giaoMoiNhat: moc.rows[0]?.giao ?? null,
  };
}
