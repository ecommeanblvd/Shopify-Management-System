'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { reconcileShipHoFromCarrierBills, type RebillSummary } from '@/features/ship-ho/reconcile-actions';

/**
 * Nút "Đối soát từ hóa đơn carrier": kéo cân/cước/phụ phí thực từ carrier_bill_lines
 * theo tracking → re-bill giá thu thực theo cân thực. Hiện tóm tắt sau khi chạy.
 */
export function ReconcileBillsButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<RebillSummary | null>(null);

  const run = () => start(async () => {
    const r = await reconcileShipHoFromCarrierBills();
    setResult(r);
    router.refresh();
  });

  return (
    <div className="relative">
      <button type="button" onClick={run} disabled={pending}
        className="inline-flex h-9 items-center rounded-md border border-border px-3 text-sm font-medium transition hover:bg-muted disabled:opacity-50">
        {pending ? 'Đang đối soát…' : '↻ Đối soát từ hóa đơn carrier'}
      </button>
      {result && (
        <div className="absolute right-0 z-20 mt-1 w-72 rounded-md border border-border bg-background p-3 text-xs shadow-lg">
          <div className="mb-1 font-semibold">Kết quả đối soát</div>
          <div className="flex justify-between"><span className="text-muted-foreground">Đơn có tracking</span><span>{result.totalWithTracking}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Khớp hóa đơn</span><span className="font-medium text-emerald-600 dark:text-emerald-400">{result.matched}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Re-bill giá thu thực</span><span>{result.requoted}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Chưa có hóa đơn</span><span>{result.unmatched}</span></div>
          {result.errors.length > 0 && (
            <div className="mt-1 border-t border-border pt-1 text-amber-600 dark:text-amber-400">
              {result.errors.slice(0, 5).map((e, i) => <div key={i}>{e.code}: {e.reason}</div>)}
            </div>
          )}
          <button type="button" onClick={() => setResult(null)} className="mt-2 text-muted-foreground underline">Đóng</button>
        </div>
      )}
    </div>
  );
}
