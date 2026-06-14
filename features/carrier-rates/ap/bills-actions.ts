'use server';

import { randomUUID } from 'crypto';
import { desc, eq, inArray } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { putObject } from '@/lib/storage/s3';
import type { BillInput, PaymentInput } from './ap-summary';

export interface UploadFile {
  bytes: Uint8Array;
  filename: string;
  contentType: string;
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
  note?: string | null;
  userId: string;
  file?: UploadFile | null;
}

export async function createBill(input: CreateBillInput): Promise<void> {
  if (!(input.amount > 0)) throw new Error('Số tiền hoá đơn phải > 0.');
  if (input.periodEnd < input.periodStart) throw new Error('Kỳ kết thúc phải ≥ kỳ bắt đầu.');

  let fileKey: string | null = null;
  if (input.file && input.file.bytes.length > 0) {
    const ext = input.file.filename.includes('.') ? input.file.filename.slice(input.file.filename.lastIndexOf('.')) : '';
    fileKey = `carrier-bills/${input.carrierAccountId}/${randomUUID()}${ext}`;
    await putObject(fileKey, input.file.bytes, input.file.contentType);
  }

  await db.insert(schema.carrierBills).values({
    carrierAccountId: input.carrierAccountId,
    billNumber: input.billNumber ?? null,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    issueDate: input.issueDate ?? null,
    dueDate: input.dueDate ?? null,
    amount: String(input.amount),
    currency: input.currency,
    fileKey,
    filename: input.file?.filename ?? null,
    contentType: input.file?.contentType ?? null,
    byteSize: input.file ? input.file.bytes.length : null,
    note: input.note ?? null,
    createdBy: input.userId,
  });
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

/** Map BillRow/PaymentRow to the pure summariser's input shapes. */
export function toSummaryInputs(bills: BillRow[], payments: PaymentRow[]): { bills: BillInput[]; payments: PaymentInput[] } {
  return {
    bills: bills.map((b) => ({ id: b.id, amount: b.amount, currency: b.currency, dueDate: b.dueDate })),
    payments: payments.map((p) => ({ billId: p.billId, amount: p.amount })),
  };
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

export async function deleteBill(id: string): Promise<void> {
  await db.delete(schema.carrierBills).where(eq(schema.carrierBills.id, id));
}

export async function deletePayment(id: string): Promise<void> {
  await db.delete(schema.carrierBillPayments).where(eq(schema.carrierBillPayments.id, id));
}
