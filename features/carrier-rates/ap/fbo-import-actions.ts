'use server';

/**
 * Import file FedEx Billing Online (FBO) Excel qua UI:
 *  1. Parse (parseFedexFbo) → gom theo số hoá đơn (groupFboIntoBills).
 *  2. Tạo/cập nhật carrier_bills (1/invoice#) + carrier_bill_lines (1/AWB).
 *  3. Upsert shipment_charges (billed đối soát) theo AWB = trackingNumber.
 * Idempotent: re-upload upsert theo (account, billNumber) — xoá+ghi lại lines.
 */
import { randomUUID } from 'crypto';
import * as XLSX from 'xlsx';
import { and, eq, inArray } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { putObject } from '@/lib/storage/s3';
import { parseFedexFbo, type FboBilledRow } from '@/features/shipments/fedex-fbo-parse';
import { groupFboIntoBills, fboShippingTotal, type FboBill } from '@/features/shipments/fedex-fbo-bill';

export interface FboBillSummary {
  billNumber: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  amount: number;
  lineCount: number;
}
export interface FboPreview {
  bills: FboBillSummary[];
  totalAwb: number;
  matchedAwb: number;
  unmatchedAwb: number;
  grandTotal: number;
  /** Vài AWB không khớp đơn trong hệ thống (để người dùng kiểm). */
  unmatchedSample: string[];
}

function parseWorkbook(bytes: Uint8Array): FboBilledRow[] {
  const wb = XLSX.read(bytes, { type: 'array' });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {
    header: 1, blankrows: false,
  }) as unknown[][];
  return parseFedexFbo(rows);
}

/** AWB → shipmentId cho các AWB có trong file (khớp trackingNumber). */
async function resolveAwbMap(awbs: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (awbs.length === 0) return map;
  // chunk để tránh IN quá lớn
  for (let i = 0; i < awbs.length; i += 500) {
    const chunk = awbs.slice(i, i + 500);
    const rows = await db
      .select({ id: schema.shipments.id, t: schema.shipments.trackingNumber })
      .from(schema.shipments)
      .where(inArray(schema.shipments.trackingNumber, chunk));
    for (const s of rows) if (s.t) map.set(s.t, s.id);
  }
  return map;
}

function toSummary(bills: FboBill[]): FboBillSummary[] {
  return bills.map((b) => ({
    billNumber: b.billNumber, periodStart: b.periodStart, periodEnd: b.periodEnd,
    amount: b.amount, lineCount: b.lines.length,
  }));
}

/** Parse + thống kê, KHÔNG ghi gì. */
export async function previewFboBill(bytes: Uint8Array): Promise<FboPreview> {
  const rows = parseWorkbook(bytes);
  const bills = groupFboIntoBills(rows);
  const awbs = rows.map((r) => r.awb);
  const awbMap = await resolveAwbMap(awbs);
  const matched = awbs.filter((a) => awbMap.has(a));
  const unmatched = awbs.filter((a) => !awbMap.has(a));
  return {
    bills: toSummary(bills),
    totalAwb: awbs.length,
    matchedAwb: matched.length,
    unmatchedAwb: unmatched.length,
    grandTotal: bills.reduce((s, b) => s + b.amount, 0),
    unmatchedSample: unmatched.slice(0, 8),
  };
}

export interface ApplyFboInput {
  carrierAccountId: string;
  currency: string;
  userId: string;
  bytes: Uint8Array;
  filename: string;
  contentType: string;
}
export interface FboApplyResult extends FboPreview {
  billsCreated: number;
  billsUpdated: number;
  chargesUpserted: number;
}

const numStr = (v: number) => v.toString();

export async function applyFboBill(input: ApplyFboInput): Promise<FboApplyResult> {
  const rows = parseWorkbook(input.bytes);
  if (rows.length === 0) throw new Error('File FBO không có dòng vận đơn hợp lệ.');
  const bills = groupFboIntoBills(rows);
  const awbMap = await resolveAwbMap(rows.map((r) => r.awb));

  // Lưu file Excel 1 lần, đính cho mọi bill trong lần upload này.
  const ext = input.filename.includes('.') ? input.filename.slice(input.filename.lastIndexOf('.')) : '.xlsx';
  const fileKey = `carrier-bills/${input.carrierAccountId}/fbo-${randomUUID()}${ext}`;
  await putObject(fileKey, input.bytes, input.contentType);
  const fileMeta = {
    fileKey, filename: input.filename, contentType: input.contentType, byteSize: input.bytes.length,
  };

  const today = new Date().toISOString().slice(0, 10);

  const counts = await db.transaction(async (tx) => {
    let created = 0, updated = 0, charges = 0;
    for (const b of bills) {
      // Tìm bill cũ theo (account, billNumber) để upsert (chỉ khi có số).
      let billId: string | null = null;
      if (b.billNumber) {
        const [existing] = await tx
          .select({ id: schema.carrierBills.id })
          .from(schema.carrierBills)
          .where(and(
            eq(schema.carrierBills.carrierAccountId, input.carrierAccountId),
            eq(schema.carrierBills.billNumber, b.billNumber),
          ))
          .limit(1);
        billId = existing?.id ?? null;
      }

      const start = b.periodStart ?? b.issueDate ?? b.dueDate ?? today;
      const billValues = {
        carrierAccountId: input.carrierAccountId,
        billNumber: b.billNumber,
        periodStart: start,
        periodEnd: b.periodEnd ?? start,
        issueDate: b.issueDate, dueDate: b.dueDate,
        amount: numStr(b.amount), currency: input.currency,
        ...fileMeta,
        note: `FedEx FBO · ${b.lines.length} vận đơn`,
        createdBy: input.userId,
      };

      if (billId) {
        await tx.update(schema.carrierBills).set(billValues).where(eq(schema.carrierBills.id, billId));
        await tx.delete(schema.carrierBillLines).where(eq(schema.carrierBillLines.billId, billId));
        updated += 1;
      } else {
        const [ins] = await tx.insert(schema.carrierBills).values(billValues).returning({ id: schema.carrierBills.id });
        billId = ins.id;
        created += 1;
      }

      await tx.insert(schema.carrierBillLines).values(b.lines.map((l) => ({
        billId: billId!,
        trackingNumber: l.awb, orderNumber: l.orderRef, weightKg: l.weightKg != null ? numStr(l.weightKg) : null,
        base: numStr(l.base), discount: numStr(l.discount), fuel: numStr(l.fuel), remote: numStr(l.remote),
        demand: numStr(l.demand), signature: numStr(l.signature), vat: numStr(l.vat), other: numStr(l.other),
        total: numStr(l.total),
      })));
    }

    // Đối soát: upsert shipment_charges (billed, LOẠI duty) cho AWB khớp đơn.
    for (const r of rows) {
      const sid = awbMap.get(r.awb);
      if (!sid) continue;
      const vals = {
        shipmentId: sid, carrierAccountId: input.carrierAccountId, trackingNumber: r.awb,
        totalAmount: numStr(fboShippingTotal(r)), currency: input.currency,
        base: numStr(r.base), fuel: numStr(r.fuel), remote: numStr(r.remote), demand: numStr(r.demand),
        directSignature: numStr(r.signature), residential: numStr(r.residential), vat: numStr(r.vat), gogreen: '0',
        discount: numStr(r.discount), elevatedRisk: '0', importHandling: numStr(r.importHandling),
        source: 'fedex_fbo', sourceHash: `fbo:${r.awb}`,
      };
      await tx.insert(schema.shipmentCharges).values(vals)
        .onConflictDoUpdate({ target: schema.shipmentCharges.shipmentId, set: vals });
      charges += 1;
    }
    return { created, updated, charges };
  });

  const awbs = rows.map((r) => r.awb);
  const matched = awbs.filter((a) => awbMap.has(a));
  const unmatched = awbs.filter((a) => !awbMap.has(a));
  return {
    bills: toSummary(bills),
    totalAwb: awbs.length, matchedAwb: matched.length, unmatchedAwb: unmatched.length,
    grandTotal: bills.reduce((s, x) => s + x.amount, 0), unmatchedSample: unmatched.slice(0, 8),
    billsCreated: counts.created, billsUpdated: counts.updated, chargesUpserted: counts.charges,
  };
}
