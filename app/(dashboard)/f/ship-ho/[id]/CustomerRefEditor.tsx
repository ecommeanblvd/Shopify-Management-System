'use client';
import { useState } from 'react';
import { updateShipHoCustomerRef } from '@/features/ship-ho/orders-actions';

/** Sửa "Mã đơn gốc" (reference của brand) tại chỗ — lưu xong tự đẩy sang MMP. */
export function CustomerRefEditor({ orderId, customerRef }: { orderId: string; customerRef: string | null }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(customerRef ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!editing) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className={customerRef ? '' : 'text-muted-foreground'}>{customerRef ?? 'chưa có'}</span>
        <button onClick={() => setEditing(true)} className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted" title="Sửa mã đơn gốc (reference của brand)">✎ sửa</button>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <input
        value={value} onChange={(e) => { setValue(e.target.value); setErr(null); }}
        placeholder="#KLS2001" autoFocus
        className="w-36 rounded border border-border bg-background px-1.5 py-0.5 text-xs"
        onKeyDown={(e) => { if (e.key === 'Escape') setEditing(false); }}
      />
      <button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          const r = await updateShipHoCustomerRef(orderId, value);
          setBusy(false);
          if (r.ok) setEditing(false);
          else setErr(r.error ?? 'Lỗi');
        }}
        className="rounded bg-primary px-2 py-0.5 text-[10px] font-medium text-primary-foreground disabled:opacity-50"
      >{busy ? '…' : 'Lưu'}</button>
      <button onClick={() => setEditing(false)} className="text-[10px] text-muted-foreground hover:underline">huỷ</button>
      {err && <span className="text-[10px] text-red-500">{err}</span>}
    </span>
  );
}
