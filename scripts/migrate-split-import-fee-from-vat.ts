/** Tách phí nhập US (nhân viên cũ gộp vào ô VAT) ra ô import_handling riêng.
 *  Giữ NGUYÊN total: vat_new = vat − phí; import_handling_new = phí (snap 64.500/68.300).
 *  Chỉ US, import_handling đang trống, phí gộp ≈ 64.500 hoặc 68.300. JP/78.000 KHÔNG đụng.
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';
const STD = [64500, 68300];
function snap(fee: number): number | null {
  for (const s of STD) if (Math.abs(fee - s) <= 300) return s;
  return null;
}
async function main() {
  const apply = process.argv.includes('--apply');
  console.log(apply ? '*** --apply: SẼ GHI shipment_charges ***' : 'DRY-RUN — chỉ in, không ghi.');
  const rows = await db.execute(sql`
    SELECT c.id, o.shopify_order_number AS ord, upper(o.ship_country) AS ctry,
      s.label_created_at::date AS d, (c.vat)::numeric AS vat, (c.total_amount)::numeric AS total,
      coalesce((c.import_handling)::numeric,0) AS imp
    FROM shipment_charges c JOIN shipments s ON s.id=c.shipment_id
      JOIN shopify_orders o ON o.id=s.order_id
    WHERE s.carrier_key='fedex' AND upper(o.ship_country)='US'
      AND coalesce((c.import_handling)::numeric,0)=0`);
  const cands: Array<{id:string;ord:string;d:string;vatOld:number;vatNew:number;fee:number}> = [];
  for (const r of rows.rows as Array<Record<string,unknown>>) {
    const vat=Number(r.vat), total=Number(r.total);
    const trueVat=Math.round(total*8/108);
    const fee=snap(vat-trueVat);
    if(fee===null) continue;
    cands.push({ id:String(r.id), ord:String(r.ord), d:String(r.d), vatOld:Math.round(vat), vatNew:Math.round(vat)-fee, fee });
  }
  const byFee=new Map<number,number>(); for(const c of cands) byFee.set(c.fee,(byFee.get(c.fee)??0)+1);
  console.log(`Đơn sẽ tách: ${cands.length}`);
  for(const [f,n] of [...byFee].sort()) console.log(`  phí ${f}đ : ${n} đơn`);
  console.log('\nMẫu 6 đơn:');
  for(const c of cands.slice(0,6)) console.log(`  ${c.ord.padEnd(12)} ${c.d}  VAT ${c.vatOld}→${c.vatNew}  +import_handling ${c.fee}`);
  if(!apply){ console.log('\nDRY-RUN XONG.'); process.exit(0); }
  let done=0;
  await db.transaction(async (tx) => {
    for(const c of cands){
      const u=await tx.execute(sql`UPDATE shipment_charges SET vat=${c.vatNew}, import_handling=${c.fee} WHERE id=${c.id}::uuid`);
      done += Number(u.rowCount ?? 0);
    }
    if(done!==cands.length) throw new Error(`UPDATE ${done}/${cands.length} — rollback`);
  });
  console.log(`\n✓ Đã tách ${done} đơn. Refresh cache đối soát (?refresh=1).`);
  process.exit(0);
}
main().catch((e)=>{console.error(e);process.exit(1);});
