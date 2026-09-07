import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { TemGrid, type Tem } from '@/components/receiving/TemGrid';
import { chuTemMon, chuTemDong } from '@/features/receiving/nhan-nhanh-logic';
import { maTemDong } from '@/features/receiving/ma-tem';

export const dynamic = 'force-dynamic';

function tach(v: string | string[] | undefined): string[] {
  const s = Array.isArray(v) ? v.join(',') : (v ?? '');
  return [...new Set(s.split(',').map((x) => x.trim()).filter(Boolean))].slice(0, 200);
}

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `?dong=` đi thẳng vào `inArray` trên cột uuid — giá trị rác (không phải UUID) làm Postgres 500 cả trang. */
function tachDong(v: string | string[] | undefined): string[] {
  return tach(v).filter((x) => RE_UUID.test(x));
}

/**
 * Tem MÓN theo mã WH-: thứ tự i/n tính trong cùng dòng đơn (unit_code tăng dần).
 * `row_number() over (partition by fulfillment_line_id)` chỉ đúng khi mọi món
 * của dòng đều nằm trong maList; trang in luôn được mở với đủ mã vừa in nên
 * chấp nhận (không truy vấn lại toàn bộ dòng để tính thứ tự tuyệt đối).
 */
async function temMon(maList: string[]): Promise<Tem[]> {
  if (maList.length === 0) return [];
  const rows = await db.select({
    unitCode: schema.goodsReceiptItems.unitCode, productTitle: schema.goodsReceiptItems.productTitle, variantTitle: schema.goodsReceiptItems.variantTitle,
    unplanned: schema.goodsReceiptItems.unplanned,
    orderNumber: schema.shopifyOrders.shopifyOrderNumber, brand: schema.brandOrderRequests.brandSlug,
    thuTu: sql<number>`row_number() over (partition by ${schema.goodsReceiptItems.fulfillmentLineId} order by ${schema.goodsReceiptItems.unitCode})::int`,
    tong: sql<number>`coalesce(${schema.orderFulfillmentLines.qty}, 1)`,
  }).from(schema.goodsReceiptItems)
    .leftJoin(schema.shopifyOrders, eq(schema.shopifyOrders.id, schema.goodsReceiptItems.orderId))
    .leftJoin(schema.brandOrderRequests, eq(schema.brandOrderRequests.id, schema.goodsReceiptItems.brandRequestId))
    .leftJoin(schema.orderFulfillmentLines, eq(schema.orderFulfillmentLines.id, schema.goodsReceiptItems.fulfillmentLineId))
    .where(inArray(schema.goodsReceiptItems.unitCode, maList));
  const theoMa = new Map(rows.map((r) => [r.unitCode, r]));
  return maList.flatMap((ma) => {
    const r = theoMa.get(ma);
    if (!r) return [];
    const chu = r.unplanned
      ? ['NGOÀI KẾ HOẠCH', r.productTitle, r.variantTitle].filter(Boolean).join(' · ')
      : chuTemMon({ orderNumber: r.orderNumber, productTitle: r.productTitle, variantTitle: r.variantTitle, thuTu: r.thuTu, tong: r.tong, brand: r.brand?.toUpperCase() ?? null });
    return [{ qr: ma, chu, phu: ma }];
  });
}

/** Tem DÒNG ĐƠN (`L:<shopifyLineId>`) cho brand in lên kiện; thứ tự dòng theo shopify_line_id trong đơn. */
async function temDong(lineIds: string[]): Promise<Tem[]> {
  if (lineIds.length === 0) return [];
  const rows = await db.select({
    shopifyLineId: schema.orderFulfillmentLines.shopifyLineId, qty: schema.orderFulfillmentLines.qty,
    orderNumber: schema.shopifyOrders.shopifyOrderNumber, productTitle: schema.shopifyOrderLines.productTitle, variantTitle: schema.shopifyOrderLines.variantTitle,
    thuTuDong: sql<number>`row_number() over (partition by ${schema.orderFulfillmentLines.fulfillmentId} order by ${schema.orderFulfillmentLines.shopifyLineId})::int`,
  }).from(schema.orderFulfillmentLines)
    .innerJoin(schema.orderFulfillment, eq(schema.orderFulfillment.id, schema.orderFulfillmentLines.fulfillmentId))
    .innerJoin(schema.shopifyOrders, eq(schema.shopifyOrders.id, schema.orderFulfillment.orderId))
    .leftJoin(schema.shopifyOrderLines, and(eq(schema.shopifyOrderLines.orderId, schema.orderFulfillment.orderId), eq(schema.shopifyOrderLines.shopifyLineId, schema.orderFulfillmentLines.shopifyLineId)))
    .where(inArray(schema.orderFulfillmentLines.id, lineIds));
  return rows.map((r) => ({
    qr: maTemDong(r.shopifyLineId),
    chu: chuTemDong({ orderNumber: r.orderNumber, thuTuDong: r.thuTuDong, productTitle: r.productTitle, variantTitle: r.variantTitle, qty: r.qty }),
    phu: maTemDong(r.shopifyLineId),
  }));
}

export default async function TemPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_receiving')) redirect('/');
  const sp = await searchParams;
  const kho = sp.kho === 'a4' ? 'a4' : '50x30';
  const tems = [...(await temMon(tach(sp.ma))), ...(await temDong(tachDong(sp.dong)))];
  if (tems.length === 0) return <p className="p-6 text-sm text-muted-foreground">Không có mã nào để in. Dùng ?ma=WH-… hoặc ?dong=&lt;lineId&gt;.</p>;
  return <TemGrid tems={tems} kho={kho} />;
}
