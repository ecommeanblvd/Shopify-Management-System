import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import Link from 'next/link';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { buttonVariants } from '@/components/ui/button';
import { listPartnerContracts } from '@/features/ship-ho/contract-actions';
import { ContractsView } from './ContractsView';

export const dynamic = 'force-dynamic';

export default async function PartnerContractsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_ship_ho')) {
    return <div className="max-w-3xl mx-auto px-6 py-16 text-center"><h1 className="text-2xl font-semibold">Forbidden</h1></div>;
  }
  const canManage = hasPermission(role, 'manage_ship_ho');
  const contracts = await listPartnerContracts(slug);

  return (
    <div className="px-6 md:px-10 py-8 md:py-12 space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">Hợp đồng · {slug}</h1>
        <div className="flex items-center gap-2">
          <Link href={`/f/ship-ho/partners/${slug}/rate-card`} className={buttonVariants({ variant: 'outline' })}>Rate card</Link>
          <Link href="/f/ship-ho/partners" className={buttonVariants({ variant: 'outline' })}>← Đối tác</Link>
        </div>
      </div>
      <ContractsView brandSlug={slug} contracts={contracts} canManage={canManage} />
    </div>
  );
}
