/**
 * Adapter giữa đơn ship hộ và engine carrier-rates. Phần THUẦN
 * (`pickCarrierCostVnd`) quy cước carrier về VND từ breakdown; phần I/O
 * (`quoteShipHoOrder`) nạp snapshot account rồi gọi engine `quote`.
 */
import { loadAccountSnapshot } from '@/features/carrier-rates/engine/load';
import { quote, type QuoteBreakdown } from '@/features/carrier-rates/engine/quote';

export interface ShipHoQuoteInput {
  carrierAccountId: string;
  weightKg: number;
  dimensions?: { lengthCm: number; widthCm: number; heightCm: number } | null;
  packagingType?: 'bag' | 'box' | null;
  destinationCountry: string;
  destinationPostcode?: string;
  destinationCity?: string;
}

export type ShipHoQuoteResult =
  | { ok: true; carrierCostVnd: number; baseVnd: number; zone: string; breakdown: QuoteBreakdown }
  | { ok: false; reason: string };

/** THUẦN: chọn cước ở VND. VND có thể là cost- hoặc display-currency của account. */
export function pickCarrierCostVnd(
  snap: { costCurrency: string; displayCurrency: string },
  breakdown: { carrierCost: number; carrierCostDisplay: number },
): { ok: true; vnd: number } | { ok: false; reason: string } {
  if (snap.costCurrency === 'VND') return { ok: true, vnd: breakdown.carrierCost };
  if (snap.displayCurrency === 'VND') return { ok: true, vnd: breakdown.carrierCostDisplay };
  return {
    ok: false,
    reason: `non_vnd_currency(cost=${snap.costCurrency},display=${snap.displayCurrency})`,
  };
}

/** THUẦN: quy base (cost currency) về VND, cùng quy tắc chọn tiền như carrierCost. */
export function pickBaseVnd(
  snap: { costCurrency: string; displayCurrency: string; fxCostPerDisplay: number },
  breakdown: { base: number },
): { ok: true; vnd: number } | { ok: false; reason: string } {
  if (snap.costCurrency === 'VND') return { ok: true, vnd: Math.round(breakdown.base) };
  if (snap.displayCurrency === 'VND') return { ok: true, vnd: Math.round(breakdown.base / snap.fxCostPerDisplay) };
  return {
    ok: false,
    reason: `non_vnd_currency(cost=${snap.costCurrency},display=${snap.displayCurrency})`,
  };
}

/** I/O: nạp snapshot + gọi engine, quy cước về VND. */
export async function quoteShipHoOrder(input: ShipHoQuoteInput): Promise<ShipHoQuoteResult> {
  const snap = await loadAccountSnapshot(input.carrierAccountId);
  if (!snap) return { ok: false, reason: 'carrier_account_not_found' };

  const res = quote(snap, {
    weightKg: input.weightKg,
    dimensions: input.dimensions ?? null,
    packagingType: input.packagingType ?? null,
    destinationCountry: input.destinationCountry,
    destinationPostcode: input.destinationPostcode,
    destinationCity: input.destinationCity,
  });
  if (!res.ok) return { ok: false, reason: res.code };

  const vnd = pickCarrierCostVnd(snap, res.breakdown);
  if (!vnd.ok) return { ok: false, reason: vnd.reason };

  const baseVnd = pickBaseVnd(snap, res.breakdown);
  if (!baseVnd.ok) return { ok: false, reason: baseVnd.reason };

  return { ok: true, carrierCostVnd: vnd.vnd, baseVnd: baseVnd.vnd, zone: res.zone, breakdown: res.breakdown };
}
