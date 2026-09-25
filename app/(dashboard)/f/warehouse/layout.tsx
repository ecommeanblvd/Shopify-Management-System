import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { WarehouseTabs } from '@/components/fulfillment/WarehouseTabs';

/**
 * Khung module Kho hàng. Layout chỉ lo tab theo quyền XEM; từng page giữ guard riêng.
 *
 * Thứ tự tab đặt theo việc kho làm HẰNG NGÀY: "Nhận & kiểm hàng" đứng ĐẦU TIÊN — đây là thao
 * tác kho mở ra làm mỗi ngày, nên nó phải là thứ bật lên trước (CEO 25/09/2026), trên cả Tồn
 * kho. Ba tab của quy trình phiếu nhập cũ trong SMS (757 dòng, kho không dùng) nằm cuối và gắn
 * chữ "cũ" để không ai vào nhầm — CEO 23/09/2026.
 */
export default async function WarehouseLayout({ children }: { children: React.ReactNode }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || (!hasPermission(role, 'view_fulfillment') && !hasPermission(role, 'view_receiving'))) {
    redirect('/');
  }
  const tabs = [
    ...(hasPermission(role, 'view_receiving')
      ? [{ href: '/f/warehouse/nhan-kcs', label: 'Nhận & kiểm hàng' },
         { href: '/f/warehouse/dong-bo', label: 'Sổ nhập & đối chiếu' }]
      : []),
    ...(hasPermission(role, 'view_fulfillment')
      ? [{ href: '/f/warehouse', label: 'Tồn kho' },
         { href: '/f/warehouse/staging', label: 'Khu chờ' }]
      : []),
    ...(hasPermission(role, 'view_receiving')
      ? [{ href: '/f/warehouse/receiving', label: 'Phiếu nhập (cũ)' },
         { href: '/f/warehouse/receiving/quet', label: 'Nhập nhanh (cũ)' },
         { href: '/f/warehouse/qc', label: 'Chờ KCS (cũ)' }]
      : []),
  ];
  return (
    <div>
      <WarehouseTabs tabs={tabs} />
      {children}
    </div>
  );
}
