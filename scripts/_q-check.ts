import { sql } from 'drizzle-orm';
import { db } from '@/db/client';
async function main() {
  const t = await db.execute(sql`SELECT to_char(now(),'YYYY-MM-DD HH24:MI:SS') gio`);
  console.log('giờ DB:', (t.rows[0] as any).gio);
  const r = await db.execute(sql`
    SELECT started_at::text, status, summary, error FROM job_runs
     WHERE job_key='track-ship-ho' ORDER BY started_at DESC LIMIT 3`);
  for (const x of r.rows) console.log(JSON.stringify(x).slice(0, 420));
  const m = await db.execute(sql`
    SELECT max(last_tracked_at)::text moi_nhat FROM ship_ho_orders`);
  console.log('ship_ho track mới nhất:', (m.rows[0] as any).moi_nhat);
  process.exit(0);
}
main();
