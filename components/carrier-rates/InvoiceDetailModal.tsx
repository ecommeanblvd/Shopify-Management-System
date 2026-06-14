'use client';

import { useEffect, useState, useTransition } from 'react';
import { FileText, Loader2, Paperclip, Trash2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AddPaymentDialog } from './AddPaymentDialog';
import type { BillRow, PaymentRow, BillLineRow } from '@/features/carrier-rates/ap/bills-actions';
import type { BillSummary } from '@/features/carrier-rates/ap/ap-summary';

interface Props {
  accountId: string;
  currency: string;
  canManage: boolean;
  bill: BillRow | null;
  summary?: BillSummary;
  payments: PaymentRow[];
  listLines: (billId: string) => Promise<BillLineRow[]>;
  addPaymentAction: (formData: FormData) => Promise<void>;
  deletePaymentAction: (paymentId: string) => Promise<void>;
  deleteBillAction: (billId: string) => Promise<void>;
  onClose: () => void;
}

const COLS: Array<[keyof BillLineRow, string]> = [
  ['base', 'Giá gốc'], ['discount', 'Chiết khấu'], ['fuel', 'Fuel'],
  ['remote', 'Remote'], ['demand', 'Demand'], ['signature', 'Ký nhận'],
  ['vat', 'VAT'], ['other', 'Khác'], ['total', 'Tổng'],
];

/** Modal chi tiết 1 hoá đơn: bảng line-item theo shipment + danh sách thanh toán. */
export function InvoiceDetailModal(props: Props) {
  const { bill, summary, currency, accountId, canManage, payments } = props;
  const [lines, setLines] = useState<BillLineRow[] | null>(null);
  const [loading, startLoad] = useTransition();

  useEffect(() => {
    if (!bill) return;
    const billId = bill.id;
    startLoad(async () => setLines(await props.listLines(billId)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bill?.id]);

  const fmt = (n: number | null | undefined) => (n == null ? '—' : Math.round(n).toLocaleString('vi-VN'));
  const pays = bill ? payments.filter((p) => p.billId === bill.id) : [];

  return (
    <Dialog open={!!bill} onOpenChange={(o) => { if (!o) props.onClose(); }}>
      <DialogContent className="w-[95vw] max-w-5xl">
        {bill && (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-3 text-sm">
                <span>{bill.billNumber ?? '(không mã)'}</span>
                <span className="font-mono text-xs text-muted-foreground">{bill.periodStart} → {bill.periodEnd}</span>
                <span className="tabular-nums">{fmt(bill.amount)} {currency}</span>
                {summary && <span className="tabular-nums text-amber-600 dark:text-amber-400">còn nợ {fmt(summary.outstanding)}</span>}
                {bill.hasFile && (
                  <a href={`/f/carrier-rates/${accountId}/bills/${bill.id}/file`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded border border-border px-2 py-0.5 text-xs hover:bg-muted">
                    <FileText className="size-3.5" /> File gốc
                  </a>
                )}
              </DialogTitle>
            </DialogHeader>

            {/* Line items (parsed from the invoice file) */}
            <div className="space-y-2">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Chi tiết theo đơn</div>
              <div className="rounded-lg border border-border overflow-auto max-h-[50vh]">
                {loading || lines === null ? (
                  <div className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Đang tải…</div>
                ) : lines.length === 0 ? (
                  <div className="px-4 py-6 text-sm text-muted-foreground italic">
                    Chưa có chi tiết từng đơn — sẽ hiện khi parse file hoá đơn (PDF/Excel) bạn upload.
                  </div>
                ) : (
                  <table className="w-full text-xs">
                    <thead className="bg-muted/30 text-muted-foreground">
                      <tr>
                        <th className="px-2 py-1.5 text-left font-medium">Tracking</th>
                        <th className="px-2 py-1.5 text-left font-medium">Đơn</th>
                        <th className="px-2 py-1.5 text-right font-medium">Kg</th>
                        {COLS.map(([, label]) => <th key={label} className="px-2 py-1.5 text-right font-medium">{label}</th>)}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {lines.map((l) => (
                        <tr key={l.id} className="hover:bg-muted/20">
                          <td className="px-2 py-1.5 font-mono">{l.trackingNumber ?? '—'}</td>
                          <td className="px-2 py-1.5">{l.orderNumber ?? '—'}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{l.weightKg ?? '—'}</td>
                          {COLS.map(([k, label]) => <td key={label} className="px-2 py-1.5 text-right tabular-nums">{fmt(l[k] as number | null)}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            {/* Payments */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Thanh toán</div>
                {canManage && summary?.status !== 'paid' && (
                  <AddPaymentDialog billId={bill.id} outstanding={summary?.outstanding ?? bill.amount} currency={currency} addPaymentAction={props.addPaymentAction} />
                )}
              </div>
              {pays.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">Chưa có thanh toán.</p>
              ) : (
                <ul className="space-y-1">
                  {pays.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-3 text-xs rounded bg-muted/30 px-3 py-1.5">
                      <span><span className="font-mono tabular-nums">{fmt(p.amount)} {currency}</span> <span className="text-muted-foreground">· {p.paidAt}{p.method ? ` · ${p.method}` : ''}{p.note ? ` · ${p.note}` : ''}</span></span>
                      <span className="flex items-center gap-2 shrink-0">
                        {p.hasProof && (
                          <a href={`/f/carrier-rates/${accountId}/bills/payments/${p.id}/proof`} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground" title="Bằng chứng"><Paperclip className="size-3.5" /></a>
                        )}
                        {canManage && (
                          <form action={async () => { await props.deletePaymentAction(p.id); }}>
                            <button type="submit" className="text-muted-foreground hover:text-destructive" title="Xoá"><Trash2 className="size-3.5" /></button>
                          </form>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {canManage && (
              <div className="border-t border-border pt-2">
                <form action={async () => { await props.deleteBillAction(bill.id); props.onClose(); }}>
                  <button type="submit" className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-destructive">
                    <Trash2 className="size-3" /> Xoá hoá đơn này
                  </button>
                </form>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
