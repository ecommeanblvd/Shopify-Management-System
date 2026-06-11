import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { listStaging } from '@/features/warehouse/staging-queries';
import { StagingBoard } from '@/components/fulfillment/StagingBoard';

export const dynamic = 'force-dynamic';

export default async function StagingPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_fulfillment')) redirect('/');
  const groups = await listStaging();
  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Khu chờ đi đơn</h1>
        <p className="text-sm text-muted-foreground">
          Kiện hàng nhập về cho đơn cụ thể (QC pass) đang chờ đủ món để đi. Đơn đủ mọi dòng → &ldquo;Sẵn sàng đi&rdquo;.
        </p>
      </div>
      <StagingBoard groups={groups} />
    </div>
  );
}
