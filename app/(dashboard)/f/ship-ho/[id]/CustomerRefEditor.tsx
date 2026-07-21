'use client';
import { useState } from 'react';
import { updateShipHoCustomerRef } from '@/features/ship-ho/orders-actions';

/** "Mã đơn gốc" (reference của brand): CHƯA có → nút thêm nổi bật (amber, dễ
 *  thấy); ĐÃ có → hiển thị cố định, không sửa nữa (chỉ đạo CEO 21/07 — ref là
 *  dữ liệu chốt một lần, tránh sửa nhầm sau khi đã đối soát với brand). */
export function CustomerRefEditor({ orderId, customerRef }: { orderId: string; customerRef: string | null }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(customerRef ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(customerRef);

  // ĐÃ có mã → khoá, hiển thị tĩnh.
  if (saved) {
    return <b className="text-foreground">{saved}</b>;
  }
  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        className="inline-flex items-center gap-1 rounded-md border border-amber-500/60 bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-700 hover:bg-amber-500/25 dark:text-amber-400"
        title="Đơn chưa có mã tham chiếu từ brand — bấm để thêm (sẽ tự đẩy sang MMP)"
      >
        ⚠ Thêm mã đơn gốc
      </button>
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
          const v = value.trim();
          if (!v) { setErr('Nhập mã trước khi lưu'); return; }
          setBusy(true);
          const r = await updateShipHoCustomerRef(orderId, v);
          setBusy(false);
          if (r.ok) { setSaved(v); setEditing(false); }
          else setErr(r.error ?? 'Lỗi');
        }}
        className="rounded bg-primary px-2 py-0.5 text-[10px] font-medium text-primary-foreground disabled:opacity-50"
      >{busy ? '…' : 'Lưu'}</button>
      <button onClick={() => setEditing(false)} className="text-[10px] text-muted-foreground hover:underline">huỷ</button>
      {err && <span className="text-[10px] text-red-500">{err}</span>}
    </span>
  );
}
