'use server';

import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { requireManageShipHo } from './require-manage';
import { quoteShipHoOrder } from './quote-adapter';
import { summarizeLine } from './quote-lines-logic';
import { listAccounts } from '@/features/carrier-rates/actions';

export interface LineQuote {
  accountId: string;
  name: string;
  carrierKey: string | null;
  carrierCostVnd: number;
  chargedVnd: number;
  marginVnd: number;
}

export interface QuoteLinesInput {
  partnerBrandSlug: string;
  weightKg: string;
  country: string;
  city?: string;
  postcode?: string;
  dimLengthCm?: string;
  dimWidthCm?: string;
  dimHeightCm?: string;
  packagingType?: 'bag' | 'box' | null;
}

/**
 * Quote MỌI carrier account đang bật cho 1 kiện ship hộ → giá thu (cost+markup
 * partner) + margin từng line. Line không quote được tuyến đó → BỎ (ẩn). Sort
 * theo giá thu tăng dần. KHÔNG ghi DB.
 */
export async function quoteShipHoLines(
  input: QuoteLinesInput,
): Promise<{ lines: LineQuote[]; error?: string }> {
  await requireManageShipHo();
  if (!input.partnerBrandSlug) return { lines: [], error: 'Thiếu partner' };
  if (!input.country?.trim()) return { lines: [], error: 'Thiếu quốc gia' };
  const w = Number(input.weightKg);
  if (!Number.isFinite(w) || w <= 0) return { lines: [], error: 'Cân nặng không hợp lệ' };

  const [partner] = await db
    .select()
    .from(schema.shipHoPartners)
    .where(eq(schema.shipHoPartners.brandSlug, input.partnerBrandSlug))
    .limit(1);
  const markup = Number(partner?.markupPercent ?? '0');

  const accounts = (await listAccounts()).filter((a) => a.enabled);
  const dims =
    input.dimLengthCm && input.dimWidthCm && input.dimHeightCm
      ? { lengthCm: Number(input.dimLengthCm), widthCm: Number(input.dimWidthCm), heightCm: Number(input.dimHeightCm) }
      : null;

  const lines: LineQuote[] = [];
  for (const a of accounts) {
    const q = await quoteShipHoOrder({
      carrierAccountId: a.id,
      weightKg: w,
      dimensions: dims,
      packagingType: input.packagingType ?? null,
      destinationCountry: input.country.trim().toUpperCase(),
      destinationPostcode: input.postcode || undefined,
      destinationCity: input.city || undefined,
    });
    if (!q.ok) continue; // line không quote được tuyến này → ẩn
    const { chargedVnd, marginVnd } = summarizeLine(q.carrierCostVnd, markup);
    lines.push({
      accountId: a.id,
      name: a.name,
      carrierKey: a.carrierKey ?? null,
      carrierCostVnd: q.carrierCostVnd,
      chargedVnd,
      marginVnd,
    });
  }
  lines.sort((x, y) => x.chargedVnd - y.chargedVnd);
  return { lines };
}
