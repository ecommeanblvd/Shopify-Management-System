import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { giaThuBangKe, QUYET_DINH_DA_CHOT } from './statement-logic';

export async function listShipHoStatements() {
  return db
    .select({
      id: schema.shipHoStatements.id,
      partnerBrandSlug: schema.shipHoStatements.partnerBrandSlug,
      brandName: schema.mmpBrands.displayName,
      type: schema.shipHoStatements.type,
      periodStart: schema.shipHoStatements.periodStart,
      periodEnd: schema.shipHoStatements.periodEnd,
      orderCount: schema.shipHoStatements.orderCount,
      totalChargedVnd: schema.shipHoStatements.totalChargedVnd,
      status: schema.shipHoStatements.status,
      issuedAt: schema.shipHoStatements.issuedAt,
      paidAt: schema.shipHoStatements.paidAt,
    })
    .from(schema.shipHoStatements)
    .leftJoin(schema.mmpBrands, eq(schema.mmpBrands.slug, schema.shipHoStatements.partnerBrandSlug))
    .orderBy(desc(schema.shipHoStatements.createdAt));
}

/** Công nợ = tổng totalChargedVnd của statement 'issued' (chưa 'paid') theo partner, tách theo loại (UI cộng lại nếu cần). */
export async function arByPartner() {
  return db
    .select({
      partnerBrandSlug: schema.shipHoStatements.partnerBrandSlug,
      brandName: schema.mmpBrands.displayName,
      type: schema.shipHoStatements.type,
      outstandingVnd: sql<string>`sum(${schema.shipHoStatements.totalChargedVnd})`,
    })
    .from(schema.shipHoStatements)
    .leftJoin(schema.mmpBrands, eq(schema.mmpBrands.slug, schema.shipHoStatements.partnerBrandSlug))
    .where(eq(schema.shipHoStatements.status, 'issued'))
    .groupBy(schema.shipHoStatements.partnerBrandSlug, schema.mmpBrands.displayName, schema.shipHoStatements.type);
}

/** Bảng kê + các đơn thuộc nó (kèm margin) — để xem chi tiết / export xlsx. Theo LOẠI (CEO 21/09/2026). */
export async function getShipHoStatement(id: string) {
  const [st] = await db.select().from(schema.shipHoStatements).where(eq(schema.shipHoStatements.id, id)).limit(1);
  if (!st) return null;
  if (st.type === 'duty') {
    const { rows } = await db.execute<{ code: string; mmpRef: string | null; brandReference: string | null; trackingNumber: string | null; shippedAt: string | null; dutyVnd: string; billNumber: string | null; issueDate: string | null }>(sql`
      SELECT o.code, o.mmp_ref AS "mmpRef", o.brand_reference AS "brandReference", o.tracking_number AS "trackingNumber", o.shipped_at::text AS "shippedAt", o.actual_duty_vnd AS "dutyVnd",
             array_to_string(o.duty_bill_numbers, ' + ') AS "billNumber",
             (SELECT max(COALESCE(b.issue_date, b.period_start))::text FROM carrier_bill_lines l JOIN carrier_bills b ON b.id = l.bill_id WHERE l.tracking_number = o.tracking_number AND l.duty > 0) AS "issueDate"
        FROM ship_ho_orders o WHERE o.duty_statement_id = ${id} ORDER BY o.shipped_at`);
    return { statement: st, orders: rows.map((r) => ({ ...r, giaThuVnd: Number(r.dutyVnd) })), choHoaDon: [] };
  }
  const orders = await db.select({
      code: schema.shipHoOrders.code, mmpRef: schema.shipHoOrders.mmpRef, brandReference: schema.shipHoOrders.brandReference, trackingNumber: schema.shipHoOrders.trackingNumber,
      shippedAt: schema.shipHoOrders.shippedAt, country: schema.shipHoOrders.country,
      chargedVnd: schema.shipHoOrders.chargedVnd, actualChargedVnd: schema.shipHoOrders.actualChargedVnd, reconcileStatus: schema.shipHoOrders.reconcileStatus,
      reconcileDecision: schema.shipHoOrders.reconcileDecision,
      actualCarrierCostVnd: schema.shipHoOrders.actualCarrierCostVnd, marginVnd: schema.shipHoOrders.marginVnd, actualDutyVnd: schema.shipHoOrders.actualDutyVnd,
    }).from(schema.shipHoOrders).where(eq(schema.shipHoOrders.statementId, id)).orderBy(schema.shipHoOrders.shippedAt);
  // Chờ hoá đơn: gửi trong kỳ, CHƯA CÓ GIÁ THỰC ĐÃ CHỐT (chưa reconciled; reconciled nhưng
  // actual_charged_vnd null — re-quote lỗi, xem Important-2 review 21/09; hoặc còn
  // 'pending_review'/'claiming' — số Đức chưa xác nhận, spec §2.2), chưa vào kê nào, cùng
  // luật loại trừ "không gửi hàng, xác nhận" như generateStatement để count/list khớp nhau.
  const choHoaDon = await db.select({ code: schema.shipHoOrders.code, brandReference: schema.shipHoOrders.brandReference, shippedAt: schema.shipHoOrders.shippedAt, chargedVnd: schema.shipHoOrders.chargedVnd })
    .from(schema.shipHoOrders)
    .where(and(eq(schema.shipHoOrders.partnerBrandSlug, st.partnerBrandSlug), isNull(schema.shipHoOrders.statementId),
      sql`(${schema.shipHoOrders.actualChargedVnd} IS NULL OR ${schema.shipHoOrders.reconcileStatus} IS DISTINCT FROM 'reconciled'
           OR (${schema.shipHoOrders.reconcileDecision} IS NOT NULL AND ${schema.shipHoOrders.reconcileDecision} NOT IN ${QUYET_DINH_DA_CHOT}))`,
      sql`${schema.shipHoOrders.shippedAt} BETWEEN ${st.periodStart} AND ${st.periodEnd}`,
      inArray(schema.shipHoOrders.status, ['shipped', 'delivered'] as const),
      sql`NOT (COALESCE(${schema.shipHoOrders.lyDoCham}, '') = 'khong_gui_hang' AND COALESCE(${schema.shipHoOrders.lyDoDoiChieu}, '') = 'xac_nhan')`));
  return { statement: st, orders: orders.map((o) => ({ ...o, giaThuVnd: giaThuBangKe(o), theoBill: true })), choHoaDon };
}

/** Báo cáo margin: tổng marginVnd theo partner (chỉ đơn đã đối soát). */
export async function marginByPartner() {
  return db
    .select({
      partnerBrandSlug: schema.shipHoOrders.partnerBrandSlug,
      brandName: schema.mmpBrands.displayName,
      orderCount: sql<number>`count(*)::int`,
      totalMarginVnd: sql<string>`coalesce(sum(${schema.shipHoOrders.marginVnd}), 0)`,
    })
    .from(schema.shipHoOrders)
    .leftJoin(schema.mmpBrands, eq(schema.mmpBrands.slug, schema.shipHoOrders.partnerBrandSlug))
    .where(sql`${schema.shipHoOrders.marginVnd} is not null`)
    .groupBy(schema.shipHoOrders.partnerBrandSlug, schema.mmpBrands.displayName);
}
