/**
 * Bù `lines_json` cho bảng kê đã phát hành TRƯỚC migration 0190 (CEO 01/10/2026).
 *
 * `railway run npx tsx scripts/bu-anh-chup-bang-ke.ts [--ap-dung]`
 *
 * Nguồn duy nhất còn số TỪNG DÒNG của các bản đó là payload trong
 * `ship_ho_statement_events` — và nó chỉ đáng tin khi dòng outbox CHƯA bị gửi lại lần nào
 * (`attempts = 1`): lượt gửi lại ghi đè payload, nên từ lần thứ hai nó không còn là ảnh chụp
 * lúc phát hành mà là ảnh chụp lúc gửi lại.
 *
 * Bản nào không có nguồn thì KHÔNG bịa: để `lines_json` NULL và `goDieuChinh` báo
 * `thieu_anh_chup` — một con số bịa trông hợp lý sẽ biến thành "điều chỉnh" gửi brand.
 *
 * Mặc định CHỈ ĐẾM.
 */
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';

const apDung = process.argv.includes('--ap-dung');

async function main(): Promise<void> {
  const ds = await db.select({
    id: schema.shipHoStatements.id, brand: schema.shipHoStatements.partnerBrandSlug,
    ky: schema.shipHoStatements.periodStart, type: schema.shipHoStatements.type,
    status: schema.shipHoStatements.status,
  }).from(schema.shipHoStatements)
    .where(and(isNull(schema.shipHoStatements.linesJson), sql`${schema.shipHoStatements.status} <> 'draft'`))
    .orderBy(schema.shipHoStatements.periodStart);

  console.log(`Bảng kê đã phát hành mà THIẾU ảnh chụp: ${ds.length}\n`);
  let bu = 0;
  for (const k of ds) {
    const [sk] = await db.select({
      payload: schema.shipHoStatementEvents.payload,
      tt: schema.shipHoStatementEvents.deliveryStatus,
      lan: schema.shipHoStatementEvents.attempts,
    }).from(schema.shipHoStatementEvents).where(and(
      eq(schema.shipHoStatementEvents.statementId, k.id),
      eq(schema.shipHoStatementEvents.event, 'statement.issued'),
    )).limit(1);

    const nhan = `${k.brand} · ${String(k.ky).slice(0, 7)} · ${k.type}`;
    if (!sk) { console.log(`  KHÔNG BÙ  ${nhan} — không có dòng outbox nào, không có nguồn số từng dòng`); continue; }
    if (sk.lan !== 1) { console.log(`  KHÔNG BÙ  ${nhan} — outbox đã gửi ${sk.lan} lần, payload không còn là ảnh chụp lúc phát hành`); continue; }
    const n = Array.isArray((sk.payload as { orders?: unknown[] })?.orders) ? (sk.payload as { orders: unknown[] }).orders.length : 0;
    if (n === 0) { console.log(`  KHÔNG BÙ  ${nhan} — payload không có dòng nào`); continue; }
    console.log(`  BÙ        ${nhan} — ${n} dòng từ outbox (${sk.tt}, thử ${sk.lan})`);
    bu++;
    if (!apDung) continue;
    await db.update(schema.shipHoStatements).set({ linesJson: sk.payload })
      .where(and(eq(schema.shipHoStatements.id, k.id), isNull(schema.shipHoStatements.linesJson)));
  }
  console.log(`\n${apDung ? `Đã bù ${bu} bản.` : `(chỉ đếm — thêm --ap-dung để bù ${bu} bản)`}`);
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
