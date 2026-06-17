'use server';

import { headers } from 'next/headers';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { mapChargesToBilled, isFreightCharges } from './dhl-billed-map';
import type { BillCharge } from './bills-actions';

export interface DhlReconcileResult {
  freightLines: number;
  matched: number;
  unmatched: { tracking: string; reason: string }[];
}

async function requireInvoicePermission() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error('unauthenticated');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'manage_shipping_invoices')) throw new Error('forbidden');
}

/**
 * Sau khi lưu hoá đơn DHL: đẩy các dòng CƯỚC (freight) vào đối soát.
 * Khớp shipment theo vận đơn (tracking) → lưu FK `shipment_id` lên bill line +
 * upsert `shipment_charges` (source 'dhl_invoice', ghi đè billed cũ của shipment
 * đó). Dòng duties bỏ qua. Trả số khớp / chưa khớp để UI báo.
 */
export async function reconcileDhlBill(billId: string): Promise<DhlReconcileResult> {
  await requireInvoicePermission();
  const [bill] = await db
    .select({
      accountId: schema.carrierBills.carrierAccountId, currency: schema.carrierBills.currency,
      periodStart: schema.carrierBills.periodStart, periodEnd: schema.carrierBills.periodEnd,
    })
    .from(schema.carrierBills).where(eq(schema.carrierBills.id, billId)).limit(1);
  if (!bill) throw new Error('bill not found');

  const lines = await db.select().from(schema.carrierBillLines).where(eq(schema.carrierBillLines.billId, billId));
  const res: DhlReconcileResult = { freightLines: 0, matched: 0, unmatched: [] };

  for (const l of lines) {
    const charges = Array.isArray(l.charges) ? (l.charges as BillCharge[]) : null;
    if (!l.trackingNumber || !isFreightCharges(charges)) continue; // chỉ cước
    res.freightLines++;

    const [sh] = await db.select({
        id: schema.shipments.id, storeId: schema.shopifyOrders.storeId,
        labelCreatedAt: schema.shipments.labelCreatedAt,
      })
      .from(schema.shipments)
      .innerJoin(schema.shopifyOrders, eq(schema.shopifyOrders.id, schema.shipments.orderId))
      .where(eq(schema.shipments.trackingNumber, l.trackingNumber)).limit(1);
    if (!sh) { res.unmatched.push({ tracking: l.trackingNumber, reason: 'shipment chưa có trong hệ thống' }); continue; }

    // Ngày đi hàng từ hoá đơn → điền label_created_at nếu shipment chưa có (không
    // đè ngày từ Excel LOG vốn chính xác hơn).
    if (!sh.labelCreatedAt && l.shipDate) {
      await db.update(schema.shipments)
        .set({ labelCreatedAt: new Date(l.shipDate) })
        .where(eq(schema.shipments.id, sh.id));
    }

    const m = mapChargesToBilled(charges!, {
      totalTax: Number(l.vat ?? 0), totalInclVat: Number(l.total ?? 0),
      weightKg: l.weightKg != null ? Number(l.weightKg) : null,
    });

    await db.update(schema.carrierBillLines).set({ shipmentId: sh.id }).where(eq(schema.carrierBillLines.id, l.id));

    const sval = {
      shipmentId: sh.id, carrierAccountId: bill.accountId, trackingNumber: l.trackingNumber,
      totalAmount: String(m.totalAmount), currency: bill.currency,
      base: String(m.base), fuel: String(m.fuel), remote: String(m.remote), demand: String(m.demand),
      directSignature: String(m.directSignature), elevatedRisk: String(m.elevatedRisk),
      addressCorrection: String(m.addressCorrection),
      gogreen: String(m.gogreen), nonConveyable: String(m.nonConveyable), residential: String(m.residential),
      discount: String(m.discount), vat: String(m.vat),
      billingWeightKg: m.billingWeightKg != null ? String(m.billingWeightKg) : null,
      source: 'dhl_invoice', sourceHash: `dhl_inv:${l.trackingNumber}`,
    };
    await db.insert(schema.shipmentCharges).values(sval).onConflictDoUpdate({
      target: schema.shipmentCharges.shipmentId,
      set: {
        carrierAccountId: sval.carrierAccountId, trackingNumber: sval.trackingNumber,
        totalAmount: sval.totalAmount, currency: sval.currency, base: sval.base, fuel: sval.fuel,
        remote: sval.remote, demand: sval.demand, directSignature: sval.directSignature,
        elevatedRisk: sval.elevatedRisk, addressCorrection: sval.addressCorrection,
        gogreen: sval.gogreen, nonConveyable: sval.nonConveyable, residential: sval.residential,
        discount: sval.discount, vat: sval.vat,
        billingWeightKg: sval.billingWeightKg, source: sval.source, sourceHash: sval.sourceHash,
      },
    });

    // Write-through: đẩy cước thực (đã gồm VAT) vào shipping_invoices để phần
    // Orders tự override "chi phí thật" theo tracking. Carrier bill là nguồn
    // authoritative → ghi đè bản CSV cũ (nếu có) theo (storeId, trackingNumber).
    await db.insert(schema.shippingInvoices).values({
      storeId: sh.storeId, carrierAccountId: bill.accountId, trackingNumber: l.trackingNumber,
      invoicePeriodStart: bill.periodStart, invoicePeriodEnd: bill.periodEnd,
      actualCost: String(m.totalAmount), currency: bill.currency, source: `carrier_bill:${billId}`,
    }).onConflictDoUpdate({
      target: [schema.shippingInvoices.storeId, schema.shippingInvoices.trackingNumber],
      set: {
        carrierAccountId: bill.accountId, actualCost: String(m.totalAmount), currency: bill.currency,
        invoicePeriodStart: bill.periodStart, invoicePeriodEnd: bill.periodEnd,
        source: `carrier_bill:${billId}`, uploadedAt: new Date(),
      },
    });
    res.matched++;
  }
  return res;
}
