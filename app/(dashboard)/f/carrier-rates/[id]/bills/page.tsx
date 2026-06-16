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
  listBills, listPaymentsForAccount, listBillLines, attachInvoicePdfsToBills, type UploadFile,
} from '@/features/carrier-rates/ap/bills-actions';
import { summariseAp, toSummaryInputs } from '@/features/carrier-rates/ap/ap-summary';
import { systemTotalForPeriod } from '@/features/carrier-rates/ap/period-compare';
import { previewFboBill, applyFboBill } from '@/features/carrier-rates/ap/fbo-import-actions';
import { BillsBoard } from '@/components/carrier-rates/BillsBoard';
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

  const [bills, payments] = await Promise.all([listBills(id), listPaymentsForAccount(id)]);
  const inputs = toSummaryInputs(bills, payments);
  const summary = summariseAp(inputs.bills, inputs.payments, new Date().toISOString().slice(0, 10));
  const periodTotals = await Promise.all(bills.map((b) => systemTotalForPeriod(id, b.periodStart, b.periodEnd)));
  const systemByBill: Record<string, number> = {};
  bills.forEach((b, i) => { systemByBill[b.id] = periodTotals[i].systemTotal; });

  // Mọi thay đổi bill/payment phải revalidate cả trang này lẫn trang account
  // (khối Công nợ ở account đọc cùng dữ liệu).
  const REV = [`/f/carrier-rates/${id}/bills`, `/f/carrier-rates/${id}`];

  async function createBillAction(formData: FormData) {
    'use server';
    if (!canAddInvoice) throw new Error('forbidden');
    const n = (k: string) => { const v = String(formData.get(k) ?? '').replace(/[^\d.-]/g, ''); return v ? Number(v) : 0; };
    const s = (k: string) => { const v = String(formData.get(k) ?? '').trim(); return v || null; };
    await createBill({
      carrierAccountId: id, billNumber: s('billNumber'),
      periodStart: String(formData.get('periodStart')), periodEnd: String(formData.get('periodEnd')),
      issueDate: s('issueDate'), dueDate: s('dueDate'), amount: n('amount'), currency,
      note: s('note'), userId: session!.user.id, file: await fileFromForm(formData, 'file'),
    });
    REV.forEach((p) => revalidatePath(p));
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
            <AddBillDialog createBillAction={createBillAction} />
          </div>
        )}
      </header>

      <BillsBoard
        accountId={id} currency={currency} canManage={canManage}
        bills={bills} payments={payments} summaryBills={summary.bills} systemByBill={systemByBill}
        listLines={listLinesAction}
        addPaymentAction={addPaymentAction} deleteBillAction={deleteBillAction} deletePaymentAction={deletePaymentAction}
      />
    </div>
  );
}
