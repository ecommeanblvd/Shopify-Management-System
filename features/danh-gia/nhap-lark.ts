/**
 * Nhập 45 đánh giá từ bảng Lark `Truspilot Review` (CEO 28/09).
 *
 * CỐ Ý KHÔNG có `'use server'` — việc của script. CHỈ ĐỌC Lark.
 *
 * Ba chỗ dữ liệu gốc phải xử lý, đã đo trước:
 *  1. `Country` hỏng — 22/45 dòng trả về cả 75 quốc gia. Lọc bằng quy tắc dấu phẩy.
 *  2. Mã đơn / email / tên sản phẩm nằm ở HAI cột (lookup + "Data cũ") — gộp.
 *  3. `Reason` lẫn cả lời khách và ghi chú CX. KHÔNG tự đoán tách: nhập vào
 *     `noi_dung` và ghi rõ trong `ghi_chu_cx` để CX chuyển tay khi rà.
 *
 * Chạy lại vô hại: `lark_record_id` UNIQUE.
 */
import { sql } from 'drizzle-orm';
import { ngayKinhDoanh } from '@/lib/timezone';
import { db, schema } from '@/db/client';
import { locQuocGia, mapKenh, mapTrang, mapTrangThai, soSaoHopLe } from './phan-loai';

const DOMAIN = process.env.LARK_DOMAIN || 'https://open.larksuite.com';
const APP = 'EaPswVhWEi8MnckszPAluuq8gZg';
const TBL = 'tblOvLCB2Btkss6a';

const NHAC =
  'Nhập từ bảng Lark "Truspilot Review". Nội dung mang từ cột `Reason` — cột đó lẫn '
  + 'cả lời khách và ghi chú phân tích của CX, nên nếu đây là ghi chú nội bộ thì '
  + 'chuyển sang ô ghi chú CX khi rà.';

const chu = (v: unknown): string => {
  if (v == null) return '';
  if (Array.isArray(v)) {
    return v.map((x) => {
      if (x == null) return '';
      if (typeof x === 'object') {
        const o = x as { text?: string; name?: string; link?: string; value?: unknown };
        if (typeof o.text === 'string') return o.text;
        if (typeof o.name === 'string') return o.name;
        if (typeof o.link === 'string') return o.link;
        if (Array.isArray(o.value)) return chu(o.value);
        return '';
      }
      return String(x);
    }).join('');
  }
  if (typeof v === 'object') {
    const o = v as { text?: string; name?: string; link?: string; value?: unknown };
    if (typeof o.text === 'string') return o.text;
    if (typeof o.name === 'string') return o.name;
    if (typeof o.link === 'string') return o.link;
    if (Array.isArray(o.value)) return chu(o.value);
    return '';
  }
  return String(v);
};

const mang = (v: unknown): string[] => {
  if (v == null) return [];
  if (Array.isArray(v)) {
    return v.map((x) => (typeof x === 'object' && x !== null
      ? ((x as { text?: string; name?: string }).text ?? (x as { name?: string }).name ?? '')
      : String(x)))
      .map((s) => s.trim())
      .filter((s) => s !== '' && s !== ',');
  }
  const s = chu(v).trim();
  return s ? [s] : [];
};

/** Gộp cặp cột lookup + "Data cũ": lấy lookup trước, thiếu thì lấy cột cũ. */
const gop = (f: Record<string, unknown>, lookup: string, cu: string): string | null =>
  (mang(f[lookup])[0]?.trim() || chu(f[cu]).trim()) || null;

const ngayVn = (v: unknown): string | null => {
  if (typeof v !== 'number') return null;
  const d = new Date(v + 7 * 3_600_000);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};

async function token(): Promise<string> {
  const r = await fetch(`${DOMAIN}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: process.env.LARK_APP_ID, app_secret: process.env.LARK_APP_SECRET }),
    signal: AbortSignal.timeout(30_000),
  });
  const j = await r.json() as { tenant_access_token?: string };
  if (!j.tenant_access_token) throw new Error('[lark] không lấy được token');
  return j.tenant_access_token;
}

interface BanGhi { record_id: string; fields: Record<string, unknown> }

async function docHet(t: string): Promise<BanGhi[]> {
  const out: BanGhi[] = [];
  let page: string | undefined;
  for (;;) {
    const r = await fetch(
      `${DOMAIN}/open-apis/bitable/v1/apps/${APP}/tables/${TBL}/records/search?page_size=500${page ? `&page_token=${page}` : ''}`,
      { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
        body: '{}', signal: AbortSignal.timeout(60_000) });
    const j = await r.json() as { code: number; msg: string;
      data?: { items?: BanGhi[]; has_more?: boolean; page_token?: string } };
    if (j.code !== 0) throw new Error(`[lark] đọc Truspilot Review lỗi: code=${j.code} msg=${j.msg}`);
    out.push(...(j.data?.items ?? []));
    if (!j.data?.has_more) break;
    page = j.data.page_token;
  }
  return out;
}

export interface KetQuaNhapDanhGia {
  doc: number;
  them: number;
  boQuaDaCo: number;
  boQuaThieuSao: number;
  noiDuocDon: number;
  tuDienBrand: number;
  bỏQuocGiaRac: number;
}

export async function nhapDanhGiaTuLark(
  onTin?: (s: string) => void,
): Promise<KetQuaNhapDanhGia> {
  const t = await token();
  const rs = await docHet(t);
  onTin?.(`Đọc ${rs.length} bản ghi từ Lark.`);
  const ket: KetQuaNhapDanhGia = {
    doc: rs.length, them: 0, boQuaDaCo: 0, boQuaThieuSao: 0,
    noiDuocDon: 0, tuDienBrand: 0, bỏQuocGiaRac: 0,
  };

  for (const r of rs) {
    const f = r.fields;

    const saoRaw = chu(f['Star Rating']).trim();
    // Số sao là thứ DUY NHẤT không thể thiếu: không có nó thì bản ghi không nói
    // được đánh giá tốt hay tệ, tức vô dụng với mọi bảng tổng hợp.
    if (!soSaoHopLe(saoRaw)) { ket.boQuaThieuSao += 1; continue; }
    const soSao = Number(saoRaw);

    const quocGiaRaw = chu(f.Country);
    const quocGia = locQuocGia(quocGiaRaw);
    if (quocGiaRaw.trim() && !quocGia) ket.bỏQuocGiaRac += 1;

    const maDonRaw = (gop(f, 'Order Number', 'Order number (Data cũ)') ?? '')
      .trim().replace(/^#/, '');
    const ngay = ngayVn(f.Date) ?? ngayKinhDoanh(new Date())!;

    try {
      const themMoi = await db.transaction(async (tx) => {
        let orderId: string | null = null;
        let storeId: string | null = null;
        let vendor: string | null = null;
        if (maDonRaw) {
          const [o] = ((await tx.execute(sql`
            SELECT id, store_id FROM shopify_orders
            WHERE regexp_replace(shopify_order_number, '^#', '') = ${maDonRaw} LIMIT 1`)) as { rows?: Record<string, unknown>[] }).rows ?? [];
          if (o) {
            orderId = String(o.id);
            storeId = String(o.store_id);
            // Chỉ tự điền brand khi đơn có ĐÚNG MỘT brand. Nhiều brand thì để
            // trống: chọn bừa là gán đánh giá tệ cho bên có thể không gây ra nó.
            const vs = ((await tx.execute(sql`
              SELECT DISTINCT vendor FROM shopify_order_lines
              WHERE order_id = ${orderId}::uuid AND vendor IS NOT NULL`)) as { rows?: Record<string, unknown>[] }).rows ?? [];
            if (vs.length === 1) vendor = String(vs[0]!.vendor);
          }
        }

        const [dg] = await tx.insert(schema.danhGia).values({
          maDanhGia: `LARK-${r.record_id.slice(-8)}`,
          ngay,
          soSao,
          trang: mapTrang(mang(f['Review site'])[0]),
          noiDung: chu(f.Reason).trim() || null,
          ghiChuCx: NHAC,
          trangThai: mapTrangThai(mang(f.Status)[0]),
          kenhLienHe: mapKenh(mang(f['Contact channel'])[0]),
          quocGia,
          khachEmail: gop(f, 'Customer Email', 'Email (Data cũ)'),
          khachTen: mang(f['Customer Name'])[0]?.trim() || null,
          storeId, orderId,
          maDon: maDonRaw ? `#${maDonRaw}` : null,
          vendor,
          theoDoi: chu(f['Follow-up & Resolution']).trim() || null,
          larkRecordId: r.record_id,
        }).onConflictDoNothing({ target: schema.danhGia.larkRecordId })
          .returning({ id: schema.danhGia.id });
        if (!dg) return false;

        if (orderId) ket.noiDuocDon += 1;
        if (vendor) ket.tuDienBrand += 1;
        return true;
      });
      if (themMoi) ket.them += 1; else ket.boQuaDaCo += 1;
    } catch (e) {
      console.error(`[danh-gia] nhập ${r.record_id} lỗi:`, e);
    }
  }
  return ket;
}
