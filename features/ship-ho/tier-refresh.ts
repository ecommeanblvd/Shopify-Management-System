/**
 * Auto-tier đối tác ship hộ: đếm đơn THÁNG TRƯỚC (theo lịch VN, UTC+7) của từng
 * brand → ghi tier_code. Idempotent — chạy trong cron hourly, kết quả ổn định
 * suốt tháng (window tháng trước không đổi). Strategic/override KHÔNG bị đụng
 * (resolve ưu tiên ở tier-pricing).
 */
import { sql, eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { tierForVolume } from './tier-pricing';

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

/** THUẦN: cửa sổ [đầu tháng trước, đầu tháng này) theo giờ VN, trả về UTC Date. */
export function lastMonthWindowVn(now: Date): { start: Date; end: Date } {
  const vn = new Date(now.getTime() + VN_OFFSET_MS);
  const y = vn.getUTCFullYear(), m = vn.getUTCMonth();
  const startVn = Date.UTC(y, m - 1, 1); // đầu tháng trước 00:00 VN
  const endVn = Date.UTC(y, m, 1);       // đầu tháng này 00:00 VN
  return { start: new Date(startVn - VN_OFFSET_MS), end: new Date(endVn - VN_OFFSET_MS) };
}

export async function refreshShipHoTiers(now: Date = new Date()): Promise<{ partners: number; changed: number }> {
  const { start, end } = lastMonthWindowVn(now);
  const counts = await db.execute<{ brand_slug: string; n: string }>(sql`
    SELECT partner_brand_slug AS brand_slug, COUNT(*)::text AS n
      FROM ship_ho_orders
     WHERE created_at >= ${start} AND created_at < ${end}
     GROUP BY 1;
  `);
  const byBrand = new Map(counts.rows.map((r) => [r.brand_slug, Number(r.n)]));

  const partners = await db.select({
    id: schema.shipHoPartners.id,
    brandSlug: schema.shipHoPartners.brandSlug,
    tierCode: schema.shipHoPartners.tierCode,
  }).from(schema.shipHoPartners);

  let changed = 0;
  for (const p of partners) {
    const auto = tierForVolume(byBrand.get(p.brandSlug) ?? 0);
    if (auto !== p.tierCode) {
      await db.update(schema.shipHoPartners)
        .set({ tierCode: auto, tierUpdatedAt: now })
        .where(eq(schema.shipHoPartners.id, p.id));
      changed++;
    }
  }
  return { partners: partners.length, changed };
}
