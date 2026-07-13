'use client';
import { useState } from 'react';
import Link from 'next/link';
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
  structure: ShipHoPriceStructure | null;
}

const vnd = (v: number | null) => (v == null ? '—' : Math.round(v).toLocaleString('vi-VN'));
const signed = (v: number | null) => (v == null ? '—' : `${v > 0 ? '+' : ''}${vnd(v)}`);

/** Bảng đơn đã đối soát: click 1 dòng → mở chi tiết từng khoản charge 3 phía. */
export function ReconciledRowsTable({ rows }: { rows: ReconciledRowData[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
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
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const open = openId === r.id;
            const kgDiff = r.billKg != null && r.billKg !== r.quoteKg;
            return (
              <RowGroup key={r.id} r={r} open={open} kgDiff={kgDiff}
                onToggle={() => setOpenId(open ? null : r.id)} />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RowGroup({ r, open, kgDiff, onToggle }: {
  r: ReconciledRowData; open: boolean; kgDiff: boolean; onToggle: () => void;
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
      </tr>
      {open && (
        <tr className="border-t border-border/40 bg-muted/20">
          <td colSpan={9} className="px-6 py-3">
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

/** Bảng con: từng khoản charge 3 phía + lệch bill (giống trang chi tiết đơn). */
function StructureDetail({ s }: { s: ShipHoPriceStructure }) {
  return (
    <table className="w-full max-w-3xl text-xs tabular-nums">
      <thead className="text-[10px] uppercase tracking-wide text-muted-foreground">
        <tr className="[&>th]:py-1.5 [&>th]:pr-4 [&>th]:font-medium">
          <th className="text-left">Khoản</th>
          <th className="text-right">Chi phí dự tính</th>
          <th className="text-right">Cước từ Carrier{s.billNumber ? ` · ${s.billNumber}` : ''}</th>
          <th className="text-right">Giá thu khách</th>
          <th className="text-right" title="Cước thực − dự tính theo từng khoản">Lệch bill</th>
        </tr>
      </thead>
      <tbody>
        <tr className="border-t border-border/40 text-muted-foreground [&>td]:py-1.5 [&>td]:pr-4">
          <td className="text-left">Cân tính phí (kg)</td>
          <td className="text-right">{s.weights.quoteKg ?? '—'}</td>
          <td className="text-right">{s.weights.billKg ?? '—'}</td>
          <td className="text-right">{s.weights.quoteKg ?? '—'}</td>
          <td className="text-right">—</td>
        </tr>
        {s.rows.map((row) => {
          const delta = row.costVnd != null && row.billVnd != null ? row.billVnd - row.costVnd : null;
          return (
            <tr key={row.label} className="border-t border-border/40 [&>td]:py-1.5 [&>td]:pr-4">
              <td className="text-left">
                {row.label}
                {row.percent != null && <span className="ml-1 text-[10px] text-muted-foreground">{row.percent}%</span>}
              </td>
              <td className="text-right">{vnd(row.costVnd)}</td>
              <td className="text-right">{vnd(row.billVnd)}</td>
              <td className="text-right">{vnd(row.chargeVnd)}</td>
              <td className={`text-right ${delta == null || delta === 0 ? 'text-muted-foreground' : delta > 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                {delta == null ? '—' : delta === 0 ? '0' : signed(delta)}
              </td>
            </tr>
          );
        })}
        <tr className="border-t border-border font-semibold [&>td]:py-1.5 [&>td]:pr-4">
          <td className="text-left">Tổng</td>
          <td className="text-right">{vnd(s.costTotal)}</td>
          <td className="text-right">{vnd(s.billTotal)}</td>
          <td className="text-right">{vnd(s.chargeTotal)}</td>
          <td className={`text-right ${s.billTotal != null && s.billTotal - s.costTotal > 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
            {s.billTotal == null ? '—' : signed(s.billTotal - s.costTotal)}
          </td>
        </tr>
      </tbody>
    </table>
  );
}
