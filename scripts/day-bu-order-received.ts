/**
 * Đẩy bù `order.received` cho đơn ship hộ CHƯA TỪNG báo MMP thành công (CEO 30/09/2026).
 *
 * Vì sao cần: `order.received` trước nay chỉ phát sinh khi người vận hành bấm "báo giá lại",
 * nên đơn tạo từ Lark không bao giờ báo MMP — và MMP trả 409 cho mọi sự kiện sau (409 = không
 * tìm thấy đơn). Nguồn đã vá (sync-lark-don tự bắn lúc tạo); đây là dọn phần đã lỡ.
 *
 * Thứ tự BẮT BUỘC (MMP dặn): `order.received` TRƯỚC, các sự kiện sau mới gửi lại. Đảo thứ tự
 * là 409 vô hạn.
 *
 * Sự kiện cũ được gửi lại qua `retryPendingShipHoEvents` — đường đã có test, và nó tự BỎ bản
 * đã bị vượt bởi sự kiện mới hơn. Giữ nguyên `occurred_at` gốc nên mốc kỳ không nhảy sang hôm nay.
 * KHÔNG gửi lại `order.reconcile_pending`: đơn đã chốt giá thì thông báo "chờ đối soát" là sai.
 *
 * Chạy: railway run --service Shopify-Management-System npx tsx scripts/day-bu-order-received.ts [--ap-dung]
 */
import { sql, inArray, and, eq, ne } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { emitShipHoEvent, retryPendingShipHoEvents } from '@/features/ship-ho/mmp-events';
import { payloadOrderReceived } from '@/features/ship-ho/order-received-payload';

const AP = process.argv.includes('--ap-dung');
const f = (n: unknown) => Number(n ?? 0).toLocaleString('vi-VN');

async function main() {
  const don = await db.execute<Record<string, unknown>>(sql`
    SELECT o.id, o.code, o.brand_reference, o.partner_brand_slug, o.source, o.status,
           o.recipient_name, o.recipient_company, o.recipient_phone, o.country, o.city,
           o.province, o.postcode, o.address1, o.address2, o.house_number, o.short_address,
           o.maps_url, o.weight_kg, o.dim_length_cm, o.dim_width_cm, o.dim_height_cm,
           o.packaging_type, o.customer_ref, o.charged_vnd, o.mmp_ref,
           (SELECT COUNT(*) FROM ship_ho_order_events e
             WHERE e.order_id = o.id AND e.delivery_status <> 'delivered'
               AND e.event <> 'order.reconcile_pending')::int AS sk_can_gui_lai
      FROM ship_ho_orders o
     WHERE o.source <> 'mmp'
       AND NOT EXISTS (SELECT 1 FROM ship_ho_order_events e
             WHERE e.order_id = o.id AND e.event = 'order.received' AND e.delivery_status = 'delivered')
     ORDER BY o.code;`);

  console.log(`Đơn chưa từng báo MMP thành công: ${don.rows.length}`);
  console.table(don.rows.map((r) => ({
    code: r.code, ref: r.brand_reference ?? '—', brand: r.partner_brand_slug,
    tt: r.status, giaBao: f(r.charged_vnd), skGuiLai: r.sk_can_gui_lai,
  })));
  if (don.rows.length === 0) { console.log('Không có gì để làm.'); process.exit(0); }
  if (!AP) { console.log('\nCHỈ ĐẾM — thêm --ap-dung để bắn thật sang MMP.'); process.exit(0); }

  console.log('\n── Bước 1: order.received ──');
  const ok: string[] = [];
  for (const r of don.rows) {
    const id = r.id as string;
    await emitShipHoEvent(
      { id, code: r.code as string, source: r.source as string, mmpRef: (r.mmp_ref as string) ?? null },
      'order.received',
      payloadOrderReceived({
        partnerBrandSlug: r.partner_brand_slug as string,
        customerRef: r.customer_ref as string | null, brandReference: r.brand_reference as string | null,
        recipientName: r.recipient_name as string | null, recipientCompany: r.recipient_company as string | null,
        recipientPhone: r.recipient_phone as string | null, country: r.country as string,
        city: r.city as string | null, province: r.province as string | null,
        postcode: r.postcode as string | null, address1: r.address1 as string | null,
        address2: r.address2 as string | null, houseNumber: r.house_number as string | null,
        shortAddress: r.short_address as string | null, mapsUrl: r.maps_url as string | null,
        weightKg: r.weight_kg as string | null, dimLengthCm: r.dim_length_cm as string | null,
        dimWidthCm: r.dim_width_cm as string | null, dimHeightCm: r.dim_height_cm as string | null,
        packagingType: r.packaging_type as string | null, chargedVnd: r.charged_vnd as string | null,
      }),
    );
    const [moi] = await db.select({ tt: schema.shipHoOrderEvents.deliveryStatus, loi: schema.shipHoOrderEvents.lastError })
      .from(schema.shipHoOrderEvents)
      .where(and(eq(schema.shipHoOrderEvents.orderId, id), eq(schema.shipHoOrderEvents.event, 'order.received')))
      .orderBy(sql`occurred_at DESC`).limit(1);
    const xong = moi?.tt === 'delivered';
    if (xong) ok.push(id);
    console.log(`  ${xong ? '✓' : '✗'} ${r.code} (${r.brand_reference ?? '—'}) ${xong ? '' : `— ${moi?.loi ?? '?'}`}`);
  }
  console.log(`order.received: ${ok.length}/${don.rows.length} vào được MMP.`);

  if (ok.length === 0) { console.log('Không đơn nào vào được — dừng, không gửi lại sự kiện sau.'); process.exit(0); }

  console.log('\n── Bước 2: gửi lại sự kiện đã kẹt ──');
  const mo = await db.update(schema.shipHoOrderEvents)
    .set({ deliveryStatus: 'pending', attempts: 0, lastError: null })
    .where(and(
      inArray(schema.shipHoOrderEvents.orderId, ok),
      ne(schema.shipHoOrderEvents.deliveryStatus, 'delivered'),
      ne(schema.shipHoOrderEvents.event, 'order.reconcile_pending'),
      ne(schema.shipHoOrderEvents.event, 'order.received'),
    )).returning({ id: schema.shipHoOrderEvents.id });
  console.log(`Mở lại ${mo.length} sự kiện, gọi lõi gửi lại…`);
  const kq = await retryPendingShipHoEvents();
  console.log('Kết quả:', JSON.stringify(kq));

  const con = await db.execute<Record<string, unknown>>(sql`
    SELECT o.code, o.brand_reference AS ref, e.event, e.delivery_status AS tt, e.last_error AS loi
      FROM ship_ho_order_events e JOIN ship_ho_orders o ON o.id = e.order_id
     WHERE e.order_id IN ${ok} AND e.delivery_status <> 'delivered'
     ORDER BY o.code, e.occurred_at;`);
  console.log(`\nCòn kẹt sau khi chạy: ${con.rows.length}`);
  if (con.rows.length) console.table(con.rows.map((r) => ({ code: r.code, ref: r.ref, sk: r.event, tt: r.tt, loi: String(r.loi ?? '').slice(0, 40) })));
  process.exit(0);
}
main();
