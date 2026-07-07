import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { listAccounts } from '@/features/carrier-rates/actions';
import { loadAccountSnapshot } from '@/features/carrier-rates/engine/load';
import { quote } from '@/features/carrier-rates/engine/quote';
import { isDefaultResidential } from '@/features/carrier-rates/residential-default';
import { pickCarrierCostVnd, pickBaseVnd } from './quote-adapter';
import { computeBrandCharge } from './brand-pricing';

export type ShipHoService = 'express' | 'standard';

export interface EstimateParcel {
  country: string; city?: string; postcode?: string;
  weightKg: number;
  dimLengthCm?: number; dimWidthCm?: number; dimHeightCm?: number;
  packagingType?: 'bag' | 'box' | null;
  service?: ShipHoService;
}

export interface BrandEstimate {
  chargedVnd: number; currency: 'VND'; provisional: true; service: ShipHoService;
  lines: { label: string; amountVnd: number }[];
  notes: string[];
}

export type EstimateResult =
  | { ok: true; estimate: BrandEstimate }
  | { ok: false; code: 'brand_not_approved' | 'no_carrier' | 'quote_failed' | 'service_unavailable' | 'bad_input'; error: string };

const SERVICE_LABEL: Record<ShipHoService, string> = { express: 'Express Delivery', standard: 'Standard Delivery' };

export function neutralNotes(): string[] {
  return [
    'Giá dự kiến theo cân nặng & kích thước khai báo; hóa đơn cuối tính theo cân & phụ phí thực tế.',
    'Phụ phí xăng dầu áp theo tuần giao hàng của đơn vị vận chuyển.',
    'Đã gồm VAT.',
  ];
}

/** Quy field breakdown (cost currency) về VND theo currency của account. */
function toVndFactor(snap: { costCurrency: string; displayCurrency: string; fxCostPerDisplay: number }): number | null {
  if (snap.costCurrency === 'VND') return 1;
  if (snap.displayCurrency === 'VND') return 1 / snap.fxCostPerDisplay;
  return null;
}

export async function estimateForBrand(brandSlug: string, parcel: EstimateParcel): Promise<EstimateResult> {
  const service: ShipHoService = parcel.service ?? 'express';
  if (service === 'standard') return { ok: false, code: 'service_unavailable', error: 'Standard Delivery chưa khả dụng' };
  const country = (parcel.country ?? '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(country) || !Number.isFinite(parcel.weightKg) || parcel.weightKg <= 0) {
    return { ok: false, code: 'bad_input', error: 'Quốc gia phải là mã ISO-2 và cân nặng phải > 0' };
  }

  const [partner] = await db.select().from(schema.shipHoPartners)
    .where(eq(schema.shipHoPartners.brandSlug, brandSlug)).limit(1);
  if (!partner || partner.status !== 'active' || !partner.selfServiceEnabled) {
    return { ok: false, code: 'brand_not_approved', error: 'Brand chưa được kích hoạt dịch vụ này' };
  }

  // Express = account FedEx đang bật (map service→account chốt khi có nhiều line; hiện lấy FedEx enabled đầu tiên).
  const account = (await listAccounts()).find((a) => a.enabled && a.carrierKey === 'fedex');
  if (!account) return { ok: false, code: 'no_carrier', error: 'Chưa cấu hình đơn vị vận chuyển' };
  const snap = await loadAccountSnapshot(account.id);
  if (!snap) return { ok: false, code: 'no_carrier', error: 'Chưa nạp được bảng giá' };

  const dims = typeof parcel.dimLengthCm === 'number' && typeof parcel.dimWidthCm === 'number' && typeof parcel.dimHeightCm === 'number'
    ? { lengthCm: parcel.dimLengthCm, widthCm: parcel.dimWidthCm, heightCm: parcel.dimHeightCm } : null;

  const res = quote(snap, {
    weightKg: parcel.weightKg, dimensions: dims, packagingType: parcel.packagingType ?? null,
    destinationCountry: country,
    destinationPostcode: parcel.postcode, destinationCity: parcel.city,
    isResidential: isDefaultResidential(country),
  });
  if (!res.ok) return { ok: false, code: 'quote_failed', error: 'Không tính được cước cho tuyến này' };

  const carrierCost = pickCarrierCostVnd(snap, res.breakdown);
  const base = pickBaseVnd(snap, res.breakdown);
  const factor = toVndFactor(snap);
  if (!carrierCost.ok || !base.ok || factor === null) {
    return { ok: false, code: 'quote_failed', error: 'Cấu hình tiền tệ không hỗ trợ' };
  }

  const b = res.breakdown;
  const surchargesVnd = Math.round(
    (b.remote + b.residential + b.perKg + b.demand + b.countryFixed + b.perStep + b.peak + b.addons) * factor,
  );
  const parts = { surchargesVnd, fuelRealVnd: Math.round(b.fuel * factor), vatRealVnd: Math.round(b.vat * factor) };

  // Ship hộ KHÔNG có phí đóng gói (b.packaging của engine bỏ qua). Thay bằng phí
  // xử lý đơn hàng cố định (chịu VAT), cộng trong computeBrandCharge.
  const { chargedVnd, lines } = computeBrandCharge({
    carrierCostVnd: carrierCost.vnd, baseVnd: base.vnd,
    fuelPercent: b.fuelPercent, vatPercent: b.vatPercent, markupPercent: Number(partner.markupPercent),
    parts, serviceLabel: SERVICE_LABEL[service],
  });

  const notes = neutralNotes();
  if (res.breakdown.residential > 0) {
    notes.push('Địa chỉ nhà dân (US/CA) — đã gồm phụ phí giao nhà dân của hãng.');
  }

  return { ok: true, estimate: { chargedVnd, currency: 'VND', provisional: true, service, lines, notes } };
}
