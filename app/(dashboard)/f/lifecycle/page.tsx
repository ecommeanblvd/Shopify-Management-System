import Link from 'next/link';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { listLifecycle, stageCounts } from '@/features/lifecycle/queries';
import { LifecycleTable } from './LifecycleTable';
import { buttonVariants } from '@/components/ui/button';
import { OrderTabs } from '@/components/orders/OrderTabs';

export const dynamic = 'force-dynamic';

export default async function LifecyclePage({ searchParams }: { searchParams: Promise<{ stage?: string; delay?: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_fulfillment')) {
    return <div className="max-w-3xl mx-auto px-6 py-16 text-center"><h1 className="text-2xl font-semibold">Forbidden</h1></div>;
  }
  const sp = await searchParams;
  const [rows, counts] = await Promise.all([
    listLifecycle({ stage: sp.stage, delay: sp.delay }),
    stageCounts(),
  ]);
  return (
    <div className="px-6 md:px-10 py-8 md:py-12 space-y-6">
      <OrderTabs />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Vòng đời đơn hàng</h1>
          <p className="text-sm text-muted-foreground">Theo dõi công đoạn xử lý từng đơn + cảnh báo trễ so với SLA.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/f/lifecycle/stats" className={buttonVariants({ variant: 'outline' })}>Thống kê</Link>
          <Link href="/f/lifecycle/sla" className={buttonVariants({ variant: 'outline' })}>Cấu hình SLA</Link>
        </div>
      </div>
      <LifecycleTable rows={rows} counts={counts} activeStage={sp.stage ?? null} activeDelay={sp.delay ?? null} />
    </div>
  );
}
