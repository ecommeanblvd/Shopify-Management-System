'use client';
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
// CHỈ import type — cấu trúc giá tính ở page (RSC) rồi truyền xuống.
import type { ShipHoPriceStructure } from '@/features/ship-ho/price-structure';

export interface ReconciledRowData {
  id: string;
  code: string;
  trackingNumber: string | null;
  billNumber: string | null;
  quoteKg: number;
  billKg: number | null;
  estVnd: number | null;
  billVnd: number | null;
  deltaVnd: number | null;
  chargedVnd: number | null;
  actualChargedVnd: number | null;
  marginVnd: number | null;
  /** null | 'pending_review' | 'accepted' | 'claiming' */
  reconcileDecision: string | null;
  structure: ShipHoPriceStructure | null;
}

interface Props {
  rows: ReconciledRowData[];
  acceptAction: (orderId: string) => Promise<void>;
  claimAction: (orderId: string, reason?: string) => Promise<void>;
  resolveAction: (orderId: string, credited: boolean) => Promise<void>;
}

const vnd = (v: number | null) => (v == null ? '—' : Math.round(v).toLocaleString('vi-VN'));
const signed = (v: number | null) => (v == null ? '—' : `${v > 0 ? '+' : ''}${vnd(v)}`);

/** Bảng đơn đã đối soát: click 1 dòng → mở chi tiết từng khoản charge 3 phía.
 *  Cột Action cuối: đơn có sai lệch chờ duyệt → mở modal accept/claim. */
export function ReconciledRowsTable({ rows, acceptAction, claimAction, resolveAction }: Props) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [modalRow, setModalRow] = useState<ReconciledRowData | null>(null);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm tabular-nums">
        <thead className="text-[11px] uppercase tracking-wide text-muted-foreground">
          <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:font-medium">
            <th className="w-6" />
            <th className="text-left">Mã</th>
            <th className="text-left">Bill</th>
            <th className="text-right" title="Cân quote → cân bill">Cân (quote→bill)</th>
            <th className="text-right">Chi phí dự tính</th>
            <th className="text-right">Giá Bill</th>
            <th className="text-right" title="Giá Bill − Chi phí dự tính">Lệch bill</th>
            <th className="text-right" title="Tính lại theo cân nặng carrier bill — KHÔNG phải số bill">Giá thu thực</th>
            <th className="text-right" title="Giá thu thực − Giá Bill">Margin thực</th>
            <th className="text-right">Đối soát</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const open = openId === r.id;
            const kgDiff = r.billKg != null && r.billKg !== r.quoteKg;
            return (
              <RowGroup key={r.id} r={r} open={open} kgDiff={kgDiff}
                onToggle={() => setOpenId(open ? null : r.id)}
                onAction={() => setModalRow(r)} />
            );
          })}
        </tbody>
      </table>

      <DecisionModal
        row={modalRow}
        onClose={() => setModalRow(null)}
        acceptAction={acceptAction}
        claimAction={claimAction}
        resolveAction={resolveAction}
      />
    </div>
  );
}

/** Nhãn/badge cột Action theo trạng thái quyết định đối soát. */
function ActionCell({ r, onAction }: { r: ReconciledRowData; onAction: () => void }) {
  const d = r.reconcileDecision;
  if (d === 'accepted') {
    return <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">✓ Đã chấp nhận</span>;
  }
  if (d === 'claim_credited') {
    return <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">✓ Claim được credit</span>;
  }
  if (d === 'claim_rejected') {
    return <span className="text-xs font-medium text-muted-foreground">✓ Claim bị từ chối</span>;
  }
  // pending_review + claiming → nút mở modal (claiming để KẾT LUẬN credit/từ chối).
  if (d === 'pending_review' || d === 'claiming') {
    const label = d === 'claiming' ? '⏳ Đợi claim · kết luận' : 'Xử lý đối soát';
    return (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onAction(); }}
        className="rounded-md border border-amber-500/50 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-700 hover:bg-amber-500/20 dark:text-amber-300 whitespace-nowrap"
      >
        {label}
      </button>
    );
  }
  return <span className="text-xs text-muted-foreground">—</span>;
}

function RowGroup({ r, open, kgDiff, onToggle, onAction }: {
  r: ReconciledRowData; open: boolean; kgDiff: boolean; onToggle: () => void; onAction: () => void;
}) {
  return (
    <>
      <tr
        className="cursor-pointer border-t border-border/60 hover:bg-muted/40 [&>td]:px-3 [&>td]:py-2"
        onClick={onToggle}
        title="Click để xem chi tiết từng khoản"
      >
        <td className="text-center text-xs text-muted-foreground">{open ? '▾' : '▸'}</td>
        <td className="text-left">
          <Link
            href={`/f/ship-ho/${r.id}`}
            onClick={(e) => e.stopPropagation()}
            className="font-medium text-primary underline-offset-2 hover:underline"
          >
            {r.code}
          </Link>
          <div className="font-mono text-[10px] text-muted-foreground">{r.trackingNumber}</div>
        </td>
        <td className="text-left font-mono text-xs">{r.billNumber ?? '—'}</td>
        <td className={`text-right ${kgDiff ? 'font-medium text-amber-600 dark:text-amber-400' : ''}`}>
          {r.quoteKg} → {r.billKg ?? '—'} kg
        </td>
        <td className="text-right">{vnd(r.estVnd)}</td>
        <td className="text-right font-medium text-sky-700 dark:text-sky-400">{vnd(r.billVnd)}</td>
        <td className={`text-right ${r.deltaVnd != null && r.deltaVnd > 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
          {signed(r.deltaVnd)}
        </td>
        <td className="text-right">
          <div className="font-medium">{vnd(r.actualChargedVnd ?? r.chargedVnd)}</div>
          {r.actualChargedVnd != null && r.chargedVnd != null && Math.round(r.chargedVnd) !== Math.round(r.actualChargedVnd) && (
            <div className="text-[10px] leading-tight text-muted-foreground line-through">{vnd(r.chargedVnd)}</div>
          )}
        </td>
        <td className={`text-right font-semibold ${r.marginVnd != null && r.marginVnd < 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
          {signed(r.marginVnd)}
        </td>
        <td className="text-right whitespace-nowrap"><ActionCell r={r} onAction={onAction} /></td>
      </tr>
      {open && (
        <tr className="border-t border-border/40 bg-muted/20">
          <td colSpan={10} className="px-6 py-3">
            {r.structure == null ? (
              <p className="py-2 text-sm text-muted-foreground">Thiếu breakdown báo giá — mở trang chi tiết đơn để xem thêm.</p>
            ) : (
              <StructureDetail s={r.structure} />
            )}
          </td>
        </tr>
      )}
    </>
  );
}

/** Modal đối soát: so 3 phía + ô lý do + 2 nút chấp nhận (lỗi nội bộ) / claim carrier. */
function DecisionModal({ row, onClose, acceptAction, claimAction, resolveAction }: {
  row: ReconciledRowData | null;
  onClose: () => void;
  acceptAction: (orderId: string) => Promise<void>;
  claimAction: (orderId: string, reason?: string) => Promise<void>;
  resolveAction: (orderId: string, credited: boolean) => Promise<void>;
}) {
  const router = useRouter();
  const [reason, setReason] = useState('');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Đơn đang 'claiming' → modal ở chế độ KẾT LUẬN claim (credit/từ chối).
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
              <Button type="button" variant="outline" size="sm"
                disabled={pending || !row}
                onClick={() => row && run(() => resolveAction(row.id, false))}>
                Claim bị từ chối
              </Button>
              <Button type="button" size="sm"
                disabled={pending || !row}
                onClick={() => row && run(() => resolveAction(row.id, true))}>
                {pending ? 'Đang xử lý…' : 'Được credit'}
              </Button>
            </>
          ) : (
            <>
              <Button type="button" variant="outline" size="sm"
                disabled={pending || !row}
                onClick={() => row && run(() => claimAction(row.id, reason))}>
                Claim đơn vị vận chuyển
              </Button>
              <Button type="button" size="sm"
                disabled={pending || !row}
                onClick={() => row && run(() => acceptAction(row.id))}>
                {pending ? 'Đang xử lý…' : 'Chấp nhận sai lệch (lỗi nội bộ)'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Bảng con: từng khoản charge 3 phía + lệch bill (giống trang chi tiết đơn). */
function StructureDetail({ s }: { s: ShipHoPriceStructure }) {
  return (
    <table className="w-full text-xs tabular-nums">
      <thead className="text-[10px] uppercase tracking-wide text-muted-foreground">
        <tr className="[&>th]:py-1.5 [&>th]:pr-4 [&>th]:font-medium">
          <th className="text-left">Khoản</th>
          <th className="text-right">Chi phí dự tính</th>
          <th className="text-right">Cước từ Carrier{s.billNumber ? ` · ${s.billNumber}` : ''}</th>
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
        {s.rows.map((row) => {
          const delta = row.quoteChargeVnd != null && row.chargeVnd != null ? row.chargeVnd - row.quoteChargeVnd : null;
          return (
            <tr key={row.label} className="border-t border-border/40 [&>td]:py-1.5 [&>td]:pr-4">
              <td className="text-left">
                {row.label}
                {row.percent != null && <span className="ml-1 text-[10px] text-muted-foreground">{row.percent}%</span>}
              </td>
              <td className="text-right text-muted-foreground">{vnd(row.costVnd)}</td>
              <td className="text-right text-muted-foreground">{vnd(row.billVnd)}</td>
              <td className="text-right">{vnd(row.quoteChargeVnd)}</td>
              <td className="text-right font-medium">{vnd(row.chargeVnd)}</td>
              <td className={`text-right ${delta == null || delta === 0 ? 'text-muted-foreground' : delta > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                {delta == null ? '—' : delta === 0 ? '0' : signed(delta)}
              </td>
            </tr>
          );
        })}
        <tr className="border-t border-border font-semibold [&>td]:py-1.5 [&>td]:pr-4">
          <td className="text-left">Tổng</td>
          <td className="text-right text-muted-foreground">{vnd(s.costTotal)}</td>
          <td className="text-right text-muted-foreground">{vnd(s.billTotal)}</td>
          <td className="text-right">{vnd(s.quoteChargeTotal)}</td>
          <td className="text-right">{vnd(s.chargeTotal)}</td>
          <td className={`text-right ${s.chargeTotal - s.quoteChargeTotal > 0 ? 'text-emerald-600 dark:text-emerald-400' : s.chargeTotal - s.quoteChargeTotal < 0 ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground'}`}>
            {signed(s.chargeTotal - s.quoteChargeTotal)}
          </td>
        </tr>
      </tbody>
    </table>
  );
}
