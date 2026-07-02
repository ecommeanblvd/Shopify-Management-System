import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { ReconcileUploader } from './ReconcileUploader';

export const dynamic = 'force-dynamic';

export default async function ShipHoReconcilePage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'manage_ship_ho')) {
    return <div className="max-w-3xl mx-auto px-6 py-16 text-center"><h1 className="text-2xl font-semibold">Forbidden</h1></div>;
  }
  return (
    <div className="px-6 md:px-10 py-8 md:py-12 space-y-6">
      <h1 className="text-3xl font-semibold tracking-tight">Đối soát cước carrier</h1>
      <p className="text-sm text-muted-foreground">
        File .xlsx/.csv theo thứ tự cột: <b>tracking · cước thực (VND)</b>. Dòng đầu header (bỏ qua).
        Hệ thống match theo tracking, ghi cước thực + delta (thực − ước tính) + margin (thu − thực).
      </p>
      <ReconcileUploader />
    </div>
  );
}
