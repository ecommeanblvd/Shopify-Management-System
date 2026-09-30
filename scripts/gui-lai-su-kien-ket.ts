/**
 * Gửi lại sự kiện MMP còn kẹt THẬT (CEO 30/09/2026).
 *
 * Chỉ đụng vào sự kiện mà dải cảnh báo đếm — tức đã LOẠI bản bị vượt (`lyDoBoQua`). Bản bị vượt
 * hỏng CÓ CHỦ Ý: gửi lại số cũ sẽ ghi đè MMP, nguy hiểm hơn là không gửi.
 *
 * Gửi qua `retryPendingShipHoEvents` — đường đã có test, và nó kiểm lại phép "đã bị vượt" một
 * lần nữa ngay trước khi gửi. Giữ nguyên `occurred_at` nên mốc kỳ không nhảy sang hôm nay.
 *
 * Chạy: railway run --service Shopify-Management-System npx tsx scripts/gui-lai-su-kien-ket.ts [--ap-dung]
 */
import { ne, eq, inArray } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { lyDoBoQua, type SuKienDaGui } from '@/features/ship-ho/event-obsolete';
import { lyDoNgan } from '@/features/ship-ho/hang-doi-hong';
import { retryPendingShipHoEvents } from '@/features/ship-ho/mmp-events';
import { hangDoiHongShipHo } from '@/features/ship-ho/hang-doi-hong-queries';

const AP = process.argv.includes('--ap-dung');

async function main() {
  const ket = await db.select({
    id: schema.shipHoOrderEvents.id, orderId: schema.shipHoOrderEvents.orderId,
    event: schema.shipHoOrderEvents.event, occurredAt: schema.shipHoOrderEvents.occurredAt,
    lastError: schema.shipHoOrderEvents.lastError, lastHttpStatus: schema.shipHoOrderEvents.lastHttpStatus,
    code: schema.shipHoOrders.code, ref: schema.shipHoOrders.brandReference,
  }).from(schema.shipHoOrderEvents)
    .innerJoin(schema.shipHoOrders, eq(schema.shipHoOrders.id, schema.shipHoOrderEvents.orderId))
    .where(ne(schema.shipHoOrderEvents.deliveryStatus, 'delivered'));

  const ids = [...new Set(ket.map((k) => k.orderId).filter((v): v is string => v != null))];
  const daGui = ids.length === 0 ? [] : await db.select({
    orderId: schema.shipHoOrderEvents.orderId, event: schema.shipHoOrderEvents.event,
    occurredAt: schema.shipHoOrderEvents.occurredAt, tt: schema.shipHoOrderEvents.deliveryStatus,
  }).from(schema.shipHoOrderEvents).where(inArray(schema.shipHoOrderEvents.orderId, ids));
  const theoDon = new Map<string, SuKienDaGui[]>();
  for (const d of daGui) {
    if (!d.orderId || d.tt !== 'delivered') continue;
    const a = theoDon.get(d.orderId) ?? [];
    a.push({ event: d.event, occurredAt: d.occurredAt });
    theoDon.set(d.orderId, a);
  }

  const canGui = ket.filter((k) => k.orderId != null
    && lyDoBoQua({ event: k.event, occurredAt: k.occurredAt }, theoDon.get(k.orderId!) ?? []) == null);
  console.log(`Sự kiện còn kẹt THẬT: ${canGui.length} (tổng chưa gửi được: ${ket.length})`);
  console.table(canGui.map((k) => ({
    don: k.ref ?? k.code, sk: k.event, luc: k.occurredAt.toISOString().slice(0, 16),
    lyDo: lyDoNgan(k.lastError, k.lastHttpStatus).slice(0, 44),
  })));
  if (canGui.length === 0) { console.log('Hàng đợi sạch.'); process.exit(0); }
  if (!AP) { console.log('\nCHỈ ĐẾM — thêm --ap-dung để gửi lại thật.'); process.exit(0); }

  await db.update(schema.shipHoOrderEvents)
    .set({ deliveryStatus: 'pending', attempts: 0, lastError: null })
    .where(inArray(schema.shipHoOrderEvents.id, canGui.map((k) => k.id)));
  console.log(`\nMở lại ${canGui.length} sự kiện, gọi lõi gửi lại…`);
  const kq = await retryPendingShipHoEvents();
  console.log('Kết quả:', JSON.stringify(kq));

  const sau = await hangDoiHongShipHo();
  console.log(`\nDải cảnh báo sau khi chạy: ${sau.tong} sự kiện`);
  for (const n of sau.nhom) console.log(`  ${n.so} · ${n.lyDo} — ${n.don.slice(0, 6).join(', ')}`);
  process.exit(0);
}
main();
