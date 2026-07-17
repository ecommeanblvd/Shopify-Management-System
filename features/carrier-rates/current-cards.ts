/**
 * Bảng giá CURRENT của các carrier account đang bật — cho cổng API external.
 * "Current" = rate card có hiệu lực hôm nay (effective_from ≤ today ≤ effective_to
 * hoặc effective_to NULL = open-ended). Trả zones × weight tiers × giá mua vào
 * (cost currency của account) — KHÔNG gồm markup/giá bán.
 */
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';

export interface CurrentRateCard {
  carrierKey: string;
  accountName: string;
  cardLabel: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  currency: string;
  zones: Array<{
    zone: string;
    countries: string[];
    tiers: Array<{ upperKg: number; packageType: string | null; price: number }>;
  }>;
}

export async function getCurrentRateCards(): Promise<CurrentRateCard[]> {
  const rows = await db.execute(sql`
    SELECT cr.key AS carrier_key, a.name AS account_name, a.cost_currency AS currency,
           rc.label AS card_label, rc.effective_from, rc.effective_to,
           z.label AS zone, wt.upper_kg, cell.package_type, cell.cost_amount,
           COALESCE((SELECT array_agg(zc.country_code ORDER BY zc.country_code)
                     FROM carrier_zone_countries zc WHERE zc.carrier_zone_id = z.id), '{}') AS countries
    FROM carrier_rate_cards rc
    JOIN carrier_accounts a ON a.id = rc.carrier_account_id AND a.enabled
    JOIN carriers cr ON cr.id = a.carrier_id
    JOIN carrier_rate_cells cell ON cell.rate_card_id = rc.id
    JOIN carrier_zones z ON z.id = cell.carrier_zone_id
    JOIN carrier_weight_tiers wt ON wt.id = cell.carrier_weight_tier_id
    WHERE rc.effective_from <= CURRENT_DATE
      AND (rc.effective_to IS NULL OR rc.effective_to >= CURRENT_DATE)
    ORDER BY cr.key, a.name, z.label, wt.upper_kg, cell.package_type
  `);

  const byAccount = new Map<string, CurrentRateCard>();
  for (const r of rows.rows as Record<string, unknown>[]) {
    const accKey = `${r.carrier_key}|${r.account_name}|${r.card_label}`;
    let card = byAccount.get(accKey);
    if (!card) {
      card = {
        carrierKey: String(r.carrier_key),
        accountName: String(r.account_name),
        cardLabel: String(r.card_label),
        effectiveFrom: String(r.effective_from),
        effectiveTo: r.effective_to == null ? null : String(r.effective_to),
        currency: String(r.currency),
        zones: [],
      };
      byAccount.set(accKey, card);
    }
    let zone = card.zones.find((z) => z.zone === String(r.zone));
    if (!zone) {
      zone = { zone: String(r.zone), countries: (r.countries as string[]) ?? [], tiers: [] };
      card.zones.push(zone);
    }
    zone.tiers.push({
      upperKg: Number(r.upper_kg),
      packageType: r.package_type == null ? null : String(r.package_type),
      price: Number(r.cost_amount),
    });
  }
  return [...byAccount.values()];
}
