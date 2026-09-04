import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { trangThaiCacJob, lichSuChay } from '@/features/jobs/queries';
import { JobsTable } from './JobsTable';

export const dynamic = 'force-dynamic';

export default async function JobsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_functions')) {
    return <div className="max-w-3xl mx-auto px-6 py-16 text-center"><h1 className="text-2xl font-semibold">Forbidden</h1></div>;
  }
  const [rows, lichSu] = await Promise.all([trangThaiCacJob(), lichSuChay(50)]);
  return (
    <div className="px-6 md:px-10 py-8 md:py-12 space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Tác vụ nền</h1>
        <p className="text-sm text-muted-foreground">
          Tác vụ nào đang chạy, cái nào ngưng. Trang này đọc nhật ký do chính tác vụ ghi ra,
          không dựa vào file cấu hình — vì lịch chạy thật nằm ở Railway, đọc repo không biết được.
        </p>
      </div>
      <JobsTable rows={rows} lichSu={lichSu} />
    </div>
  );
}
