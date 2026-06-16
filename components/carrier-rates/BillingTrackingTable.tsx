'use client';

import { Fragment, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, FileText, Search } from 'lucide-react';
import { InvoiceDetailModal } from './InvoiceDetailModal';
import type { BillRow, PaymentRow, BillLineRow } from '@/features/carrier-rates/ap/bills-actions';
import type { BillSummary } from '@/features/carrier-rates/ap/ap-summary';
import type { TrackingRow } from '@/features/carrier-rates/ap/tracking-rows';

interface Props {
  accountId: string;
  currency: string;
  canManage: boolean;
  rows: TrackingRow[];
  bills: BillRow[];
  payments: PaymentRow[];
  summaryBills: BillSummary[];
  listLines: (billId: string) => Promise<BillLineRow[]>;
  addPaymentAction: (formData: FormData) => Promise<void>;
  deleteBillAction: (billId: string) => Promise<void>;
  deletePaymentAction: (paymentId: string) => Promise<void>;
}

function statusBadge(r: TrackingRow): { label: string; cls: string } {
  if (r.status === 'paid') return { label: 'Đã trả', cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' };
  if (r.overdue) return { label: 'Quá hạn', cls: 'bg-red-500/15 text-red-700 dark:text-red-400' };
  if (r.status === 'partial') return { label: 'Một phần', cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-400' };
  return { label: 'Chưa trả', cls: 'bg-muted text-muted-foreground' };
}

export function BillingTrackingTable(props: Props) {
  const { accountId, currency, canManage, rows, bills, payments, summaryBills } = props;
  const [q, setQ] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<BillRow | null>(null);
  const fmt = (n: number | null | undefined) => (n == null ? '—' : Math.round(n).toLocaleString('vi-VN'));
  const billById = useMemo(() => new Map(bills.map((b) => [b.id, b])), [bills]);
  const sumById = useMemo(() => new Map(summaryBills.map((s) => [s.id, s])), [summaryBills]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) =>
      (r.trackingNumber ?? '').toLowerCase().includes(s) ||
      (r.orderNumber ?? '').toLowerCase().includes(s) ||
      (r.billNumber ?? '').toLowerCase().includes(s));
  }, [rows, q]);

  const toggle = (k: string) => setExpanded((p) => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n; });

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">Chưa có hoá đơn nào. Dùng nút “Thêm hoá đơn” bên trên.</p>;
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Theo tracking ({filtered.length})</h2>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm tracking / đơn / hoá đơn"
            className="w-64 rounded-md border border-border bg-background pl-8 pr-3 py-1.5 text-sm" />
        </div>
      </div>

      <div className="rounded-xl border border-border overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/30 text-[11px] uppercase tracking-wider text-muted-foreground">
              <th className="w-6" />
              <th className="px-3 py-2 text-left font-medium">Tracking</th>
              <th className="px-3 py-2 text-left font-medium">Đơn</th>
              <th className="px-3 py-2 text-left font-medium">Hoá đơn</th>
              <th className="px-3 py-2 text-left font-medium">Hạn TT</th>
              <th className="px-3 py-2 text-right font-medium">Phí (tổng)</th>
              <th className="px-3 py-2 text-center font-medium">Trạng thái</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.map((r) => {
              const b = statusBadge(r);
              const open = expanded.has(r.key);
              const bill = billById.get(r.billId) ?? null;
              return (
                <Fragment key={r.key}>
                  <tr className="hover:bg-muted/20">
                    <td className="pl-2 align-middle">
                      {r.hasDetail && (
                        <button type="button" onClick={() => toggle(r.key)} className="text-muted-foreground hover:text-foreground">
                          {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                        </button>
                      )}
                    </td>
                    <td className="px-3 py-2 font-medium tabular-nums">{r.trackingNumber ?? <span className="text-muted-foreground">(không chi tiết)</span>}</td>
                    <td className="px-3 py-2 text-muted-foreground">{r.orderNumber ?? '—'}</td>
                    <td className="px-3 py-2">
                      <button type="button" onClick={() => setSelected(bill)} disabled={!bill}
                        className="inline-flex items-center gap-1 text-primary hover:underline disabled:text-muted-foreground disabled:no-underline">
                        <FileText className="size-3.5" /> {r.billNumber ?? '—'}
                      </button>
                    </td>
                    <td className="px-3 py-2 tabular-nums">{r.dueDate ?? '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold">{fmt(r.total)}</td>
                    <td className="px-3 py-2 text-center">
                      <span className={`inline-block rounded px-2 py-0.5 text-[11px] font-medium ${b.cls}`}>{b.label}</span>
                    </td>
                  </tr>
                  {open && r.hasDetail && (
                    <tr className="bg-muted/10">
                      <td />
                      <td colSpan={6} className="px-3 py-2">
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                          {r.fees.map((f, i) => (
                            <span key={i}><span className="text-muted-foreground">{f.label}:</span> <span className="tabular-nums">{fmt(f.value)}</span></span>
                          ))}
                          {r.weightKg != null && r.weightKg > 0 && <span><span className="text-muted-foreground">Cân:</span> {r.weightKg} kg</span>}
                        </div>
                        {r.note && <p className="mt-1 text-[11px] text-muted-foreground">{r.note}</p>}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <InvoiceDetailModal
        accountId={accountId} currency={currency} canManage={canManage}
        bill={selected} summary={selected ? sumById.get(selected.id) : undefined}
        payments={payments} listLines={props.listLines}
        addPaymentAction={props.addPaymentAction} deletePaymentAction={props.deletePaymentAction}
        deleteBillAction={props.deleteBillAction} onClose={() => setSelected(null)}
      />
    </section>
  );
}
