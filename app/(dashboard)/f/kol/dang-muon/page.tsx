import Link from 'next/link';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { ngayKinhDoanh } from '@/lib/timezone';
import { dangMuon } from '@/features/kol/queries';
import { BangDangMuon } from '@/components/kol/BangDangMuon';

export const dynamic = 'force-dynamic';

export default async function DangMuonKolPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_kol')) {
    return <div className="max-w-3xl mx-auto px-6 py-16 text-center"><h1 className="text-2xl font-semibold">Forbidden</h1></div>;
  }

  const homNay = ngayKinhDoanh(new Date())!;
  const mon = await dangMuon(homNay);
  const soQuaHan = mon.filter((m) => m.soNgayTre !== null && m.soNgayTre > 0).length;

  return (
    <div className="px-6 md:px-10 py-8 md:py-12 space-y-6">
      <div>
        <Link href="/f/kol" className="text-sm text-muted-foreground underline-offset-2 hover:underline">
          ← Đơn KOL &amp; chụp đồ
        </Link>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Đang mượn</h1>
        <p className="text-sm text-muted-foreground">
          {mon.length} dòng hàng mượn còn chưa trả đủ
          {soQuaHan > 0 && (
            <> · <span className="font-medium text-red-600 dark:text-red-400">{soQuaHan} dòng đã quá hạn</span></>
          )}
          . Không có nhắc tự động ở đợt này — theo dõi và nhận trả thủ công qua đơn.
        </p>
      </div>
      <BangDangMuon mon={mon} />
    </div>
  );
}
