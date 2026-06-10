'use client';

import { useMemo, useState } from 'react';
import type { ReconcileViewRow, ReconcileStatus } from '@/features/shipments/reconcile-view';
import { setReconcileStatus, clearReconcileStatus } from '@/features/shipments/reconcile-status-actions';
import { ReconcileDetailPanel } from './ReconcileDetailPanel';

const fmtVnd = (n: number | null): string =>
  n === null
    ? '—'
    : (n < 0 ? '-' : '') +
      new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(Math.abs(Math.round(n)));

type CarrierFilter = 'all' | 'fedex' | 'dhl';
type StatusFilter = 'all' | 'pending' | 'reconciled' | 'ignored';

interface Props {
  rows: ReconcileViewRow[];
}

function deltaClass(pct: number | null): string {
  if (pct === null) return '';
  const a = Math.abs(pct);
  if (a > 25) return 'text-red-600 dark:text-red-400';
  if (a > 10) return 'text-amber-600 dark:text-amber-400';
  return 'text-muted-foreground';
}

export function ReconcileTable({ rows }: Props) {
  const [carrier, setCarrier] = useState<CarrierFilter>('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [country, setCountry] = useState('');
  const [minPct, setMinPct] = useState('');
  const [q, setQ] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const minAbs = minPct ? Number(minPct) : null;
    const needle = q.trim().toLowerCase();
    return rows
      .filter((r) => carrier === 'all' || r.carrierKey === carrier)
      .filter((r) => status === 'all' || r.status === status)
      .filter((r) => !country || r.shipCountry.toLowerCase() === country.toLowerCase())
      .filter((r) => minAbs === null || (r.deltaPct !== null && Math.abs(r.deltaPct) >= minAbs))
      .filter(
        (r) =>
          !needle ||
          r.orderNumber.toLowerCase().includes(needle) ||
          r.trackingNumber.toLowerCase().includes(needle),
      )
      .sort((a, b) => Math.abs(b.deltaVnd ?? 0) - Math.abs(a.deltaVnd ?? 0));
  }, [rows, carrier, status, country, minPct, q]);

  const summary = useMemo(() => {
    let billed = 0, engine = 0, over10 = 0, pendingCount = 0;
    for (const r of filtered) {
      billed += r.billedTotal;
      engine += r.engineTotal ?? 0;
      if (r.deltaPct !== null && Math.abs(r.deltaPct) > 10) over10 += 1;
      if (r.status === 'pending') pendingCount += 1;
    }
    const delta = billed - engine;
    const pct = billed > 0 ? (delta / billed) * 100 : 0;
    return { billed, engine, delta, pct, over10, pendingCount, n: filtered.length };
  }, [filtered]);

  async function mark(r: ReconcileViewRow, next: 'reconciled' | 'ignored') {
    setPending(r.shipmentId);
    try {
      if (r.status === next) {
        await clearReconcileStatus(r.shipmentId);
      } else {
        await setReconcileStatus({ shipmentId: r.shipmentId, status: next, billedTotal: r.billedTotal });
      }
    } finally {
      setPending(null);
    }
  }

  const exportHref = useMemo(() => {
    const p = new URLSearchParams();
    if (carrier !== 'all') p.set('carrier', carrier);
    if (country) p.set('country', country);
    return `/f/shipping-reconcile/export.csv${p.toString() ? `?${p}` : ''}`;
  }, [carrier, country]);

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="Σ Billed" value={`${fmtVnd(summary.billed)} đ`} />
        <Stat label="Σ Hệ thống" value={`${fmtVnd(summary.engine)} đ`} />
        <Stat label="Σ Lệch" value={`${fmtVnd(summary.delta)} đ (${summary.pct.toFixed(2)}%)`} />
        <Stat label="Đơn lệch >10%" value={String(summary.over10)} />
        <Stat label="Chưa đối soát" value={String(summary.pendingCount)} />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <select value={carrier} onChange={(e) => setCarrier(e.target.value as CarrierFilter)} className="rounded border border-border bg-background px-2 py-1">
          <option value="all">Tất cả carrier</option>
          <option value="fedex">FedEx</option>
          <option value="dhl">DHL</option>
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} className="rounded border border-border bg-background px-2 py-1">
          <option value="all">Mọi trạng thái</option>
          <option value="pending">Chưa đối soát</option>
          <option value="reconciled">Đã đối soát</option>
          <option value="ignored">Bỏ qua</option>
        </select>
        <input value={country} onChange={(e) => setCountry(e.target.value)} placeholder="Nước (vd SA)" className="w-28 rounded border border-border bg-background px-2 py-1" />
        <input value={minPct} onChange={(e) => setMinPct(e.target.value)} placeholder="Lệch ≥ %" className="w-24 rounded border border-border bg-background px-2 py-1" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm order / tracking" className="w-48 rounded border border-border bg-background px-2 py-1" />
        <a href={exportHref} className="ml-auto rounded border border-border px-3 py-1 hover:bg-muted">Export CSV</a>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Order</th>
              <th className="px-3 py-2 text-left">Tracking</th>
              <th className="px-3 py-2 text-left">CC</th>
              <th className="px-3 py-2 text-left">Nước</th>
              <th className="px-3 py-2 text-right">KG</th>
              <th className="px-3 py-2 text-right">Billed</th>
              <th className="px-3 py-2 text-right">Hệ thống</th>
              <th className="px-3 py-2 text-right">Lệch</th>
              <th className="px-3 py-2 text-right">Δ%</th>
              <th className="px-3 py-2 text-left">Trạng thái</th>
            </tr>
          </thead>
          <tbody className="font-mono tabular-nums">
            {filtered.map((r) => (
              <FragmentRow
                key={r.shipmentId}
                r={r}
                expanded={expanded === r.shipmentId}
                busy={pending === r.shipmentId}
                onToggle={() => setExpanded(expanded === r.shipmentId ? null : r.shipmentId)}
                onMark={mark}
              />
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={10} className="px-3 py-6 text-center text-muted-foreground font-sans">Không có đơn nào khớp bộ lọc.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 font-mono tabular-nums font-semibold">{value}</div>
    </div>
  );
}

function FragmentRow({
  r, expanded, busy, onToggle, onMark,
}: {
  r: ReconcileViewRow;
  expanded: boolean;
  busy: boolean;
  onToggle: () => void;
  onMark: (r: ReconcileViewRow, next: 'reconciled' | 'ignored') => void;
}) {
  const statusLabel: Record<ReconcileStatus, string> = {
    pending: 'Chưa', reconciled: 'Đã đối soát', ignored: 'Bỏ qua',
  };
  return (
    <>
      <tr className="cursor-pointer border-t border-border hover:bg-muted/30" onClick={onToggle}>
        <td className="px-3 py-2 font-sans">{r.orderNumber}</td>
        <td className="px-3 py-2">{r.trackingNumber}</td>
        <td className="px-3 py-2 font-sans">{r.carrierKey}</td>
        <td className="px-3 py-2">{r.shipCountry}</td>
        <td className="px-3 py-2 text-right whitespace-nowrap">
          {r.weightKg ?? '—'}
          {r.chargeableKg !== null && r.weightKg !== null && r.chargeableKg !== r.weightKg && (
            <span
              className={r.chargeableKg > r.weightKg ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}
              title="Cân tính phí (dim weight / làm tròn bậc carrier)"
            >
              {' → '}{r.chargeableKg}
            </span>
          )}
        </td>
        <td className="px-3 py-2 text-right">{fmtVnd(r.billedTotal)}</td>
        <td className="px-3 py-2 text-right">{fmtVnd(r.engineTotal)}</td>
        <td className={`px-3 py-2 text-right ${deltaClass(r.deltaPct)}`}>{fmtVnd(r.deltaVnd)}</td>
        <td className={`px-3 py-2 text-right ${deltaClass(r.deltaPct)}`}>{r.deltaPct !== null ? `${r.deltaPct.toFixed(1)}` : '—'}</td>
        <td className="px-3 py-2 font-sans" onClick={(e) => e.stopPropagation()}>
          <span className="mr-2">{statusLabel[r.status]}{r.billedChangedSinceReview ? ' ⚠' : ''}</span>
          <button disabled={busy} onClick={() => onMark(r, 'reconciled')} className="mr-1 rounded border border-border px-1.5 py-0.5 text-xs hover:bg-muted disabled:opacity-50">✓</button>
          <button disabled={busy} onClick={() => onMark(r, 'ignored')} className="rounded border border-border px-1.5 py-0.5 text-xs hover:bg-muted disabled:opacity-50">Bỏ qua</button>
        </td>
      </tr>
      {expanded && (
        <tr className="border-t border-border bg-muted/10">
          <td colSpan={10}><ReconcileDetailPanel row={r} /></td>
        </tr>
      )}
    </>
  );
}
