'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { STAGE_LABELS, STAGE_ORDER, delayTone, fmtDuration, type Tone } from '@/features/lifecycle/display';
import type { LifecycleListRow } from '@/features/lifecycle/queries';
import { Card, CardContent } from '@/components/ui/card';

const TONE: Record<Tone, string> = {
  ok: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  warn: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  bad: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  muted: 'bg-muted text-muted-foreground',
};

export function LifecycleTable({ rows, counts, activeStage, activeDelay }: {
  rows: LifecycleListRow[]; counts: Record<string, number>; activeStage: string | null; activeDelay: string | null;
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const setParam = (k: string, v: string | null) => {
    const q = new URLSearchParams(sp.toString());
    if (v == null || q.get(k) === v) q.delete(k); else q.set(k, v);
    router.push(`/f/lifecycle?${q.toString()}`);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {STAGE_ORDER.filter((s) => counts[s]).map((s) => (
          <button key={s} onClick={() => setParam('stage', s)}
            className={`rounded-full px-3 py-1 text-xs font-medium border ${activeStage === s ? 'bg-foreground text-background' : 'hover:bg-muted'}`}>
            {STAGE_LABELS[s]} · {counts[s]}
          </button>
        ))}
        <span className="mx-1 border-l" />
        {(['overdue', 'due_soon'] as const).map((d) => (
          <button key={d} onClick={() => setParam('delay', d)}
            className={`rounded-full px-3 py-1 text-xs font-medium border ${activeDelay === d ? 'bg-foreground text-background' : 'hover:bg-muted'}`}>
            {d === 'overdue' ? '🔴 Quá hạn' : '🟡 Sắp hạn'}
          </button>
        ))}
      </div>
      <Card><CardContent className="p-0 overflow-auto">
        <table className="w-full text-sm">
          <thead className="border-b text-muted-foreground">
            <tr className="[&>th]:text-left [&>th]:p-3">
              <th>Đơn</th><th>Store</th><th>Công đoạn</th><th>Đã ở</th><th>Trạng thái</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">Không có đơn khớp bộ lọc.</td></tr>
            ) : rows.map((r) => {
              const tone = delayTone(r.delayStatus);
              return (
                <tr key={r.orderId} className="border-b hover:bg-muted/40 [&>td]:p-3">
                  <td><Link href={`/f/lifecycle/${r.orderId}`} className="font-medium underline-offset-2 hover:underline">{r.orderNumber ?? r.orderId.slice(0, 8)}</Link>{r.exception && <span className="ml-1" title="Sự cố">⚠️</span>}</td>
                  <td>{r.storeName ?? '—'}</td>
                  <td>{STAGE_LABELS[r.currentStage as keyof typeof STAGE_LABELS] ?? r.currentStage}</td>
                  <td>{fmtDuration(r.timeInStageHrs)}</td>
                  <td>
                    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${TONE[tone]}`}>
                      {r.delayStatus === 'overdue' ? `Trễ ${fmtDuration(r.delayHours)}` : r.delayStatus === 'due_soon' ? 'Sắp hạn' : 'Đúng hạn'}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </CardContent></Card>
    </div>
  );
}
