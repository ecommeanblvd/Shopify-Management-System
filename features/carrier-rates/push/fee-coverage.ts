import type { CarrierAccountSnapshot } from '../engine/quote';

type Surcharge = CarrierAccountSnapshot['surcharges'][number];

export interface FeeItem {
  label: string;
  /** Số tiền / % cụ thể theo công thức hệ thống (vd "42,5%", "84.400đ"). */
  detail?: string;
}

export interface FeeCoverageResult {
  /** % fuel đang hiệu lực HÔM NAY — mức bake vào bảng giá. NULL nếu không có. */
  fuelPercent: number | null;
  covered: FeeItem[];
  notCovered: FeeItem[];
}

const vnd = (v: number) => `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(v)}đ`;

/** Lọc dòng đang hiệu lực hôm nay (active + trong cửa sổ ngày). */
function applicable(s: Surcharge, now: Date): boolean {
  if (!s.active) return false;
  if (s.startsAt && s.startsAt.getTime() > now.getTime()) return false;
  if (s.endsAt && s.endsAt.getTime() <= now.getTime()) return false;
  return true;
}

/** % fuel hiệu lực hôm nay (tổng các dòng fuel_percent áp dụng). */
export function fuelPercentToday(surcharges: Surcharge[], now: Date = new Date()): number | null {
  const rows = surcharges.filter((s) => s.kind === 'fuel_percent' && applicable(s, now));
  if (rows.length === 0) return null;
  return Math.round(rows.reduce((sum, s) => sum + s.value, 0) * 100) / 100;
}

export function classifyFeeCoverage(
  surcharges: Surcharge[],
  accountName: string,
  now: Date = new Date(),
): FeeCoverageResult {
  const live = surcharges.filter((s) => applicable(s, now));
  const has = (kind: string, mode?: string) =>
    live.some((s) => s.kind === kind && (mode ? (s.applyMode ?? 'always') === mode : true));

  // Giá trị (distinct) của 1 kind đang áp — để format số tiền/khoảng.
  const valuesOf = (kind: string, mode?: string): number[] =>
    [...new Set(live.filter((s) => s.kind === kind && (mode ? (s.applyMode ?? 'always') === mode : true)).map((s) => s.value))]
      .filter((v) => v > 0).sort((a, b) => a - b);
  const moneyRange = (kind: string, mode?: string): string => {
    const v = valuesOf(kind, mode);
    if (v.length === 0) return '';
    return v.length === 1 ? vnd(v[0]) : `${vnd(v[0])}–${vnd(v[v.length - 1])}`;
  };
  const pctOf = (kind: string): string => {
    const total = live.filter((s) => s.kind === kind).reduce((sum, s) => sum + s.value, 0);
    return total > 0 ? `${Math.round(total * 100) / 100}%` : '';
  };

  const fuelPercent = fuelPercentToday(surcharges, now);

  const covered: FeeItem[] = [{ label: 'Cước cơ bản', detail: 'theo bậc cân (rate card)' }];
  if (has('fuel_percent')) covered.push({ label: 'Phụ phí xăng dầu (fuel)', detail: fuelPercent != null ? `${fuelPercent}%` : undefined });
  if (has('demand_per_kg')) covered.push({ label: 'Demand surcharge', detail: `${moneyRange('demand_per_kg')}/kg (theo nước)` });
  if (has('per_kg_fixed')) covered.push({ label: 'Phụ phí theo kg', detail: `${moneyRange('per_kg_fixed')}/kg` });
  if (has('per_step_fixed')) {
    const step = live.find((s) => s.kind === 'per_step_fixed' && s.stepKg);
    covered.push({ label: 'Phí theo bậc cân (GoGreen)', detail: `${moneyRange('per_step_fixed')}/${step?.stepKg ?? '0,5'}kg` });
  }
  if (has('country_fixed', 'always')) covered.push({ label: 'Phí cố định theo nước (nhập khẩu / rủi ro)', detail: `${moneyRange('country_fixed', 'always')} (nước áp dụng)` });
  if (has('residential_fixed')) covered.push({ label: 'Giao địa chỉ nhà — residential', detail: `${moneyRange('residential_fixed')} (US/CA)` });
  if (has('addon_fixed', 'always')) covered.push({ label: 'Dịch vụ bổ sung tự áp (ký nhận)', detail: moneyRange('addon_fixed', 'always') });
  if (has('peak_fixed')) covered.push({ label: 'Phụ phí cao điểm (peak)', detail: moneyRange('peak_fixed') });
  if (has('markup_percent')) covered.push({ label: 'Markup (lợi nhuận)', detail: pctOf('markup_percent') });
  if (has('vat_percent')) covered.push({ label: 'VAT', detail: pctOf('vat_percent') });

  const notCovered: FeeItem[] = [];
  if (has('remote_fixed')) notCovered.push({ label: 'ODA / vùng xa', detail: `${moneyRange('remote_fixed')} — cần địa chỉ cụ thể, matrix không kích hoạt` });
  if (has('addon_fixed', 'when_billed')) notCovered.push({ label: 'Dịch vụ opt-in (ký nhận)', detail: `${moneyRange('addon_fixed', 'when_billed')} — chỉ khi đơn thực dùng` });
  if (has('country_fixed', 'when_billed')) notCovered.push({ label: 'Phí nước opt-in', detail: `${moneyRange('country_fixed', 'when_billed')} — chỉ khi hoá đơn có` });
  if (/fedex/i.test(accountName)) notCovered.push({ label: 'Address Correction', detail: 'FedEx sửa địa chỉ sai — phát sinh trên hoá đơn (đã có fuel)' });

  return { fuelPercent, covered, notCovered };
}
