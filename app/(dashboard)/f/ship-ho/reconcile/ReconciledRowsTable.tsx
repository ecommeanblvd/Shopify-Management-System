'use client';
import { useState } from 'react';
import Link from 'next/link';
import {
  ReconcileStatusCell, StructureDetail, vnd, signed,
  type ReconcileModalData, type ReconcileActions,
} from '@/components/ship-ho/reconcile-decision-ui';

/** Row bảng đối soát = dữ liệu modal (ReconcileModalData) + vài cột hiển thị riêng. */
export interface ReconciledRowData extends ReconcileModalData {
  trackingNumber: string | null;
  billNumber: string | null;
  quoteKg: number;
  billKg: number | null;
  marginVnd: number | null;
}

/** Bảng đơn đã đối soát: click 1 dòng → mở chi tiết từng khoản charge 3 phía.
 *  Cột "Đối soát" cuối: badge trạng thái + mở modal accept/claim/resolve. */
export function ReconciledRowsTable({ rows, ...actions }: { rows: ReconciledRowData[] } & ReconcileActions) {
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs tabular-nums xl:text-sm">
        <thead className="text-[11px] uppercase tracking-wide text-muted-foreground">
          <tr className="[&>th]:px-2 [&>th]:py-2 xl:[&>th]:px-3 [&>th]:font-medium">
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
                onToggle={() => setOpenId(open ? null : r.id)} actions={actions} />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RowGroup({ r, open, kgDiff, onToggle, actions }: {
  r: ReconciledRowData; open: boolean; kgDiff: boolean; onToggle: () => void; actions: ReconcileActions;
}) {
  return (
    <>
      <tr
        className="cursor-pointer border-t border-border/60 hover:bg-muted/40 [&>td]:px-2 [&>td]:py-2 xl:[&>td]:px-3"
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
        <td className="text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
          <ReconcileStatusCell row={r} actions={actions} />
        </td>
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
