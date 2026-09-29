'use server';

import { and, eq, inArray, isNotNull, or, sql } from 'drizzle-orm';
import { STORE_NHAN_HANG } from './pham-vi';
import { db, schema } from '@/db/client';
import { boDauTiengViet } from '@/features/kol/bo-dau';
import { requirePerm } from '@/features/receiving/perm';
import { chuanHoaMaDon } from './ma-don';
import { conNhanDuoc, kieuTuKhoa, phanSo } from './tim-don-logic';
import type { KetQuaTim } from './types';
import { khoa, monPoConNhan } from './po-con-nhan';

const GIOI_HAN = 20;


/**
 * Món của đơn đang UNFULFILLED / PARTIALLY_FULFILLED mà CHƯA nhận đủ.
 *
 * Không có danh sách dựng sẵn (CEO 24/09) — ô tìm là cửa duy nhất. Khớp theo mã
 * đơn (chuẩn hoá bỏ `#` cả hai phía), SKU, tên sản phẩm KHÔNG DẤU, hoặc ID sản
 * phẩm/biến thể dạng số (thứ tem `V:` in ra).
 *
 * `daNhan` đếm theo (đơn, SKU) chứ không theo dòng đơn: `goods_receipt_items`
 * không có khoá ngoại sang `shopify_order_lines`. Một đơn có HAI dòng cùng SKU
 * thì hai dòng dùng chung số đã nhận — hiếm, và sai về phía AN TOÀN (hiện thừa
 * còn hơn ẩn mất hàng chưa nhận).
 */
export async function timMonChuaNhan(tuKhoa: string): Promise<KetQuaTim[]> {
  await requirePerm('view_receiving');
  const kieu = kieuTuKhoa(tuKhoa);
  if (kieu === 'qua_ngan') return [];
  const q = tuKhoa.trim();
  const maDon = chuanHoaMaDon(q);
  const khongDau = `%${boDauTiengViet(q)}%`;
  const so = phanSo(q);

  const dieuKien = kieu === 'id'
    ? or(
        sql`regexp_replace(coalesce(${schema.shopifyOrderLines.shopifyVariantId}, ''), '[^0-9]', '', 'g') = ${q}`,
        sql`regexp_replace(coalesce(${schema.shopifyOrderLines.shopifyProductId}, ''), '[^0-9]', '', 'g') = ${q}`,
        sql`EXISTS (SELECT 1 FROM shopify_variants v WHERE v.sku = ${schema.shopifyOrderLines.sku}
              AND regexp_replace(v.shopify_variant_id, '[^0-9]', '', 'g') = ${q})`,
      )
    : or(
        sql`regexp_replace(${schema.shopifyOrders.shopifyOrderNumber}, '^#', '') ILIKE ${`%${maDon}%`}`,
        sql`${schema.shopifyOrderLines.sku} ILIKE ${`%${q}%`}`,
        sql`EXISTS (SELECT 1 FROM shopify_variants v WHERE v.sku = ${schema.shopifyOrderLines.sku}
              AND v.tim_kiem LIKE ${khongDau})`,
        // Phao khi gõ sai phần chữ của mã đơn: "MBVLD28543" vẫn ra "#MBLVD28543".
        // Xem `phanSo` — chỉ bật khi chuỗi số đủ dài.
        ...(so ? [sql`regexp_replace(${schema.shopifyOrders.shopifyOrderNumber}, '\\D', '', 'g') LIKE ${`%${so}%`}`] : []),
      );

  const rows = await db.select({
    lineId: schema.shopifyOrderLines.id,
    orderId: schema.shopifyOrders.id,
    storeId: schema.shopifyOrders.storeId,
    shopifyOrderId: schema.shopifyOrders.shopifyOrderId,
    maDon: schema.shopifyOrders.shopifyOrderNumber,
    sku: schema.shopifyOrderLines.sku,
    tenSanPham: schema.shopifyOrderLines.productTitle,
    tenBienThe: schema.shopifyOrderLines.variantTitle,
    vendor: schema.shopifyOrderLines.vendor,
    datSl: schema.shopifyOrderLines.quantity,
    daNhan: sql<number>`(SELECT count(*)::int FROM goods_receipt_items gi
      WHERE gi.order_id = ${schema.shopifyOrders.id}
        AND gi.sku IS NOT DISTINCT FROM ${schema.shopifyOrderLines.sku})`,
  })
    .from(schema.shopifyOrderLines)
    .innerJoin(schema.shopifyOrders, eq(schema.shopifyOrders.id, schema.shopifyOrderLines.orderId))
    .innerJoin(schema.stores, eq(schema.stores.id, schema.shopifyOrders.storeId))
    .where(and(
      // Chỉ ba store vận hành thật. Trước 29/09/2026 màn này không lọc store nên
      // `cici-mean` lọt vào (21 đơn chưa fulfill, 47 dòng) — CEO chốt chặn.
      inArray(schema.stores.shopDomain, [...STORE_NHAN_HANG]),
      inArray(schema.shopifyOrders.fulfillmentStatus, ['UNFULFILLED', 'PARTIALLY_FULFILLED']),
      isNotNull(schema.shopifyOrderLines.sku),
      dieuKien,
    ))
    .limit(GIOI_HAN * 3);

  const shopify: KetQuaTim[] = rows
    .filter((r) => conNhanDuoc({ datSl: r.datSl, daNhan: r.daNhan }))
    .map((r) => ({ ...r, nguon: 'shopify' as const }));

  /* Hàng đặt PO xếp SAU hàng của đơn khách: đơn khách có người đang đợi, PO là
   * hàng nhập về bán dần. Cùng một trần `GIOI_HAN` cho cả hai nguồn. */
  const po = shopify.length >= GIOI_HAN ? [] : await timMonPo(q, GIOI_HAN - shopify.length);
  return [...shopify, ...po].slice(0, GIOI_HAN);
}

/**
 * Món hàng đặt PO còn nhập được (CEO 29/09/2026).
 *
 * Chỉ dòng đã tick "Báo đơn", chỉ PO CHƯA nhập đủ, và chỉ món còn thiếu — luật ở
 * `po-con-nhan.ts`. "Đã nhận" cộng cả hai nguồn: dòng đội kho nhập tay trên bảng
 * Lark và chiếc vừa nhận trên SMS (lệnh đẩy sang Lark đang tắt nên thiếu vế thứ
 * hai là nhận thừa).
 */
async function timMonPo(q: string, gioiHan: number): Promise<KetQuaTim[]> {
  const maDon = chuanHoaMaDon(q);
  const khongDau = `%${boDauTiengViet(q)}%`;
  const dong = await db.select({
    recordId: schema.larkPoDong.recordId,
    orderNumber: schema.larkPoDong.orderNumber,
    sku: schema.larkPoDong.sku,
    soLuong: schema.larkPoDong.soLuong,
    baoDon: schema.larkPoDong.baoDon,
    ten: schema.larkPoDong.lineitemName,
    vendor: schema.larkPoDong.vendor,
  }).from(schema.larkPoDong).where(and(
    eq(schema.larkPoDong.baoDon, true),
    or(
      sql`regexp_replace(coalesce(${schema.larkPoDong.orderNumber}, ''), '^#', '') ILIKE ${`%${maDon}%`}`,
      sql`${schema.larkPoDong.sku} ILIKE ${`%${q}%`}`,
      sql`${schema.larkPoDong.timKiem} LIKE ${khongDau.toLowerCase()}`,
    ),
  ));
  if (dong.length === 0) return [];

  /* Đếm đã nhận cho TOÀN BỘ các đơn PO chạm tới, không chỉ dòng khớp từ khoá:
   * luật "đơn đã đủ thì chặn cả đơn" cần biết mọi món của đơn đó. */
  const cacDon = [...new Set(dong.map((d) => d.orderNumber).filter((x): x is string => !!x))];
  const moiDong = await db.select({
    recordId: schema.larkPoDong.recordId, orderNumber: schema.larkPoDong.orderNumber,
    sku: schema.larkPoDong.sku, soLuong: schema.larkPoDong.soLuong, baoDon: schema.larkPoDong.baoDon,
  }).from(schema.larkPoDong).where(and(
    eq(schema.larkPoDong.baoDon, true),
    inArray(schema.larkPoDong.orderNumber, cacDon),
  ));

  const daNhan = await demDaNhanPo(cacDon);
  const con = new Map(monPoConNhan(moiDong, daNhan).map((m) => [khoa(m.orderNumber, m.sku), m]));

  const ra: KetQuaTim[] = [];
  const daCo = new Set<string>();
  for (const d of dong) {
    const k = khoa(d.orderNumber, d.sku);
    const m = con.get(k);
    if (!m || daCo.has(k)) continue;     // đơn đã đủ / món đã đủ / đã gom rồi
    daCo.add(k);
    ra.push({
      nguon: 'po', lineId: m.recordId,
      orderId: null, storeId: null, shopifyOrderId: null,
      maDon: m.orderNumber, sku: m.sku,
      tenSanPham: d.ten, tenBienThe: null, vendor: d.vendor,
      datSl: m.dat, daNhan: m.daNhan,
    });
    if (ra.length >= gioiHan) break;
  }
  return ra;
}

/** Đã nhận theo `đơn|sku`, CỘNG hai nguồn: bảng kho Lark + phiếu nhận trên SMS. */
async function demDaNhanPo(cacDon: readonly string[]): Promise<Map<string, number>> {
  const m = new Map<string, number>();
  if (cacDon.length === 0) return m;
  const khongDau2 = cacDon.map((d) => d.replace(/^#/, ''));

  const lark = await db.execute<{ don: string; sku: string; n: number }>(sql`
    SELECT order_number AS don, sku, count(*)::int AS n FROM lark_wh_inventory
    WHERE regexp_replace(coalesce(order_number,''), '^#', '') IN ${khongDau2}
      AND sku IS NOT NULL GROUP BY 1, 2`);
  const sms = await db.execute<{ don: string; sku: string; n: number }>(sql`
    SELECT po_order_number AS don, sku, count(*)::int AS n FROM goods_receipt_items
    WHERE regexp_replace(coalesce(po_order_number,''), '^#', '') IN ${khongDau2}
      AND sku IS NOT NULL GROUP BY 1, 2`);
  for (const r of [...lark.rows, ...sms.rows]) {
    const k = khoa(`#${String(r.don).replace(/^#/, '')}`, r.sku);
    m.set(k, (m.get(k) ?? 0) + Number(r.n));
  }
  return m;
}
