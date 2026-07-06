/**
 * Rate card ship hộ cho MMP (pull, per-brand).
 *
 * MMP gọi POST /api/mmp/ship-ho/ratecard { brandSlug } (HMAC MMP_WEBHOOK_SECRET)
 * → nhận rate card BRAND-FACING của đúng brand đó (markup riêng) để lưu vào DB
 * và hiển thị cho brand đã duyệt. KHÔNG lộ giá vốn/margin: mỗi ô chỉ có `offerVnd`
 * (giá brand trả = base×(1+markup)); `baseVnd` bị loại.
 *
 * `shapeRateCardForMmp` THUẦN (không I/O) để test độc lập; `buildBrandRateCardPayload`
 * là I/O (load partner + snapshot FedEx + buildRateCard). Fuel KHÔNG bake vào giá —
 * để link riêng (áp theo tuần lúc quote), khớp cách RateCardView hiển thị cho ops.
 */
import { createHash } from 'crypto';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { listAccounts } from '@/features/carrier-rates/actions';
import { loadAccountSnapshot } from '@/features/carrier-rates/engine/load';
import { ORDER_PROCESSING_FEE_VND } from './offer-pricing';
import { buildRateCard, FEDEX_FUEL_URL, type RateCard } from './offer-ratecard-logic';
import { neutralNotes } from './brand-estimate';

export interface MmpRateCardCell { tierUpperKg: number; offerVnd: number }
export interface MmpRateCardZone { label: string; countries: string[]; cells: MmpRateCardCell[] }
export interface MmpRateCardSurcharge { kind: string; label: string; detail: string }
export interface MmpRateCardCountryZone { code: string; name: string; zone: string }

export interface MmpRateCardPayload {
  brandSlug: string;
  service: 'express';
  currency: 'VND';
  markupPercent: number;
  /** Hash 12-hex nội dung (KHÔNG gồm generatedAt) — MMP so để biết khi nào rate card đổi. */
  version: string;
  generatedAt: string; // ISO
  effectiveDate: string; // YYYY-MM-DD (ngày sinh rate card = "giá hiệu lực tính đến")
  tiers: number[];
  zones: MmpRateCardZone[];
  countryZones: MmpRateCardCountryZone[];
  surcharges: MmpRateCardSurcharge[];
  processingFeeVnd: number;
  fuelUrl: string;
  notes: string[];
}

/** THUẦN: RateCard (nội bộ) → payload MMP. Bỏ baseVnd, thêm hash/metadata/notes. */
export function shapeRateCardForMmp(
  card: RateCard,
  meta: { brandSlug: string; generatedAt: Date },
): MmpRateCardPayload {
  const zones: MmpRateCardZone[] = card.zones.map((z) => ({
    label: z.label,
    countries: z.countries,
    // Chỉ offerVnd (giá brand trả) — KHÔNG gửi baseVnd (giá vốn).
    cells: z.cells.map((c) => ({ tierUpperKg: c.tierUpperKg, offerVnd: c.offerVnd })),
  }));

  // Nội dung dùng để băm version — KHÔNG chứa generatedAt để hash ổn định giữa
  // các lần gọi, chỉ đổi khi giá/markup/phụ phí/zone thực sự đổi.
  const content = {
    brandSlug: meta.brandSlug,
    service: 'express' as const,
    currency: 'VND' as const,
    markupPercent: card.markupPercent,
    tiers: card.tiers,
    zones,
    countryZones: card.countryZones,
    surcharges: card.surcharges,
    processingFeeVnd: ORDER_PROCESSING_FEE_VND,
    fuelUrl: FEDEX_FUEL_URL,
    notes: neutralNotes(),
  };
  const version = createHash('sha256').update(JSON.stringify(content)).digest('hex').slice(0, 12);

  return {
    ...content,
    version,
    generatedAt: meta.generatedAt.toISOString(),
    effectiveDate: meta.generatedAt.toISOString().slice(0, 10),
  };
}

export type BuildRateCardResult =
  | { ok: true; ratecard: MmpRateCardPayload }
  | { ok: false; code: 'bad_input' | 'brand_not_approved' | 'no_carrier' };

/** I/O: dựng payload rate card MMP cho 1 brand đã duyệt. */
export async function buildBrandRateCardPayload(brandSlug: string): Promise<BuildRateCardResult> {
  const slug = (brandSlug ?? '').trim();
  if (!slug) return { ok: false, code: 'bad_input' };

  const [partner] = await db.select().from(schema.shipHoPartners)
    .where(eq(schema.shipHoPartners.brandSlug, slug)).limit(1);
  // Gate GIỐNG estimateForBrand: chỉ brand active + selfService mới có rate card.
  if (!partner || partner.status !== 'active' || !partner.selfServiceEnabled) {
    return { ok: false, code: 'brand_not_approved' };
  }

  const fedex = (await listAccounts()).find((a) => a.enabled && a.carrierKey === 'fedex');
  if (!fedex) return { ok: false, code: 'no_carrier' };
  const snap = await loadAccountSnapshot(fedex.id);
  if (!snap) return { ok: false, code: 'no_carrier' };

  const now = new Date();
  const card = buildRateCard(snap, Number(partner.markupPercent), now);
  return { ok: true, ratecard: shapeRateCardForMmp(card, { brandSlug: slug, generatedAt: now }) };
}
