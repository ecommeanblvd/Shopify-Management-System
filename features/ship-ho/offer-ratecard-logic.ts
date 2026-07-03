/** THUẦN: dựng rate card offer (base×(1+markup)) theo zone × mức cân từ snapshot carrier. */
import { pickBaseVnd } from './quote-adapter';

export interface RateCardCell { tierUpperKg: number; baseVnd: number; offerVnd: number }
export interface RateCardZone { label: string; countries: string[]; cells: RateCardCell[] }
export interface RateCard { markupPercent: number; tiers: number[]; zones: RateCardZone[]; surchargeNotes: string[] }

export interface RateCardSnapshot {
  costCurrency: string;
  displayCurrency: string;
  fxCostPerDisplay: number;
  weightTiers: { upperKg: number }[];
  zonesByCountry: Map<string, { label: string; rateByTierUpper: Map<number, number> }>;
  surcharges: { kind: string }[];
}

// Nhãn tiếng Việt cho surcharge kind (chỉ các kind muốn hiện trên rate card).
const SURCHARGE_LABELS: Record<string, string> = {
  fuel_percent: 'Phụ phí xăng dầu (theo tuần FedEx)',
  remote_fixed: 'Phụ phí vùng xa',
  residential: 'Phụ phí địa chỉ dân cư',
  demand_per_kg: 'Phụ phí nhu cầu theo kg',
  country_fixed: 'Phí xử lý theo nước',
  peak_fixed: 'Phụ phí cao điểm',
  vat_percent: 'VAT',
};

export function buildRateCard(snap: RateCardSnapshot, markupPercent: number): RateCard {
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

  const seen = new Set<string>();
  const surchargeNotes: string[] = [];
  for (const s of snap.surcharges) {
    const label = SURCHARGE_LABELS[s.kind];
    if (label && !seen.has(label)) { seen.add(label); surchargeNotes.push(label); }
  }

  return { markupPercent, tiers, zones, surchargeNotes };
}
