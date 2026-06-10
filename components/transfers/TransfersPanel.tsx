'use client';

import { useState, useTransition } from 'react';
import { createTransfer, markInTransit, markReceived, cancelTransfer } from '@/features/transfers/actions';

type Warehouse = { id: string; code: string; name: string };
type Line = { sku: string; qty: number; productTitle: string | null };
type Transfer = {
  id: string; code: string; status: string; fromCode: string; toCode: string;
  note: string | null; sentAt: Date | null; receivedAt: Date | null; lines: Line[];
};

interface Props { warehouses: Warehouse[]; transfers: Transfer[]; canManage: boolean; }

const STATUS_LABEL: Record<string, string> = { draft: 'Nháp', in_transit: 'Đang chuyển', received: 'Đã nhận', cancelled: 'Đã hủy' };

export function TransfersPanel({ warehouses, transfers, canManage }: Props) {
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [note, setNote] = useState('');
  const [rows, setRows] = useState<{ sku: string; qty: string }[]>([{ sku: '', qty: '' }]);
  const [isPending, startTransition] = useTransition();

  const setRow = (i: number, patch: Partial<{ sku: string; qty: string }>) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const handleCreate = () => startTransition(async () => {
    await createTransfer({
      fromWarehouseId: fromId, toWarehouseId: toId, note: note || null,
      lines: rows.filter((r) => r.sku.trim() && Number(r.qty) > 0).map((r) => ({ sku: r.sku.trim(), qty: Number(r.qty) })),
    });
    setFromId(''); setToId(''); setNote(''); setRows([{ sku: '', qty: '' }]);
  });

  return (
    <div className="space-y-8">
      {canManage && (
        <div className="rounded-lg border border-border p-4 space-y-3">
          <h2 className="text-sm font-semibold">Phiếu chuyển kho mới</h2>
          <div className="flex flex-wrap items-end gap-2">
            <label className="space-y-1">
              <span className="block text-xs uppercase tracking-wider text-muted-foreground">Từ kho</span>
              <select value={fromId} onChange={(e) => setFromId(e.target.value)} className="border border-input bg-input/30 rounded-md px-2 py-1.5 text-sm">
                <option value="">—</option>
                {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}
              </select>
            </label>
            <label className="space-y-1">
              <span className="block text-xs uppercase tracking-wider text-muted-foreground">Đến kho</span>
              <select value={toId} onChange={(e) => setToId(e.target.value)} className="border border-input bg-input/30 rounded-md px-2 py-1.5 text-sm">
                <option value="">—</option>
                {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}
              </select>
            </label>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ghi chú" className="flex-1 border border-input bg-input/30 rounded-md px-3 py-1.5 text-sm" />
          </div>
          <div className="space-y-2">
            {rows.map((r, i) => (
              <div key={i} className="flex items-center gap-2">
                <input value={r.sku} onChange={(e) => setRow(i, { sku: e.target.value })} placeholder="SKU" className="flex-1 border border-input bg-input/30 rounded-md px-2 py-1 text-sm" />
                <input value={r.qty} onChange={(e) => setRow(i, { qty: e.target.value })} placeholder="SL" inputMode="numeric" className="w-24 border border-input bg-input/30 rounded-md px-2 py-1 text-sm" />
                {i === rows.length - 1 && (
                  <button onClick={() => setRows((rs) => [...rs, { sku: '', qty: '' }])} className="rounded border border-border px-2 py-1 text-xs hover:bg-muted">+ dòng</button>
                )}
              </div>
            ))}
          </div>
          <button disabled={isPending || !fromId || !toId} onClick={handleCreate} className="rounded border border-border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50">
            Tạo phiếu
          </button>
        </div>
      )}

      <div className="space-y-3">
        <h2 className="text-sm font-semibold">Phiếu ({transfers.length})</h2>
        {transfers.map((t) => (
          <div key={t.id} className="rounded-lg border border-border p-4 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-mono text-sm font-medium">{t.code} · {t.fromCode} → {t.toCode}</div>
              <span className="rounded bg-muted px-2 py-0.5 text-xs">{STATUS_LABEL[t.status] ?? t.status}</span>
            </div>
            <ul className="text-xs text-muted-foreground">
              {t.lines.map((l, i) => <li key={i} className="font-mono">{l.sku} ×{l.qty}</li>)}
            </ul>
            {canManage && (t.status === 'draft' || t.status === 'in_transit') && (
              <div className="flex flex-wrap items-center gap-2">
                {t.status === 'draft' && (
                  <button disabled={isPending} onClick={() => startTransition(async () => { await markInTransit(t.id); })} className="rounded border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50">Đánh dấu đã gửi</button>
                )}
                {t.status === 'in_transit' && (
                  <button disabled={isPending} onClick={() => startTransition(async () => { await markReceived(t.id); })} className="rounded border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50">Đánh dấu đã nhận</button>
                )}
                <button disabled={isPending} onClick={() => startTransition(async () => { await cancelTransfer(t.id); })} className="rounded border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50">Hủy</button>
              </div>
            )}
          </div>
        ))}
        {transfers.length === 0 && <p className="text-sm text-muted-foreground">Chưa có phiếu chuyển kho.</p>}
      </div>
    </div>
  );
}
