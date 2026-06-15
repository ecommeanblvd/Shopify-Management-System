/**
 * Import file FedEx Billing Online (FBO) Excel → cập nhật shipment_charges
 * (billed) theo breakdown chuẩn của FedEx. Khớp đơn theo AWB = trackingNumber.
 * Idempotent (upsert theo shipmentId). Mặc định dry-run; --apply mới ghi.
 *
 *   pnpm exec dotenv -- tsx scripts/import-fedex-fbo.ts <file.xlsx> [--apply]
 *
 * Map: signature+residential → direct_signature (engine gộp residential vào
 * dòng ký nhận). duty (hải quan, pass-through) KHÔNG vào total shipping.
 */
import * as XLSX from 'xlsx';
import { db, schema } from '@/db/client';
import { parseFedexFbo } from '@/features/shipments/fedex-fbo-parse';
import { fboShippingTotal } from '@/features/shipments/fedex-fbo-bill';

const FEDEX_ACCOUNT = '5683f3c0-9249-40c1-a3e7-d967f0d62c29';

async function main(): Promise<void> {
  const file = process.argv[2];
  const apply = process.argv.includes('--apply');
  if (!file || file.startsWith('--')) { console.error('usage: import-fedex-fbo <file.xlsx> [--apply]'); process.exit(1); }

  const wb = XLSX.readFile(file);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, blankrows: false }) as unknown[][];
  const fbo = parseFedexFbo(rows);
  console.log(`FBO: ${fbo.length} đơn (AWB).`);

  // map AWB → shipmentId
  const ships = await db.select({ id: schema.shipments.id, t: schema.shipments.trackingNumber })
    .from(schema.shipments);
  const trackToId = new Map<string, string>();
  for (const s of ships) if (s.t) trackToId.set(s.t, s.id);

  let matched = 0, dutyCount = 0, n = 0;
  for (const r of fbo) {
    const sid = trackToId.get(r.awb);
    if (!sid) continue;
    matched += 1;
    if (r.duty !== 0) dutyCount += 1;
    if (!apply) continue;
    const num = (v: number) => v.toString();
    const vals = {
      shipmentId: sid, carrierAccountId: FEDEX_ACCOUNT, trackingNumber: r.awb,
      totalAmount: num(fboShippingTotal(r)), currency: 'VND',
      base: num(r.base), fuel: num(r.fuel), remote: num(r.remote), demand: num(r.demand),
      directSignature: num(r.signature + r.residential), vat: num(r.vat), gogreen: '0',
      discount: num(r.discount), elevatedRisk: '0', importHandling: num(r.importHandling),
      source: 'fedex_fbo', sourceHash: `fbo:${r.awb}`,
    };
    await db.insert(schema.shipmentCharges).values(vals)
      .onConflictDoUpdate({ target: schema.shipmentCharges.shipmentId, set: vals });
    n += 1;
  }

  console.log(`Khớp tracking: ${matched}/${fbo.length} | có duty (bỏ khỏi total): ${dutyCount}`);
  console.log(apply ? `✓ Đã ghi/cập nhật ${n} charge (source=fedex_fbo).` : '[DRY-RUN] Thêm --apply để ghi.');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
