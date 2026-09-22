import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { timMonCuaDon, listDaXuLyHomNay } from '@/features/kho-nhan/queries';
import { BangNhanKcs } from '@/components/kho-nhan/BangNhanKcs';

export const dynamic = 'force-dynamic';

export default async function NhanKcsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_receiving')) {
    return <div className="px-6 py-16 text-center text-sm text-muted-foreground">Không có quyền.</div>;
  }
  const sp = await searchParams;
  const don = typeof sp.don === 'string' ? sp.don : '';
  const [mon, homNay] = await Promise.all([don ? timMonCuaDon(don) : Promise.resolve([]), listDaXuLyHomNay()]);

  return (
    <div className="space-y-5 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Nhận hàng &amp; KCS</h1>
        <p className="text-sm text-muted-foreground">
          Gõ hoặc quét mã đơn, nhập số lượng, cân và kết quả kiểm cho từng món. SMS ghi thẳng sang bảng kho trên Lark.
        </p>
      </div>
      <BangNhanKcs don={don} mon={mon} homNay={homNay} coQuyenNhap={hasPermission(role, 'manage_qc')} />
    </div>
  );
}
