'use client';

import { Fragment, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, FileText, Search } from 'lucide-react';
import { InvoiceDetailModal } from './InvoiceDetailModal';
import type { BillRow, PaymentRow, BillLineRow } from '@/features/carrier-rates/ap/bills-actions';
import type { BillSummary } from '@/features/carrier-rates/ap/ap-summary';
import type { TrackingRow } from '@/features/carrier-rates/ap/tracking-rows';
import { feeColumnRank, OTHER_LABEL } from '@/features/carrier-rates/ap/charge-classify';

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

// Cột phí gộp (data cũ) ưu tiên thứ tự này; tên khoản chi tiết (DHL) xếp sau theo thứ tự gặp.
const FEE_ORDER = ['Giá gốc', 'Chiết khấu', 'Fuel', 'Remote', 'Demand', 'Ký nhận', 'VAT', 'Khác'];

export function BillingTrackingTable(props: Props) {
  const { accountId, currency, canManage, rows, bills, payments, summaryBills } = props;
  const [q, setQ] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<BillRow | null>(null);
  const fmt = (n: number | null | undefined) => (n == null ? '—' : Math.round(n).toLocaleString('vi-VN'));
  const billById = useMemo(() => new Map(bills.map((b) => [b.id, b])), [bills]);
  const sumById = useMemo(() => new Map(summaryBills.map((s) => [s.id, s])), [summaryBills]);

  // Cột phí = HỢP mọi nhãn khoản xuất hiện (>0). Nhãn cột-gộp đứng trước theo
  // FEE_ORDER; nhãn chi tiết (tên khoản DHL) xếp sau theo thứ tự gặp.
  const feeCols = useMemo(() => {
    const seen = new Set<string>();
    for (const r of rows) for (const f of r.fees) if (f.value !== 0) seen.add(f.label);
    // Cột-gộp cũ (legacy) trước; khoản DHL chi tiết xếp theo rank; "Khác" luôn cuối.
    const legacy = FEE_ORDER.filter((l) => l !== OTHER_LABEL && seen.has(l));
    const dhl = [...seen]
      .filter((l) => !FEE_ORDER.includes(l))
      .sort((a, b) => feeColumnRank(a) - feeColumnRank(b) || a.localeCompare(b));
    const tail = seen.has(OTHER_LABEL) ? [OTHER_LABEL] : [];
    return [...legacy, ...dhl, ...tail];
  }, [rows]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) =>
      (r.trackingNumber ?? '').toLowerCase().includes(s) ||
      (r.orderNumber ?? '').toLowerCase().includes(s) ||
      (r.billNumber ?? '').toLowerCase().includes(s));
  }, [rows, q]);

  const toggle = (k: string) => setExpanded((p) => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const feeVal = (r: TrackingRow, label: string) => r.fees.find((f) => f.label === label)?.value ?? null;

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
              {feeCols.map((c) => <th key={c} className="px-3 py-2 text-right font-medium whitespace-nowrap">{c}</th>)}
              <th className="px-3 py-2 text-right font-medium">Tổng</th>
              <th className="px-3 py-2 text-center font-medium w-12">HĐ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.map((r) => {
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
                    <td className="px-3 py-2 font-medium tabular-nums whitespace-nowrap">{r.trackingNumber ?? <span className="text-muted-foreground">(không chi tiết)</span>}</td>
                    <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{r.orderNumber ?? '—'}</td>
                    {feeCols.map((c) => <td key={c} className="px-3 py-2 text-right tabular-nums">{fmt(feeVal(r, c))}</td>)}
                    <td className="px-3 py-2 text-right tabular-nums font-semibold">{fmt(r.total)}</td>
                    <td className="px-3 py-2 text-center">
                      <button type="button" onClick={() => setSelected(bill)} disabled={!bill}
                        title={r.billNumber ? `Hoá đơn ${r.billNumber}` : 'Không có hoá đơn'}
                        className="text-primary hover:text-primary/80 disabled:text-muted-foreground/40">
                        <FileText className="size-4" />
                      </button>
                    </td>
                  </tr>
                  {open && r.hasDetail && (
                    <tr className="bg-muted/10">
                      <td />
                      <td colSpan={feeCols.length + 4} className="px-3 py-2 space-y-1.5">
                        {r.breakdown.length > 0 && (
                          <div className="space-y-0.5">
                            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Đầy đủ các khoản (gồm thuế/duty)</p>
                            <div className="grid grid-cols-2 gap-x-6 gap-y-0.5 sm:grid-cols-3 max-w-3xl">
                              {r.breakdown.map((f, j) => (
                                <div key={j} className="flex items-baseline justify-between gap-2 text-[11px]">
                                  <span className="text-muted-foreground truncate">{f.label}</span>
                                  <span className="tabular-nums">{fmt(f.value)}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {r.note && <p className="text-[11px] text-muted-foreground">{r.note}</p>}
                        {r.weightKg != null && r.weightKg > 0 && <p className="text-[11px] text-muted-foreground">Cân: {r.weightKg} kg</p>}
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
