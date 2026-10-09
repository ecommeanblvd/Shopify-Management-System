/** TẠM: cho don 0123 co gia sau khi sua quoc gia. Xoá sau khi dùng. */
import { db } from '@/db/client';
import { sql } from 'drizzle-orm';
async function main() {
  const han = Date.now() + 45 * 60 * 1000;
  while (Date.now() < han) {
    try {
      const r = await db.execute(sql`
        select o.code, o.country, o.actual_charged_vnd, o.actual_duty_vnd, o.statement_id,
               s.period_start, s.type::text as loai, s.status::text as tt
        from ship_ho_orders o
        left join ship_ho_statements s on s.id = o.statement_id
        where o.code = '26-INSLG-SV-0123'
      `);
      const row = (r as { rows?: Record<string, unknown>[] }).rows?.[0];
      if (row?.actual_charged_vnd != null) {
        console.log('DA CO GIA:', JSON.stringify(row, null, 1));
        process.exit(0);
      }
    } catch (e) {
      console.error('[cho] bo qua loi tam thoi:', e instanceof Error ? e.message : String(e));
    }
    await new Promise((s) => setTimeout(s, 90_000));
  }
  console.log('HET HAN: chua co gia');
  process.exit(0);
}
void main();
