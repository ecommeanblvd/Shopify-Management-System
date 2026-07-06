/** THUẦN: dựng rate card offer (base×(1+markup)) theo zone × mức cân từ snapshot carrier. */
import { pickBaseVnd } from './quote-adapter';
import { isApplicable, type SurchargeSnap } from '@/features/carrier-rates/engine/quote';
import { countryByIso } from '@/lib/geo/countries';

/** Link tra phụ phí xăng dầu FedEx (hiển thị trên rate card). */
export const FEDEX_FUEL_URL = 'https://www.fedex.com/en-vn/shipping/fuel-surcharge.html';

export interface RateCardCell { tierUpperKg: number; baseVnd: number; offerVnd: number }
export interface RateCardZone { label: string; countries: string[]; cells: RateCardCell[] }
export interface RateCardCountryZone { code: string; name: string; zone: string }
export interface RateCardSurcharge { label: string; detail: string }
export interface RateCard {
  markupPercent: number;
  tiers: number[];
  zones: RateCardZone[];
  countryZones: RateCardCountryZone[];
  surcharges: RateCardSurcharge[];
}

export interface RateCardSnapshot {
  costCurrency: string;
  displayCurrency: string;
  fxCostPerDisplay: number;
  weightTiers: { upperKg: number }[];
  zonesByCountry: Map<string, { label: string; rateByTierUpper: Map<number, number> }>;
  /**
   * Structural subset of SurchargeSnap (engine/quote.ts) — snapshot thật (từ
   * loadAccountSnapshot) khớp type này. Dùng SurchargeSnap trực tiếp (thay vì
   * intersection với field required) để tránh xung đột variance khi TS so khớp
   * mảng — các field optional của SurchargeSnap được coi như `| undefined`
   * tương đương null trong buildSurcharges/countryZones.
   */
  surcharges: SurchargeSnap[];
}

/** Định dạng VND nguyên, kiểu "82.200₫". */
function vnd(v: number): string {
  return v.toLocaleString('vi-VN') + '₫';
}

export function buildRateCard(snap: RateCardSnapshot, markupPercent: number, asOf: Date): RateCard {
  const tiers = snap.weightTiers.map((t) => t.upperKg).slice().sort((a, b) => a - b);

  // Gom zone distinct theo label + danh sách nước.
  const byLabel = new Map<string, { zone: { label: string; rateByTierUpper: Map<number, number> }; countries: string[] }>();
  for (const [country, zone] of snap.zonesByCountry) {
    const e = byLabel.get(zone.label) ?? { zone, countries: [] };
    e.countries.push(country);
    byLabel.set(zone.label, e);
  }

  const zones: RateCardZone[] = [];
  for (const { zone, countries } of byLabel.values()) {
    const cells: RateCardCell[] = [];
    for (const tierUpperKg of tiers) {
      const baseCost = zone.rateByTierUpper.get(tierUpperKg);
      if (baseCost === undefined) continue; // ô thiếu rate → bỏ
      const conv = pickBaseVnd(snap, { base: baseCost });
      if (!conv.ok) continue;
      const baseVnd = conv.vnd;
      cells.push({ tierUpperKg, baseVnd, offerVnd: Math.round(baseVnd * (1 + markupPercent / 100)) });
    }
    zones.push({ label: zone.label, countries: countries.slice().sort(), cells });
  }
  zones.sort((a, b) => a.label.localeCompare(b.label));

  // Bảng zone quốc gia kiểu carrier: 1 dòng / nước, sort theo tên nước.
  const countryZones: RateCardCountryZone[] = [];
  for (const [code, zone] of snap.zonesByCountry) {
    countryZones.push({ code, name: countryByIso(code)?.name ?? code, zone: zone.label });
  }
  countryZones.sort((a, b) => a.name.localeCompare(b.name));

  const surcharges = buildSurcharges(snap.surcharges, asOf);

  return { markupPercent, tiers, zones, countryZones, surcharges };
}

function buildSurcharges(
  raw: RateCardSnapshot['surcharges'],
  asOf: Date,
): RateCardSurcharge[] {
  // isApplicable là single source of truth (features/carrier-rates/engine/quote.ts):
  // active && startsAt≤asOf && (endsAt==null||endsAt>asOf).
  const active = raw.filter((s) => isApplicable(s, asOf));

  const surcharges: RateCardSurcharge[] = [];

  // fuel_percent: 1 dòng / row (không gộp — mỗi row đã là mức hiện hành).
  for (const s of active.filter((x) => x.kind === 'fuel_percent')) {
    surcharges.push({ label: 'Phụ phí xăng dầu (FedEx, theo tuần)', detail: `${s.value}% × cước` });
  }

  // remote_fixed: gộp mọi tier thành 1 dòng.
  const remoteRows = active.filter((s) => s.kind === 'remote_fixed');
  if (remoteRows.length > 0) {
    const parts = remoteRows.map((s) => {
      const tierLabel = s.tier ?? '—';
      const formula = s.valuePerKg
        ? `max(${vnd(s.value)}/lô, ${vnd(s.valuePerKg)}/kg)`
        : `${vnd(s.value)}/lô`;
      return `${tierLabel}: ${formula}`;
    });
    surcharges.push({
      label: 'Phụ phí vùng xa (ODA — theo mã bưu chính đích)',
      detail: parts.join(' · '),
    });
  }

  // residential_fixed: 1 dòng / row.
  for (const s of active.filter((x) => x.kind === 'residential_fixed')) {
    let detail = `${vnd(s.value)}/lô`;
    if (s.countryCodes && s.countryCodes.length > 0) detail += ` (áp dụng: ${s.countryCodes.join(', ')})`;
    surcharges.push({ label: 'Phụ phí địa chỉ dân cư', detail });
  }

  // demand_per_kg: gộp theo value distinct.
  const demandRows = active.filter((s) => s.kind === 'demand_per_kg');
  if (demandRows.length > 0) {
    const distinctValues = Array.from(new Set(demandRows.map((s) => s.value))).sort((a, b) => a - b);
    const parts = distinctValues.map((v) => `${vnd(v)}/kg`);
    const detail = distinctValues.length > 1 ? `${parts.join(' · ')} (tùy khu vực đích)` : parts[0];
    surcharges.push({ label: 'Phụ phí nhu cầu (Demand) theo kg', detail });
  }

  // country_fixed: 1 dòng / row.
  for (const s of active.filter((x) => x.kind === 'country_fixed')) {
    let detail = `${vnd(s.value)}/lô`;
    if (s.countryCodes && s.countryCodes.length > 0) detail += ` (áp dụng: ${s.countryCodes.join(', ')})`;
    surcharges.push({ label: 'Phí xử lý theo nước', detail });
  }

  // addon_fixed: 1 dòng / row.
  for (const s of active.filter((x) => x.kind === 'addon_fixed')) {
    surcharges.push({ label: 'Phí ký nhận trực tiếp (Direct Signature, khi chọn)', detail: `${vnd(s.value)}/lô` });
  }

  // vat_percent: 1 dòng / row.
  for (const s of active.filter((x) => x.kind === 'vat_percent')) {
    surcharges.push({ label: 'VAT', detail: `${s.value}%` });
  }

  return surcharges;
}
