/**
 * Đồng bộ tranh chấp từ Shopify Payments.
 *
 * CỐ Ý KHÔNG có `'use server'` — việc của cron/script, không phải endpoint.
 * (Action gọi được nó nằm ở `actions.ts`, có cửa quyền riêng.)
 *
 * CHỈ ĐỌC Shopify. Ghi ĐÚNG các cột Shopify sở hữu; `ma_ho_so`, `phi_dispute`,
 * `order_id` gắn tay và ghi chú của CX không bao giờ bị chạm — nếu không thì một
 * lượt sync xoá mất việc CX đã làm.
 */
import { sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { getStoreToken, graphqlCall } from '@/lib/shopify/client';
import { mapLoai, mapLyDo, mapTrangThai } from './chuan-hoa';

/** `order { name }` gọi kèm để nối đơn — xem chú thích về lỗi MỘT PHẦN bên dưới. */
const TRUY_VAN = `query($sau: String) {
  shopifyPaymentsAccount {
    disputes(first: 50, after: $sau) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        type
        status
        reasonDetails { reason networkReasonCode }
        amount { amount currencyCode }
        initiatedAt
        evidenceDueBy
        evidenceSentOn
        finalizedOn
        order { name }
      }
    }
  }
}`;

interface NodeDispute {
  id: string;
  type?: string | null;
  status?: string | null;
  reasonDetails?: { reason?: string | null; networkReasonCode?: string | null } | null;
  amount?: { amount?: string | null; currencyCode?: string | null } | null;
  initiatedAt?: string | null;
  evidenceDueBy?: string | null;
  evidenceSentOn?: string | null;
  finalizedOn?: string | null;
  order?: { name?: string | null } | null;
}

export interface KetQuaSyncStore {
  store: string;
  doc: number;
  them: number;
  capNhat: number;
  boQua: number;
  /** Store không dùng Shopify Payments HOẶC chưa cấp scope — không kết luận là 0 ca. */
  khongCoTaiKhoan: boolean;
  loi?: string;
}

const ngay = (v: string | null | undefined): Date | null => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

async function docMotStore(store: {
  id: string; name: string; shopDomain: string; apiVersion: string;
}): Promise<{ nodes: NodeDispute[]; khongCoTaiKhoan: boolean }> {
  const token = await getStoreToken(store.id);
  const nodes: NodeDispute[] = [];
  let sau: string | null = null;
  for (;;) {
    const r = await graphqlCall({
      shopDomain: store.shopDomain, apiVersion: store.apiVersion, token,
      query: TRUY_VAN, variables: { sau },
    }) as {
      data?: { shopifyPaymentsAccount?: { disputes?: {
        pageInfo?: { hasNextPage?: boolean; endCursor?: string }; nodes?: NodeDispute[] } } | null };
      errors?: { message?: string }[];
    };

    const acc = r.data?.shopifyPaymentsAccount;
    // `shopifyPaymentsAccount` = null: store không dùng Shopify Payments (hoặc
    // chưa cấp scope). KHÔNG phải lỗi, và KHÔNG có nghĩa store đó không có
    // tranh chấp — chỉ có nghĩa là mình không đọc được.
    if (acc == null) {
      if (r.errors?.length && !r.data) {
        throw new Error(`Shopify trả lỗi: ${r.errors.map((e) => e.message).join('; ')}`);
      }
      return { nodes, khongCoTaiKhoan: true };
    }

    // Lỗi MỘT PHẦN là chuyện bình thường ở đây: dispute cũ có đơn đã bị xoá thì
    // Shopify trả `"Order not found"` trong `errors` NHƯNG VẪN trả đủ `data`.
    // Coi `errors` là thất bại thì sync chết vì một ca năm 2020.
    const d = acc.disputes;
    nodes.push(...(d?.nodes ?? []));
    if (!d?.pageInfo?.hasNextPage) break;
    sau = d.pageInfo.endCursor ?? null;
    if (!sau) break;
  }
  return { nodes, khongCoTaiKhoan: false };
}

async function ghiMotDispute(
  storeId: string, n: NodeDispute,
): Promise<'them' | 'capNhat' | 'boQua'> {
  const trangThai = mapTrangThai(n.status);
  const soTien = n.amount?.amount;
  const tienTe = n.amount?.currencyCode;
  // Thiếu ba thứ này thì bản ghi vô nghĩa: không biết đang ở đâu, bao nhiêu tiền,
  // tiền gì. Bỏ qua và ĐẾM chứ không ghi rác rồi để UI hiện "NaN".
  if (!trangThai || soTien == null || !tienTe) return 'boQua';

  const maDon = n.order?.name?.trim() || null;
  const ket = await db.execute(sql`
    INSERT INTO dispute (
      store_id, nguon, cong_thanh_toan, shopify_dispute_id, loai, trang_thai,
      ly_do, ly_do_mang,
      so_tien, tien_te, mo_luc, han_nop, da_nop_luc, chot_luc, ma_don, dong_bo_luc
    ) VALUES (
      ${storeId}, 'shopify', 'shopify_payments', ${n.id}, ${mapLoai(n.type)}, ${trangThai},
      ${mapLyDo(n.reasonDetails?.reason)}, ${n.reasonDetails?.networkReasonCode ?? null},
      ${String(soTien)}, ${tienTe},
      ${ngay(n.initiatedAt)}, ${ngay(n.evidenceDueBy)},
      ${ngay(n.evidenceSentOn)}, ${ngay(n.finalizedOn)},
      ${maDon}, now()
    )
    ON CONFLICT (shopify_dispute_id) DO UPDATE SET
      loai = EXCLUDED.loai,
      trang_thai = EXCLUDED.trang_thai,
      ly_do = EXCLUDED.ly_do,
      ly_do_mang = EXCLUDED.ly_do_mang,
      so_tien = EXCLUDED.so_tien,
      tien_te = EXCLUDED.tien_te,
      mo_luc = EXCLUDED.mo_luc,
      han_nop = EXCLUDED.han_nop,
      da_nop_luc = EXCLUDED.da_nop_luc,
      chot_luc = EXCLUDED.chot_luc,
      -- Mã đơn chỉ ghi khi Shopify CÓ trả về: dispute có đơn đã xoá trả null, ghi
      -- null lên là xoá mất mã đơn CX đã điền tay.
      ma_don = COALESCE(EXCLUDED.ma_don, dispute.ma_don),
      updated_at = now(),
      dong_bo_luc = now()
    RETURNING (dispute.created_at = dispute.updated_at) AS moi`);
  const rows = ((ket as { rows?: Record<string, unknown>[] }).rows ?? []);
  return rows[0]?.moi === true ? 'them' : 'capNhat';
}

/** Nối `ma_don` sang `order_id` cho các ca chưa nối được. Không ghi đè nối tay. */
async function noiDon(): Promise<number> {
  const r = await db.execute(sql`
    UPDATE dispute d SET order_id = o.id, updated_at = now()
    FROM shopify_orders o
    WHERE d.order_id IS NULL AND d.ma_don IS NOT NULL
      AND o.store_id = d.store_id
      AND regexp_replace(o.shopify_order_number, '^#', '')
          = regexp_replace(d.ma_don, '^#', '')`);
  return r.rowCount ?? 0;
}

export async function dongBoDispute(
  onTin?: (s: string) => void,
): Promise<{ store: KetQuaSyncStore[]; noiDon: number }> {
  const stores = await db.select({
    id: schema.stores.id, name: schema.stores.name,
    shopDomain: schema.stores.shopDomain, apiVersion: schema.stores.apiVersion,
  }).from(schema.stores);

  const ket: KetQuaSyncStore[] = [];
  for (const s of stores) {
    const r: KetQuaSyncStore = {
      store: s.name, doc: 0, them: 0, capNhat: 0, boQua: 0, khongCoTaiKhoan: false,
    };
    try {
      const { nodes, khongCoTaiKhoan } = await docMotStore(s);
      r.khongCoTaiKhoan = khongCoTaiKhoan;
      r.doc = nodes.length;
      for (const n of nodes) {
        const v = await ghiMotDispute(s.id, n);
        r[v] += 1;
      }
    } catch (e) {
      r.loi = e instanceof Error ? e.message : String(e);
      console.error(`[dispute] sync ${s.name} lỗi:`, e);
    }
    onTin?.(r.khongCoTaiKhoan
      ? `${s.name}: không đọc được Shopify Payments (chưa dùng hoặc chưa cấp scope)`
      : `${s.name}: đọc ${r.doc} · thêm ${r.them} · cập nhật ${r.capNhat} · bỏ qua ${r.boQua}${r.loi ? ` · LỖI ${r.loi}` : ''}`);
    ket.push(r);
  }
  const noi = await noiDon();
  onTin?.(`nối thêm ${noi} ca sang đơn trong hệ thống`);
  return { store: ket, noiDon: noi };
}
