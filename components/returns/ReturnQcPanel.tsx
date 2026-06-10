'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { submitReturnQc, cancelReturn } from '@/features/returns/actions';

type Line = {
  id: string; shopifyLineId: string; sku: string | null; productTitle: string | null;
  variantTitle: string | null; returnedQty: number; passQty: number; failQty: number;
  failReason: string | null; restockedQty: number;
};
type Refund = { amount: string; refundedAt: Date; reason: string | null };

interface Props {
  returnId: string;
  status: string;
  refundFlag: 'refunded' | 'awaiting_refund' | 'none';
  refunds: Refund[];
  lines: Line[];
  canManage: boolean;
}

const FLAG_LABEL: Record<string, string> = { refunded: 'Đã refund trên Shopify', awaiting_refund: 'Đã nhận + QC pass nhưng Shopify chưa refund', none: 'Chưa có refund' };
const FLAG_CLASS: Record<string, string> = { refunded: 'text-emerald-600', awaiting_refund: 'text-amber-600 font-medium', none: 'text-muted-foreground' };

export function ReturnQcPanel({ returnId, status, refundFlag, refunds, lines, canManage }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [rows, setRows] = useState(lines.map((l) => ({
    lineId: l.id, passQty: String(l.passQty), failQty: String(l.failQty), failReason: l.failReason ?? '',
  })));
  const [error, setError] = useState<string | null>(null);

  const setRow = (i: number, patch: Partial<{ passQty: string; failQty: string; failReason: string }>) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const isOpen = status === 'open';

  const submit = () => startTransition(async () => {
    setError(null);
    try {
      await submitReturnQc({
        returnId,
        lines: rows.map((r) => ({
          lineId: r.lineId, passQty: Number(r.passQty || 0), failQty: Number(r.failQty || 0),
          failReason: r.failReason || null,
        })),
      });
      router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : 'Lỗi không xác định'); }
  });

  const cancel = () => startTransition(async () => {
    setError(null);
    try { await cancelReturn(returnId); router.refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Lỗi không xác định'); }
  });

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-border p-4 space-y-1">
        <div className="text-sm font-semibold">Đối chiếu refund</div>
        <div className={`text-sm ${FLAG_CLASS[refundFlag]}`}>{FLAG_LABEL[refundFlag]}</div>
        {refunds.length > 0 && (
          <ul className="text-xs text-muted-foreground pt-1 space-y-0.5">
            {refunds.map((r, i) => (
              <li key={i}>{new Date(r.refundedAt).toLocaleDateString('vi-VN')} · {r.amount}{r.reason ? ` · ${r.reason}` : ''}</li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-lg border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="text-left px-3 py-2">Sản phẩm</th>
              <th className="text-right px-3 py-2">Trả về</th>
              <th className="text-right px-3 py-2">Đạt</th>
              <th className="text-right px-3 py-2">Hư</th>
              <th className="text-left px-3 py-2">Lý do hư</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {lines.map((l, i) => (
              <tr key={l.id}>
                <td className="px-3 py-2">
                  <div>{l.productTitle ?? '—'}{l.variantTitle ? ` · ${l.variantTitle}` : ''}</div>
                  <div className="text-xs text-muted-foreground">SKU {l.sku ?? '—'}{l.restockedQty > 0 ? ` · đã restock ${l.restockedQty}` : ''}</div>
                </td>
                <td className="px-3 py-2 text-right">{l.returnedQty}</td>
                <td className="px-3 py-2 text-right">
                  {isOpen && canManage ? (
                    <input type="number" min={0} max={l.returnedQty} value={rows[i].passQty}
                      onChange={(e) => setRow(i, { passQty: e.target.value })}
                      className="w-16 border border-input bg-input/30 rounded-md px-2 py-1 text-sm text-right" />
                  ) : l.passQty}
                </td>
                <td className="px-3 py-2 text-right">
                  {isOpen && canManage ? (
                    <input type="number" min={0} max={l.returnedQty} value={rows[i].failQty}
                      onChange={(e) => setRow(i, { failQty: e.target.value })}
                      className="w-16 border border-input bg-input/30 rounded-md px-2 py-1 text-sm text-right" />
                  ) : l.failQty}
                </td>
                <td className="px-3 py-2">
                  {isOpen && canManage ? (
                    <input value={rows[i].failReason} onChange={(e) => setRow(i, { failReason: e.target.value })}
                      placeholder="—" className="w-full border border-input bg-input/30 rounded-md px-2 py-1 text-sm" />
                  ) : (l.failReason ?? '—')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {error && <div className="text-sm text-red-600">{error}</div>}

      {isOpen && canManage && (
        <div className="flex items-center gap-2">
          <button onClick={submit} disabled={isPending}
            className="rounded-md bg-primary text-primary-foreground px-4 py-1.5 text-sm font-medium disabled:opacity-50">
            Hoàn tất QC (restock)
          </button>
          <button onClick={cancel} disabled={isPending}
            className="rounded-md border border-border px-4 py-1.5 text-sm disabled:opacity-50">Huỷ phiếu</button>
        </div>
      )}
      {status === 'completed' && <div className="text-sm text-emerald-600">Đã hoàn tất QC.</div>}
      {status === 'cancelled' && <div className="text-sm text-muted-foreground">Phiếu đã huỷ.</div>}
    </div>
  );
}
