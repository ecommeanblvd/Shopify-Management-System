import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { WarehouseTabs } from '@/components/fulfillment/WarehouseTabs';

/** Khung module Kho hàng: tab Tồn kho · Khu chờ · Nhập kho & QC.
 *  Layout chỉ lo tab theo quyền XEM; từng page giữ nguyên guard riêng. */
export default async function WarehouseLayout({ children }: { children: React.ReactNode }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || (!hasPermission(role, 'view_fulfillment') && !hasPermission(role, 'view_receiving'))) {
    redirect('/');
  }
  const tabs = [
    ...(hasPermission(role, 'view_fulfillment')
      ? [{ href: '/f/warehouse', label: 'Tồn kho' },
         { href: '/f/warehouse/staging', label: 'Khu chờ' }]
      : []),
    ...(hasPermission(role, 'view_receiving')
      ? [{ href: '/f/warehouse/receiving', label: 'Nhập kho & QC' }]
      : []),
  ];
  return (
    <div>
      <WarehouseTabs tabs={tabs} />
      {children}
    </div>
  );
}
