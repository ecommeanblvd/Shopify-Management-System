/**
 * Nhập 675 ticket lịch sử từ bảng Lark `CX - To Do` (CEO 27/09).
 *
 * CỐ Ý KHÔNG có `'use server'` — việc của script, không phải endpoint.
 *
 * CHỈ ĐỌC Lark, không ghi một ô nào lên đó. Bản ghi nhập vào có
 * `nguon = 'lark'` và UI chặn mọi hành động ghi: đây là hồ sơ lưu trữ để tra
 * lịch sử, không phải ticket đang chạy.
 *
 * Chạy lại vô hại: `lark_record_id` là UNIQUE và mỗi lượt bỏ qua bản đã có.
 */
import { sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { boPhanHopLe } from './phan-loai';

const DOMAIN = process.env.LARK_DOMAIN || 'https://open.larksuite.com';
const APP = 'EaPswVhWEi8MnckszPAluuq8gZg';
const TBL = 'tblDADK0cZxRx1XP';

/** Cột cập nhật của từng bộ phận → mã bộ phận bên mình. */
const COT_UPDATE: [string, string][] = [
  ['CS Update', 'CX-CS'],
  ['MER Update', 'MERCHANDISE'],
  ['PRM Update', 'PROCUREMENT'],
  ['WH Update', 'DISCO-WH'],
  ['LOG Update', 'DISCO-LOG'],
  ['BD China Update', 'CHINA'],
];
/** Cột trạng thái tương ứng. */
const COT_PROCESS: Record<string, string> = {
  'CX-CS': 'CS Process',
  MERCHANDISE: 'MER Process',
  PROCUREMENT: 'PRM Process',
  'DISCO-WH': 'WH Process',
  'DISCO-LOG': 'LOG Process',
  CHINA: 'BD China Process',
};

/** Loại của Lark → mã bên mình. Loại lạ rơi về `khac` của nhóm suy từ Category. */
const MAP_LOAI: Record<string, [string, string]> = {
  'processing time': ['don_hang', 'thoi_gian_xu_ly'],
  'production time': ['don_hang', 'thoi_gian_xu_ly'],
  'sold out': ['don_hang', 'het_hang'],
  'customize info': ['don_hang', 'so_do'],
  'cancel by customer': ['don_hang', 'khach_huy'],
  'design modification': ['don_hang', 'sua_thiet_ke'],
  'change size': ['don_hang', 'doi_size'],
  'size issue': ['don_hang', 'doi_size'],
  'production delayed': ['don_hang', 'san_xuat_tre'],
  'order update': ['don_hang', 'cap_nhat_don'],
  'order status': ['don_hang', 'cap_nhat_don'],
  'suspected mispurchase': ['don_hang', 'nghi_mua_nham'],
  'hold by customer': ['don_hang', 'khach_giu_don'],
  'hold by cx': ['don_hang', 'khach_giu_don'],
  'qc failed': ['don_hang', 'qc_khong_dat'],
  'invalid address': ['truoc_khi_gui', 'dia_chi_khong_hop_le'],
  'change address': ['truoc_khi_gui', 'doi_dia_chi'],
  'delevery attempt failed': ['su_co_van_chuyen', 'giao_that_bai'],
  'delivery attempt failed': ['su_co_van_chuyen', 'giao_that_bai'],
  'additional information required': ['su_co_van_chuyen', 'thieu_thong_tin'],
  'held for pickup': ['su_co_van_chuyen', 'cho_nhan_buu_cuc'],
  'customs clearance': ['su_co_van_chuyen', 'thong_quan'],
};

/** Category của Lark → nhóm bên mình, dùng khi loại không map được. */
const MAP_NHOM: Record<string, string> = {
  'order managerment issue': 'don_hang',
  'order management issue': 'don_hang',
  'pre-shipment issue': 'truoc_khi_gui',
  'ep - shipping exceptions': 'su_co_van_chuyen',
};

/** Trạng thái ticket của Lark → bên mình. Trống (38% dòng Lark) coi là `xong`:
 *  675 ticket này đều đã cũ, để `moi` là chúng nhảy vào danh sách việc đang chạy. */
const MAP_TRANG_THAI: Record<string, string> = {
  'new case': 'moi', processing: 'dang_xu_ly', done: 'xong',
};

/** Process của Lark → trạng thái phần việc. */
function mapProcess(v: string): string {
  const s = v.toLowerCase();
  if (s.includes('đã xử lý')) return 'da_xu_ly';
  if (s.includes('chưa đủ')) return 'chua_du_thong_tin';
  return 'dang_xu_ly';
}

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

/** Giá trị nhiều lựa chọn → mảng chuỗi. */
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
    const j = await r.json() as { code: number; msg: string; data?: { items?: BanGhi[]; has_more?: boolean; page_token?: string } };
    if (j.code !== 0) throw new Error(`[lark] đọc CX - To Do lỗi: code=${j.code} msg=${j.msg}`);
    out.push(...(j.data?.items ?? []));
    if (!j.data?.has_more) break;
    page = j.data.page_token;
  }
  return out;
}

export interface KetQuaNhap {
  doc: number; them: number; boQua: number; ganDong: number; ghiChu: number; khongMapLoai: number;
}

export async function nhapTicketTuLark(onTin?: (s: string) => void): Promise<KetQuaNhap> {
  const t = await token();
  const rs = await docHet(t);
  onTin?.(`Đọc ${rs.length} bản ghi từ Lark.`);
  const ket: KetQuaNhap = { doc: rs.length, them: 0, boQua: 0, ganDong: 0, ghiChu: 0, khongMapLoai: 0 };

  for (const r of rs) {
    const f = r.fields;

    const catRaw = mang(f['Query/ Issue Category'])[0] ?? mang(f['Text 14'])[0] ?? '';
    const loaiRaw = mang(f['Query/ Issue Types'])[0] ?? mang(f['Text 13'])[0] ?? '';
    const mapped = MAP_LOAI[loaiRaw.toLowerCase().trim()];
    const nhom = mapped?.[0] ?? MAP_NHOM[catRaw.toLowerCase().trim()] ?? 'don_hang';
    const loai = mapped?.[1] ?? 'khac';
    if (!mapped) ket.khongMapLoai += 1;

    // `khac` chỉ tồn tại trong nhóm `don_hang`; loại lạ ở hai nhóm kia phải rơi
    // về nhóm đơn hàng, không thì sinh cặp nhóm/loại không hợp lệ.
    const nhomCuoi = mapped ? nhom : 'don_hang';

    const boPhanNeu = mang(f['Dept. Raising Issue'])[0] ?? 'CX-CS';
    const tt = MAP_TRANG_THAI[chu(f['Status TODO']).toLowerCase().trim()] ?? 'xong';

    // Tiêu đề: Lark không có cột tiêu đề, nên lấy dòng đầu của ghi chú CS —
    // đúng thứ CX đọc để nhận ra ticket. Không có thì dùng nhãn loại.
    const csUpdate = chu(f['CS Update']).trim();
    const tieuDe = (csUpdate.split('\n')[0] ?? '').trim().slice(0, 280)
      || `${catRaw || 'Ticket'}${loaiRaw ? ` — ${loaiRaw}` : ''}`.slice(0, 280);

    const idLark = chu(f['ID Ticket']).trim();
    const ma = `LARK-${idLark || r.record_id.slice(-8)}`;
    const email = mang(f["Customer's Email"])[0] ?? null;
    const maCs = chu(f['Ticket No. (for CS)']).trim() || null;
    const taoLuc = typeof f['Date Created'] === 'number' ? new Date(f['Date Created'] as number) : new Date();

    // Khoá nối dòng đơn: Order Number + Lineitem SKU — đúng khoá đã dùng khi
    // điền Min/Max Production sang bảng CX, nên đã biết là chạy được.
    const donRaw = mang(f['Order number']);
    const skuRaw = mang(f.SKU);

    try {
      const themMoi = await db.transaction(async (tx) => {
        const [tk] = await tx.insert(schema.cxTicket).values({
          maTicket: ma, tieuDe,
          nhom: nhomCuoi, loai,
          boPhanNeu: boPhanHopLe(boPhanNeu) ? boPhanNeu : 'CX-CS',
          trangThai: tt,
          maTicketCs: maCs,
          khachEmail: email,
          nguon: 'lark',
          larkRecordId: r.record_id,
          createdAt: taoLuc,
          dongLuc: tt === 'xong' ? taoLuc : null,
        }).onConflictDoNothing({ target: schema.cxTicket.larkRecordId })
          .returning({ id: schema.cxTicket.id });
        if (!tk) return false; // đã nhập lần trước

        // Gắn dòng đơn. Một ticket Lark có thể kể nhiều đơn và nhiều SKU; nối
        // theo TỔ HỢP để không bỏ sót, rồi `onConflictDoNothing` lo phần trùng.
        const don = donRaw.map((d) => d.replace(/^#/, '').trim()).filter(Boolean);
        const sku = skuRaw.map((s) => s.trim()).filter(Boolean);
        if (don.length > 0) {
          // Dùng `IN` với mảng, KHÔNG dùng `ANY`: trong template `sql` của
          // drizzle một mảng JS bung thành ($1, $2, …), nên `ANY` sinh ra
          // `ANY(($1,$2))` và Postgres báo lỗi — đúng lỗi đã lọt production
          // 16/09/2026, có test chặn ở lib/sql-mang.test.ts.
          const q = sku.length > 0
            ? sql`SELECT l.id, o.store_id FROM shopify_order_lines l
                    JOIN shopify_orders o ON o.id = l.order_id
                   WHERE regexp_replace(o.shopify_order_number, '^#', '') IN ${don}
                     AND l.sku IN ${sku}`
            : sql`SELECT l.id, o.store_id FROM shopify_order_lines l
                    JOIN shopify_orders o ON o.id = l.order_id
                   WHERE regexp_replace(o.shopify_order_number, '^#', '') IN ${don}`;
          const dong = ((await tx.execute(q)) as unknown as { rows?: Record<string, unknown>[] }).rows ?? [];
          if (dong.length > 0) {
            await tx.insert(schema.cxTicketDong)
              .values(dong.map((d) => ({ ticketId: tk.id, orderLineId: String(d.id) })))
              .onConflictDoNothing();
            ket.ganDong += dong.length;
            await tx.update(schema.cxTicket)
              .set({ storeId: String(dong[0]!.store_id) })
              .where(sql`${schema.cxTicket.id} = ${tk.id}`);
          }
        }

        // Năm cột Update thành năm ghi chú riêng — Lark dồn hết diễn biến của
        // một bộ phận vào một ô, đọc lẫn giữa các bộ phận.
        for (const [cot, boPhan] of COT_UPDATE) {
          const noiDung = chu(f[cot]).trim();
          const tThai = mapProcess(chu(f[COT_PROCESS[boPhan]!]));
          const coProcess = chu(f[COT_PROCESS[boPhan]!]).trim() !== '';
          if (!noiDung && !coProcess) continue;

          await tx.insert(schema.cxTicketPhanViec).values({
            ticketId: tk.id, boPhan, trangThai: tThai,
            xongLuc: tThai === 'da_xu_ly' ? taoLuc : null,
            createdAt: taoLuc,
          }).onConflictDoNothing();

          if (noiDung) {
            await tx.insert(schema.cxTicketGhiChu).values({
              ticketId: tk.id, boPhan, noiDung, ghiHo: false, createdAt: taoLuc,
            });
            ket.ghiChu += 1;
          }
        }

        // Bộ phận được gán trên Lark mà chưa có cập nhật nào: vẫn tạo phần việc,
        // nếu không thì mất thông tin "ticket này từng gửi cho ai".
        for (const bp of mang(f['Dept. Receiving Issue'])) {
          if (!boPhanHopLe(bp)) continue;
          await tx.insert(schema.cxTicketPhanViec)
            .values({ ticketId: tk.id, boPhan: bp, trangThai: 'dang_xu_ly', createdAt: taoLuc })
            .onConflictDoNothing();
        }
        return true;
      });
      if (themMoi) ket.them += 1; else ket.boQua += 1;
    } catch (e) {
      console.error(`[cx-ticket] nhập ${ma} lỗi:`, e);
    }
    if ((ket.them + ket.boQua) % 100 === 0) {
      onTin?.(`… ${ket.them} thêm / ${ket.boQua} bỏ qua`);
    }
  }
  return ket;
}
