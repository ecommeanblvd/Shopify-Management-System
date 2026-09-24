import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { brandCoHangTra } from '@/features/kho-nhan/bien-ban';
import { BienBan } from '@/components/kho-nhan/BienBan';

export const dynamic = 'force-dynamic';

export default async function BienBanPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_receiving')) {
    return <div className="px-6 py-16 text-center text-sm text-muted-foreground">Không có quyền.</div>;
  }

  const brands = await brandCoHangTra();

  return (
    <div className="space-y-5 p-6">
      <div className="print:hidden">
        <Link href="/f/warehouse/nhan-kcs" className="text-sm text-primary hover:underline">
          ← Nhận hàng &amp; KCS
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Biên bản trả brand</h1>
        <p className="text-sm text-muted-foreground">
          Gom chiếc không đạt kiểm theo brand để in gửi lại. Chiếc đã vào biên bản sẽ không hiện ở lần lập sau.
        </p>
      </div>
      <BienBan brands={brands} />
    </div>
  );
}
