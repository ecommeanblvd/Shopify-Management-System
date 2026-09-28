import { db } from '@/db/client';
import { sql } from 'drizzle-orm';
const rows = <T>(r: unknown): T[] => ((r as { rows?: T[] }).rows ?? (r as T[]));
async function main() {
  for (const cot of ['warehouse', 'inventory_type'] as const) {
    const q = await db.execute(sql`
      SELECT ${sql.raw(cot)} AS v, count(*)::int AS n
      FROM lark_wh_inventory GROUP BY 1 ORDER BY n DESC`);
    console.log(`\n=== ${cot} ===`);
    for (const x of rows<{ v: string | null; n: number }>(q)) console.log(`  ${JSON.stringify(x.v)} | ${x.n}`);
  }
  process.exit(0);
}
main();
