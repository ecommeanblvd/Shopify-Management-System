import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { getLifecycle } from '@/features/lifecycle/queries';
import {
  buildTimeline, fmtDuration, STAGE_LABELS, MAIN_CHAIN, nextStage, stageProgress, statusLabel,
} from '@/features/lifecycle/display';
import type { StageKey } from '@/features/lifecycle/derive';
import { Card, CardContent } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';

export const dynamic = 'force-dynamic';

const fmt = (d: Date | string | null) => d ? new Date(d).toLocaleString('vi-VN') : '—';
const fmtDay = (d: Date | string | null) => d ? new Date(d).toLocaleDateString('vi-VN') : '—';

const APPROX_NOTE: Record<'first_seen' | 'out_of_order', string> = {
  first_seen: 'mới ghi nhận',
  out_of_order: 'lệch thứ tự — dữ liệu nguồn không nhất quán',
};

export default async function LifecycleDetailPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_fulfillment')) {
    return <div className="max-w-3xl mx-auto px-6 py-16 text-center"><h1 className="text-2xl font-semibold">Forbidden</h1></div>;
  }
  const lc = await getLifecycle(orderId);
  if (!lc) notFound();

  const stage = lc.currentStage as StageKey;
  const nx = nextStage(stage);
  const st = statusLabel(lc.delayStatus, lc.delayHours);
  const { index } = stageProgress(stage);
  const steps = buildTimeline(lc, lc.syncedAt);

  return (
    <div className="max-w-3xl mx-auto px-6 md:px-10 py-8 space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">{lc.orderNumber ?? orderId.slice(0, 8)}</h1>
          <p className="text-sm text-muted-foreground">
            {lc.storeName ?? '—'} · hiện tại <span className="text-foreground font-medium">{STAGE_LABELS[stage]}</span>
            {nx && <> → chờ <span className="text-foreground font-medium">{STAGE_LABELS[nx]}</span></>}
            {lc.exception && ' · ⚠ sự cố'}
          </p>
        </div>
        <Link href="/f/lifecycle" className={buttonVariants({ variant: 'outline' })}>← Danh sách</Link>
      </div>

      {MAIN_CHAIN.includes(stage) && (
        <Card><CardContent className="p-4">
          <div className="flex items-start">
            {MAIN_CHAIN.map((s, i) => (
              <div key={s} className="flex-1 flex flex-col items-center text-center">
                <div className="flex items-center w-full">
                  <span className={`h-[2px] flex-1 ${i === 0 ? 'opacity-0' : i <= index ? 'bg-foreground' : 'bg-border'}`} />
                  <span className={`mx-0.5 h-3 w-3 shrink-0 rounded-full border-2 ${i < index ? 'bg-foreground border-foreground' : i === index ? 'border-foreground' : 'border-border bg-transparent'}`} />
                  <span className={`h-[2px] flex-1 ${i === MAIN_CHAIN.length - 1 ? 'opacity-0' : i < index ? 'bg-foreground' : 'bg-border'}`} />
                </div>
                <span className={`mt-1.5 text-[11px] ${i === index ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>{STAGE_LABELS[s]}</span>
              </div>
            ))}
          </div>
        </CardContent></Card>
      )}

      <Card><CardContent className="p-4 text-sm">
        {lc.delayStatus === 'stale' ? (
          <p><span className="font-medium">Nghi mất tín hiệu giao.</span>{' '}
            <span className="text-muted-foreground">Đã bàn giao carrier {fmtDay(lc.shippedAt)}, tới nay {fmtDuration(lc.delayHours)} chưa nhận cập nhật &quot;đã giao&quot;. Nhiều khả năng đã giao xong nhưng tracking không cập nhật — cần kiểm tra carrier, không tính là trễ SLA.</span></p>
        ) : lc.deadline ? (
          <p>Deadline công đoạn hiện tại: <b>{fmt(lc.deadline)}</b>
            {lc.delayStatus === 'overdue' && <span className="text-red-600"> · {st.text}</span>}
            {lc.delayStatus === 'due_soon' && <span className="text-amber-600"> · sắp hạn</span>}
          </p>
        ) : <p className="text-muted-foreground">Không có deadline cho công đoạn hiện tại.</p>}
      </CardContent></Card>

      <Card><CardContent className="p-4">
        <div className="text-xs uppercase tracking-wider text-muted-foreground mb-4">Timeline · theo thời gian thật</div>
        <ol className="relative border-l ml-2 space-y-6">
          {steps.map((s) => (
            <li key={s.key} className="ml-4">
              <span className={`absolute -left-1.5 mt-1 h-3 w-3 rounded-full ${s.approx ? 'bg-background border-2 border-border' : 'bg-foreground'}`} />
              <div className="flex items-baseline justify-between gap-3">
                <span className={s.approx ? 'text-muted-foreground' : 'font-medium'}>{s.label}
                  {s.approxReason && <span className="ml-2 text-[11px] rounded px-1.5 py-0.5 bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">≈ {APPROX_NOTE[s.approxReason]}</span>}
                </span>
                <span className="text-xs text-muted-foreground whitespace-nowrap">{s.approx ? `≈ ${fmtDay(s.at)}` : fmt(s.at)}</span>
              </div>
              {s.durationHrs != null && <div className="text-xs text-muted-foreground">+{fmtDuration(s.durationHrs)} từ mốc trước</div>}
            </li>
          ))}
          {steps.length === 0 && <li className="ml-4 text-sm text-muted-foreground">Chưa có mốc nào.</li>}
        </ol>
      </CardContent></Card>
    </div>
  );
}
