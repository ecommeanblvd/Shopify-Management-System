import Link from 'next/link';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import {
  lifecycleDurations, listLifecycleStores, listBrandOptions, listCarrierOptions,
} from '@/features/lifecycle/stats-queries';
import { listSla } from '@/features/lifecycle/queries';
import { aggregateLifecycle, SLA_SEGMENTS, type SlaKey, type GroupBy } from '@/features/lifecycle/stats-logic';
import { buttonVariants } from '@/components/ui/button';
import { StatsView } from './StatsView';

export const dynamic = 'force-dynamic';

const GROUP_BYS: GroupBy[] = ['none', 'brand', 'carrier', 'month'];

export default async function LifecycleStatsPage({
  searchParams,
}: {
  searchParams: Promise<{ store?: string; brand?: string; carrier?: string; from?: string; to?: string; by?: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_fulfillment')) {
    return <div className="max-w-3xl mx-auto px-6 py-16 text-center"><h1 className="text-2xl font-semibold">Forbidden</h1></div>;
  }

  const sp = await searchParams;
  const groupBy: GroupBy = (GROUP_BYS as string[]).includes(sp.by ?? '') ? (sp.by as GroupBy) : 'none';
  const filter = {
    storeId: sp.store || undefined,
    brand: sp.brand || undefined,
    carrier: sp.carrier || undefined,
    fromMonth: sp.from || undefined,
    toMonth: sp.to || undefined,
  };

  const [rows, slaRows, stores, brands, carriers] = await Promise.all([
    lifecycleDurations(filter),
    listSla(),
    listLifecycleStores(),
    listBrandOptions(),
    listCarrierOptions(),
  ]);

  const sla = {} as Record<SlaKey, number>;
  for (const s of SLA_SEGMENTS) sla[s] = 0;
  for (const r of slaRows) if ((SLA_SEGMENTS as string[]).includes(r.key)) sla[r.key as SlaKey] = r.targetHours;

  const groups = aggregateLifecycle(rows, sla, groupBy);

  return (
    <div className="px-6 md:px-10 py-8 md:py-12 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Thống kê vòng đời</h1>
          <p className="text-sm text-muted-foreground">Thời gian trung bình/trung vị mỗi công đoạn + tỉ lệ trễ. {rows.length} đơn.</p>
        </div>
        <Link href="/f/lifecycle" className={buttonVariants({ variant: 'outline' })}>← Dashboard</Link>
      </div>
      <StatsView
        groups={groups}
        sla={sla}
        stores={stores}
        brands={brands}
        carriers={carriers}
        active={{ store: sp.store ?? '', brand: sp.brand ?? '', carrier: sp.carrier ?? '', from: sp.from ?? '', to: sp.to ?? '', by: groupBy }}
      />
    </div>
  );
}
