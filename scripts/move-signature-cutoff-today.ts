/**
 * Dời mốc "always" của FedEx Direct Signature từ 2026-06-03 → 2026-06-15 (hôm
 * nay). Trước mốc = when_billed (engine fit theo billed, hết lệch giả); từ mốc
 * = always (mọi đơn trừ nước miễn). Idempotent. --apply mới ghi.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { db, schema } from '@/db/client';
const FEDEX='5683f3c0-9249-40c1-a3e7-d967f0d62c29';
const OLD=new Date('2026-06-03'), NEW=new Date('2026-06-15');
const d=(x:Date|null)=>x?x.toISOString().slice(0,10):'∞';
async function main(){
  const apply=process.argv.includes('--apply');
  const rows=await db.select().from(schema.carrierSurcharges)
    .where(and(eq(schema.carrierSurcharges.carrierAccountId,FEDEX),eq(schema.carrierSurcharges.kind,'addon_fixed')));
  console.log('Trước:'); for(const r of rows) console.log(`  ${d(r.startsAt)}→${d(r.endsAt)} apply=${r.applyMode}`);
  const always=rows.find(r=>r.applyMode==='always'&&r.endsAt===null);
  const wb=rows.find(r=>r.applyMode==='when_billed'&&r.endsAt&&r.endsAt.getTime()===OLD.getTime());
  if(!always||!wb){console.log('⚠ Không tìm thấy đúng cặp mốc 03/06 — dừng.');process.exit(1);}
  console.log(`\nDự kiến: when_billed endsAt ${d(OLD)}→${d(NEW)}; always startsAt ${d(OLD)}→${d(NEW)}`);
  if(!apply){console.log('[DRY-RUN] --apply để ghi.');process.exit(0);}
  await db.update(schema.carrierSurcharges).set({endsAt:NEW}).where(eq(schema.carrierSurcharges.id,wb.id));
  await db.update(schema.carrierSurcharges).set({startsAt:NEW}).where(eq(schema.carrierSurcharges.id,always.id));
  console.log('✓ Đã dời mốc → 15/6 (cache reconcile tự tính lại).');
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1);});
