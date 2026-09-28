import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { WarehouseTabs } from '@/components/fulfillment/WarehouseTabs';
import { OTimXuyenModule } from '@/components/cx/OTimXuyenModule';

/**
 * Khung module CX. "Hôm nay" đứng đầu: đó là trang trả lời "cần làm gì" cho cả năm
 * module, thay vì buộc CX mở bốn tab mới biết.
 *
 * Tab "Đổi trả" TRỎ sang màn đã có ở `/f/customer-account/requests` chứ không
 * dựng lại — một luồng đổi trả, hai chỗ vào.
 */
export default async function CxLayout({ children }: { children: React.ReactNode }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  const coQuyenCx = hasPermission(role, 'view_cx_ticket')
    || hasPermission(role, 'view_cx_dispute')
    || hasPermission(role, 'view_cx_incident')
    || hasPermission(role, 'view_cx_review');
  if (!role || !coQuyenCx) redirect('/');

  const tabs = [
    { href: '/f/cx', label: 'Hôm nay' },
    ...(hasPermission(role, 'view_cx_ticket')
      ? [{ href: '/f/cx/viec-can-lam', label: 'Việc cần làm' }]
      : []),
    ...(hasPermission(role, 'view_cx_dispute')
      ? [{ href: '/f/cx/tranh-chap', label: 'Tranh chấp' }]
      : []),
    ...(hasPermission(role, 'view_cx_incident')
      ? [{ href: '/f/cx/su-co', label: 'Sự cố' }]
      : []),
    ...(hasPermission(role, 'view_cx_review')
      ? [{ href: '/f/cx/danh-gia', label: 'Đánh giá' }]
      : []),
    ...(hasPermission(role, 'view_functions')
      ? [{ href: '/f/customer-account/requests', label: 'Đổi trả' }]
      : []),
  ];
  return (
    <div>
      <WarehouseTabs tabs={tabs} />
      {/* Ô tìm nằm ở LAYOUT nên có trên mọi tab CX: tra một đơn không phải đi về
          trang chủ trước. */}
      <div className="border-b border-border px-6 py-3 md:px-10">
        <div className="max-w-xl">
          <OTimXuyenModule />
        </div>
      </div>
      {children}
    </div>
  );
}
