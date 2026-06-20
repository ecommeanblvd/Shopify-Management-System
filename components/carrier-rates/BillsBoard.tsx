'use client';

import { useState } from 'react';
import { FileText } from 'lucide-react';
import { InvoiceDetailModal } from './InvoiceDetailModal';
import type { BillRow, PaymentRow, BillLineRow } from '@/features/carrier-rates/ap/bills-actions';
import type { BillSummary } from '@/features/carrier-rates/ap/ap-summary';

interface Props {
  accountId: string;
  currency: string;
  canManage: boolean;
  bills: BillRow[];
  payments: PaymentRow[];
  summaryBills: BillSummary[];
  systemByBill: Record<string, number>;
  listLines: (billId: string) => Promise<BillLineRow[]>;
  addPaymentAction: (formData: FormData) => Promise<void>;
  deleteBillAction: (billId: string) => Promise<void>;
  deletePaymentAction: (paymentId: string) => Promise<void>;
}

const STATUS: Record<BillSummary['status'], { label: string; cls: string }> = {
  unpaid: { label: 'Chưa trả', cls: 'bg-muted text-muted-foreground' },
  partial: { label: 'Một phần', cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-400' },
  paid: { label: 'Đã trả đủ', cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' },
};

export function BillsBoard(props: Props) {
  const { accountId, currency, canManage, bills, payments, summaryBills, systemByBill } = props;
  const [selected, setSelected] = useState<BillRow | null>(null);
  const fmt = (n: number) => Math.round(n).toLocaleString('vi-VN');
  const sumById = new Map(summaryBills.map((s) => [s.id, s]));

  if (bills.length === 0) {
    return <p className="text-sm text-muted-foreground">Chưa có hoá đơn nào. Dùng form bên trên để thêm.</p>;
  }

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        Hoá đơn ({bills.length})
        {(() => { const miss = bills.filter((b) => !b.hasPdf).length; return miss > 0 ? (
          <span className="text-amber-600 dark:text-amber-400"> · {miss} bill chưa có PDF</span>
        ) : null; })()}
      </h2>
      <div className="rounded-xl border border-border overflow-hidden">
        <div className="grid grid-cols-12 gap-2 bg-muted/30 px-4 py-2 text-[11px] uppercase tracking-wider text-muted-foreground">
          <div className="col-span-3">Hoá đơn / kỳ</div>
          <div className="col-span-2 text-right">Số tiền</div>
          <div className="col-span-2 text-right">Còn nợ</div>
          <div className="col-span-2 text-right">So kỳ (hệ thống)</div>
          <div className="col-span-3 text-right">Trạng thái</div>
        </div>
        <ul className="divide-y divide-border">
          {bills.map((b) => {
            const s = sumById.get(b.id);
            const sysTotal = systemByBill[b.id] ?? 0;
            const periodDelta = b.amount - sysTotal;
            return (
              <li
                key={b.id}
                onClick={() => setSelected(b)}
                className="grid grid-cols-12 gap-2 px-4 py-3 items-center hover:bg-muted/20 cursor-pointer"
                title="Bấm để xem chi tiết hoá đơn"
              >
                <div className="col-span-3 min-w-0">
                  <div className="text-sm font-medium truncate">{b.billNumber ?? '(không mã)'}</div>
                  <div className="text-[11px] text-muted-foreground font-mono">{b.periodStart} → {b.periodEnd}{b.dueDate ? ` · hạn ${b.dueDate}` : ''}</div>
                </div>
                <div className="col-span-2 text-right text-sm tabular-nums">{fmt(b.amount)}</div>
                <div className={'col-span-2 text-right text-sm tabular-nums ' + ((s?.outstanding ?? 0) > 0 ? 'font-medium' : 'text-muted-foreground')}>{fmt(s?.outstanding ?? b.amount)}</div>
                <div className="col-span-2 text-right text-[12px] tabular-nums" title="Tổng hệ thống ghi nhận trong kỳ">
                  <span className="text-muted-foreground">{fmt(sysTotal)}</span>
                  {Math.abs(periodDelta) >= 1000 && (
                    <span className={periodDelta > 0 ? ' text-amber-600 dark:text-amber-400' : ' text-emerald-600 dark:text-emerald-400'}> ({periodDelta > 0 ? '+' : ''}{fmt(periodDelta)})</span>
                  )}
                </div>
                <div className="col-span-3 flex items-center justify-end gap-2">
                  {s?.overdue && <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-destructive/15 text-destructive">Quá hạn</span>}
                  {s && <span className={'rounded px-1.5 py-0.5 text-[10px] font-medium ' + STATUS[s.status].cls}>{STATUS[s.status].label}</span>}
                  {b.hasFile && (
                    <a
                      href={`/f/carrier-rates/${accountId}/bills/${b.id}/file`}
                      target="_blank" rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="text-muted-foreground hover:text-foreground" title="Mở file hoá đơn gốc"
                    >
                      <FileText className="size-4" />
                    </a>
                  )}
                  {b.hasPdf ? (
                    <a
                      href={`/f/carrier-rates/${accountId}/bills/${b.id}/pdf`}
                      target="_blank" rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="text-muted-foreground hover:text-foreground" title="Mở PDF hoá đơn"
                    >
                      <FileText className="size-4" />
                    </a>
                  ) : (
                    <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-amber-500/15 text-amber-600 dark:text-amber-400" title="Chưa đính PDF hoá đơn">⚠ chưa có PDF</span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <InvoiceDetailModal
        accountId={accountId}
        currency={currency}
        canManage={canManage}
        bill={selected}
        summary={selected ? sumById.get(selected.id) : undefined}
        payments={payments}
        listLines={props.listLines}
        addPaymentAction={props.addPaymentAction}
        deletePaymentAction={props.deletePaymentAction}
        deleteBillAction={props.deleteBillAction}
        onClose={() => setSelected(null)}
      />
    </section>
  );
}
