'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setShipHoDeliveryStatusManual, type ManualDeliveryStatus } from '@/features/ship-ho/tracking-actions';

/**
 * Update TAY trạng thái giao (khi auto-track chưa khả dụng). Đổi trạng thái →
 * server tự bắn event shipment.* sang MMP + nâng status đơn nếu delivered.
 */
export function ManualStatusControl({ orderId, current }: {
  orderId: string;
  current: string | null;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<ManualDeliveryStatus | ''>('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const save = () => start(async () => {
    if (!status) return;
    setMsg(null); setErr(null);
    const r = await setShipHoDeliveryStatusManual(orderId, status, status === 'delivered' ? `${date}T00:00:00+07:00` : undefined);
    if (!r.ok) { setErr(r.error ?? 'Lỗi'); return; }
    setMsg(status !== current ? 'Đã cập nhật — event đã gửi sang MMP.' : 'Đã cập nhật.');
    setStatus('');
    router.refresh();
  });

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted-foreground" title="Dùng khi tracking tự động chưa khả dụng — trạng thái sẽ tự đồng bộ sang MMP">Trạng thái giao:</span>
      <select className="rounded border border-border bg-background px-2 py-1 text-xs"
        value={status} onChange={(e) => setStatus(e.target.value as ManualDeliveryStatus | '')}>
        <option value="">— chọn trạng thái —</option>
        <option value="in_transit">Đang vận chuyển</option>
        <option value="out_for_delivery">Đang giao</option>
        <option value="delivered">Đã giao</option>
        <option value="exception">Sự cố</option>
      </select>
      {status === 'delivered' && (
        <input type="date" className="rounded border border-border bg-background px-2 py-1 text-xs"
          value={date} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setDate(e.target.value)} />
      )}
      <button type="button" disabled={pending || !status} onClick={save}
        className="rounded-md border border-border px-2.5 py-1 text-xs font-medium transition hover:bg-muted disabled:opacity-50">
        {pending ? 'Đang lưu…' : 'Lưu'}
      </button>
      {msg && <span className="text-xs text-emerald-600 dark:text-emerald-400">✓ {msg}</span>}
      {err && <span className="text-xs text-red-600 dark:text-red-400">{err}</span>}
    </div>
  );
}
