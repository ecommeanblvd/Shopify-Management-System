'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { TriangleAlert } from 'lucide-react';
import {
  STAGE_LABELS, STAGE_ORDER, MAIN_CHAIN, nextStage, stageProgress,
  statusLabel, fmtDuration, type Tone,
} from '@/features/lifecycle/display';
import type { StageKey } from '@/features/lifecycle/derive';
import type { LifecycleListRow } from '@/features/lifecycle/queries';
import { Card, CardContent } from '@/components/ui/card';

const CHIP: Record<Tone, string> = {
  ok: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  warn: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  bad: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  stale: 'bg-muted text-muted-foreground border border-border',
  muted: 'bg-muted text-muted-foreground',
};

function StageBar({ stage }: { stage: StageKey }) {
  const { index, total } = stageProgress(stage);
  return (
    <div className="flex gap-[3px]">
      {Array.from({ length: total }).map((_, i) => (
        <span key={i} className={`h-[5px] flex-1 rounded-full ${i <= index ? 'bg-foreground' : 'bg-border'}`} />
      ))}
    </div>
  );
}

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
        {([['overdue', 'Quá hạn'], ['due_soon', 'Sắp hạn'], ['stale', 'Nghi mất tín hiệu']] as const).map(([d, label]) => (
          <button key={d} onClick={() => setParam('delay', d)}
            className={`rounded-full px-3 py-1 text-xs font-medium border ${activeDelay === d ? 'bg-foreground text-background' : 'hover:bg-muted'}`}>
            {label}
          </button>
        ))}
      </div>

      <Card><CardContent className="p-0 divide-y">
        {rows.length === 0 ? (
          <div className="p-6 text-center text-muted-foreground text-sm">Không có đơn khớp bộ lọc.</div>
        ) : rows.map((r) => {
          const stage = r.currentStage as StageKey;
          const nx = nextStage(stage);
          const st = statusLabel(r.delayStatus, r.delayHours);
          const when = r.delayStatus === 'stale'
            ? `gửi ${fmtDuration(r.delayHours)} trước, chưa có tín hiệu`
            : `đã ở ${fmtDuration(r.timeInStageHrs)}`;
          return (
            <div key={r.orderId} className="grid grid-cols-[150px_1fr_auto] items-center gap-4 p-3 hover:bg-muted/40">
              <div className="min-w-0">
                <Link href={`/f/lifecycle/${r.orderId}`} className="font-medium underline-offset-2 hover:underline inline-flex items-center gap-1">
                  {r.orderNumber ?? r.orderId.slice(0, 8)}
                  {r.exception && <TriangleAlert className="h-3.5 w-3.5 text-amber-500" aria-label="sự cố" />}
                </Link>
                <div className="text-xs text-muted-foreground truncate">{r.storeName ?? '—'}</div>
              </div>
              <div className="min-w-0">
                {MAIN_CHAIN.includes(stage) ? <StageBar stage={stage} /> : <div className="text-xs text-muted-foreground">{STAGE_LABELS[stage]}</div>}
                <div className="text-xs text-muted-foreground mt-1.5 truncate">
                  <span className="text-foreground font-medium">{STAGE_LABELS[stage]}</span>
                  {nx && <> → chờ {STAGE_LABELS[nx]}</>} · {when}
                </div>
              </div>
              <span className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${CHIP[st.tone]}`}>{st.text}</span>
            </div>
          );
        })}
      </CardContent></Card>
    </div>
  );
}
