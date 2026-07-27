'use server';

import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { listAccounts } from '@/features/carrier-rates/actions';
import { loadAccountSnapshot } from '@/features/carrier-rates/engine/load';
import { requireManageShipHo } from './require-manage';
import { buildRateCard, type RateCard } from './offer-ratecard-logic';
import { resolveTier, effectiveMarkupPercent } from './tier-pricing';

export async function getPartnerRateCard(
  brandSlug: string,
): Promise<{ ok: true; card: RateCard; accountName: string; odaLookupUrl: string } | { ok: false; error: string }> {
  try { await requireManageShipHo(); } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }

  const [partner] = await db
    .select()
    .from(schema.shipHoPartners)
    .where(eq(schema.shipHoPartners.brandSlug, brandSlug))
    .limit(1);
  if (!partner) return { ok: false, error: 'Không tìm thấy đối tác' };

  const fedex = (await listAccounts()).find((a) => a.enabled && a.carrierKey === 'fedex');
  if (!fedex) return { ok: false, error: 'Chưa có carrier account FedEx đang bật' };

  // Ratecard chỉ cần dòng phụ phí, không cần postcode list (ODA 2026 ~130k dòng).
  const snap = await loadAccountSnapshot(fedex.id, new Date(), { skipRemotePostcodes: true });
  if (!snap) return { ok: false, error: 'Không nạp được bảng giá FedEx' };

  // Tier pricing (spec 09/07): markup hiệu dụng từ tier, không dùng markup_percent legacy.
  const tier = resolveTier({
    strategic: partner.strategic, overrideCode: partner.tierOverrideCode, autoCode: partner.tierCode,
  });
  const card = buildRateCard(snap, Math.round(effectiveMarkupPercent(tier.discountPct) * 10000) / 10000, new Date());
  const odaLookupUrl = `/f/carrier-rates/${fedex.id}/remote-postcodes`;
  return { ok: true, card, accountName: fedex.name, odaLookupUrl };
}
