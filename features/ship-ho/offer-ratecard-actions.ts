'use server';

import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { listAccounts } from '@/features/carrier-rates/actions';
import { loadAccountSnapshot } from '@/features/carrier-rates/engine/load';
import { requireManageShipHo } from './require-manage';
import { buildRateCard, type RateCard } from './offer-ratecard-logic';

export async function getPartnerRateCard(
  brandSlug: string,
): Promise<{ ok: true; card: RateCard; accountName: string } | { ok: false; error: string }> {
  try { await requireManageShipHo(); } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }

  const [partner] = await db
    .select()
    .from(schema.shipHoPartners)
    .where(eq(schema.shipHoPartners.brandSlug, brandSlug))
    .limit(1);
  if (!partner) return { ok: false, error: 'Không tìm thấy đối tác' };

  const fedex = (await listAccounts()).find((a) => a.enabled && a.carrierKey === 'fedex');
  if (!fedex) return { ok: false, error: 'Chưa có carrier account FedEx đang bật' };

  const snap = await loadAccountSnapshot(fedex.id);
  if (!snap) return { ok: false, error: 'Không nạp được bảng giá FedEx' };

  const card = buildRateCard(snap, Number(partner.markupPercent));
  return { ok: true, card, accountName: fedex.name };
}
