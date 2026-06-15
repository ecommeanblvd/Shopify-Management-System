/**
 * Phân loại địa chỉ người nhận (FedEx Address Validation) cho các đơn BỊ THU
 * phí Residential → xác minh phí đúng/sai để đòi NCC.
 *   railway run -- npx tsx scripts/classify-fedex-residential.ts <file.xlsx> [--limit N] [--apply] [--refresh]
 *
 * Chỉ classify đơn có residential>0 + khớp tracking. Dedup theo địa chỉ (gọi
 * API 1 lần/địa chỉ). Lưu KẾT QUẢ vào shipment_charges.residential_class
 * (không lưu địa chỉ — tránh PII). Mặc định dry-run.
 */
import * as XLSX from 'xlsx';
import { eq, inArray } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { parseFedexFbo, type FboBilledRow } from '@/features/shipments/fedex-fbo-parse';
import { resolveAddress, type AddressInput } from '@/lib/fedex/address';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };

const addrInput = (r: FboBilledRow): AddressInput => ({
  streetLines: [r.recipientStreet1 ?? '', r.recipientStreet2 ?? ''].filter((s) => s.trim()),
  city: r.recipientCity, stateOrProvinceCode: r.recipientState,
  postalCode: r.recipientPostcode, countryCode: r.recipientCountry ?? 'US',
});
const addrKey = (r: FboBilledRow) =>
  [r.recipientStreet1, r.recipientCity, r.recipientState, r.recipientPostcode, r.recipientCountry]
    .map((s) => String(s ?? '').trim().toUpperCase()).join('|');

async function main(): Promise<void> {
  const file = process.argv[2];
  if (!file || file.startsWith('--')) { console.error('usage: classify-fedex-residential <file.xlsx> [--limit N] [--apply] [--refresh]'); process.exit(1); }
  const limit = Number(arg('limit') ?? '99999');
  const apply = process.argv.includes('--apply');
  const refresh = process.argv.includes('--refresh');

  const wb = XLSX.readFile(file);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, blankrows: false }) as unknown[][];
  const fbo = parseFedexFbo(rows).filter((r) => r.residential > 0 && (r.recipientStreet1 || r.recipientCity));

  // AWB → shipmentId (chỉ đơn trong hệ thống, có residential billed)
  const awbs = fbo.map((r) => r.awb);
  const sidByAwb = new Map<string, string>();
  for (let i = 0; i < awbs.length; i += 500) {
    const chunk = awbs.slice(i, i + 500);
    const sc = await db.select({ sid: schema.shipmentCharges.shipmentId, t: schema.shipmentCharges.trackingNumber, cls: schema.shipmentCharges.residentialClass })
      .from(schema.shipmentCharges).where(inArray(schema.shipmentCharges.trackingNumber, chunk));
    for (const s of sc) if (s.t && (refresh || !s.cls)) sidByAwb.set(s.t, s.sid);
  }
  const todo = fbo.filter((r) => sidByAwb.has(r.awb)).slice(0, limit);
  console.log(`Cần classify: ${todo.length} đơn residential${refresh ? ' (refresh)' : ' (chưa classify)'}.`);

  // dedup theo địa chỉ → classify 1 lần/địa chỉ
  const classByKey = new Map<string, string>();
  const tally: Record<string, number> = {};
  let businessVnd = 0, n = 0;
  const now = new Date();

  for (const r of todo) {
    const key = addrKey(r);
    let cls = classByKey.get(key);
    if (!cls) {
      try {
        cls = (await resolveAddress(addrInput(r))).classification;
        await sleep(300);
      } catch (e) { cls = 'UNKNOWN'; console.log(`  ${r.awb}: lỗi ${(e as Error).message.slice(0, 60)}`); }
      classByKey.set(key, cls);
    }
    tally[cls] = (tally[cls] ?? 0) + 1;
    if (cls === 'BUSINESS') businessVnd += r.residential;
    if (apply) {
      await db.update(schema.shipmentCharges)
        .set({ residentialClass: cls, residentialClassAt: now })
        .where(eq(schema.shipmentCharges.shipmentId, sidByAwb.get(r.awb)!));
      n += 1;
    }
  }

  console.log('\nPhân loại:', JSON.stringify(tally));
  console.log(`⚠ BUSINESS (thu residential SAI → đòi NCC): ${tally.BUSINESS ?? 0} đơn · ${Math.round(businessVnd).toLocaleString('vi-VN')} VND`);
  console.log(apply ? `✓ Đã ghi ${n} classification.` : '[DRY-RUN] Thêm --apply để ghi.');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
