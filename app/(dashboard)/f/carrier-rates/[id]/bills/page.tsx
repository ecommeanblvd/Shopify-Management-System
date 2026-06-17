import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { ChevronLeft, Receipt } from 'lucide-react';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { getAccount } from '@/features/carrier-rates/actions';
import {
  createBill, addPayment, deleteBill, deletePayment,
  listBills, listPaymentsForAccount, listBillLines, listAllBillLines, attachInvoicePdfsToBills,
  type UploadFile, type BillLineInput, type BatchImportResult,
} from '@/features/carrier-rates/ap/bills-actions';
import { parseDhlInvoiceCsv, dhlShipmentToBillLine } from '@/features/carrier-rates/ap/dhl-invoice-csv';
import { summariseAp, toSummaryInputs } from '@/features/carrier-rates/ap/ap-summary';
import { buildTrackingRows } from '@/features/carrier-rates/ap/tracking-rows';
import { reconcileDhlBill, type DhlReconcileResult } from '@/features/carrier-rates/ap/dhl-reconcile-actions';
import { previewFboBill, applyFboBill } from '@/features/carrier-rates/ap/fbo-import-actions';
import { detectUnknownCharges } from '@/features/carrier-rates/ap/detect-surcharges';
import { BillingTrackingTable } from '@/components/carrier-rates/BillingTrackingTable';
import { NewSurchargesReport } from '@/components/carrier-rates/NewSurchargesReport';
import { AddBillDialog } from '@/components/carrier-rates/AddBillDialog';
import { ImportFboDialog } from '@/components/carrier-rates/ImportFboDialog';
import { AttachInvoicePdfDialog } from '@/components/carrier-rates/AttachInvoicePdfDialog';

export const dynamic = 'force-dynamic';

async function fileFromForm(form: FormData, field: string): Promise<UploadFile | null> {
  const f = form.get(field);
  if (!(f instanceof File) || f.size === 0) return null;
  return { bytes: new Uint8Array(await f.arrayBuffer()), filename: f.name, contentType: f.type || 'application/octet-stream' };
}

export default async function CarrierBillsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_carrier_rates')) {
    return <div className="max-w-3xl mx-auto px-6 md:px-10 py-16 text-center"><h1 className="text-3xl font-semibold">Forbidden</h1></div>;
  }
  const account = await getAccount(id);
  if (!account) notFound();

  const canManage = hasPermission(role, 'manage_carrier_rates');
  // Thêm/nhập hoá đơn carrier chỉ cần quyền hoá đơn (logistics có), tách khỏi
  // quyền quản trị bảng giá đầy đủ (manage_carrier_rates — gác payments/xoá).
  const canAddInvoice = canManage || hasPermission(role, 'manage_shipping_invoices');
  const currency = account.costCurrency ?? 'VND';

  const [bills, payments, allLines] = await Promise.all([listBills(id), listPaymentsForAccount(id), listAllBillLines(id)]);
  const inputs = toSummaryInputs(bills, payments);
  const today = new Date().toISOString().slice(0, 10);
  const summary = summariseAp(inputs.bills, inputs.payments, today);
  const trackingRows = buildTrackingRows(
    bills.map((b) => ({ id: b.id, billNumber: b.billNumber, dueDate: b.dueDate, amount: b.amount })),
    allLines.map((l) => ({
      billId: l.billId, trackingNumber: l.trackingNumber, orderNumber: l.orderNumber, weightKg: l.weightKg ?? null,
      base: l.base ?? 0, discount: l.discount ?? 0, fuel: l.fuel ?? 0, remote: l.remote ?? 0, demand: l.demand ?? 0,
      signature: l.signature ?? 0, vat: l.vat ?? 0, other: l.other ?? 0, total: l.total ?? 0, note: l.note,
      charges: l.charges,
    })),
    inputs.payments, today,
  );

  // Phí lạ (chưa map cước, không phải thuế/duty) → gợi ý set up surcharge mới.
  const billMetaById = new Map(bills.map((b) => [b.id, { billNumber: b.billNumber, periodStart: b.periodStart }]));
  const unknownCharges = detectUnknownCharges(
    allLines.map((l) => ({
      billId: l.billId,
      billNumber: billMetaById.get(l.billId)?.billNumber ?? null,
      periodStart: billMetaById.get(l.billId)?.periodStart ?? '',
      trackingNumber: l.trackingNumber,
      charges: l.charges,
    })),
  );

  // Mọi thay đổi bill/payment phải revalidate cả trang này lẫn trang account
  // (khối Công nợ ở account đọc cùng dữ liệu).
  const REV = [`/f/carrier-rates/${id}/bills`, `/f/carrier-rates/${id}`];

  async function createBillAction(formData: FormData): Promise<DhlReconcileResult | null> {
    'use server';
    if (!canAddInvoice) throw new Error('forbidden');
    const n = (k: string) => { const v = String(formData.get(k) ?? '').replace(/[^\d.-]/g, ''); return v ? Number(v) : 0; };
    const s = (k: string) => { const v = String(formData.get(k) ?? '').trim(); return v || null; };
    let lines: BillLineInput[] | undefined;
    const linesJson = String(formData.get('linesJson') ?? '').trim();
    if (linesJson) { try { const arr = JSON.parse(linesJson); if (Array.isArray(arr) && arr.length) lines = arr as BillLineInput[]; } catch { /* bỏ qua nếu hỏng */ } }
    const { id: billId } = await createBill({
      carrierAccountId: id, billNumber: s('billNumber'),
      periodStart: String(formData.get('periodStart')), periodEnd: String(formData.get('periodEnd')),
      issueDate: s('issueDate'), dueDate: s('dueDate'), amount: n('amount'), currency,
      note: s('note'), userId: session!.user.id, file: await fileFromForm(formData, 'file'), lines,
    });
    // Hoá đơn DHL có dòng cước → tự đẩy vào đối soát.
    let reconcile: DhlReconcileResult | null = null;
    if (account.carrierKey === 'dhl' && lines?.length) {
      reconcile = await reconcileDhlBill(billId);
    }
    REV.forEach((p) => revalidatePath(p));
    return reconcile;
  }
  // Upload NHIỀU file CSV DHL 1 lượt → mỗi file 1 hoá đơn + đối soát cước. Bỏ
  // qua file trùng mã / không đọc được; trả kết quả từng file.
  async function importBatchAction(formData: FormData): Promise<BatchImportResult[]> {
    'use server';
    if (!canAddInvoice) throw new Error('forbidden');
    const files = formData.getAll('files').filter((f): f is File => f instanceof File && f.size > 0);
    const existing = new Set((await listBills(id)).map((b) => b.billNumber).filter(Boolean) as string[]);
    const out: BatchImportResult[] = [];
    for (const f of files) {
      const base: BatchImportResult = { filename: f.name, ok: false, billNumber: null, amount: null, matched: null, freight: null, message: null };
      if (!/\.csv$/i.test(f.name)) { out.push({ ...base, message: 'Chỉ nhận file CSV' }); continue; }
      let p; try { p = parseDhlInvoiceCsv(await f.text()); } catch { out.push({ ...base, message: 'Lỗi đọc file' }); continue; }
      if (!p) { out.push({ ...base, message: 'Không đúng định dạng hoá đơn DHL' }); continue; }
      if (p.billNumber && existing.has(p.billNumber)) { out.push({ ...base, billNumber: p.billNumber, message: 'Đã tồn tại — bỏ qua' }); continue; }
      const lines = p.shipments.map(dhlShipmentToBillLine);
      const bytes = new Uint8Array(await f.arrayBuffer());
      const { id: billId } = await createBill({
        carrierAccountId: id, billNumber: p.billNumber, periodStart: p.periodStart, periodEnd: p.periodEnd,
        issueDate: p.issueDate, dueDate: p.dueDate, amount: p.amountInclVat, currency,
        note: p.note, userId: session!.user.id, file: { bytes, filename: f.name, contentType: 'text/csv' }, lines,
      });
      if (p.billNumber) existing.add(p.billNumber);
      let matched: number | null = null, freight: number | null = null;
      if (account.carrierKey === 'dhl' && lines.length) { const r = await reconcileDhlBill(billId); matched = r.matched; freight = r.freightLines; }
      out.push({ filename: f.name, ok: true, billNumber: p.billNumber, amount: p.amountInclVat, matched, freight, message: null });
    }
    REV.forEach((pp) => revalidatePath(pp));
    return out;
  }
  async function addPaymentAction(formData: FormData) {
    'use server';
    const n = (k: string) => { const v = String(formData.get(k) ?? '').replace(/[^\d.-]/g, ''); return v ? Number(v) : 0; };
    const s = (k: string) => { const v = String(formData.get(k) ?? '').trim(); return v || null; };
    await addPayment({
      billId: String(formData.get('billId')), paidAt: String(formData.get('paidAt')),
      amount: n('amount'), method: s('method'), note: s('note'),
      userId: session!.user.id, proof: await fileFromForm(formData, 'proof'),
    });
    REV.forEach((p) => revalidatePath(p));
  }
  const isFedex = account.carrierKey === 'fedex';
  async function previewFboAction(formData: FormData) {
    'use server';
    if (!canAddInvoice) throw new Error('forbidden');
    const file = await fileFromForm(formData, 'file');
    if (!file) throw new Error('Chưa chọn file FBO.');
    return previewFboBill(file.bytes);
  }
  async function applyFboAction(formData: FormData) {
    'use server';
    if (!canAddInvoice) throw new Error('forbidden');
    const file = await fileFromForm(formData, 'file');
    if (!file) throw new Error('Chưa chọn file FBO.');
    const res = await applyFboBill({
      carrierAccountId: id, currency, userId: session!.user.id,
      bytes: file.bytes, filename: file.filename, contentType: file.contentType,
    });
    REV.forEach((p) => revalidatePath(p));
    return res;
  }
  async function attachPdfsAction(formData: FormData) {
    'use server';
    if (!canAddInvoice) throw new Error('forbidden');
    const fs = formData.getAll('files').filter((f): f is File => f instanceof File && f.size > 0);
    const files = await Promise.all(fs.map(async (f) => ({
      bytes: new Uint8Array(await f.arrayBuffer()), filename: f.name, contentType: f.type || 'application/pdf',
    })));
    if (files.length === 0) throw new Error('Chưa chọn PDF.');
    const res = await attachInvoicePdfsToBills({ carrierAccountId: id, files });
    REV.forEach((p) => revalidatePath(p));
    return res;
  }
  async function deleteBillAction(billId: string) { 'use server'; await deleteBill(billId); REV.forEach((p) => revalidatePath(p)); }
  async function deletePaymentAction(paymentId: string) { 'use server'; await deletePayment(paymentId); REV.forEach((p) => revalidatePath(p)); }
  async function listLinesAction(billId: string) { 'use server'; return listBillLines(billId); }

  const fmt = (v: number) => `${Math.round(v).toLocaleString('vi-VN')} ${currency}`;

  return (
    <div className="px-6 md:px-10 py-6 space-y-6">
      <Link href={`/f/carrier-rates/${id}`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ChevronLeft className="size-4" /> {account.name}
      </Link>

      <header className="flex items-center justify-between gap-3 flex-wrap">
        <div className="space-y-1">
          <h1 className="text-2xl md:text-3xl font-semibold tracking-tight flex items-center gap-2">
            <Receipt className="size-6 text-muted-foreground" /> Billing / Invoices
          </h1>
          <p className="text-sm text-muted-foreground">
            {bills.length} hoá đơn · đã bill {fmt(summary.totalBilled)} · còn nợ <b className={summary.totalOutstanding > 0 ? 'text-amber-600 dark:text-amber-400' : ''}>{fmt(summary.totalOutstanding)}</b>
          </p>
        </div>
        {canAddInvoice && (
          <div className="flex items-center gap-2">
            {isFedex && <ImportFboDialog currency={currency} previewAction={previewFboAction} applyAction={applyFboAction} />}
            {isFedex && <AttachInvoicePdfDialog attachAction={attachPdfsAction} />}
            <AddBillDialog createBillAction={createBillAction} importAction={importBatchAction} accountCurrency={currency} />
          </div>
        )}
      </header>

      <NewSurchargesReport accountId={id} currency={currency} rows={unknownCharges} />

      <BillingTrackingTable
        accountId={id} currency={currency} canManage={canManage}
        rows={trackingRows} bills={bills} payments={payments} summaryBills={summary.bills}
        listLines={listLinesAction}
        addPaymentAction={addPaymentAction} deleteBillAction={deleteBillAction} deletePaymentAction={deletePaymentAction}
      />
    </div>
  );
}
