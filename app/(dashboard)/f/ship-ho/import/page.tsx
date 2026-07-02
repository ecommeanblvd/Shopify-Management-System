import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { listShipHoPartners } from '@/features/ship-ho/partners-actions';
import { ImportUploader } from './ImportUploader';

export const dynamic = 'force-dynamic';

export default async function ShipHoImportPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'manage_ship_ho')) {
    return <div className="max-w-3xl mx-auto px-6 py-16 text-center"><h1 className="text-2xl font-semibold">Forbidden</h1></div>;
  }
  const partners = await listShipHoPartners();
  return (
    <div className="max-w-2xl mx-auto px-6 md:px-10 py-8 space-y-6">
      <h1 className="text-3xl font-semibold tracking-tight">Import đơn ship hộ</h1>
      <p className="text-sm text-muted-foreground">
        File .xlsx theo thứ tự cột: mã · người nhận · công ty · SĐT · nước(ISO2) · thành phố · tỉnh ·
        postcode · địa chỉ1 · địa chỉ2 · cân(kg) · D · R · C · đóng gói(bag/box) · carrier(fedex/dhl) · tracking.
        Dòng đầu là header (bỏ qua).
      </p>
      <ImportUploader partners={partners.filter((p) => p.status === 'active').map((p) => ({ slug: p.brandSlug, name: p.displayName ?? p.brandSlug }))} />
    </div>
  );
}
