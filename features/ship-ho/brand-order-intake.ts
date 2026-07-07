import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { validateAddressExtra } from '@/lib/geo/address-requirements';
import { countrySupportsDirectSignature, DIRECT_SIGNATURE_FEE_VND } from '@/features/carrier-rates/direct-signature';
import { estimateForBrand, neutralNotes, type EstimateParcel, type BrandEstimate, type ShipHoService } from './brand-estimate';
import { emitShipHoEvent } from './mmp-events';

export interface BrandOrderInput {
  brandSlug: string;
  mmpRef: string;
  customerRef?: string;
  recipient?: { name?: string; phone?: string; email?: string };
  address: {
    // MMP gửi `state` (chuẩn spec mới); nhận cả `province` để tương thích ngược.
    country: string; city?: string; state?: string; province?: string; postcode?: string;
    address1?: string; address2?: string;
    houseNumber?: string; shortAddress?: string; mapsUrl?: string;
  };
  parcel: EstimateParcel;
}

export type IntakeResult =
  | { ok: true; orderId: string; code: string; idempotent?: boolean; estimate: BrandEstimate }
  | { ok: false; code: 'brand_not_approved' | 'bad_input' | 'quote_failed' | 'no_carrier' | 'service_unavailable'; error: string };

export async function intakeBrandOrder(input: BrandOrderInput): Promise<IntakeResult> {
  if (!input.brandSlug || !input.mmpRef || !input.address?.country) {
    return { ok: false, code: 'bad_input', error: 'brandSlug + mmpRef + address.country required' };
  }

  // Idempotency: đơn đã tồn tại theo mmp_ref → trả ngay (KHÔNG re-estimate; dùng giá đã snapshot).
  const [existing] = await db.select().from(schema.shipHoOrders)
    .where(eq(schema.shipHoOrders.mmpRef, input.mmpRef)).limit(1);
  if (existing) {
    const total = Number(existing.chargedVnd ?? 0);
    return {
      ok: true, orderId: existing.id, code: existing.code, idempotent: true,
      estimate: {
        chargedVnd: total, currency: 'VND', provisional: true,
        service: (existing.service as ShipHoService) ?? 'express',
        lines: [{ label: 'Tổng giá dự kiến', amountVnd: total }],
        notes: neutralNotes(),
        directSignatureAvailable: countrySupportsDirectSignature(existing.country),
        directSignatureFeeVnd: DIRECT_SIGNATURE_FEE_VND,
      },
    };
  }

  // Đơn mới: estimate là guard approve + quote. Đơn brand luôn Express ở phase này.
  const est = await estimateForBrand(input.brandSlug, { ...input.parcel, country: input.address.country, service: 'express' });
  if (!est.ok) return { ok: false, code: est.code, error: est.error };

  // Validate địa chỉ theo nước (SA short-address/maps, GCC house-number).
  const extra = validateAddressExtra(input.address.country, {
    houseNumber: input.address.houseNumber, shortAddress: input.address.shortAddress, mapsUrl: input.address.mapsUrl,
  });
  if (!extra.ok) return { ok: false, code: 'bad_input', error: extra.error ?? 'Thiếu thông tin địa chỉ' };

  try {
    const [row] = await db.insert(schema.shipHoOrders).values({
      code: input.mmpRef, partnerBrandSlug: input.brandSlug,
      source: 'mmp', mmpRef: input.mmpRef, customerRef: input.customerRef || null, service: 'express',
      recipientName: input.recipient?.name || null, recipientPhone: input.recipient?.phone || null,
      recipientEmail: input.recipient?.email || null,
      country: input.address.country.trim().toUpperCase(), city: input.address.city || null,
      // Bang/tỉnh: MMP gửi `state`; fallback `province` cho payload cũ.
      province: input.address.state || input.address.province || null, postcode: input.address.postcode || null,
      address1: input.address.address1 || null, address2: input.address.address2 || null,
      houseNumber: extra.normalized.houseNumber ?? null, shortAddress: extra.normalized.shortAddress ?? null, mapsUrl: extra.normalized.mapsUrl ?? null,
      weightKg: String(input.parcel.weightKg),
      dimLengthCm: input.parcel.dimLengthCm != null ? String(input.parcel.dimLengthCm) : null,
      dimWidthCm: input.parcel.dimWidthCm != null ? String(input.parcel.dimWidthCm) : null,
      dimHeightCm: input.parcel.dimHeightCm != null ? String(input.parcel.dimHeightCm) : null,
      packagingType: input.parcel.packagingType ?? null,
      chargedVnd: String(est.estimate.chargedVnd), quotedAt: new Date(),
      status: 'draft', createdBy: `mmp:${input.brandSlug}`,
    }).returning({ id: schema.shipHoOrders.id });

    await emitShipHoEvent(
      { id: row.id, code: input.mmpRef, source: 'mmp', mmpRef: input.mmpRef },
      'order.received', { chargedVnd: est.estimate.chargedVnd },
    );

    return { ok: true, orderId: row.id, code: input.mmpRef, estimate: est.estimate };
  } catch (e) {
    // Race: concurrent duplicate mmp_ref rejected by the unique index → trả đơn đã tồn tại (idempotent).
    const [dup] = await db.select().from(schema.shipHoOrders)
      .where(eq(schema.shipHoOrders.mmpRef, input.mmpRef)).limit(1);
    if (dup) return { ok: true, orderId: dup.id, code: dup.code, idempotent: true, estimate: est.estimate };
    throw e;
  }
}
