'use client';

import { useState, useTransition } from 'react';
import { backfillMmpOrders } from '@/features/mmp/order-backfill';

/** Operator-triggered: đẩy các đơn có dòng brand sang MMP. Nhập N để test một
 *  phần trước (để trống = đẩy tất cả). Idempotent (MMP dedupe). */
export function MmpBackfillButton() {
  const [pending, startTransition] = useTransition();
  const [limit, setLimit] = useState('');
  const [result, setResult] = useState<string | null>(null);

  function run() {
    setResult(null);
    const n = limit.trim() ? Math.max(0, Math.floor(Number(limit))) : undefined;
    if (limit.trim() && (n === undefined || Number.isNaN(n))) {
      setResult('N không hợp lệ.');
      return;
    }
    startTransition(async () => {
      try {
        const r = await backfillMmpOrders({ limit: n });
        setResult(`Đã đẩy ${r.pushed} · bỏ qua ${r.skipped} · lỗi ${r.failed} (tổng eligible ${r.total.toLocaleString('vi-VN')}).`);
      } catch {
        setResult('Lỗi khi đẩy sang MMP.');
      }
    });
  }

  return (
    <div className="flex items-center gap-2">
      {result && <span className="text-xs text-muted-foreground">{result}</span>}
      <input
        type="number"
        min={0}
        value={limit}
        onChange={(e) => setLimit(e.target.value)}
        placeholder="N (trống = tất cả)"
        className="w-36 rounded border border-border bg-background px-2 py-1 text-sm"
        disabled={pending}
      />
      <button
        onClick={run}
        disabled={pending}
        className="rounded border border-border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
      >
        {pending ? 'Đang đẩy…' : 'Đẩy đơn brand → MMP'}
      </button>
    </div>
  );
}
