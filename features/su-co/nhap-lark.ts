/**
 * Nhập 156 ca sự cố từ bảng Lark `Incident Management (Cũ)` (CEO 28/09).
 *
 * CỐ Ý KHÔNG có `'use server'` — việc của script.
 *
 * CHỈ ĐỌC Lark, không ghi một ô nào lên đó. Chạy lại vô hại: `lark_record_id` UNIQUE.
 *
 * Ba chỗ dữ liệu gốc KHÔNG ĐỦ để suy, ghi thành GHI CHÚ chứ không bịa số:
 *  1. Đơn vị tiền — bảng gốc không có cột nào, ghi USD và nói rõ là suy ra.
 *  2. Khai loại chi phí mà không có số tiền (~30 lời khai) — KHÔNG tạo dòng chi
 *     phí số 0 giả, mà ghi chú lại.
 *  3. 18 ca vừa nhiều bộ phận vừa nhiều loại chi phí — Lark không nói bộ phận nào
 *     chịu khoản nào, nên đặt bộ phận đầu làm chính, ghi chú đủ danh sách, và bật
 *     `can_xem_lai` để CX rà.
 */
import { sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import {
  COT_TIEN_LARK, LOAI_KHAI_LARK, mapBoPhanLark, mapGiaiDoanLark,
  mapNguyenNhanLark, mapTrangThaiLark,
} from './phan-loai';

const DOMAIN = process.env.LARK_DOMAIN || 'https://open.larksuite.com';
const APP = 'EaPswVhWEi8MnckszPAluuq8gZg';
const TBL = 'tbl7gQuwsBxW20Fj';
/** Bảng gốc không có cột đơn vị tiền — mọi số coi là USD, và nói rõ trong ghi chú. */
const TIEN_TE = 'USD';

const chu = (v: unknown): string => {
  if (v == null) return '';
  if (Array.isArray(v)) {
    return v.map((x) => {
      if (x == null) return '';
      if (typeof x === 'object') {
        const o = x as { text?: string; name?: string; value?: unknown };
        if (typeof o.text === 'string') return o.text;
        if (typeof o.name === 'string') return o.name;
        if (Array.isArray(o.value)) return chu(o.value);
        return '';
      }
      return String(x);
    }).join('');
  }
  if (typeof v === 'object') {
    const o = v as { text?: string; name?: string; value?: unknown };
    if (typeof o.text === 'string') return o.text;
    if (typeof o.name === 'string') return o.name;
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

const so = (v: unknown): number | null => {
  if (typeof v === 'number') return v;
  const s = chu(v).replace(/[^0-9.-]/g, '');
  if (!s || s === '-' || s === '.') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

/** Ngày Lark (ms) → `yyyy-mm-dd` theo giờ Việt Nam. */
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
    if (j.code !== 0) throw new Error(`[lark] đọc Incident Management lỗi: code=${j.code} msg=${j.msg}`);
    out.push(...(j.data?.items ?? []));
    if (!j.data?.has_more) break;
    page = j.data.page_token;
  }
  return out;
}

export interface KetQuaNhapSuCo {
  doc: number;
  them: number;
  boQuaDaCo: number;
  dongChiPhi: number;
  khaiKhongCoSo: number;
  canXemLai: number;
  noiDuocDon: number;
  nguyenNhanLa: number;
}

export async function nhapSuCoTuLark(
  onTin?: (s: string) => void,
): Promise<KetQuaNhapSuCo> {
  const t = await token();
  const rs = await docHet(t);
  onTin?.(`Đọc ${rs.length} bản ghi từ Lark.`);
  const ket: KetQuaNhapSuCo = {
    doc: rs.length, them: 0, boQuaDaCo: 0, dongChiPhi: 0,
    khaiKhongCoSo: 0, canXemLai: 0, noiDuocDon: 0, nguyenNhanLa: 0,
  };

  for (const r of rs) {
    const f = r.fields;

    const nguyenNhan = mapNguyenNhanLark(chu(f['Tag Label']));
    // Nguyên nhân lạ: KHÔNG bỏ bản ghi (mất cả tiền theo nó), mà xếp vào nguyên
    // nhân gần nhất về nghĩa rồi ghi chú lại giá trị gốc.
    const nnCuoi = nguyenNhan ?? 'sold_out';
    if (!nguyenNhan) ket.nguyenNhanLa += 1;

    const boPhanLark = mang(f['Responsible Dept.'])
      .map((x) => mapBoPhanLark(x))
      .filter((x): x is string => x != null);
    const loaiKhai = mang(f['Incident Type']);

    // Dòng chi phí: chỉ tạo khi CÓ SỐ TIỀN. Số 0 giả làm mọi bảng tổng sai.
    const dongChiPhi: { loai: string; soTien: string }[] = [];
    for (const [cot, loai] of Object.entries(COT_TIEN_LARK)) {
      const v = so(f[cot]);
      if (v != null && v !== 0) dongChiPhi.push({ loai, soTien: v.toFixed(2) });
    }

    // Khai loại mà không có số — ghi chú, không tạo dòng.
    const khaiThieuSo = loaiKhai
      .map((k) => LOAI_KHAI_LARK[k])
      .filter((l): l is string => l != null && !dongChiPhi.some((d) => d.loai === l));

    const nhieuBoPhan = boPhanLark.length > 1;
    /* Nhiều bộ phận + CÓ TIỀN là đã không suy được: Lark không nói khoản nào của
     * ai, nên số tiền đang được gán cho bộ phận Lark tình cờ liệt kê đầu. Điều
     * kiện ban đầu em đặt là `> 1` dòng chi phí, và nó bỏ sót 16/18 ca — ca một
     * khoản tiền với hai bộ phận vẫn mơ hồ y như ca hai khoản. */
    const canXemLai = nhieuBoPhan && dongChiPhi.length > 0;

    const maDonRaw = mang(f['Order Number'])[0]?.trim().replace(/^#/, '') ?? '';
    const idLark = chu(f['Incident ID']).trim() || chu(f.ID).trim();
    const ma = `LARK-${idLark || r.record_id.slice(-8)}`;
    const ngayBao = ngayVn(f['Date Reported']) ?? new Date().toISOString().slice(0, 10);

    try {
      const themMoi = await db.transaction(async (tx) => {
        let orderId: string | null = null;
        let storeId: string | null = null;
        if (maDonRaw) {
          const [o] = ((await tx.execute(sql`
            SELECT id, store_id FROM shopify_orders
            WHERE regexp_replace(shopify_order_number, '^#', '') = ${maDonRaw} LIMIT 1`)) as { rows?: Record<string, unknown>[] }).rows ?? [];
          if (o) { orderId = String(o.id); storeId = String(o.store_id); }
        }

        const [sc] = await tx.insert(schema.suCo).values({
          maSuCo: ma,
          ngayBao,
          nguyenNhan: nnCuoi,
          giaiDoan: mapGiaiDoanLark(chu(f['Cust. Journey Stage'])),
          trangThai: mapTrangThaiLark(chu(f.Status)),
          moTa: chu(f['Issue Log']).trim() || null,
          boPhanChinh: boPhanLark[0] ?? null,
          maGiamGia: chu(f['Discount code for future purchase']).trim() || null,
          maTicketCs: chu(f['Intercom Ticket']).trim() || null,
          storeId, orderId,
          maDon: maDonRaw ? `#${maDonRaw}` : null,
          canXemLai,
          larkRecordId: r.record_id,
        }).onConflictDoNothing({ target: schema.suCo.larkRecordId })
          .returning({ id: schema.suCo.id });
        if (!sc) return false;

        if (orderId) ket.noiDuocDon += 1;
        if (canXemLai) ket.canXemLai += 1;

        if (dongChiPhi.length > 0) {
          await tx.insert(schema.suCoChiPhi).values(dongChiPhi.map((d) => ({
            suCoId: sc.id, loai: d.loai, soTien: d.soTien, tienTe: TIEN_TE,
            // Bộ phận để TRỐNG → thừa hưởng bộ phận chính. Lark không nói bộ phận
            // nào chịu khoản nào, nên gán bừa từng dòng là bịa số liệu.
            boPhan: null,
          })));
          ket.dongChiPhi += dongChiPhi.length;
        }

        const ghiChu: string[] = [
          `Nhập từ bảng Lark "Incident Management (Cũ)". Đơn vị tiền là SUY RA (${TIEN_TE}) — bảng gốc không có cột đơn vị tiền.`,
        ];
        if (!nguyenNhan) {
          ghiChu.push(`Nguyên nhân gốc trên Lark là "${chu(f['Tag Label'])}", chưa có mã tương ứng — tạm xếp vào "${nnCuoi}".`);
        }
        if (khaiThieuSo.length > 0) {
          ghiChu.push(`Lark khai loại chi phí ${khaiThieuSo.join(', ')} nhưng KHÔNG có số tiền, nên không tạo dòng chi phí.`);
          ket.khaiKhongCoSo += khaiThieuSo.length;
        }
        if (nhieuBoPhan) {
          ghiChu.push(`Lark ghi ${boPhanLark.length} bộ phận: ${boPhanLark.join(', ')}. Đặt "${boPhanLark[0]}" làm bộ phận chịu chính${canXemLai ? ' và đánh dấu CẦN XEM LẠI — Lark không nói khoản nào thuộc bộ phận nào' : ''}.`);
        }
        await tx.insert(schema.suCoGhiChu).values(
          ghiChu.map((noiDung) => ({ suCoId: sc.id, noiDung, tuLark: true })),
        );
        return true;
      });
      if (themMoi) ket.them += 1; else ket.boQuaDaCo += 1;
    } catch (e) {
      console.error(`[su-co] nhập ${ma} lỗi:`, e);
    }
  }
  return ket;
}
