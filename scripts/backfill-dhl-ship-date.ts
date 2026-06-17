/**
 * Backfill carrier_bill_lines.ship_date cho các hoá đơn DHL đã upload TRƯỚC khi
 * có cột ship_date — đọc lại file CSV gốc trong R2, map tracking → Shipment Date,
 * rồi điền ship_date (chỉ khi đang null) + shipments.label_created_at (chỉ khi null).
 *
 * Chạy:  npx dotenv -- tsx scripts/backfill-dhl-ship-date.ts [--dry]
 */
import { and, eq, isNull } from 'drizzle-orm';
import { db, schema } from '../db/client';
import { getObject } from '../lib/storage/s3';
import { parseDhlInvoiceCsv } from '../features/carrier-rates/ap/dhl-invoice-csv';

const DRY = process.argv.includes('--dry');

async function main() {
  // Bills của account DHL, có file gốc, và còn ≥1 line thiếu ship_date.
  const dhlAccounts = await db
    .select({ id: schema.carrierAccounts.id })
    .from(schema.carrierAccounts)
    .innerJoin(schema.carriers, eq(schema.carriers.id, schema.carrierAccounts.carrierId))
    .where(eq(schema.carriers.key, 'dhl'));
  const accountIds = new Set(dhlAccounts.map((a) => a.id));

  const bills = await db
    .select({ id: schema.carrierBills.id, fileKey: schema.carrierBills.fileKey, accountId: schema.carrierBills.carrierAccountId, billNumber: schema.carrierBills.billNumber })
    .from(schema.carrierBills);

  let billsProcessed = 0, linesUpdated = 0, shipmentsUpdated = 0, filesMissing = 0, parseFailed = 0;

  for (const b of bills) {
    if (!accountIds.has(b.accountId) || !b.fileKey) continue;

    // Còn line nào thiếu ship_date không?
    const pending = await db
      .select({ id: schema.carrierBillLines.id, tracking: schema.carrierBillLines.trackingNumber })
      .from(schema.carrierBillLines)
      .where(and(eq(schema.carrierBillLines.billId, b.id), isNull(schema.carrierBillLines.shipDate)));
    if (pending.length === 0) continue;

    let bytes: Uint8Array;
    try { bytes = await getObject(b.fileKey); }
    catch { filesMissing++; console.warn(`  [skip] ${b.billNumber ?? b.id}: không đọc được file ${b.fileKey}`); continue; }

    const parsed = parseDhlInvoiceCsv(Buffer.from(bytes).toString('utf8'));
    if (!parsed) { parseFailed++; console.warn(`  [skip] ${b.billNumber ?? b.id}: parse CSV thất bại`); continue; }

    // tracking → ship date (YYYY-MM-DD)
    const dateByTracking = new Map<string, string>();
    for (const s of parsed.shipments) if (s.shipmentNumber && s.date) dateByTracking.set(s.shipmentNumber, s.date);

    billsProcessed++;
    for (const ln of pending) {
      if (!ln.tracking) continue;
      const d = dateByTracking.get(ln.tracking);
      if (!d) continue;

      if (!DRY) {
        await db.update(schema.carrierBillLines).set({ shipDate: d }).where(eq(schema.carrierBillLines.id, ln.id));
      }
      linesUpdated++;

      // Điền shipments.label_created_at nếu shipment khớp tracking & đang null.
      const [sh] = await db
        .select({ id: schema.shipments.id, label: schema.shipments.labelCreatedAt })
        .from(schema.shipments).where(eq(schema.shipments.trackingNumber, ln.tracking)).limit(1);
      if (sh && !sh.label) {
        if (!DRY) {
          await db.update(schema.shipments).set({ labelCreatedAt: new Date(d) }).where(eq(schema.shipments.id, sh.id));
        }
        shipmentsUpdated++;
      }
    }
  }

  console.log(`\n${DRY ? '[DRY RUN] ' : ''}Xong:`);
  console.log(`  bills xử lý:        ${billsProcessed}`);
  console.log(`  bill lines điền:    ${linesUpdated}`);
  console.log(`  shipments điền date:${shipmentsUpdated}`);
  if (filesMissing) console.log(`  file thiếu:         ${filesMissing}`);
  if (parseFailed) console.log(`  parse lỗi:          ${parseFailed}`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
