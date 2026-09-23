/**
 * Điền `lark_mon_don.shopify_line_id` cho các món chưa nối. Chạy sau mỗi lượt đồng bộ bảng
 * món (mỗi giờ) — best-effort, hỏng thì chỉ log.
 */
import { eq, isNull, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { chonDongChoMon, type DongDonToiThieu } from './noi-mon-dong-don';

const MOI_LUOT = 2000;

export async function noiLineIdChoMon(): Promise<{ xet: number; noiDuoc: number }> {
  const chua = await db
    .select({ dinhDanh: schema.larkMonDon.dinhDanh, orderNumber: schema.larkMonDon.orderNumber, sku: schema.larkMonDon.sku })
    .from(schema.larkMonDon)
    .where(isNull(schema.larkMonDon.shopifyLineId))
    .limit(MOI_LUOT);
  if (chua.length === 0) return { xet: 0, noiDuoc: 0 };

  // Gom theo đơn: một đơn nhiều món, và phải biết dòng nào đã gán để không gán trùng.
  const theoDon = new Map<string, typeof chua>();
  for (const m of chua) theoDon.set(m.orderNumber, [...(theoDon.get(m.orderNumber) ?? []), m]);

  let noiDuoc = 0;
  for (const [don, dsMon] of theoDon) {
    const dong = await db
      .select({ shopifyLineId: schema.shopifyOrderLines.shopifyLineId, sku: schema.shopifyOrderLines.sku })
      .from(schema.shopifyOrderLines)
      .innerJoin(schema.shopifyOrders, eq(schema.shopifyOrders.id, schema.shopifyOrderLines.orderId))
      .where(sql`replace(${schema.shopifyOrders.shopifyOrderNumber}, '#', '') = ${don}`);
    if (dong.length === 0) continue;

    // Dòng đã gán cho món khác từ lượt trước cũng phải tính là đã dùng.
    const daGan = await db
      .select({ lineId: schema.larkMonDon.shopifyLineId })
      .from(schema.larkMonDon)
      .where(eq(schema.larkMonDon.orderNumber, don));
    const dung = new Set(daGan.map((x) => x.lineId).filter((x): x is string => !!x));
    const ds: DongDonToiThieu[] = dong.map((x) => ({ shopifyLineId: x.shopifyLineId, sku: x.sku, daDung: dung.has(x.shopifyLineId) }));

    for (const m of dsMon) {
      const lineId = chonDongChoMon(m.sku, ds);
      if (!lineId) continue;
      await db.update(schema.larkMonDon).set({ shopifyLineId: lineId }).where(eq(schema.larkMonDon.dinhDanh, m.dinhDanh));
      const d = ds.find((x) => x.shopifyLineId === lineId);
      if (d) d.daDung = true;
      noiDuoc++;
    }
  }
  return { xet: chua.length, noiDuoc };
}
