import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { getLifecycle } from '@/features/lifecycle/queries';
import { buildTimeline, fmtDuration, STAGE_LABELS } from '@/features/lifecycle/display';
import { Card, CardContent } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';

export const dynamic = 'force-dynamic';

const fmt = (d: Date | string | null) => d ? new Date(d).toLocaleString('vi-VN') : '—';

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
  const steps = buildTimeline(lc);

  return (
    <div className="max-w-3xl mx-auto px-6 md:px-10 py-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">{lc.orderNumber ?? orderId.slice(0, 8)}</h1>
          <p className="text-sm text-muted-foreground">{lc.storeName ?? '—'} · {STAGE_LABELS[lc.currentStage as keyof typeof STAGE_LABELS] ?? lc.currentStage}{lc.exception && ' · ⚠️ sự cố'}</p>
        </div>
        <Link href="/f/lifecycle" className={buttonVariants({ variant: 'outline' })}>← Danh sách</Link>
      </div>
      <Card><CardContent className="p-4">
        <div className="text-xs uppercase tracking-wider text-muted-foreground mb-4">Timeline</div>
        <ol className="relative border-l ml-2 space-y-6">
          {steps.map((s) => (
            <li key={s.key} className="ml-4">
              <span className="absolute -left-1.5 mt-1 h-3 w-3 rounded-full bg-foreground" />
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-medium">{s.label}</span>
                <span className="text-xs text-muted-foreground">{fmt(s.at)}</span>
              </div>
              {s.durationHrs != null && <div className="text-xs text-muted-foreground">+{fmtDuration(s.durationHrs)} từ mốc trước</div>}
            </li>
          ))}
          {steps.length === 0 && <li className="ml-4 text-sm text-muted-foreground">Chưa có mốc nào.</li>}
        </ol>
      </CardContent></Card>
      {lc.deadline && lc.delayStatus !== 'on_track' && (
        <Card><CardContent className="p-4 text-sm">
          Deadline công đoạn hiện tại: <b>{fmt(lc.deadline)}</b>
          {lc.delayStatus === 'overdue' && <span className="text-red-600"> · trễ {fmtDuration(lc.delayHours)}</span>}
        </CardContent></Card>
      )}
    </div>
  );
}
