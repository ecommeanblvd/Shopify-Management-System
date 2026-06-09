'use client';

import { useState, useTransition } from 'react';
import { runBackfillFulfillment } from '@/features/fulfillment/actions';

/** Operator-triggered backfill: creates order_fulfillment records for orders
 *  that predate the feature (idempotent — safe to run repeatedly). */
export function BackfillButton() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<string | null>(null);

  function run() {
    setResult(null);
    startTransition(async () => {
      try {
        const n = await runBackfillFulfillment();
        setResult(`Đã quét ${n.toLocaleString('vi-VN')} đơn.`);
      } catch {
        setResult('Lỗi khi backfill.');
      }
    });
  }

  return (
    <div className="flex items-center gap-2">
      {result && <span className="text-xs text-muted-foreground">{result}</span>}
      <button
        onClick={run}
        disabled={pending}
        className="rounded border border-border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
      >
        {pending ? 'Đang backfill…' : 'Backfill đơn cũ'}
      </button>
    </div>
  );
}
