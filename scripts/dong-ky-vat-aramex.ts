/**
 * ĐÓNG KỲ dòng VAT của tài khoản Aramex HN — để chi phí hãng khớp ĐÚNG hoá đơn họ xuất.
 *
 *   railway run npx tsx scripts/dong-ky-vat-aramex.ts            # CHẠY THỬ, không ghi gì
 *   railway run npx tsx scripts/dong-ky-vat-aramex.ts --ap-dung  # ghi thật
 *
 * HNC đổi sang bảng giá GỘP VAT. Mốc trên hoá đơn thật rất sạch, không có vùng xám:
 *   … → 21/08/2026 : 100% dòng hoá đơn CÓ VAT
 *   24/08/2026 → … : 100% dòng hoá đơn VAT = 0   (22–23/08 cuối tuần, không kiện nào)
 * Nên engine cộng thêm 8% từ 22/08 là tính thừa — đo trên 15 kiện tháng 9, giá hệ thống cao
 * hơn hoá đơn 12,3–12,4%, tách ra thì ~8% là VAT thừa và ~4% là tỉ giá trôi.
 *
 * ĐÓNG KỲ, KHÔNG XOÁ: tháng 7 và nửa đầu tháng 8 hoá đơn THẬT có VAT 8%, và engine phải tính
 * lại đúng số đó khi đối soát kỳ cũ. Xoá dòng là bịa lại lịch sử.
 *
 * KHÔNG đụng giá bán cho brand: giá đó đi theo bảng giá fix riêng của từng brand, và VAT mình
 * xuất hoá đơn cho brand là khoản của MEAN BLVD, không phải VAT của hãng (CEO 16/10/2026).
 */
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';

const APDUNG = process.argv.includes('--ap-dung');
/** Ngày đầu tiên HNC KHÔNG còn thu VAT riêng. `ends_at` là biên MỞ nên kiện 21/08 vẫn có VAT. */
const DONG_TU = new Date('2026-08-22T00:00:00Z');

async function main() {
  const [acc] = await db.select({ id: schema.carrierAccounts.id, ten: schema.carrierAccounts.name })
    .from(schema.carrierAccounts)
    .innerJoin(schema.carriers, eq(schema.carriers.id, schema.carrierAccounts.carrierId))
    .where(eq(schema.carriers.key, 'aramex')).limit(1);
  if (!acc) { console.error('Không tìm thấy tài khoản Aramex.'); process.exit(1); }

  const ds = await db.select({
    id: schema.carrierSurcharges.id, value: schema.carrierSurcharges.value,
    tu: schema.carrierSurcharges.startsAt, den: schema.carrierSurcharges.endsAt,
    active: schema.carrierSurcharges.active, note: schema.carrierSurcharges.note,
  }).from(schema.carrierSurcharges)
    .where(and(
      eq(schema.carrierSurcharges.carrierAccountId, acc.id),
      eq(schema.carrierSurcharges.kind, 'vat_percent'),
    ));

  console.log(`${acc.ten} — ${ds.length} dòng VAT:\n`);
  const canSua = ds.filter((x) => x.active && x.den == null);
  for (const x of ds) {
    const mo = x.den == null ? 'MỞ (không hạn)' : `đến ${String(x.den).slice(0, 10)}`;
    console.log(`  ${x.value}% · từ ${String(x.tu).slice(0, 10)} · ${mo} · ${x.active ? 'đang bật' : 'đã tắt'}`);
    console.log(`     ${x.note ?? ''}`);
  }

  if (canSua.length === 0) {
    console.log('\nKhông có dòng VAT nào còn mở — không cần làm gì.');
    process.exit(0);
  }
  console.log(`\nSẼ ĐÓNG ${canSua.length} dòng tại ${DONG_TU.toISOString().slice(0, 10)}:`);
  console.log('  kiện gửi TRƯỚC 22/08/2026 → vẫn tính VAT 8% (đúng hoá đơn kỳ cũ)');
  console.log('  kiện gửi TỪ  22/08/2026 → không còn cộng VAT (giá HNC đã gộp)');

  if (!APDUNG) {
    console.log('\n=== CHẠY THỬ — KHÔNG ghi gì. Thêm --ap-dung để ghi thật. ===');
    process.exit(0);
  }
  for (const x of canSua) {
    await db.update(schema.carrierSurcharges)
      .set({
        endsAt: DONG_TU,
        note: `${x.note ?? ''} · đóng kỳ 22/08/2026: HNC chuyển sang bảng giá GỘP VAT, hoá đơn từ 24/08 có VAT=0 (đo 96 dòng)`.trim(),
      })
      .where(eq(schema.carrierSurcharges.id, x.id));
  }
  console.log(`\n✓ ĐÃ ĐÓNG ${canSua.length} dòng tại ${DONG_TU.toISOString().slice(0, 10)}`);
  process.exit(0);
}
main();
