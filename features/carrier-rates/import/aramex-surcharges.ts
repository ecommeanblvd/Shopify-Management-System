/**
 * Phụ phí Aramex (công văn HNC 2601/CV/QTHN, hiệu lực 01/02/2024) — data thuần
 * + logic bake all-in, tách khỏi script I/O để test độc lập.
 *
 * Base Aramex lưu ALL-IN fuel FIX 30% + VAT 8%. 9 phụ phí này công văn ghi
 * "chưa gồm PPXD và VAT; riêng DTP/DDP không tính PPXD" và đi theo fuel BIẾN
 * ĐỘNG của Aramex (aramex.com/us fuel-surcharge, 2 lần/tháng) + VAT 8% fix.
 * Engine chỉ có MỘT mức fuel/account nên phụ phí phải BAKE ALL-IN theo fuel
 * hiện hành (base fix 30% ≠ phụ phí biến động → không dùng chung dòng fuel_percent).
 */

export const ARAMEX_VAT_PERCENT = 8;
/** Aramex fuel July 2026 (1st-15th). BIẾN ĐỘNG 2 lần/tháng — trang WAF chặn
 *  auto-fetch nên truyền tay qua --fuel khi đổi. */
export const ARAMEX_DEFAULT_FUEL_PERCENT = 30;
export const ARAMEX_SURCHARGE_NOTE_PREFIX = 'Aramex phụ phí 01/02/2024';

export interface AramexSurcharge {
  kind: 'addon_fixed' | 'residential_fixed' | 'remote_fixed' | 'country_fixed';
  rawUsd: number;
  /** remote: raw USD/kg đi kèm rawUsd làm sàn (engine dùng max). */
  rawPerKg?: number;
  /** true → chịu PPXD (bake fuel). DDP = false (không tính PPXD). */
  fuelable: boolean;
  applyMode: 'always' | 'when_billed';
  countryCodes?: string[];
  label: string;
}

/** 9 phụ phí công văn — RAW USD (nguồn sự thật, dùng để re-bake khi fuel đổi). */
export const ARAMEX_SURCHARGES: AramexSurcharge[] = [
  { kind: 'addon_fixed', rawUsd: 15, fuelable: true, applyMode: 'when_billed', label: 'Sai địa chỉ (Bad address)' },
  { kind: 'residential_fixed', rawUsd: 6.0, fuelable: true, applyMode: 'always', label: 'Địa chỉ khu dân cư (Residential)' },
  { kind: 'remote_fixed', rawUsd: 30, rawPerKg: 0.5, fuelable: true, applyMode: 'always', label: 'Vùng sâu vùng xa (Remote) max(30 USD/lô, 0.5 USD/kg)' },
  { kind: 'addon_fixed', rawUsd: 110, fuelable: true, applyMode: 'when_billed', label: 'Kiện quá trọng tải ≥70kg (Over Weight)/kiện' },
  { kind: 'addon_fixed', rawUsd: 82.5, fuelable: true, applyMode: 'when_billed', label: 'Kiện ngoại cỡ ≥120cm (Over Sized)/kiện' },
  { kind: 'addon_fixed', rawUsd: 315, fuelable: true, applyMode: 'when_billed', label: 'Pallet không xếp chồng (Non-stackable)/kiện' },
  { kind: 'country_fixed', rawUsd: 35, fuelable: true, applyMode: 'always',
    countryCodes: ['AF', 'BI', 'IQ', 'LY', 'ML', 'NE', 'SS', 'SY', 'YE'], label: 'Rủi ro cao (Elevated Risk)' },
  { kind: 'country_fixed', rawUsd: 40, fuelable: true, applyMode: 'always',
    countryCodes: ['CF', 'CD', 'ER', 'IR', 'IQ', 'KP', 'LR', 'LY', 'SO', 'SD', 'SY', 'YE'], label: 'Điểm đến khó tiếp cận (Restricted Destination)' },
  { kind: 'addon_fixed', rawUsd: 30, fuelable: false, applyMode: 'when_billed', label: 'Trả thuế đầu gửi DDP (30 USD/lô hoặc 5% thuế) — KHÔNG tính PPXD' },
];

/** raw → all-in USD (2 dp). fuelable: ×(1+fuel%)×(1+VAT%). DDP: ×(1+VAT%). */
export function bakeAramex(raw: number, fuelable: boolean, fuelPct: number): number {
  const withFuel = fuelable ? raw * (1 + fuelPct / 100) : raw;
  return Math.round(withFuel * (1 + ARAMEX_VAT_PERCENT / 100) * 100) / 100;
}

export interface BakedAramexSurcharge {
  kind: AramexSurcharge['kind'];
  value: number;
  valuePerKg: number | null;
  applyMode: 'always' | 'when_billed';
  countryCodes: string[] | null;
  note: string;
}

/** Bake toàn bộ 9 phụ phí theo fuelPct hiện hành → rows sẵn sàng ghi DB. */
export function bakeAramexSurcharges(fuelPct: number): BakedAramexSurcharge[] {
  return ARAMEX_SURCHARGES.map((s) => {
    const value = bakeAramex(s.rawUsd, s.fuelable, fuelPct);
    const valuePerKg = s.rawPerKg !== undefined ? bakeAramex(s.rawPerKg, s.fuelable, fuelPct) : null;
    const note = `${ARAMEX_SURCHARGE_NOTE_PREFIX}: ${s.label} · raw ${s.rawUsd}${s.rawPerKg ? `+${s.rawPerKg}/kg` : ''} USD · all-in ${s.fuelable ? `fuel ${fuelPct}%+` : ''}VAT ${ARAMEX_VAT_PERCENT}% = ${value}${valuePerKg ? `+${valuePerKg}/kg` : ''} USD`;
    return { kind: s.kind, value, valuePerKg, applyMode: s.applyMode, countryCodes: s.countryCodes ?? null, note };
  });
}
