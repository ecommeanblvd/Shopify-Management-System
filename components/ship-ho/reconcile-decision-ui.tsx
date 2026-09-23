'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { reconcileCellState } from '@/features/ship-ho/reconcile-decision';
import {
  shipHoFreightAndDutyRows, shipHoFreightSubtotal, shipHoFinalTotal,
  type ShipHoPriceStructure, type PriceStructureRow,
} from '@/features/ship-ho/price-structure';

/** Dữ liệu tối thiểu cho ô "Đối soát" + modal (dùng chung: table chính + trang reconcile). */
export interface ReconcileModalData {
  id: string;
  code: string;
  reconcileStatus: string | null;   // 'reconciled' | null
  reconcileDecision: string | null; // null | pending_review | accepted | claiming | claim_credited | claim_rejected
  hasTracking: boolean;
  estVnd: number | null;
  billVnd: number | null;
  deltaVnd: number | null;
  chargedVnd: number | null;
  actualChargedVnd: number | null;
  structure: ShipHoPriceStructure | null;
}

export interface ReconcileActions {
  acceptAction: (orderId: string) => Promise<void>;
  claimAction: (orderId: string, reason?: string) => Promise<void>;
  resolveAction: (orderId: string, credited: boolean) => Promise<void>;
}

export const vnd = (v: number | null) => (v == null ? '—' : Math.round(v).toLocaleString('vi-VN'));
export const signed = (v: number | null) => (v == null ? '—' : `${v > 0 ? '+' : ''}${vnd(v)}`);

const TONE: Record<string, string> = {
  none: 'text-muted-foreground',
  waiting: 'text-muted-foreground',
  done: 'text-emerald-600 dark:text-emerald-400',
  review: 'border border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-300 hover:bg-amber-500/20',
  claiming: 'border border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-300 hover:bg-amber-500/20',
};

/**
 * Ô "Đối soát": badge theo trạng thái. Khi cần xử lý (pending_review/claiming) →
 * là nút mở modal (chặn click-row). Tự quản modal accept/claim/resolve.
 */
export function ReconcileStatusCell({ row, actions }: { row: ReconcileModalData; actions: ReconcileActions }) {
  const [open, setOpen] = useState(false);
  const st = reconcileCellState(row.reconcileStatus, row.reconcileDecision, row.hasTracking);

  if (!st.actionable) {
    return <span className={`text-xs font-medium whitespace-nowrap ${TONE[st.kind]}`}>{st.label}</span>;
  }
  return (
    <>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        className={`rounded-md px-2.5 py-1 text-xs font-medium whitespace-nowrap ${TONE[st.kind]}`}
      >
        {st.label}
      </button>
      <DecisionModal row={open ? row : null} onClose={() => setOpen(false)} actions={actions} />
    </>
  );
}

/** Modal đối soát: so 3 phía + accept/claim (pending_review) hoặc kết luận (claiming). */
export function DecisionModal({ row, onClose, actions }: {
  row: ReconcileModalData | null;
  onClose: () => void;
  actions: ReconcileActions;
}) {
  const router = useRouter();
  const [reason, setReason] = useState('');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const resolveMode = row?.reconcileDecision === 'claiming';

  const run = (fn: () => Promise<void>) => {
    setError(null);
    startTransition(async () => {
      try {
        await fn();
        setReason('');
        onClose();
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Có lỗi xảy ra.');
      }
    });
  };

  const open = row !== null;
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { setReason(''); setError(null); onClose(); } }}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{resolveMode ? 'Kết luận claim' : 'Đối soát'} — đơn {row?.code}</DialogTitle>
          <DialogDescription>
            {resolveMode ? (
              <>Đơn đang chờ claim carrier. <b>Được credit</b> = carrier hoàn tiền chênh; <b>Bị từ chối</b> =
              carrier không hoàn. Cả hai đều chốt giá thu khách theo bill thực và đẩy sang MMP.</>
            ) : (
              <>So sánh chi phí dự tính với cước bill thực. Lệch do lỗi nội bộ → <b>Chấp nhận</b> (đẩy giá thu
              chính thức sang MMP). Lệch cần đòi carrier → <b>Claim</b> (đơn sang “đợi claim”, giá thu GIỮ nguyên).</>
            )}
          </DialogDescription>
        </DialogHeader>

        {row && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
              <span>Chi phí dự tính: <b className="tabular-nums">{vnd(row.estVnd)}</b></span>
              <span>Cước bill thực: <b className="tabular-nums text-sky-700 dark:text-sky-400">{vnd(row.billVnd)}</b></span>
              <span>Lệch: <b className={`tabular-nums ${row.deltaVnd != null && row.deltaVnd > 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>{signed(row.deltaVnd)}</b></span>
            </div>

            {row.structure ? (
              <div className="rounded-lg border border-border p-3 overflow-x-auto">
                <StructureDetail s={row.structure} />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Thiếu breakdown báo giá cho đơn này.</p>
            )}

            {!resolveMode && (
              <label className="block space-y-1">
                <span className="text-xs uppercase tracking-wider text-muted-foreground">Lý do (tuỳ chọn — gửi kèm khi Claim)</span>
                <input
                  type="text"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="vd: FedEx tính sai residential / dư phụ phí…"
                  className="w-full h-9 border border-input bg-input/30 rounded-md px-3 text-sm"
                  disabled={pending}
                />
              </label>
            )}

            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        )}

        <DialogFooter className="flex-row justify-end gap-2 pt-2">
          {resolveMode ? (
            <>
              <Button type="button" variant="outline" size="sm" disabled={pending || !row}
                onClick={() => row && run(() => actions.resolveAction(row.id, false))}>
                Claim bị từ chối
              </Button>
              <Button type="button" size="sm" disabled={pending || !row}
                onClick={() => row && run(() => actions.resolveAction(row.id, true))}>
                {pending ? 'Đang xử lý…' : 'Được credit'}
              </Button>
            </>
          ) : (
            <>
              <Button type="button" variant="outline" size="sm" disabled={pending || !row}
                onClick={() => row && run(() => actions.claimAction(row.id, reason))}>
                Claim đơn vị vận chuyển
              </Button>
              <Button type="button" size="sm" disabled={pending || !row}
                onClick={() => row && run(() => actions.acceptAction(row.id))}>
                {pending ? 'Đang xử lý…' : 'Chấp nhận sai lệch (lỗi nội bộ)'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Bảng con: từng khoản charge 3 phía + lệch bill (dùng ở modal + inline expand,
 * cả trang danh sách lẫn trang đối soát — chỉ MỘT bản dựng bảng, dùng chung).
 * Reading order (CEO 23/09, khớp trang chi tiết): freight rows → "Tổng cước"
 * (subtotal, KHÔNG gồm duty) → dòng duty riêng → "Tổng cuối" (cước + duty).
 * 6 cột, KHÔNG có cột margin (bảng rút gọn cho modal — xem trang chi tiết nếu
 * cần margin từng dòng).
 */
export function StructureDetail({ s }: { s: ShipHoPriceStructure }) {
  const { freightRows, dutyRow } = shipHoFreightAndDutyRows(s);
  const freightSubtotal = shipHoFreightSubtotal(s);
  const finalTotal = shipHoFinalTotal(s);

  const renderRow = (row: PriceStructureRow) => {
    const delta = row.quoteChargeVnd != null && row.chargeVnd != null ? row.chargeVnd - row.quoteChargeVnd : null;
    return (
      <tr key={row.label} className="border-t border-border/40 [&>td]:py-1.5 [&>td]:pr-4">
        <td className="text-left">{row.label}</td>
        <td className="text-right text-muted-foreground">
          {vnd(row.costVnd)}
          {/* % QUOTE (rate khoá lúc báo giá) cạnh cột chi phí dự tính. */}
          {row.percent != null && <span className="ml-1 text-[10px] text-muted-foreground/70">({row.percent}%)</span>}
        </td>
        <td className="text-right text-muted-foreground">
          {vnd(row.billVnd)}
          {/* % HIỆU LỰC trên bill (Change 1, 23/09) — chỉ hiện khi suy được đáng
              tin (xem `billPercent` trong price-structure.ts); rate đổi hàng
              tuần nên thường khác % quote bên trái, để so trực tiếp. */}
          {row.billPercent != null && <span className="ml-1 text-[10px] text-muted-foreground/70">({row.billPercent}%)</span>}
        </td>
        <td className="text-right">{vnd(row.quoteChargeVnd)}</td>
        <td className="text-right font-medium">{vnd(row.chargeVnd)}</td>
        <td className={`text-right ${delta == null || delta === 0 ? 'text-muted-foreground' : delta > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
          {delta == null ? '—' : delta === 0 ? '0' : signed(delta)}
        </td>
      </tr>
    );
  };

  const renderTotalRow = (label: string, t: { costVnd: number; billVnd: number | null; quoteChargeVnd: number; chargeVnd: number }, billLabel?: string | null) => {
    const delta = t.chargeVnd - t.quoteChargeVnd;
    return (
      <tr className="border-t border-border font-semibold [&>td]:py-1.5 [&>td]:pr-4">
        <td className="text-left">{label}</td>
        <td className="text-right text-muted-foreground">{vnd(t.costVnd)}</td>
        <td className="text-right text-muted-foreground">
          {billLabel && <span className="mr-1 text-[9px] font-normal text-muted-foreground/70">({billLabel})</span>}
          {vnd(t.billVnd)}
        </td>
        <td className="text-right">{vnd(t.quoteChargeVnd)}</td>
        <td className="text-right">{vnd(t.chargeVnd)}</td>
        <td className={`text-right ${delta > 0 ? 'text-emerald-600 dark:text-emerald-400' : delta < 0 ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground'}`}>
          {signed(delta)}
        </td>
      </tr>
    );
  };

  return (
    <table className="w-full text-xs tabular-nums">
      <thead className="text-[10px] uppercase tracking-wide text-muted-foreground">
        <tr className="[&>th]:py-1.5 [&>th]:pr-4 [&>th]:font-medium">
          <th className="text-left">Khoản</th>
          <th className="text-right">Chi phí dự tính</th>
          <th className="text-right">Cước từ Carrier</th>
          <th className="text-right" title="Giá quote lúc khách tạo vận đơn trên MMP">Giá thu dự tính</th>
          <th className="text-right" title="Tính lại theo bill (cân + phụ phí thực)">Giá thu thực</th>
          <th className="text-right" title="Giá thu thực − Giá thu dự tính">Lệch thu</th>
        </tr>
      </thead>
      <tbody>
        <tr className="border-t border-border/40 text-muted-foreground [&>td]:py-1.5 [&>td]:pr-4">
          <td className="text-left">Cân tính phí (kg)</td>
          <td className="text-right">{s.weights.quoteKg ?? '—'}</td>
          <td className="text-right">{s.weights.billKg ?? '—'}</td>
          <td className="text-right">{s.weights.quoteKg ?? '—'}</td>
          <td className="text-right">{s.weights.billKg ?? s.weights.quoteKg ?? '—'}</td>
          <td className="text-right">—</td>
        </tr>
        {freightRows.map(renderRow)}
        {renderTotalRow(freightSubtotal.label, freightSubtotal)}
        {dutyRow && renderRow(dutyRow)}
        {renderTotalRow(finalTotal.label, finalTotal, s.billNumber)}
      </tbody>
    </table>
  );
}
