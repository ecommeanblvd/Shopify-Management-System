/**
 * DHL Direct Signature: giống FedEx — quá khứ when_billed (fit theo billed,
 * hết lệch giả), từ 2026-06-15 always (mọi đơn). DHL chưa cấu hình nước miễn
 * → always áp mọi nước (cần bổ sung excludedCountryCodes nếu DHL có miễn).
 * Idempotent. --apply mới ghi.
 */
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
const DHL='67c5b5eb-ae96-4260-990b-8dd1126f3166';
const CUT=new Date('2026-06-15');
const d=(x:Date|null)=>x?x.toISOString().slice(0,10):'∞';
async function main(){
  const apply=process.argv.includes('--apply');
  const rows=await db.select().from(schema.carrierSurcharges)
    .where(and(eq(schema.carrierSurcharges.carrierAccountId,DHL),eq(schema.carrierSurcharges.kind,'addon_fixed')));
  const open=rows.find(r=>r.endsAt===null);
  if(!open){console.log('⚠ Không thấy dòng mở DHL — dừng.');process.exit(1);}
  const hasAlways=rows.some(r=>r.applyMode==='always'&&r.startsAt&&r.startsAt.getTime()===CUT.getTime());
  console.log(`Sẽ: ${rows.length} dòng → when_billed; dòng mở (${d(open.startsAt)}→∞) cắt endsAt=${d(CUT)}; thêm always ${open.value} ${d(CUT)}→∞${hasAlways?' (đã có)':''}`);
  if(!apply){console.log('[DRY-RUN] --apply để ghi.');process.exit(0);}
  for(const r of rows) await db.update(schema.carrierSurcharges)
    .set({applyMode:'when_billed',...(r.id===open.id?{endsAt:CUT}:{})}).where(eq(schema.carrierSurcharges.id,r.id));
  if(!hasAlways) await db.insert(schema.carrierSurcharges).values({
    carrierAccountId:DHL, kind:'addon_fixed', value:open.value, applyMode:'always',
    startsAt:CUT, endsAt:null, excludedCountryCodes:open.excludedCountryCodes, fuelable:open.fuelable,
    active:true, note:'DHL Direct Signature — always từ 15/06/2026 (mọi đơn)'});
  console.log('✓ Đã cập nhật DHL.');
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1);});
