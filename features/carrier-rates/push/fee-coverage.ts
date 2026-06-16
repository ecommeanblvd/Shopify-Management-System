import type { CarrierAccountSnapshot } from '../engine/quote';

/**
 * Phân định khoản phí carrier matrix CÓ cover / KHÔNG cover, suy từ cấu hình
 * surcharge active + cách matrix quote (chỉ nước+cân, KHÔNG có địa chỉ cụ thể):
 *   - remote_fixed (ODA/vùng xa) cần postcode/city để kích hoạt → matrix không
 *     có → KHÔNG cover.
 *   - apply_mode='when_billed' (ký nhận opt-in, phí nước opt-in) chỉ tính khi
 *     đơn thực dùng → KHÔNG vào matrix.
 *   - Address Correction (FedEx) là phí phát sinh trên hoá đơn, engine không
 *     định giá → KHÔNG cover (chỉ thêm nhãn này cho FedEx).
 */
export function classifyFeeCoverage(
  surcharges: CarrierAccountSnapshot['surcharges'],
  accountName: string,
  now: Date = new Date(),
): { covered: string[]; notCovered: string[] } {
  const modes = new Map<string, Set<string>>();
  for (const s of surcharges) {
    if (!s.active) continue;
    // CHỈ xét dòng đang hiệu lực hôm nay — bỏ qua kỳ cũ đã hết hạn (vd ký nhận
    // when_billed trước khi đổi sang always) để không hiện nhãn gây hiểu lầm.
    if (s.startsAt && s.startsAt.getTime() > now.getTime()) continue;
    if (s.endsAt && s.endsAt.getTime() <= now.getTime()) continue;
    const set = modes.get(s.kind) ?? new Set<string>();
    set.add(s.applyMode ?? 'always');
    modes.set(s.kind, set);
  }
  const has = (k: string, mode?: string) => (mode ? !!modes.get(k)?.has(mode) : modes.has(k));

  const covered: string[] = ['Cước cơ bản (theo bậc cân)'];
  if (has('fuel_percent')) covered.push('Phụ phí xăng dầu (fuel)');
  if (has('demand_per_kg')) covered.push('Demand surcharge (theo nước)');
  if (has('per_kg_fixed')) covered.push('Phụ phí theo kg');
  if (has('per_step_fixed')) covered.push('Phí theo bậc cân (GoGreen)');
  if (has('country_fixed', 'always')) covered.push('Phí cố định theo nước (nhập khẩu / rủi ro)');
  if (has('residential_fixed')) covered.push('Giao địa chỉ nhà — residential (nước áp dụng)');
  if (has('addon_fixed', 'always')) covered.push('Dịch vụ bổ sung tự áp (vd ký nhận DHL)');
  if (has('peak_fixed')) covered.push('Phụ phí cao điểm (peak)');
  if (has('vat_percent')) covered.push('VAT');

  const notCovered: string[] = [];
  if (has('remote_fixed')) notCovered.push('ODA / vùng xa — cần địa chỉ cụ thể, matrix phẳng không kích hoạt');
  if (has('addon_fixed', 'when_billed')) notCovered.push('Dịch vụ opt-in (ký nhận trực tiếp) — chỉ khi đơn thực dùng');
  if (has('country_fixed', 'when_billed')) notCovered.push('Phí nước opt-in — chỉ khi hoá đơn có');
  if (/fedex/i.test(accountName)) notCovered.push('Address Correction — phí sửa địa chỉ sai, chỉ phát sinh trên hoá đơn');

  return { covered, notCovered };
}
