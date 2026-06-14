import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { ChevronLeft, Truck, Wallet } from 'lucide-react';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { getAccount, updateAccount, deleteAccount } from '@/features/carrier-rates/actions';
import { daysSince } from '@/features/carrier-rates/lib';
import {
  createBill, addPayment, deleteBill, deletePayment,
  listBills, listPaymentsForAccount, listBillLines, type UploadFile,
} from '@/features/carrier-rates/ap/bills-actions';
import { summariseAp, toSummaryInputs } from '@/features/carrier-rates/ap/ap-summary';
import { systemTotalForPeriod, systemAllTimeTotal } from '@/features/carrier-rates/ap/period-compare';
import { BillsBoard } from '@/components/carrier-rates/BillsBoard';
import { CarrierSetupSheet } from '@/components/carrier-rates/CarrierSetupSheet';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export const dynamic = 'force-dynamic';

const FX_STALE_DAYS = 30;

function todayIso(): string { return new Date().toISOString().slice(0, 10); }

async function fileFromForm(form: FormData, field: string): Promise<UploadFile | null> {
  const f = form.get(field);
  if (!(f instanceof File) || f.size === 0) return null;
  return { bytes: new Uint8Array(await f.arrayBuffer()), filename: f.name, contentType: f.type || 'application/octet-stream' };
}

async function toggleEnabledAction(id: string, next: boolean, userId: string) {
  'use server';
  await updateAccount({ id, enabled: next }, userId);
  revalidatePath(`/f/carrier-rates/${id}`);
  revalidatePath('/f/carrier-rates');
}

async function deleteAccountAction(id: string) {
  'use server';
  await deleteAccount(id);
  redirect('/f/carrier-rates');
}

export default async function CarrierAccountDetailPage({ params }: { params: Promise<{ id: string }> }) {
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
  const currency = account.costCurrency ?? 'VND';
  const fxNumber = Number(account.fxCostPerDisplay);
  const fxFormatted = Number.isFinite(fxNumber) ? fxNumber.toLocaleString() : account.fxCostPerDisplay;
  const fxAge = daysSince(account.fxUpdatedAt);
  const fxStale = fxAge >= FX_STALE_DAYS;

  const [bills, payments, allTime] = await Promise.all([
    listBills(id), listPaymentsForAccount(id), systemAllTimeTotal(id),
  ]);
  const inputs = toSummaryInputs(bills, payments);
  const summary = summariseAp(inputs.bills, inputs.payments, todayIso());
  const periodTotals = await Promise.all(bills.map((b) => systemTotalForPeriod(id, b.periodStart, b.periodEnd)));
  const systemByBill: Record<string, number> = {};
  bills.forEach((b, i) => { systemByBill[b.id] = periodTotals[i].systemTotal; });

  const fmt = (n: number) => `${Math.round(n).toLocaleString('vi-VN')} ${currency}`;

  // ── Server actions ──
  async function createBillAction(formData: FormData) {
    'use server';
    const n = (k: string) => { const v = String(formData.get(k) ?? '').replace(/[^\d.-]/g, ''); return v ? Number(v) : 0; };
    const s = (k: string) => { const v = String(formData.get(k) ?? '').trim(); return v || null; };
    await createBill({
      carrierAccountId: id, billNumber: s('billNumber'),
      periodStart: String(formData.get('periodStart')), periodEnd: String(formData.get('periodEnd')),
      issueDate: s('issueDate'), dueDate: s('dueDate'), amount: n('amount'), currency,
      note: s('note'), userId: session!.user.id, file: await fileFromForm(formData, 'file'),
    });
    revalidatePath(`/f/carrier-rates/${id}`);
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
    revalidatePath(`/f/carrier-rates/${id}`);
  }
  async function deleteBillAction(billId: string) { 'use server'; await deleteBill(billId); revalidatePath(`/f/carrier-rates/${id}`); }
  async function deletePaymentAction(paymentId: string) { 'use server'; await deletePayment(paymentId); revalidatePath(`/f/carrier-rates/${id}`); }
  async function listLinesAction(billId: string) { 'use server'; return listBillLines(billId); }

  return (
    <div className="px-6 md:px-10 py-6 space-y-8">
      <Link href="/f/carrier-rates" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ChevronLeft className="size-4" /> Carrier rates
      </Link>

      {/* Header: name + status + (!) setup */}
      <header className="flex items-start justify-between gap-6 flex-wrap">
        <div className="space-y-2 min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
            <span className="inline-flex items-center gap-1.5"><Truck className="size-3.5" />{account.carrierName ?? account.carrierKey ?? 'Carrier'}</span>
            <Badge variant={account.enabled ? 'default' : 'outline'} className="h-5 text-[10px] uppercase tracking-wider">{account.enabled ? 'Active' : 'Disabled'}</Badge>
          </div>
          <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">{account.name}</h1>
        </div>
        <CarrierSetupSheet
          accountId={id} canManage={canManage} enabled={account.enabled}
          fxFormatted={String(fxFormatted)} fxAge={fxAge} fxStale={fxStale}
          costCurrency={account.costCurrency} displayCurrency={account.displayCurrency}
          weightUnit={account.weightUnit} notes={account.notes ?? null}
          toggleAction={toggleEnabledAction.bind(null, id, !account.enabled, session.user.id)}
          deleteAction={deleteAccountAction.bind(null, id)}
        />
      </header>

      {/* AP summary */}
      <section className="space-y-3">
        <div className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground"><Wallet className="size-3.5" /> Công nợ</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-border rounded-2xl overflow-hidden border border-border">
          <StatTile label="Đã bill" value={fmt(summary.totalBilled)} sub={`${bills.length} hoá đơn`} />
          <StatTile label="Đã thanh toán" value={fmt(summary.totalPaid)} />
          <StatTile label="Còn nợ" value={fmt(summary.totalOutstanding)} accent={summary.totalOutstanding > 0} />
          <StatTile label="Quá hạn" value={fmt(summary.overdueAmount)} sub={`${summary.overdueCount} hoá đơn`} danger={summary.overdueCount > 0} />
        </div>
        <div className="rounded-xl border border-dashed border-border bg-muted/20 px-4 py-2.5 text-xs text-muted-foreground flex flex-wrap gap-x-6 gap-y-1">
          <span className="uppercase tracking-wider">Tham chiếu hệ thống:</span>
          <span>Đã charge all-time <b className="text-foreground tabular-nums">{fmt(allTime.systemTotal)}</b> ({allTime.shipmentCount.toLocaleString('vi-VN')} đơn)</span>
          <span>Công nợ ước tính <b className={'tabular-nums ' + (allTime.systemTotal - summary.totalPaid > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-foreground')}>{fmt(Math.max(0, allTime.systemTotal - summary.totalPaid))}</b></span>
        </div>
      </section>

      {/* Add bill */}
      {canManage && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Thêm hoá đơn</h2>
          <Card><CardContent className="p-5">
            <form action={createBillAction} className="grid grid-cols-2 md:grid-cols-4 gap-4 items-end">
              <Field label="Mã hoá đơn"><Input name="billNumber" placeholder="INV-..." /></Field>
              <Field label="Số tiền *"><Input name="amount" required inputMode="numeric" placeholder="0" /></Field>
              <Field label="Kỳ từ *"><Input name="periodStart" type="date" required /></Field>
              <Field label="Kỳ đến *"><Input name="periodEnd" type="date" required /></Field>
              <Field label="Ngày xuất"><Input name="issueDate" type="date" /></Field>
              <Field label="Hạn thanh toán"><Input name="dueDate" type="date" /></Field>
              <Field label="File hoá đơn"><Input name="file" type="file" accept=".pdf,.xlsx,.xls,.png,.jpg,.jpeg" /></Field>
              <Field label="Ghi chú"><Input name="note" placeholder="—" /></Field>
              <div className="col-span-2 md:col-span-4"><Button type="submit" size="sm">Lưu hoá đơn</Button></div>
            </form>
          </CardContent></Card>
        </section>
      )}

      <BillsBoard
        accountId={id} currency={currency} canManage={canManage}
        bills={bills} payments={payments} summaryBills={summary.bills} systemByBill={systemByBill}
        listLines={listLinesAction}
        addPaymentAction={addPaymentAction} deleteBillAction={deleteBillAction} deletePaymentAction={deletePaymentAction}
      />
    </div>
  );
}

function StatTile({ label, value, sub, accent, danger }: { label: string; value: string; sub?: string; accent?: boolean; danger?: boolean }) {
  return (
    <div className="bg-card p-4 md:p-5">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={'mt-1 text-lg md:text-xl font-semibold tabular-nums ' + (danger ? 'text-destructive' : accent ? 'text-amber-600 dark:text-amber-400' : '')}>{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
