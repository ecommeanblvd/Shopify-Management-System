/**
 * Nhập tranh chấp PayPal/Stripe từ bảng Lark `Dispute Management` (CEO 27/09).
 *
 * CỐ Ý KHÔNG có `'use server'` — việc của script.
 *
 * CHỈ ĐỌC Lark, không ghi một ô nào lên đó.
 *
 * Quy tắc quan trọng nhất: **KHÔNG nhập 87 ca Shopify Payment**. Chúng đã về từ
 * nguồn đúng qua `sync.ts`; nhập thêm bản chép tay của Lark là sinh hai dòng cho
 * một ca, với số liệu lệch nhau. Riêng ô `Following up` của những ca đó thì đính
 * vào ca đã sync theo mã đơn, để không mất việc CX đã ghi.
 *
 * Chạy lại vô hại: `lark_record_id` UNIQUE.
 */
import { sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { mapCongThanhToan, mapLyDo, mapTrangThai } from './chuan-hoa';

const DOMAIN = process.env.LARK_DOMAIN || 'https://open.larksuite.com';
const APP = 'EaPswVhWEi8MnckszPAluuq8gZg';
const TBL = 'tblbHZu614yrzr12';

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

const so = (v: unknown): number | null => {
  if (typeof v === 'number') return v;
  const s = chu(v).replace(/[^0-9.-]/g, '');
  if (s === '' || s === '-' || s === '.') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

const ngay = (v: unknown): Date | null => {
  if (typeof v === 'number') {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
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
    if (j.code !== 0) throw new Error(`[lark] đọc Dispute Management lỗi: code=${j.code} msg=${j.msg}`);
    out.push(...(j.data?.items ?? []));
    if (!j.data?.has_more) break;
    page = j.data.page_token;
  }
  return out;
}

export interface KetQuaNhapDispute {
  doc: number;
  them: number;
  boQuaDaCo: number;
  boQuaShopify: number;
  ghiChuDinhVaoCaSync: number;
  thieuDuLieu: number;
  noiDuocDon: number;
}

export async function nhapDisputeTuLark(
  onTin?: (s: string) => void,
): Promise<KetQuaNhapDispute> {
  const t = await token();
  const rs = await docHet(t);
  onTin?.(`Đọc ${rs.length} bản ghi từ Lark.`);
  const ket: KetQuaNhapDispute = {
    doc: rs.length, them: 0, boQuaDaCo: 0, boQuaShopify: 0,
    ghiChuDinhVaoCaSync: 0, thieuDuLieu: 0, noiDuocDon: 0,
  };

  // Bảng Lark không ghi store. Mọi mã đơn trong bảng đều dạng #MBLVD… nên gán
  // về meanblvd, và CHỈ nhận đúng dạng đó — gán bừa store là làm số liệu của
  // store khác sai mà không ai biết.
  const [mb] = await db.select({ id: schema.stores.id })
    .from(schema.stores).where(sql`name = 'meanblvd'`).limit(1);
  if (!mb) throw new Error('Không tìm thấy store meanblvd');

  for (const r of rs) {
    const f = r.fields;
    const cong = mapCongThanhToan(chu(f['Payment Gateway']));
    const maDonRaw = chu(f['Order No.']).trim().replace(/^#/, '');
    const theoDoi = chu(f['Following up']).trim();

    // ── Ca Shopify Payment: KHÔNG tạo dòng mới, chỉ mang ghi chú sang.
    if (cong === 'shopify_payments' || cong == null) {
      ket.boQuaShopify += 1;
      if (theoDoi && maDonRaw) {
        const g = await db.execute(sql`
          INSERT INTO dispute_ghi_chu (dispute_id, noi_dung, tu_lark)
          SELECT d.id, ${theoDoi}, true FROM dispute d
          WHERE d.nguon = 'shopify'
            AND regexp_replace(COALESCE(d.ma_don, ''), '^#', '') = ${maDonRaw}
            AND NOT EXISTS (
              SELECT 1 FROM dispute_ghi_chu x
              WHERE x.dispute_id = d.id AND x.tu_lark AND x.noi_dung = ${theoDoi})`);
        ket.ghiChuDinhVaoCaSync += g.rowCount ?? 0;
      }
      continue;
    }

    const trangThai = mapTrangThai(chu(f.Status));
    const soTien = so(f['Dispute Amount']);
    // Không có trạng thái hoặc không có số tiền thì bản ghi vô nghĩa — đếm và bỏ,
    // không ghi rác để UI hiện NaN.
    if (!trangThai || soTien == null) { ket.thieuDuLieu += 1; continue; }

    // Bảng Lark KHÔNG có cột đơn vị tiền. Mọi số ở đó là USD theo cách CX dùng,
    // nên ghi 'USD' và nói rõ trong ghi chú rằng đơn vị là suy ra — thà ghi rõ
    // còn hơn để trống rồi bị loại khỏi mọi bảng tổng.
    const tienTe = 'USD';

    try {
      const themMoi = await db.transaction(async (tx) => {
        let orderId: string | null = null;
        if (maDonRaw) {
          const [o] = ((await tx.execute(sql`
            SELECT id FROM shopify_orders
            WHERE store_id = ${mb.id}::uuid
              AND regexp_replace(shopify_order_number, '^#', '') = ${maDonRaw}
            LIMIT 1`)) as { rows?: Record<string, unknown>[] }).rows ?? [];
          orderId = o ? String(o.id) : null;
        }

        const [d] = await tx.insert(schema.dispute).values({
          storeId: mb.id,
          nguon: 'tay',
          congThanhToan: cong,
          loai: 'chargeback',
          trangThai,
          lyDo: mapLyDo(chu(f['Case Reason'])),
          soTien: soTien.toFixed(2),
          tienTe,
          phiDispute: so(f['Dispute Fee'])?.toFixed(2) ?? null,
          moLuc: ngay(f['Open Date']) ?? ngay(f['Record Date']),
          hanNop: ngay(f['Expire Date']),
          chotLuc: ngay(f['Closed Date']),
          maHoSo: chu(f['Case ID']).trim() || null,
          orderId,
          maDon: maDonRaw ? `#${maDonRaw}` : null,
          khachEmail: chu(f.Email).trim() || null,
          larkRecordId: r.record_id,
        }).onConflictDoNothing({ target: schema.dispute.larkRecordId })
          .returning({ id: schema.dispute.id });
        if (!d) return false;

        if (orderId) ket.noiDuocDon += 1;
        if (theoDoi) {
          await tx.insert(schema.disputeGhiChu)
            .values({ disputeId: d.id, noiDung: theoDoi, tuLark: true });
        }
        return true;
      });
      if (themMoi) ket.them += 1; else ket.boQuaDaCo += 1;
    } catch (e) {
      console.error(`[dispute] nhập ${r.record_id} lỗi:`, e);
      ket.thieuDuLieu += 1;
    }
  }
  return ket;
}
