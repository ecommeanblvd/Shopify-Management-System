'use server';

import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth/auth';
import { db, schema } from '@/db/client';
import { quoteOrderAcrossCarriers, type CarrierQuoteRow } from '@/features/carrier-rates/compare/quote-order-carriers';
import { laNhaDan } from '@/features/carrier-rates/residential-from-class';

export interface OrderCarrierComparison {
  rows: CarrierQuoteRow[];
  /** Carrier khách đã trả (cost attribution, sync re-derive). */
  currentPaidKey: string | null;
  /** Carrier staff đã chọn để đi hàng (nếu có). */
  selectedKey: string | null;
  weightKg: number | null;
  country: string | null;
  error?: string;
}

/** Load thông tin ship của đơn + quote mọi carrier để so sánh. */
export async function getOrderCarrierComparison(orderId: string): Promise<OrderCarrierComparison> {
  const [o] = await db.select({
    shipCountry: schema.shopifyOrders.shipCountry,
    shipWeightKg: schema.shopifyOrders.shipWeightKg,
    shipWeightKgOverride: schema.shopifyOrders.shipWeightKgOverride,
    shipPostcode: schema.shopifyOrders.shipPostcode,
    shipCity: schema.shopifyOrders.shipCity,
    processedAtShopify: schema.shopifyOrders.processedAtShopify,
    shippingCarrierKey: schema.shopifyOrders.shippingCarrierKey,
    selectedCarrierKey: schema.shopifyOrders.selectedCarrierKey,
    addrClass: schema.shopifyOrders.addrClass,
  }).from(schema.shopifyOrders).where(eq(schema.shopifyOrders.id, orderId)).limit(1);

  if (!o) return { rows: [], currentPaidKey: null, selectedKey: null, weightKg: null, country: null, error: 'Không tìm thấy đơn' };

  const weightKg = Number(o.shipWeightKgOverride ?? o.shipWeightKg) || null;
  const base = { currentPaidKey: o.shippingCarrierKey, selectedKey: o.selectedCarrierKey, weightKg, country: o.shipCountry };
  if (!o.shipCountry || !weightKg) {
    return { rows: [], ...base, error: 'Thiếu nước hoặc cân nặng — không thể báo giá' };
  }

  const rows = await quoteOrderAcrossCarriers({
    country: o.shipCountry, weightKg,
    postcode: o.shipPostcode, city: o.shipCity,
    effectiveDate: o.processedAtShopify ?? undefined,
    // Phí giao nhà dân theo ĐÚNG phân loại FedEx của địa chỉ này (đã verify và
    // lưu ở addr_class). Thiếu nó thì bảng so sánh bỏ hẳn 84.400đ (FedEx) /
    // 95.410đ (UPS) mỗi đơn US-CA, tức giá vốn ghi thiếu.
    isResidential: laNhaDan(o.addrClass, o.shipCountry),
  });
  return { rows, ...base };
}

/** Staff chọn carrier đi hàng cho đơn → ghi selected_carrier_key (sync không đụng). */
export async function assignOrderCarrier(orderId: string, carrierKey: string): Promise<{ ok: boolean; error?: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { ok: false, error: 'Chưa đăng nhập' };

  // Guard: carrier đang tạm ngưng CHỌN thì chặn (không chỉ dựa UI disable).
  const [acc] = await db.select({ suspendedAt: schema.carrierAccounts.suspendedAt, reason: schema.carrierAccounts.suspendReason })
    .from(schema.carrierAccounts)
    .innerJoin(schema.carriers, eq(schema.carriers.id, schema.carrierAccounts.carrierId))
    .where(and(eq(schema.carriers.key, carrierKey), eq(schema.carrierAccounts.enabled, true)))
    .limit(1);
  if (acc?.suspendedAt && acc.suspendedAt <= new Date()) {
    return { ok: false, error: `${carrierKey} đang tạm ngưng${acc.reason ? ` (${acc.reason})` : ''}` };
  }

  await db.update(schema.shopifyOrders).set({
    selectedCarrierKey: carrierKey,
    selectedCarrierAt: new Date(),
    selectedCarrierBy: session.user.email ?? session.user.id,
  }).where(eq(schema.shopifyOrders.id, orderId));

  revalidatePath('/f/orders');
  return { ok: true };
}
