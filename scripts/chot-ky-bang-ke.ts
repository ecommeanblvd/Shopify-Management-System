/**
 * Phát hành (chốt) bảng kê ship hộ bằng script — CEO 01/10/2026 cho phép cho ca kỳ 09.
 *
 * `railway run npx tsx scripts/chot-ky-bang-ke.ts --ky=2026-09 --brand=kalisa,mirer [--ap-dung]`
 *
 * Vì sao có đường này: phát hành vốn CỐ Ý là nút người bấm ("chốt kỳ là việc kế toán" — CEO
 * 28/09/2026). Script này KHÔNG đi tắt qua luật: toàn bộ hàng rào nằm trong `phatHanhBangKe`
 * (lõi không-auth), script chỉ chọn bảng kê và gọi nó. Thiếu hàng rào nào thì sửa ở lõi, không
 * sửa ở đây — hai bản sao của một luật tiền là cách chắc nhất để chúng lệch nhau.
 *
 * BẮT BUỘC khai `--ky` VÀ `--brand`: chốt kỳ là gửi yêu cầu thu tiền tới brand và không lùi
 * được. Một lệnh chạy nhầm không được phép phát hành cả sổ, nên không có chế độ "tất cả".
 *
 * Mặc định CHỈ ĐẾM. Thêm `--ap-dung` mới phát hành.
 */
import { eq, and, inArray } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { phatHanhBangKe, donLechKy } from '@/features/ship-ho/statement-core';
import { kyTuTen } from '@/features/ship-ho/ky-bang-ke';

const f = (n: number) => n.toLocaleString('vi-VN');
const doc = (ten: string) => process.argv.find((a) => a.startsWith(`--${ten}=`))?.split('=')[1] ?? '';

async function main(): Promise<void> {
  const apDung = process.argv.includes('--ap-dung');
  const ky = doc('ky');
  const brands = doc('brand').split(',').map((x) => x.trim()).filter(Boolean);
  if (!ky || brands.length === 0) {
    process.stderr.write('Bắt buộc: --ky=YYYY-MM --brand=slug1,slug2 [--ap-dung]\n');
    process.exitCode = 1; return;
  }
  const { dau } = kyTuTen(ky); // ném luôn nếu tên kỳ sai, không đoán

  const kes = await db.select({
    id: schema.shipHoStatements.id, brand: schema.shipHoStatements.partnerBrandSlug,
    type: schema.shipHoStatements.type, status: schema.shipHoStatements.status,
    don: schema.shipHoStatements.orderCount, tien: schema.shipHoStatements.totalChargedVnd,
  }).from(schema.shipHoStatements)
    .where(and(
      eq(schema.shipHoStatements.periodStart, dau),
      inArray(schema.shipHoStatements.partnerBrandSlug, brands),
    ))
    .orderBy(schema.shipHoStatements.partnerBrandSlug, schema.shipHoStatements.type);

  const thieu = brands.filter((b) => !kes.some((k) => k.brand === b));
  for (const b of thieu) console.log(`  ⚠ ${b}: KHÔNG có bảng kê nào ở kỳ ${ky} — kiểm lại slug`);

  console.log(`Kỳ ${ky} · brand khai: ${brands.join(', ')} · tìm thấy ${kes.length} bảng kê\n`);
  let tongTien = 0, soChot = 0;
  for (const k of kes) {
    const lech = await donLechKy(k.id);
    const nhan = `${k.brand} · ${k.type} · ${k.don} đơn · ${f(Number(k.tien))}đ`;
    if (k.status !== 'draft') { console.log(`  BỎ QUA  ${nhan} — đã ${k.status}`); continue; }
    if (lech.length > 0) { console.log(`  CHẶN    ${nhan} — ${lech.length} đơn lệch kỳ: ${lech.slice(0, 5).join(', ')}`); continue; }
    console.log(`  CHỐT    ${nhan}`);
    soChot++; tongTien += Number(k.tien);
  }
  console.log(`\nSẽ phát hành ${soChot} bảng kê · TỔNG ${f(tongTien)}đ`);

  if (!apDung) { console.log('\n(chỉ đếm — thêm --ap-dung để phát hành)'); return; }
  if (soChot === 0) { console.log('\nKhông có bảng kê nào phát hành được.'); return; }

  console.log('\n— phát hành —');
  for (const k of kes) {
    if (k.status !== 'draft') continue;
    const r = await phatHanhBangKe(k.id);
    if (!r.ok) { console.log(`  ✗ ${k.brand} · ${k.type}: ${r.error}`); continue; }
    // Lượt bắn MMP là best-effort nên PHẢI nói ra kết quả riêng: bảng kê đã 'issued' mà MMP
    // chưa nhận là trạng thái có thật, và từ 01/10 nó nằm trong outbox để cron thử lại.
    const mmp = r.mmp ? (r.mmp.ok ? `MMP nhận (${r.mmp.detail})` : `MMP CHƯA nhận: ${r.mmp.detail}`) : 'không dựng được payload';
    console.log(`  ✓ ${k.brand} · ${k.type} · ${f(Number(k.tien))}đ — đã phát hành · ${mmp}`);
  }

  console.log('\n— sổ gửi bảng kê sau lượt này —');
  const sk = await db.select({
    brand: schema.shipHoStatementEvents.brandSlug, event: schema.shipHoStatementEvents.event,
    tt: schema.shipHoStatementEvents.deliveryStatus, lan: schema.shipHoStatementEvents.attempts,
    http: schema.shipHoStatementEvents.lastHttpStatus, loi: schema.shipHoStatementEvents.lastError,
  }).from(schema.shipHoStatementEvents).orderBy(schema.shipHoStatementEvents.occurredAt);
  for (const x of sk) {
    console.log(`  ${x.brand} · ${x.event} · ${x.tt} · thử ${x.lan} · http ${x.http ?? '—'}${x.loi ? ` · ${x.loi}` : ''}`);
  }
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
