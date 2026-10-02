import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import Link from 'next/link';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { listShipHoPartners, listBrandsForShipHo } from '@/features/ship-ho/partners-actions';
import { countContractsByPartner } from '@/features/ship-ho/contract-actions';
import { buttonVariants } from '@/components/ui/button';
import { PartnersManager } from './PartnersManager';
import { KhoiLinkPhuPhi } from '@/components/ship-ho/KhoiLinkPhuPhi';
import { docLinkDangSong } from '@/features/ship-ho/trang-phu-phi/actions';
import { hienNgay } from '@/lib/timezone';

export const dynamic = 'force-dynamic';

export default async function ShipHoPartnersPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_ship_ho')) {
    return <div className="max-w-3xl mx-auto px-6 py-16 text-center"><h1 className="text-2xl font-semibold">Forbidden</h1></div>;
  }
  const canManage = hasPermission(role, 'manage_ship_ho');
  const [partners, brands, contractCounts, links] = await Promise.all([
    listShipHoPartners(), listBrandsForShipHo(), countContractsByPartner(), docLinkDangSong(),
  ]);
  /* Chỉ brand ĐANG là đối tác ship hộ mới có dòng link: trang phụ phí dẫn nguồn theo đơn đã đi,
   * nên một brand chưa ship hộ thì link mở ra cũng rỗng. Dữ liệu xuống Client Component là dữ
   * liệu thuần — không truyền hàm (xem `components/rsc-ham-qua-bien.test.ts`). */
  const theoSlug = new Map(links.map((l) => [l.brandSlug, l]));
  const dongLink = partners.map((p) => {
    const l = theoSlug.get(p.brandSlug);
    return {
      brandSlug: p.brandSlug,
      tenBrand: p.displayName ?? p.brandSlug,
      token: l?.token ?? null,
      taoLuc: l ? hienNgay(l.taoLuc) : null,
    };
  });
  return (
    <div className="px-6 md:px-10 py-8 md:py-12 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-semibold tracking-tight">Đối tác ship hộ</h1>
        {canManage && <Link href="/f/ship-ho/partner-requests" className={buttonVariants({ variant: 'outline' })}>Đăng ký ship hộ</Link>}
      </div>
      <PartnersManager partners={partners} brands={brands} canManage={canManage} contractCounts={contractCounts} />
      <KhoiLinkPhuPhi dong={dongLink} canManage={canManage} />
    </div>
  );
}
