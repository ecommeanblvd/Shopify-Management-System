'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { ReconcileViewRow, ReconcileStatus } from '@/features/shipments/reconcile-view';
import { isAutoReconciled, MATCH_TOLERANCE_VND, effStatus, type ReconcileFilters, type ReconcileSummaryStat } from '@/features/shipments/reconcile-filter';
import { carrierWeightCell } from '@/features/shipments/reconcile-cells';
import { tenHang } from '@/lib/carriers/ten-hang';
import { isoToCountryName } from '@/features/shipments/country-name-to-iso';
import { ReconcileDetailPanel } from './ReconcileDetailPanel';
import { issueInfo } from './issue-label';

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
const ADDR_CLASS_LABEL: Record<string, string> = {
  RESIDENTIAL: '🏠 Nhà dân', BUSINESS: '🏢 Doanh nghiệp', MIXED: 'Hỗn hợp', UNKNOWN: 'Chưa rõ',
};
/** Dòng verify địa chỉ FedEx cho tooltip. */
function addrVerifyLine(r: ReconcileViewRow): string {
  if (!r.addrClass) return 'Verify địa chỉ: chưa verify';
  const parts = [ADDR_CLASS_LABEL[r.addrClass] ?? r.addrClass];
  if (r.addrDeliverable === false) parts.push('⚠ không giao được');
  else if (r.addrDeliverable) parts.push('✓ giao được');
  if (r.addrIssue) parts.push(r.addrIssue);
  return `Verify: ${parts.join(' · ')}`;
}

function CountryCell({ r }: { r: ReconcileViewRow }) {
  const rm = remoteInfo(r);
  const addr = addrVerifyLine(r);
  // CHỈ dùng popup tùy biến bên dưới — KHÔNG đặt thuộc tính `title` native ở đây,
  // nếu không trình duyệt vẽ thêm tooltip mặc định chồng lên popup (2 hộp đè nhau).
  return (
    <td className="px-3 py-2">
      <span className="group/ci relative inline-flex items-center gap-1">
        {r.shipCountry}
        <span
          className="cursor-help rounded-full border border-border px-1 text-[9px] font-semibold leading-none text-muted-foreground group-hover/ci:border-foreground group-hover/ci:text-foreground"
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
            <div className={`pt-1 ${r.addrDeliverable === false ? 'text-red-600 dark:text-red-400' : r.addrClass ? 'text-foreground' : 'text-muted-foreground'}`}>{addr}</div>
          </div>
        </div>
      </span>
    </td>
  );
}

const PAGE_SIZE = 100;

interface Props {
  /** Các hãng có thật trong dữ liệu, để dựng ô lọc. */
  hangCo: string[];
  /** Dòng của TRANG đang xem (đã lọc + slice phía server). */
  rows: ReconcileViewRow[];
  summary: ReconcileSummaryStat;
  totalPages: number;
  safePage: number;
  totalFiltered: number;
  filters: ReconcileFilters;
  pdfMap: Record<string, { accountId: string; billId: string }>;
  /** Số dòng tiền-billed (tính trên toàn bộ filteredRows phía server). */
  preBilledCounts: { awaiting_measurement: number; awaiting_billed: number };
}

/** Màu số LỆCH theo HƯỚNG (để rà soát): hệ thống CAO hơn billed (deltaVnd<0,
 *  vì delta=billed−engine) → XANH (an toàn). Hệ thống THẤP hơn (deltaVnd>0,
 *  NCC thu cao hơn dự tính) → ĐỎ (cần rà). Đơn đã khớp / pass-through → xám. */
function deltaDirClass(r: ReconcileViewRow): string {
  if (isAutoReconciled(r) || r.deltaVnd === null || Math.abs(r.deltaVnd) < MATCH_TOLERANCE_VND) {
    return 'text-muted-foreground';
  }
  return r.deltaVnd < 0
    ? 'text-emerald-600 dark:text-emerald-400'
    : 'text-red-600 dark:text-red-400';
}

export function ReconcileTable({ rows, summary, totalPages, safePage, totalFiltered, filters, hangCo, pdfMap, preBilledCounts }: Props) {
  const router = useRouter();
  const sp = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [expanded, setExpanded] = useState<string | null>(null);
  // Ô text: state cục bộ để gõ mượt; đẩy lên URL sau debounce 300ms (tránh
  // round-trip server mỗi ký tự). Dropdown/pager đẩy URL ngay.
  const [country, setCountry] = useState(filters.country);
  const [minPct, setMinPct] = useState(filters.minPct);
  const [q, setQ] = useState(filters.q);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function pushParams(patch: Record<string, string>, resetPage = true): void {
    const p = new URLSearchParams(sp?.toString() ?? '');
    for (const [k, v] of Object.entries(patch)) { if (v) p.set(k, v); else p.delete(k); }
    if (resetPage) p.delete('page');
    p.delete('refresh');
    startTransition(() => router.replace(`?${p.toString()}`, { scroll: false }));
  }
  function debouncedPush(patch: Record<string, string>): void {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => pushParams(patch), 300);
  }

  return (
    <div className="space-y-3">
      {/* Dải số MỘT HÀNG — trước là năm thẻ lớn `grid` + một hàng riêng cho "chờ cân đo /
          chờ billed", cộng lại ~110px chỉ để nói bảy con số (CEO 20/10/2026: "chỗ cần làm
          việc bị tụt hẳn xuống dưới"). Vẫn đủ bảy con số và nhãn của chúng, bỏ khung thẻ và
          phần đệm. Σ Lệch to hơn bốn cái kia vì đó là con số người ta soi. */}
      <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 rounded-lg border border-border px-3 py-2">
        <So nhan="Σ Billed" giaTri={`${fmtVnd(summary.billed)} đ`} />
        <So nhan="Σ Hệ thống" giaTri={`${fmtVnd(summary.engine)} đ`} />
        <So nhan="Σ Lệch" giaTri={`${fmtVnd(summary.delta)} đ`} sub={`${summary.pct.toFixed(2)}%`} noiBat />
        <So nhan="Đơn lệch >10%" giaTri={String(summary.over10)} />
        <So nhan="Chưa đối soát" giaTri={String(summary.pendingCount)} />
        {/* Hai số tiền-billed: nhập vào dải số chứ không chiếm một hàng riêng. Giữ dáng mờ
            vì đây là đơn CHƯA có gì để đối soát, không phải số để soi. */}
        {preBilledCounts.awaiting_measurement > 0 && (
          <span className="text-xs text-muted-foreground">{preBilledCounts.awaiting_measurement} chờ cân đo</span>
        )}
        {preBilledCounts.awaiting_billed > 0 && (
          <span className="text-xs text-muted-foreground">{preBilledCounts.awaiting_billed} chờ billed</span>
        )}
      </div>

      {/* Filters */}
      <div className={`flex flex-wrap items-center gap-2 text-sm ${isPending ? 'opacity-60' : ''}`}>
        <select value={filters.carrier} onChange={(e) => pushParams({ carrier: e.target.value === 'all' ? '' : e.target.value })} className="rounded border border-border bg-background px-2 py-1">
          <option value="all">Tất cả carrier</option>
          {/* Danh sách suy từ dữ liệu (xem `hangTrongDoiSoat`) — gõ cứng ở đây làm UPS biến mất. */}
          {hangCo.map((k) => <option key={k} value={k}>{tenHang(k)}</option>)}
        </select>
        <select value={filters.status} onChange={(e) => pushParams({ status: e.target.value === 'all' ? '' : e.target.value })} className="rounded border border-border bg-background px-2 py-1">
          <option value="all">Mọi trạng thái</option>
          <option value="pending">Chưa đối soát</option>
          <option value="reconciled">Đã đối soát</option>
          <option value="ignored">Bỏ qua</option>
          <option value="carrier_error">Lỗi carrier</option>
          <option value="disputing">Đang đòi NCC</option>
          <option value="internal_error">Lỗi nội bộ</option>
          <option value="credited">Đã thu hồi</option>
          <option value="accepted">Chấp nhận chênh lệch</option>
          <option value="awaiting_measurement">Chờ cân đo</option>
          <option value="awaiting_billed">Chờ billed</option>
        </select>
        <input value={country} onChange={(e) => { setCountry(e.target.value); debouncedPush({ country: e.target.value }); }} placeholder="Nước (vd SA)" className="w-28 rounded border border-border bg-background px-2 py-1" />
        <input value={minPct} onChange={(e) => { setMinPct(e.target.value); debouncedPush({ minPct: e.target.value }); }} placeholder="Lệch ≥ %" className="w-24 rounded border border-border bg-background px-2 py-1" />
        <input value={q} onChange={(e) => { setQ(e.target.value); debouncedPush({ q: e.target.value }); }} placeholder="Tìm order / tracking" className="w-48 rounded border border-border bg-background px-2 py-1" />
      </div>

      {/* Table */}
      <div className="overflow-auto max-h-[calc(100vh-180px)] rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-20 bg-muted text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Order</th>
              <th className="px-3 py-2 text-left">Tracking</th>
              <th className="px-3 py-2 text-left">CC</th>
              <th className="px-3 py-2 text-left">Nước</th>
              <th className="px-3 py-2 text-left whitespace-nowrap" title="Ngày tạo label/ship — quyết định kỳ giá xăng dầu & phụ phí áp dụng">Ngày ship</th>
              <th className="px-3 py-2 text-right" title="Cân đơn hàng sync từ Shopify (tổng cân variant)">KG Shopify</th>
              <th className="px-3 py-2 text-right" title="Cân thực tế trên cân (file ops)">KG cân</th>
              <th className="px-3 py-2 text-right" title="Cân dự kiến: engine max(cân thực, dim) + làm tròn bậc carrier — văn phòng kỳ vọng">KG dự kiến</th>
              <th className="px-3 py-2 text-right" title="Cân carrier THẬT tính phí trên hoá đơn (FBO/DHL); '—' nếu chưa import hoá đơn">KG carrier</th>
              <th className="px-3 py-2 text-right">Billed</th>
              <th className="px-3 py-2 text-right">Hệ thống</th>
              <th className="px-3 py-2 text-right">Lệch</th>
              <th className="px-3 py-2 text-right">Δ%</th>
              <th className="px-3 py-2 text-left">Trạng thái</th>
            </tr>
          </thead>
          <tbody className="font-mono tabular-nums">
            {rows.map((r) => (
              <FragmentRow
                key={r.shipmentId}
                r={r}
                expanded={expanded === r.shipmentId}
                onToggle={() => setExpanded(expanded === r.shipmentId ? null : r.shipmentId)}
                pdfMap={pdfMap}
              />
            ))}
            {totalFiltered === 0 && (
              <tr><td colSpan={14} className="px-3 py-6 text-center text-muted-foreground font-sans">Không có đơn nào khớp bộ lọc.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pager */}
      {totalFiltered > PAGE_SIZE && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Hiển thị {safePage * PAGE_SIZE + 1}–{Math.min((safePage + 1) * PAGE_SIZE, totalFiltered)} / {totalFiltered} đơn
          </span>
          <span className="flex items-center gap-1">
            <button type="button" disabled={safePage === 0 || isPending} onClick={() => pushParams({ page: String(safePage - 1) }, false)}
              className="rounded border border-border px-2.5 py-1 hover:bg-muted disabled:opacity-40">‹ Trước</button>
            <span className="px-2 font-mono tabular-nums">{safePage + 1}/{totalPages}</span>
            <button type="button" disabled={safePage >= totalPages - 1 || isPending} onClick={() => pushParams({ page: String(safePage + 1) }, false)}
              className="rounded border border-border px-2.5 py-1 hover:bg-muted disabled:opacity-40">Sau ›</button>
          </span>
        </div>
      )}
    </div>
  );
}

/** Một con số trong dải số: nhãn nhỏ + giá trị, nằm ngang, không khung thẻ. */
function So({ nhan, giaTri, sub, noiBat = false }: {
  nhan: string; giaTri: string; sub?: string;
  /** Σ Lệch — to và đậm hơn, vì đó là con số cả trang này tồn tại để nhìn. */
  noiBat?: boolean;
}) {
  return (
    <span className="inline-flex items-baseline gap-1.5 whitespace-nowrap">
      <span className="text-[11px] uppercase tracking-wider text-muted-foreground">{nhan}</span>
      <span className={`font-mono tabular-nums ${noiBat ? 'text-base font-semibold' : 'text-sm font-medium'}`}>
        {giaTri}
        {sub && <span className="ml-1 text-xs font-normal text-muted-foreground">({sub})</span>}
      </span>
    </span>
  );
}

const OPERATOR_STATUS: Record<Exclude<ReconcileStatus, 'pending'>, { label: string; className: string }> = {
  reconciled: { label: 'Đã đối soát', className: 'border border-emerald-500/40 text-emerald-600 dark:text-emerald-400' },
  ignored: { label: 'Bỏ qua', className: 'border border-border text-muted-foreground' },
  carrier_error: { label: 'Lỗi carrier', className: 'border border-amber-500/40 text-amber-600 dark:text-amber-400' },
  disputing: { label: 'Đang đòi NCC', className: 'border border-sky-500/40 text-sky-600 dark:text-sky-400' },
  internal_error: { label: 'Lỗi nội bộ', className: 'border border-amber-500/40 text-amber-600 dark:text-amber-400' },
  credited: { label: 'Đã thu hồi', className: 'border border-emerald-500/40 text-emerald-600 dark:text-emerald-400' },
  accepted: { label: 'Chấp nhận chênh lệch', className: 'border border-border text-muted-foreground' },
  awaiting_measurement: { label: 'Chờ cân đo', className: 'border border-border text-muted-foreground' },
  awaiting_billed: { label: 'Chờ billed', className: 'border border-sky-500/40 text-sky-600 dark:text-sky-400' },
};

function FragmentRow({
  r, expanded, onToggle, pdfMap,
}: {
  r: ReconcileViewRow;
  expanded: boolean;
  onToggle: () => void;
  pdfMap: Record<string, { accountId: string; billId: string }>;
}) {
  const issue = issueInfo(r);
  return (
    <>
      <tr className="cursor-pointer border-t border-border hover:bg-muted/30" onClick={onToggle}>
        <td className="px-3 py-2 font-sans">{r.orderNumber}</td>
        <td className="px-3 py-2">{r.trackingNumber}</td>
        <td className="px-3 py-2 font-sans">{r.carrierKey ? tenHang(r.carrierKey) : '—'}</td>
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
        <td className="px-3 py-2 text-right">
          {(() => {
            const c = carrierWeightCell(r.billedWeightKg, r.chargeableKg);
            if (c.text === '—') return '—';
            return (
              <span
                className={c.mismatch ? 'text-amber-600 dark:text-amber-400' : undefined}
                title={c.mismatch ? `Carrier tính khác văn phòng (dự kiến ${r.chargeableKg})` : undefined}
              >
                {c.text}
              </span>
            );
          })()}
        </td>
        <td className="px-3 py-2 text-right">{fmtVnd(r.billedTotal)}</td>
        <td className="px-3 py-2 text-right">{fmtVnd(r.engineTotal)}</td>
        <td className={`px-3 py-2 text-right font-medium ${deltaDirClass(r)}`}>{fmtVnd(r.deltaVnd)}</td>
        <td className={`px-3 py-2 text-right ${deltaDirClass(r)}`}>{r.deltaPct !== null ? `${r.deltaPct.toFixed(1)}` : '—'}</td>
        <td className="px-3 py-2 font-sans whitespace-nowrap">
          <span className="inline-flex flex-col items-start gap-0.5">
            {r.billedTotal === null ? (() => {
              const st = effStatus(r) as 'awaiting_measurement' | 'awaiting_billed';
              return (
                <span className={`rounded px-2 py-0.5 text-xs font-medium ${OPERATOR_STATUS[st].className}`}>
                  {OPERATOR_STATUS[st].label}
                </span>
              );
            })() : isAutoReconciled(r) ? (
              <span className="rounded bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">Tự đối soát</span>
            ) : r.status === 'pending' ? (
              <span className={`rounded px-2 py-0.5 text-xs font-medium ${issue.className}`}>{issue.label}</span>
            ) : r.staleDispute ? (
              // Đã từng đòi NCC nhưng Δ nay về ~0 → KHÔNG hiện "đòi NCC" (gây hiểu
              // lầm). Hiện "Đã khớp lại" + gợi ý rút khiếu nại chính thức.
              <>
                <span className="rounded bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                  Đã khớp lại
                </span>
                <span
                  className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400"
                  title="Δ hiện tại đã về ~0 (engine cập nhật sau lúc đòi) — NCC tính đúng. Bấm Hoàn tác để rút khiếu nại chính thức."
                >
                  Δ về 0 · nên rút đòi
                </span>
              </>
            ) : (
              <span className={`rounded px-2 py-0.5 text-xs font-medium ${OPERATOR_STATUS[r.status].className}`}>
                {OPERATOR_STATUS[r.status].label}
                {r.billedChangedSinceReview ? ' ⚠' : ''}
              </span>
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
          <td colSpan={14}>
            {pdfMap[r.shipmentId] && (
              <div className="flex items-center gap-2 border-b border-border px-4 py-2">
                <a
                  href={`/f/carrier-rates/${pdfMap[r.shipmentId].accountId}/bills/${pdfMap[r.shipmentId].billId}/pdf`}
                  target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded border border-border px-2 py-0.5 text-xs hover:bg-muted"
                >
                  Hoá đơn PDF
                </a>
              </div>
            )}
            <ReconcileDetailPanel row={r} />
          </td>
        </tr>
      )}
    </>
  );
}
