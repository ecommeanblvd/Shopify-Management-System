import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { listSla } from '@/features/lifecycle/queries';
import { SlaEditor } from './SlaEditor';

export const dynamic = 'force-dynamic';

export default async function SlaPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_fulfillment')) {
    return <div className="max-w-3xl mx-auto px-6 py-16 text-center"><h1 className="text-2xl font-semibold">Forbidden</h1></div>;
  }
  const canManage = hasPermission(role, 'manage_fulfillment');
  const sla = await listSla();
  return (
    <div className="max-w-2xl mx-auto px-6 md:px-10 py-8 space-y-6">
      <h1 className="text-3xl font-semibold tracking-tight">Cấu hình SLA vòng đời</h1>
      <p className="text-sm text-muted-foreground">Thời gian dự kiến (giờ) cho từng công đoạn — dùng để cảnh báo trễ.</p>
      <SlaEditor sla={sla} canManage={canManage} />
    </div>
  );
}
