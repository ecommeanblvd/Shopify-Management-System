import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { ChevronLeft, Wallet } from 'lucide-react';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { getAccount } from '@/features/carrier-rates/actions';
import {
  createBill, addPayment, deleteBill, deletePayment,
  listBills, listPaymentsForAccount, toSummaryInputs, type UploadFile,
} from '@/features/carrier-rates/ap/bills-actions';
import { summariseAp } from '@/features/carrier-rates/ap/ap-summary';
import { systemTotalForPeriod, systemAllTimeTotal } from '@/features/carrier-rates/ap/period-compare';
import { BillsBoard } from '@/components/carrier-rates/BillsBoard';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';

export const dynamic = 'force-dynamic';

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

async function fileFromForm(form: FormData, field: string): Promise<UploadFile | null> {
  const f = form.get(field);
  if (!(f instanceof File) || f.size === 0) return null;
  const bytes = new Uint8Array(await f.arrayBuffer());
  return { bytes, filename: f.name, contentType: f.type || 'application/octet-stream' };
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

  const [bills, payments, allTime] = await Promise.all([
    listBills(id), listPaymentsForAccount(id), systemAllTimeTotal(id),
  ]);
  const inputs = toSummaryInputs(bills, payments);
  const summary = summariseAp(inputs.bills, inputs.payments, todayIso());

  // Per-bill system total for the period (statement-vs-lines compare).
  const periodTotals = await Promise.all(
    bills.map((b) => systemTotalForPeriod(id, b.periodStart, b.periodEnd)),
  );
  const systemByBill: Record<string, number> = {};
  bills.forEach((b, i) => { systemByBill[b.id] = periodTotals[i].systemTotal; });

  const currency = account.costCurrency ?? 'VND';

  // ── Server actions ──
  async function createBillAction(formData: FormData) {
    'use server';
    const num = (k: string) => { const v = String(formData.get(k) ?? '').replace(/[^\d.-]/g, ''); return v ? Number(v) : 0; };
    const str = (k: string) => { const v = String(formData.get(k) ?? '').trim(); return v || null; };
    await createBill({
      carrierAccountId: id,
      billNumber: str('billNumber'),
      periodStart: String(formData.get('periodStart')),
      periodEnd: String(formData.get('periodEnd')),
      issueDate: str('issueDate'),
      dueDate: str('dueDate'),
      amount: num('amount'),
      currency,
      note: str('note'),
      userId: session!.user.id,
      file: await fileFromForm(formData, 'file'),
    });
    revalidatePath(`/f/carrier-rates/${id}/bills`);
  }

  async function addPaymentAction(formData: FormData) {
    'use server';
    const num = (k: string) => { const v = String(formData.get(k) ?? '').replace(/[^\d.-]/g, ''); return v ? Number(v) : 0; };
    const str = (k: string) => { const v = String(formData.get(k) ?? '').trim(); return v || null; };
    await addPayment({
      billId: String(formData.get('billId')),
      paidAt: String(formData.get('paidAt')),
      amount: num('amount'),
      method: str('method'),
      note: str('note'),
      userId: session!.user.id,
      proof: await fileFromForm(formData, 'proof'),
    });
    revalidatePath(`/f/carrier-rates/${id}/bills`);
  }

  async function deleteBillAction(billId: string) {
    'use server';
    await deleteBill(billId);
    revalidatePath(`/f/carrier-rates/${id}/bills`);
  }

  async function deletePaymentAction(paymentId: string) {
    'use server';
    await deletePayment(paymentId);
    revalidatePath(`/f/carrier-rates/${id}/bills`);
  }

  const fmt = (n: number) => `${Math.round(n).toLocaleString('vi-VN')} ${currency}`;

  return (
    <div className="px-6 md:px-10 py-8 md:py-12 space-y-10">
      <Link href={`/f/carrier-rates/${id}`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ChevronLeft className="size-4" />
        {account.name}
      </Link>

      <header className="space-y-3">
        <div className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <Wallet className="size-3.5" /> Công nợ carrier
        </div>
        <h1 className="text-4xl md:text-5xl font-semibold tracking-tight">Quản trị công nợ</h1>
        <p className="text-sm text-muted-foreground max-w-xl">
          Upload hoá đơn carrier theo kỳ và bằng chứng thanh toán để nắm công nợ thực với đối tác.
        </p>
      </header>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-border rounded-2xl overflow-hidden border border-border">
        <StatTile label="Đã bill" value={fmt(summary.totalBilled)} sub={`${bills.length} hoá đơn`} />
        <StatTile label="Đã thanh toán" value={fmt(summary.totalPaid)} />
        <StatTile label="Còn nợ" value={fmt(summary.totalOutstanding)} accent={summary.totalOutstanding > 0} />
        <StatTile label="Quá hạn" value={fmt(summary.overdueAmount)} sub={`${summary.overdueCount} hoá đơn`} danger={summary.overdueCount > 0} />
      </div>

      {/* Reference: all-time system charge vs paid (NOT the official bill-based debt) */}
      <div className="rounded-xl border border-dashed border-border bg-muted/20 px-4 py-3">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">
          Tham chiếu nhanh — theo số hệ thống ghi nhận (chưa qua hoá đơn carrier)
        </div>
        <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
          <span>Hệ thống đã charge (all-time): <b className="tabular-nums">{fmt(allTime.systemTotal)}</b> <span className="text-muted-foreground">· {allTime.shipmentCount.toLocaleString('vi-VN')} đơn</span></span>
          <span>Đã thanh toán: <b className="tabular-nums">{fmt(summary.totalPaid)}</b></span>
          <span>Công nợ ước tính: <b className={'tabular-nums ' + (allTime.systemTotal - summary.totalPaid > 0 ? 'text-amber-600 dark:text-amber-400' : '')}>{fmt(Math.max(0, allTime.systemTotal - summary.totalPaid))}</b></span>
        </div>
        <p className="text-[11px] text-muted-foreground mt-1.5">
          Con số ước tính từ chi phí hệ thống tính, chỉ để tham khảo. Công nợ chính thức (cards trên) tính từ hoá đơn carrier bạn upload.
        </p>
      </div>

      {/* Upload bill */}
      {canManage && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Thêm hoá đơn</h2>
          <Card>
            <CardContent className="p-5">
              <form action={createBillAction} className="grid grid-cols-2 md:grid-cols-4 gap-4 items-end">
                <Field label="Mã hoá đơn"><Input name="billNumber" placeholder="INV-..." /></Field>
                <Field label="Số tiền *"><Input name="amount" required inputMode="numeric" placeholder="0" /></Field>
                <Field label="Kỳ từ *"><Input name="periodStart" type="date" required /></Field>
                <Field label="Kỳ đến *"><Input name="periodEnd" type="date" required /></Field>
                <Field label="Ngày xuất"><Input name="issueDate" type="date" /></Field>
                <Field label="Hạn thanh toán"><Input name="dueDate" type="date" /></Field>
                <Field label="File hoá đơn"><Input name="file" type="file" accept=".pdf,.xlsx,.xls,.png,.jpg,.jpeg" /></Field>
                <Field label="Ghi chú"><Input name="note" placeholder="—" /></Field>
                <div className="col-span-2 md:col-span-4">
                  <Button type="submit" size="sm">Lưu hoá đơn</Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </section>
      )}

      <BillsBoard
        accountId={id}
        currency={currency}
        canManage={canManage}
        bills={bills}
        payments={payments}
        summaryBills={summary.bills}
        systemByBill={systemByBill}
        addPaymentAction={addPaymentAction}
        deleteBillAction={deleteBillAction}
        deletePaymentAction={deletePaymentAction}
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
