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
  addPayment, deleteBill, deletePayment,
  listBills, listPaymentsForAccount, listBillLines, listAllBillLines, attachInvoicePdfsToBills,
  type UploadFile,
} from '@/features/carrier-rates/ap/bills-actions';
import { summariseAp, toSummaryInputs } from '@/features/carrier-rates/ap/ap-summary';
import { buildTrackingRows } from '@/features/carrier-rates/ap/tracking-rows';
import { detectUnknownCharges } from '@/features/carrier-rates/ap/detect-surcharges';
import { previewOneInvoice, importCarrierInvoices } from '@/features/carrier-rates/ap/invoice-upload';
import { BillingTrackingTable } from '@/components/carrier-rates/BillingTrackingTable';
import { NewSurchargesReport } from '@/components/carrier-rates/NewSurchargesReport';
import { CarrierInvoiceDialog } from '@/components/carrier-rates/CarrierInvoiceDialog';
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
  async function previewInvoiceAction(formData: FormData) {
    'use server';
    if (!canAddInvoice) throw new Error('forbidden');
    const file = await fileFromForm(formData, 'file');
    if (!file) throw new Error('Chưa chọn file.');
    return previewOneInvoice(
      { carrierKey: account.carrierKey, carrierAccountId: id, currency, userId: session!.user.id },
      file,
    );
  }
  async function importInvoicesAction(formData: FormData) {
    'use server';
    if (!canAddInvoice) throw new Error('forbidden');
    const fileObjs = formData.getAll('files').filter((f): f is File => f instanceof File && f.size > 0);
    const ups = await Promise.all(fileObjs.map(async (f) => ({
      bytes: new Uint8Array(await f.arrayBuffer()), filename: f.name, contentType: f.type || 'application/octet-stream',
    })));
    const existing = new Set((await listBills(id)).map((b) => b.billNumber).filter(Boolean) as string[]);
    const res = await importCarrierInvoices(
      { carrierKey: account.carrierKey, carrierAccountId: id, currency, userId: session!.user.id },
      ups, existing,
    );
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
            {isFedex && <AttachInvoicePdfDialog attachAction={attachPdfsAction} />}
            <CarrierInvoiceDialog carrierKey={account.carrierKey as 'fedex' | 'dhl'} currency={currency} previewAction={previewInvoiceAction} importAction={importInvoicesAction} />
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
