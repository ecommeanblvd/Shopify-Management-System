/**
 * Đẩy các dòng hoá đơn Aramex vào đối soát: khớp shipment theo vận đơn rồi ghi
 * `shipment_charges` (số hãng ĐÃ THU), giống việc reconcileDhlBill làm cho DHL.
 *
 * Khác DHL ở hai chỗ:
 *   - hoá đơn Hợp Nhất ghi bằng VNĐ trong khi bảng giá Aramex tính bằng USD,
 *     nên phần quy đổi nằm ở đối soát (dùng `carrier_bills.fx_rate` của chính
 *     hoá đơn — xem to-vnd.ts), không phải ở đây
 *   - bảng kê chỉ có ba khoản: cước gốc, phụ phí xăng dầu, và phí hải quan đầu
 *     xuất (cột "Phí phát sinh" trên bảng kê, $0,4/lô — CEO xác nhận 27/08).
 *     Khoản này vào `import_handling`, cùng cột với phí xử lý hàng nhập US của
 *     FedEx, để màn đối soát hiện đúng dòng phí hải quan.
 *
 * KHÔNG kiểm quyền ở đây: hàm chỉ được gọi từ luồng nhập hoá đơn vốn đã gác
 * quyền. Muốn gọi từ nơi khác thì bọc thêm lớp kiểm quyền.
 */
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { invalidateReconcileCache } from '@/features/shipments/reconcile-cache';

export interface KetQuaGhiBilled {
  /** Số dòng hoá đơn khớp được shipment. */
  khop: number;
  /** Dòng không tìm thấy shipment nào mang vận đơn đó. */
  khongKhop: string[];
}

export async function ghiBilledAramex(billId: string): Promise<KetQuaGhiBilled> {
  const [bill] = await db
    .select({
      accountId: schema.carrierBills.carrierAccountId,
      currency: schema.carrierBills.currency,
      periodStart: schema.carrierBills.periodStart,
      periodEnd: schema.carrierBills.periodEnd,
    })
    .from(schema.carrierBills).where(eq(schema.carrierBills.id, billId)).limit(1);
  if (!bill) throw new Error('không thấy hoá đơn');

  const lines = await db.select().from(schema.carrierBillLines)
    .where(eq(schema.carrierBillLines.billId, billId));

  const res: KetQuaGhiBilled = { khop: 0, khongKhop: [] };

  for (const l of lines) {
    if (!l.trackingNumber) continue;
    const [sh] = await db
      .select({ id: schema.shipments.id, storeId: schema.shopifyOrders.storeId, labelCreatedAt: schema.shipments.labelCreatedAt })
      .from(schema.shipments)
      .innerJoin(schema.shopifyOrders, eq(schema.shopifyOrders.id, schema.shipments.orderId))
      .where(eq(schema.shipments.trackingNumber, l.trackingNumber)).limit(1);
    if (!sh) { res.khongKhop.push(l.trackingNumber); continue; }

    // Ngày đi hàng của bảng kê là ngày hãng nhận hàng — điền khi shipment chưa
    // có, nhưng KHÔNG đè ngày sẵn có (Excel kho chính xác hơn).
    if (!sh.labelCreatedAt && l.shipDate) {
      await db.update(schema.shipments)
        .set({ labelCreatedAt: new Date(l.shipDate) })
        .where(eq(schema.shipments.id, sh.id));
    }

    const soTien = (v: unknown) => (v == null ? 0 : Number(v));
    // Tổng ĐÃ gồm thuế — cùng quy ước với DHL để đối soát so cùng một thước.
    const tong = soTien(l.total) + soTien(l.vat);

    const gt = {
      shipmentId: sh.id,
      carrierAccountId: bill.accountId,
      trackingNumber: l.trackingNumber,
      totalAmount: String(tong),
      currency: bill.currency,
      base: String(soTien(l.base)),
      fuel: String(soTien(l.fuel)),
      importHandling: String(soTien(l.other)),
      // Ghi rõ 0 chứ không bỏ trống: nhập lại hoá đơn sau khi đổi cách xếp
      // khoản phải DỌN cột cũ, nếu không số cũ nằm lại và bị đếm hai lần.
      demand: '0',
      vat: String(soTien(l.vat)),
      billingWeightKg: l.weightKg != null ? String(l.weightKg) : null,
      source: 'aramex_invoice',
      sourceHash: `aramex_inv:${l.trackingNumber}`,
    };

    await db.insert(schema.shipmentCharges).values(gt).onConflictDoUpdate({
      target: schema.shipmentCharges.shipmentId,
      set: {
        carrierAccountId: gt.carrierAccountId, trackingNumber: gt.trackingNumber,
        totalAmount: gt.totalAmount, currency: gt.currency, base: gt.base,
        fuel: gt.fuel, importHandling: gt.importHandling, demand: gt.demand, vat: gt.vat,
        billingWeightKg: gt.billingWeightKg, source: gt.source, sourceHash: gt.sourceHash,
      },
    });

    // Đẩy cước thực sang phần Orders để "chi phí thật" của đơn dùng số hoá đơn
    // thay vì số ước tính.
    await db.insert(schema.shippingInvoices).values({
      storeId: sh.storeId, carrierAccountId: bill.accountId, trackingNumber: l.trackingNumber,
      invoicePeriodStart: bill.periodStart, invoicePeriodEnd: bill.periodEnd,
      actualCost: String(tong), currency: bill.currency, source: `carrier_bill:${billId}`,
    }).onConflictDoUpdate({
      target: [schema.shippingInvoices.storeId, schema.shippingInvoices.trackingNumber],
      set: {
        carrierAccountId: bill.accountId, actualCost: String(tong), currency: bill.currency,
        invoicePeriodStart: bill.periodStart, invoicePeriodEnd: bill.periodEnd,
        source: `carrier_bill:${billId}`, uploadedAt: new Date(),
      },
    });
    res.khop++;
  }

  if (res.khop > 0) invalidateReconcileCache();
  return res;
}
