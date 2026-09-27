import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { WarehouseTabs } from '@/components/fulfillment/WarehouseTabs';

/**
 * Khung module CX. "Việc cần làm" đứng đầu vì đó là thứ CX mở ra mỗi ngày.
 *
 * Tab "Đổi trả" TRỎ sang màn đã có ở `/f/customer-account/requests` chứ không
 * dựng lại — một luồng đổi trả, hai chỗ vào.
 */
export default async function CxLayout({ children }: { children: React.ReactNode }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_cx_ticket')) redirect('/');

  const tabs = [
    { href: '/f/cx', label: 'Việc cần làm' },
    ...(hasPermission(role, 'view_functions')
      ? [{ href: '/f/customer-account/requests', label: 'Đổi trả' }]
      : []),
  ];
  return (
    <div>
      <WarehouseTabs tabs={tabs} />
      {children}
    </div>
  );
}
