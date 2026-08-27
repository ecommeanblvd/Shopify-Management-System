'use server';

import { randomUUID } from 'crypto';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { putObject } from '@/lib/storage/s3';

export interface UploadFile {
  bytes: Uint8Array;
  filename: string;
  contentType: string;
}

/** Dòng chi tiết billed theo shipment (khớp cột carrier_bill_lines). */
export interface BillLineInput {
  trackingNumber?: string | null;
  orderNumber?: string | null;
  weightKg?: number | null;
  base?: number | null;
  discount?: number | null;
  fuel?: number | null;
  remote?: number | null;
  demand?: number | null;
  signature?: number | null;
  vat?: number | null;
  other?: number | null;
  total?: number | null;
  note?: string | null;
  /** Ngày đi hàng (YYYY-MM-DD) — điền shipments.label_created_at khi đối soát. */
  shipDate?: string | null;
  /** Breakdown chi tiết từng khoản (jsonb): [{code,name,charge,tax,total}]. */
  charges?: unknown;
}

export interface CreateBillInput {
  carrierAccountId: string;
  billNumber?: string | null;
  periodStart: string;
  periodEnd: string;
  issueDate?: string | null;
  dueDate?: string | null;
  amount: number;
  currency: string;
  /** Tỉ giá ghi trên hoá đơn (1 đơn vị `currency` gốc = ? VNĐ). Chỉ hoá đơn
   *  ngoại tệ mới có — xem carrier_bills.fx_rate. */
  fxRate?: number | null;
  note?: string | null;
  userId: string;
  file?: UploadFile | null;
  /** Khi nhập từ file hoá đơn: lưu kèm breakdown từng shipment. */
  lines?: BillLineInput[];
}

const numOrNull = (v: number | null | undefined) => (v == null ? null : String(v));

export async function createBill(input: CreateBillInput): Promise<{ id: string }> {
  if (!(input.amount > 0)) throw new Error('Số tiền hoá đơn phải > 0.');
  if (input.periodEnd < input.periodStart) throw new Error('Kỳ kết thúc phải ≥ kỳ bắt đầu.');

  let fileKey: string | null = null;
  if (input.file && input.file.bytes.length > 0) {
    const ext = input.file.filename.includes('.') ? input.file.filename.slice(input.file.filename.lastIndexOf('.')) : '';
    fileKey = `carrier-bills/${input.carrierAccountId}/${randomUUID()}${ext}`;
    await putObject(fileKey, input.file.bytes, input.file.contentType);
  }

  const billValues = {
    carrierAccountId: input.carrierAccountId,
    billNumber: input.billNumber ?? null,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    issueDate: input.issueDate ?? null,
    dueDate: input.dueDate ?? null,
    amount: String(input.amount),
    currency: input.currency,
    fxRate: input.fxRate != null ? String(input.fxRate) : null,
    fileKey,
    filename: input.file?.filename ?? null,
    contentType: input.file?.contentType ?? null,
    byteSize: input.file ? input.file.bytes.length : null,
    note: input.note ?? null,
    createdBy: input.userId,
  };

  // UPSERT theo (account, billNumber): re-upload cùng hoá đơn → CẬP NHẬT bill cũ
  // + thay lines, KHÔNG tạo bill trùng. (reconcileDhlBill sau đó chỉ ghi
  // shipment_charges có thay đổi → giữ nguyên đơn đã đối soát.)
  let billId: string | null = null;
  if (input.billNumber) {
    const [existing] = await db.select({ id: schema.carrierBills.id })
      .from(schema.carrierBills)
      .where(and(eq(schema.carrierBills.carrierAccountId, input.carrierAccountId), eq(schema.carrierBills.billNumber, input.billNumber)))
      .limit(1);
    billId = existing?.id ?? null;
  }
  if (billId) {
    await db.update(schema.carrierBills).set(billValues).where(eq(schema.carrierBills.id, billId));
    await db.delete(schema.carrierBillLines).where(eq(schema.carrierBillLines.billId, billId));
  } else {
    const [ins] = await db.insert(schema.carrierBills).values(billValues).returning({ id: schema.carrierBills.id });
    billId = ins.id;
  }
  const bill = { id: billId };

  if (input.lines?.length) {
    await db.insert(schema.carrierBillLines).values(input.lines.map((l) => ({
      billId: bill.id,
      trackingNumber: l.trackingNumber ?? null,
      orderNumber: l.orderNumber ?? null,
      weightKg: numOrNull(l.weightKg),
      base: numOrNull(l.base),
      discount: numOrNull(l.discount),
      fuel: numOrNull(l.fuel),
      remote: numOrNull(l.remote),
      demand: numOrNull(l.demand),
      signature: numOrNull(l.signature),
      vat: numOrNull(l.vat),
      other: numOrNull(l.other),
      total: numOrNull(l.total),
      shipDate: l.shipDate ?? null,
      charges: l.charges ?? null,
      note: l.note ?? null,
    })));
  }
  return { id: bill.id };
}

export interface BillRow {
  id: string;
  billNumber: string | null;
  periodStart: string;
  periodEnd: string;
  issueDate: string | null;
  dueDate: string | null;
  amount: number;
  currency: string;
  hasFile: boolean;
  hasPdf: boolean;
  pdfAmount: number | null;
  pdfIssueDate: string | null;
  pdfDueDate: string | null;
  filename: string | null;
  note: string | null;
}

export async function listBills(carrierAccountId: string): Promise<BillRow[]> {
  const rows = await db
    .select()
    .from(schema.carrierBills)
    .where(eq(schema.carrierBills.carrierAccountId, carrierAccountId))
    .orderBy(desc(schema.carrierBills.periodStart), desc(schema.carrierBills.createdAt));
  return rows.map((b) => ({
    id: b.id,
    billNumber: b.billNumber,
    periodStart: b.periodStart,
    periodEnd: b.periodEnd,
    issueDate: b.issueDate,
    dueDate: b.dueDate,
    amount: Number(b.amount),
    currency: b.currency,
    hasFile: !!b.fileKey,
    hasPdf: !!b.pdfFileKey,
    pdfAmount: b.pdfAmount !== null ? Number(b.pdfAmount) : null,
    pdfIssueDate: b.pdfIssueDate,
    pdfDueDate: b.pdfDueDate,
    filename: b.filename,
    note: b.note,
  }));
}

export interface PaymentRow {
  id: string;
  billId: string;
  paidAt: string;
  amount: number;
  method: string | null;
  hasProof: boolean;
  proofFilename: string | null;
  note: string | null;
}

/** All payments for an account's bills (one query) — feeds the AP summariser. */
export async function listPaymentsForAccount(carrierAccountId: string): Promise<PaymentRow[]> {
  const bills = await db
    .select({ id: schema.carrierBills.id })
    .from(schema.carrierBills)
    .where(eq(schema.carrierBills.carrierAccountId, carrierAccountId));
  const billIds = bills.map((b) => b.id);
  if (billIds.length === 0) return [];
  const rows = await db
    .select()
    .from(schema.carrierBillPayments)
    .where(inArray(schema.carrierBillPayments.billId, billIds))
    .orderBy(desc(schema.carrierBillPayments.paidAt));
  return rows.map((p) => ({
    id: p.id,
    billId: p.billId,
    paidAt: p.paidAt,
    amount: Number(p.amount),
    method: p.method,
    hasProof: !!p.proofFileKey,
    proofFilename: p.proofFilename,
    note: p.note,
  }));
}

export interface AddPaymentInput {
  billId: string;
  paidAt: string;
  amount: number;
  method?: string | null;
  note?: string | null;
  userId: string;
  proof?: UploadFile | null;
}

export async function addPayment(input: AddPaymentInput): Promise<void> {
  if (!(input.amount > 0)) throw new Error('Số tiền thanh toán phải > 0.');
  // Confirm the bill exists (and get account for the storage key).
  const [bill] = await db
    .select({ accountId: schema.carrierBills.carrierAccountId })
    .from(schema.carrierBills)
    .where(eq(schema.carrierBills.id, input.billId))
    .limit(1);
  if (!bill) throw new Error('Không tìm thấy hoá đơn.');

  let proofKey: string | null = null;
  if (input.proof && input.proof.bytes.length > 0) {
    const ext = input.proof.filename.includes('.') ? input.proof.filename.slice(input.proof.filename.lastIndexOf('.')) : '';
    proofKey = `carrier-bill-payments/${input.billId}/${randomUUID()}${ext}`;
    await putObject(proofKey, input.proof.bytes, input.proof.contentType);
  }

  await db.insert(schema.carrierBillPayments).values({
    billId: input.billId,
    paidAt: input.paidAt,
    amount: String(input.amount),
    method: input.method ?? null,
    proofFileKey: proofKey,
    proofFilename: input.proof?.filename ?? null,
    proofContentType: input.proof?.contentType ?? null,
    proofByteSize: input.proof ? input.proof.bytes.length : null,
    note: input.note ?? null,
    createdBy: input.userId,
  });
}

export interface BillLineRow {
  id: string;
  trackingNumber: string | null;
  orderNumber: string | null;
  weightKg: number | null;
  base: number | null;
  discount: number | null;
  fuel: number | null;
  remote: number | null;
  demand: number | null;
  signature: number | null;
  vat: number | null;
  other: number | null;
  total: number | null;
  note: string | null;
}

const num = (v: string | null) => (v === null ? null : Number(v));

/** Per-shipment line items of a bill (parsed from the invoice file). Empty
 *  until the bill parser runs. */
export async function listBillLines(billId: string): Promise<BillLineRow[]> {
  const rows = await db
    .select()
    .from(schema.carrierBillLines)
    .where(eq(schema.carrierBillLines.billId, billId))
    .orderBy(schema.carrierBillLines.trackingNumber);
  return rows.map((r) => ({
    id: r.id,
    trackingNumber: r.trackingNumber,
    orderNumber: r.orderNumber,
    weightKg: num(r.weightKg),
    base: num(r.base),
    discount: num(r.discount),
    fuel: num(r.fuel),
    remote: num(r.remote),
    demand: num(r.demand),
    signature: num(r.signature),
    vat: num(r.vat),
    other: num(r.other),
    total: num(r.total),
    note: r.note,
  }));
}

export interface BillCharge { code: string; name: string; charge: number; tax: number; total: number }
export interface AllBillLineRow extends BillLineRow { billId: string; charges: BillCharge[] | null }

/** Mọi line của các bill thuộc 1 account (kèm billId + breakdown) — dựng bảng theo tracking. */
export async function listAllBillLines(carrierAccountId: string): Promise<AllBillLineRow[]> {
  const rows = await db
    .select({ l: schema.carrierBillLines })
    .from(schema.carrierBillLines)
    .innerJoin(schema.carrierBills, eq(schema.carrierBills.id, schema.carrierBillLines.billId))
    .where(eq(schema.carrierBills.carrierAccountId, carrierAccountId))
    .orderBy(schema.carrierBillLines.trackingNumber);
  return rows.map(({ l: r }) => ({
    id: r.id, billId: r.billId,
    trackingNumber: r.trackingNumber, orderNumber: r.orderNumber,
    weightKg: num(r.weightKg), base: num(r.base), discount: num(r.discount), fuel: num(r.fuel),
    remote: num(r.remote), demand: num(r.demand), signature: num(r.signature),
    vat: num(r.vat), other: num(r.other), total: num(r.total), note: r.note,
    charges: Array.isArray(r.charges) ? (r.charges as BillCharge[]) : null,
  }));
}

export async function deleteBill(id: string): Promise<void> {
  await db.delete(schema.carrierBills).where(eq(schema.carrierBills.id, id));
}

export async function deletePayment(id: string): Promise<void> {
  await db.delete(schema.carrierBillPayments).where(eq(schema.carrierBillPayments.id, id));
}
