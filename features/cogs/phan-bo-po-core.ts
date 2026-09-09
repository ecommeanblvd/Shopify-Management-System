/**
 * Lõi DB (không auth) phân bổ PO → dòng đơn cho một brand. Idempotent: xoá toàn bộ
 * dòng `source='po'` của brand rồi phân bổ lại từ đầu (FIFO phụ thuộc toàn bộ tập
 * đơn, không thể ghi lẻ). Chỉ nhắm dòng đơn CHƯA có giá vốn nguồn khác — dòng đã
 * có `brand_statement`/`mmp`/`shopify_unit_cost` không tiêu hao kho PO.
 * Kỳ ghi = THÁNG ĐẶT đơn (giá vốn đi cùng doanh thu; khác dòng bảng kê ghi theo kỳ
 * thực nhận). Dùng bởi action `phanBoPOAction` và script bảo trì.
 */
import { and, eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { sqlGioKinhDoanh } from '@/lib/timezone';
import { phanBoPO, type DongDon, type DongPO, type KhongPhanBo, type PhanBo, laMaPO } from './phan-bo-po';

export interface KetQuaPhanBoPO {
  brandSlug: string;
  dongXet: number;
  daPhanBo: number;
  tongVnd: number;
  theoPO: Array<{ refCode: string; qty: number; vnd: number }>;
  khong: KhongPhanBo[];
  chiTiet: PhanBo[];
}

export async function phanBoPOCore(brandSlug: string, opts?: { dryRun?: boolean; userId?: string | null }): Promise<KetQuaPhanBoPO> {
  const po = (await db.select({
    refCode: schema.brandCogsOffline.refCode, period: schema.brandCogsOffline.period, sku: schema.brandCogsOffline.sku,
    qty: schema.brandCogsOffline.qty, amount: schema.brandCogsOffline.amount,
  }).from(schema.brandCogsOffline).where(and(eq(schema.brandCogsOffline.brandSlug, brandSlug), eq(schema.brandCogsOffline.kind, 'cogs'))))
    .filter((r) => r.sku && r.qty > 0 && laMaPO(r.refCode))
    .map<DongPO>((r) => ({ refCode: r.refCode, period: r.period, sku: r.sku!, qty: r.qty, amountVnd: Number(r.amount) }));

  // Dòng đơn của brand (theo vendor, không phân biệt hoa/thường), đơn chưa huỷ, CHƯA có
  // giá vốn nguồn khác 'po' (dòng 'po' cũ sẽ bị xoá và phân bổ lại).
  const thang = `to_char(${sqlGioKinhDoanh('o.processed_at_shopify')}, 'YYYY-MM')`;
  const { rows } = await db.$client.query(
    `SELECT l.order_id, l.shopify_line_id, o.store_id, o.shopify_order_number AS ma_don, l.sku, l.quantity::int AS qty,
            ${thang} AS thang_dat, to_char(${sqlGioKinhDoanh('o.processed_at_shopify')}, 'YYYY-MM-DD') AS ngay_dat
     FROM shopify_order_lines l
     JOIN shopify_orders o ON o.id = l.order_id
     LEFT JOIN order_line_cogs c ON c.order_id = l.order_id AND c.shopify_line_id = l.shopify_line_id AND c.kind = 'cogs' AND c.source <> 'po'
     -- vendor ↔ slug so sau khi bỏ ký tự không phải chữ/số: 'La Vierge' ↔ 'la-vierge', 'Calista de Minh Thanh' ↔ 'calista-de-minh-thanh'.
     WHERE regexp_replace(lower(l.vendor), '[^a-z0-9]', '', 'g') = regexp_replace(lower($1), '[^a-z0-9]', '', 'g')
       AND o.cancelled_at_shopify IS NULL AND c.id IS NULL AND o.processed_at_shopify >= '2026-01-01'`,
    [brandSlug],
  );
  const dongDon = (rows as Array<Record<string, unknown>>).map<DongDon & { storeId: string }>((r) => ({
    orderId: String(r.order_id), shopifyLineId: String(r.shopify_line_id), storeId: String(r.store_id), maDon: String(r.ma_don),
    sku: r.sku == null ? null : String(r.sku), qty: Number(r.qty), thangDat: String(r.thang_dat), ngayDat: String(r.ngay_dat),
  }));
  const storeCua = new Map(dongDon.map((d) => [`${d.orderId}|${d.shopifyLineId}`, d.storeId]));
  const { phanBo, khong } = phanBoPO(dongDon, po);

  if (!opts?.dryRun) {
    await db.transaction(async (tx) => {
      await tx.delete(schema.orderLineCogs).where(and(eq(schema.orderLineCogs.source, 'po'), eq(schema.orderLineCogs.brandSlug, brandSlug)));
      for (const p of phanBo) {
        await tx.insert(schema.orderLineCogs).values({
          orderId: p.orderId, shopifyLineId: p.shopifyLineId, storeId: storeCua.get(`${p.orderId}|${p.shopifyLineId}`)!,
          kind: 'cogs', period: p.thangDat, amount: String(p.amountVnd), currency: 'VND', source: 'po', brandSlug,
          statementRef: p.tuPO.map((t) => t.refCode).join(' '), detail: { sku: p.sku, tuPO: p.tuPO }, importedBy: opts?.userId ?? null,
        }).onConflictDoUpdate({
          target: [schema.orderLineCogs.orderId, schema.orderLineCogs.shopifyLineId, schema.orderLineCogs.kind, schema.orderLineCogs.period],
          // Trùng khoá chỉ xảy ra với dòng 'po' cũ cùng kỳ (đã xoá ở trên) hoặc dòng nguồn khác kỳ khác — không đè nguồn khác.
          set: { amount: String(p.amountVnd), statementRef: p.tuPO.map((t) => t.refCode).join(' '), detail: { sku: p.sku, tuPO: p.tuPO }, importedAt: sql`now()` },
          setWhere: sql`${schema.orderLineCogs.source} = 'po'`,
        });
      }
    });
  }
  const theoPO = new Map<string, { qty: number; vnd: number }>();
  for (const p of phanBo) for (const t of p.tuPO) { const x = theoPO.get(t.refCode) ?? { qty: 0, vnd: 0 }; x.qty += t.qty; x.vnd += t.qty * t.donGiaVnd; theoPO.set(t.refCode, x); }
  return {
    brandSlug, dongXet: dongDon.length, daPhanBo: phanBo.length, tongVnd: phanBo.reduce((s, p) => s + p.amountVnd, 0),
    theoPO: [...theoPO.entries()].map(([refCode, v]) => ({ refCode, ...v })).sort((a, b) => a.refCode.localeCompare(b.refCode)),
    khong, chiTiet: phanBo,
  };
}
