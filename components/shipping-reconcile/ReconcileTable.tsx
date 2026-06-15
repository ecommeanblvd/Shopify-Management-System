'use client';

import { useMemo, useState } from 'react';
import type { ReconcileViewRow, ReconcileStatus } from '@/features/shipments/reconcile-view';
import { isoToCountryName } from '@/features/shipments/country-name-to-iso';
import { ReconcileDetailPanel } from './ReconcileDetailPanel';
import { issueInfo } from './issue-label';
import { ReconcileIssuesModal, type OpenIssue } from './ReconcileIssuesModal';
import type { IssueReportRecord } from '@/features/shipments/issue-report-actions';
import type { CarrierErrorRow, CarrierErrorGroup } from '@/features/shipments/carrier-error-report';

const fmtVnd = (n: number | null): string =>
  n === null
    ? '—'
    : (n < 0 ? '-' : '') +
      new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(Math.abs(Math.round(n)));

/** Nhận diện vùng xa (ODA) cho 1 đơn theo engine/FedEx/bill. */
function remoteInfo(r: ReconcileViewRow): { text: string; tone: string } {
  const e = r.engineRemote ?? 0, b = r.billedRemote ?? 0, f = r.fedexQuote?.remote ?? 0;
  if (e > 0 || f > 0) {
    return {
      text: `Vùng xa (ODA): CÓ — engine ${fmtVnd(e)}đ` + (f ? `, FedEx ${fmtVnd(f)}đ` : '') + (b ? `, bill ${fmtVnd(b)}đ` : ''),
      tone: 'text-amber-600 dark:text-amber-400',
    };
  }
  if (b > 0) {
    return { text: `Vùng xa (ODA): bill thu ${fmtVnd(b)}đ nhưng hệ thống KHÔNG nhận diện — kiểm ODA list`, tone: 'text-red-600 dark:text-red-400' };
  }
  return { text: 'Vùng xa (ODA): không thuộc', tone: 'text-muted-foreground' };
}

/** Cột Nước: mã nước + (!) hover ra popover địa chỉ (tên nước, TP, zip, vùng xa). */
function CountryCell({ r }: { r: ReconcileViewRow }) {
  const rm = remoteInfo(r);
  const title = [
    `${isoToCountryName(r.shipCountry)} (${r.shipCountry || '—'})`,
    `Thành phố: ${r.shipCity ?? '—'}`, `Zipcode: ${r.shipPostcode ?? '—'}`, rm.text,
  ].join('\n');
  return (
    <td className="px-3 py-2">
      <span className="group/ci relative inline-flex items-center gap-1">
        {r.shipCountry}
        <span
          className="cursor-help rounded-full border border-border px-1 text-[9px] font-semibold leading-none text-muted-foreground group-hover/ci:border-foreground group-hover/ci:text-foreground"
          title={title}
          onClick={(e) => e.stopPropagation()}
        >
          !
        </span>
        <div className="invisible absolute left-0 top-full z-50 mt-1 w-64 rounded-md border border-border bg-popover p-3 text-left text-xs opacity-0 shadow-xl transition-opacity group-hover/ci:visible group-hover/ci:opacity-100">
          <div className="mb-1.5 text-sm font-semibold">
            {isoToCountryName(r.shipCountry)} <span className="font-mono text-xs text-muted-foreground">({r.shipCountry || '—'})</span>
          </div>
          <div className="space-y-1 font-sans">
            <div><span className="text-muted-foreground">Thành phố: </span>{r.shipCity ?? '—'}</div>
            <div><span className="text-muted-foreground">Zipcode: </span>{r.shipPostcode ?? '—'}</div>
            <div className={`pt-1 ${rm.tone}`}>{rm.text}</div>
          </div>
        </div>
      </span>
    </td>
  );
}

type CarrierFilter = 'all' | 'fedex' | 'dhl';
type StatusFilter = 'all' | 'pending' | 'reconciled' | 'ignored' | 'carrier_error' | 'disputing';

/** Ngưỡng "khớp hoàn toàn" — trùng ngưỡng KHỚP của engine (lệch nhỏ do làm tròn). */
const MATCH_TOLERANCE_VND = 1000;
/** Đơn pending NHƯNG lệch < ngưỡng → coi như tự đối soát (không cần người xác nhận). */
function isAutoReconciled(r: ReconcileViewRow): boolean {
  if (r.status !== 'pending') return false;
  // Khớp khi: (a) lệch tuyệt đối nhỏ, HOẶC (b) diagnose đã giải thích toàn bộ
  // lệch là PASS-THROUGH hợp lệ — phí opt-in (ký nhận when_billed) hóa đơn thu
  // thêm, KHÔNG phải lỗi. Trước đây chỉ xét (a) nên khi signature chuyển sang
  // when_billed, engine thấp hơn billed ~143k ⇒ mọi đơn có ký nhận bị tính lệch.
  if (Math.abs(r.deltaVnd ?? 0) < MATCH_TOLERANCE_VND) return true;
  return r.diagnosis?.severity === 'passthrough' || r.diagnosis?.severity === 'match';
}
/** Trạng thái HIỆU DỤNG cho view: đơn khớp-pending tính là 'reconciled' (auto). */
function effStatus(r: ReconcileViewRow): ReconcileStatus {
  return isAutoReconciled(r) ? 'reconciled' : r.status;
}

interface Props {
  rows: ReconcileViewRow[];
  reports: IssueReportRecord[];
  carrierErrors: CarrierErrorRow[];
  carrierErrorGroups: CarrierErrorGroup[];
}

function deltaClass(pct: number | null): string {
  if (pct === null) return '';
  const a = Math.abs(pct);
  if (a > 25) return 'text-red-600 dark:text-red-400';
  if (a > 10) return 'text-amber-600 dark:text-amber-400';
  return 'text-muted-foreground';
}

export function ReconcileTable({ rows, reports, carrierErrors, carrierErrorGroups }: Props) {
  const [carrier, setCarrier] = useState<CarrierFilter>('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [country, setCountry] = useState('');
  const [minPct, setMinPct] = useState('');
  const [q, setQ] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 100;

  // Đổi filter -> về trang 0, reset NGAY TRONG render (pattern "adjusting
  // state during render" của React) thay vì effect để khỏi render thừa.
  const filterKey = `${carrier}|${status}|${country}|${minPct}|${q}`;
  const [prevFilterKey, setPrevFilterKey] = useState(filterKey);
  if (prevFilterKey !== filterKey) {
    setPrevFilterKey(filterKey);
    setPage(0);
  }

  const filtered = useMemo(() => {
    const minAbs = minPct ? Number(minPct) : null;
    const needle = q.trim().toLowerCase();
    return rows
      .filter((r) => carrier === 'all' || r.carrierKey === carrier)
      .filter((r) => status === 'all' || effStatus(r) === status)
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
    let billed = 0, engine = 0, over10 = 0, pendingCount = 0, disputingCount = 0;
    for (const r of filtered) {
      billed += r.billedTotal;
      engine += r.engineTotal ?? 0;
      const isPending = effStatus(r) === 'pending';
      // "Đơn lệch >10%": chỉ đếm đơn CÒN pending (chưa khớp/duyệt), bỏ qua
      // pass-through đã giải thích — tránh phình do opt-in ký nhận.
      if (isPending && r.deltaPct !== null && Math.abs(r.deltaPct) > 10) over10 += 1;
      if (isPending) pendingCount += 1;
      if (r.status === 'disputing') disputingCount += 1;
    }
    const delta = billed - engine;
    const pct = billed > 0 ? (delta / billed) * 100 : 0;
    return { billed, engine, delta, pct, over10, pendingCount, disputingCount, n: filtered.length };
  }, [filtered]);

  // Logistics to-check list: PENDING rows with an actionable issue, grouped
  // by issue signature. Lives behind the "Vấn đề & Report" modal — an issue
  // becomes a persistent report only after Logistics confirms the fix.
  const openIssues = useMemo<OpenIssue[]>(() => {
    const groups = new Map<string, OpenIssue>();
    for (const r of rows) {
      if (r.status !== 'pending') continue;
      const info = issueInfo(r);
      if (!info.groupKey || !info.action) continue;
      const g = groups.get(info.groupKey) ?? {
        groupKey: info.groupKey, carrierKey: r.carrierKey || null,
        label: info.label, action: info.action, count: 0, sumDelta: 0, samples: [],
      };
      g.count += 1;
      g.sumDelta += r.deltaVnd ?? 0;
      if (g.samples.length < 4) g.samples.push(r.orderNumber);
      groups.set(info.groupKey, g);
    }
    return [...groups.values()].sort((a, b) => Math.abs(b.sumDelta) - Math.abs(a.sumDelta));
  }, [rows]);

  // Render only the current page — 2,500+ rows at once costs ~30k DOM
  // nodes and seconds of mount time. Filters/summary still cover the
  // FULL set; only painting is windowed.
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const visible = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

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
        <Stat label="Σ Lệch" value={`${fmtVnd(summary.delta)} đ`} sub={`${summary.pct.toFixed(2)}%`} />
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
          <option value="carrier_error">Lỗi carrier</option>
          <option value="disputing">Đang đòi NCC</option>
        </select>
        <input value={country} onChange={(e) => setCountry(e.target.value)} placeholder="Nước (vd SA)" className="w-28 rounded border border-border bg-background px-2 py-1" />
        <input value={minPct} onChange={(e) => setMinPct(e.target.value)} placeholder="Lệch ≥ %" className="w-24 rounded border border-border bg-background px-2 py-1" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm order / tracking" className="w-48 rounded border border-border bg-background px-2 py-1" />
        <div className="ml-auto flex items-center gap-2">
          <ReconcileIssuesModal openIssues={openIssues} reports={reports}
            carrierErrors={carrierErrors} carrierErrorGroups={carrierErrorGroups} />
          <a href={exportHref} className="rounded border border-border px-3 py-1 hover:bg-muted">Export CSV</a>
        </div>
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
              <th className="px-3 py-2 text-left whitespace-nowrap" title="Ngày tạo label/ship — quyết định kỳ giá xăng dầu & phụ phí áp dụng">Ngày ship</th>
              <th className="px-3 py-2 text-right" title="Cân đơn hàng sync từ Shopify (tổng cân variant)">KG Shopify</th>
              <th className="px-3 py-2 text-right" title="Cân thực tế trên cân (file ops)">KG cân</th>
              <th className="px-3 py-2 text-right" title="Cân carrier tính phí: max(cân thực, dim) + làm tròn bậc">KG bill</th>
              <th className="px-3 py-2 text-right">Billed</th>
              <th className="px-3 py-2 text-right">Hệ thống</th>
              <th className="px-3 py-2 text-right">Lệch</th>
              <th className="px-3 py-2 text-right">Δ%</th>
              <th className="px-3 py-2 text-left">Trạng thái</th>
            </tr>
          </thead>
          <tbody className="font-mono tabular-nums">
            {visible.map((r) => (
              <FragmentRow
                key={r.shipmentId}
                r={r}
                expanded={expanded === r.shipmentId}
                onToggle={() => setExpanded(expanded === r.shipmentId ? null : r.shipmentId)}
              />
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={13} className="px-3 py-6 text-center text-muted-foreground font-sans">Không có đơn nào khớp bộ lọc.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pager */}
      {filtered.length > PAGE_SIZE && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Hiển thị {safePage * PAGE_SIZE + 1}–{Math.min((safePage + 1) * PAGE_SIZE, filtered.length)} / {filtered.length} đơn
          </span>
          <span className="flex items-center gap-1">
            <button type="button" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}
              className="rounded border border-border px-2.5 py-1 hover:bg-muted disabled:opacity-40">‹ Trước</button>
            <span className="px-2 font-mono tabular-nums">{safePage + 1}/{totalPages}</span>
            <button type="button" disabled={safePage >= totalPages - 1} onClick={() => setPage(safePage + 1)}
              className="rounded border border-border px-2.5 py-1 hover:bg-muted disabled:opacity-40">Sau ›</button>
          </span>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 whitespace-nowrap font-mono tabular-nums font-semibold">
        {value}
        {sub && <span className="ml-1 text-xs font-normal text-muted-foreground">({sub})</span>}
      </div>
    </div>
  );
}

const OPERATOR_STATUS: Record<Exclude<ReconcileStatus, 'pending'>, { label: string; className: string }> = {
  reconciled: { label: 'Đã đối soát', className: 'border border-emerald-500/40 text-emerald-600 dark:text-emerald-400' },
  ignored: { label: 'Bỏ qua', className: 'border border-border text-muted-foreground' },
  carrier_error: { label: 'Lỗi carrier', className: 'border border-amber-500/40 text-amber-600 dark:text-amber-400' },
  disputing: { label: 'Đang đòi NCC', className: 'border border-sky-500/40 text-sky-600 dark:text-sky-400' },
};

function FragmentRow({
  r, expanded, onToggle,
}: {
  r: ReconcileViewRow;
  expanded: boolean;
  onToggle: () => void;
}) {
  const issue = issueInfo(r);
  return (
    <>
      <tr className="cursor-pointer border-t border-border hover:bg-muted/30" onClick={onToggle}>
        <td className="px-3 py-2 font-sans">{r.orderNumber}</td>
        <td className="px-3 py-2">{r.trackingNumber}</td>
        <td className="px-3 py-2 font-sans">{r.carrierKey}</td>
        <CountryCell r={r} />
        <td className="px-3 py-2 whitespace-nowrap tabular-nums">{r.labelDate ? new Date(r.labelDate).toLocaleDateString('vi-VN') : '—'}</td>
        <td className="px-3 py-2 text-right text-muted-foreground">{r.shopifyWeightKg ?? '—'}</td>
        <td className="px-3 py-2 text-right">{r.weightKg ?? '—'}</td>
        <td className="px-3 py-2 text-right">
          {r.chargeableKg === null ? '—' : (
            <span
              className={r.weightKg !== null && r.chargeableKg > r.weightKg ? 'text-amber-600 dark:text-amber-400' : undefined}
              title={r.weightKg !== null && r.chargeableKg > r.weightKg ? 'Bị đội bậc do dim weight / làm tròn carrier' : undefined}
            >
              {r.chargeableKg}
            </span>
          )}
        </td>
        <td className="px-3 py-2 text-right">{fmtVnd(r.billedTotal)}</td>
        <td className="px-3 py-2 text-right">{fmtVnd(r.engineTotal)}</td>
        <td className={`px-3 py-2 text-right ${deltaClass(r.deltaPct)}`}>{fmtVnd(r.deltaVnd)}</td>
        <td className={`px-3 py-2 text-right ${deltaClass(r.deltaPct)}`}>{r.deltaPct !== null ? `${r.deltaPct.toFixed(1)}` : '—'}</td>
        <td className="px-3 py-2 font-sans whitespace-nowrap">
          <span className="inline-flex flex-col items-start gap-0.5">
            {isAutoReconciled(r) ? (
              <span className="rounded bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">Tự đối soát</span>
            ) : r.status === 'pending' ? (
              <span className={`rounded px-2 py-0.5 text-xs font-medium ${issue.className}`}>{issue.label}</span>
            ) : (
              <>
                <span className={`rounded px-2 py-0.5 text-xs font-medium ${OPERATOR_STATUS[r.status].className}`}>
                  {OPERATOR_STATUS[r.status].label}
                  {r.billedChangedSinceReview ? ' ⚠' : ''}
                </span>
                {r.staleDispute && (
                  <span
                    className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400"
                    title="Δ hiện tại đã về ~0 (engine cập nhật sau lúc duyệt) — NCC tính đúng, nên rút khiếu nại"
                  >
                    Δ về 0 · nên rút
                  </span>
                )}
              </>
            )}
            {r.demandUncovered && (
              <span
                className="rounded bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-medium text-rose-700 dark:text-rose-400"
                title={`Bill có phí Demand (${fmtVnd(r.billedDemand)}) nhưng engine áp 0 — nước "${r.shipCountry}" chưa nằm trong country_codes của dòng demand nào. Bổ sung config.`}
              >
                Demand thiếu config ({r.shipCountry})
              </span>
            )}
            {r.fedexCompare?.overcharged && (
              <span
                className="rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] font-medium text-red-700 dark:text-red-400"
                title={`So giá hợp đồng NCC (API): ${r.fedexCompare.verdict}`}
              >
                NCC thu cao +{fmtVnd(r.fedexCompare.totalDelta)}
              </span>
            )}
          </span>
        </td>
      </tr>
      {expanded && (
        <tr className="border-t border-border bg-muted/10">
          <td colSpan={13}><ReconcileDetailPanel row={r} /></td>
        </tr>
      )}
    </>
  );
}
