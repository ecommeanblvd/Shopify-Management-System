import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { Undo2 } from 'lucide-react';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { listReturns, searchOrdersForReturn, getOrderLinesForReturn } from '@/features/returns/queries';
import { ReturnsPanel } from '@/components/returns/ReturnsPanel';

export const dynamic = 'force-dynamic';

export default async function ReturnsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_returns')) {
    return <div className="px-6 py-16 text-center text-sm text-muted-foreground">Bạn không có quyền xem Hàng hoàn.</div>;
  }
  const returns = await listReturns();
  return (
    <div className="px-6 md:px-10 py-8 md:py-12 space-y-8">
      <header className="space-y-2">
        <div className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <Undo2 className="size-3.5" /> Vận hành đơn
        </div>
        <h1 className="text-4xl font-semibold tracking-tight">Hàng hoàn</h1>
        <p className="text-sm text-muted-foreground">Ghi nhận hàng khách trả về + QC. Trạng thái refund đồng bộ từ Shopify.</p>
      </header>
      <ReturnsPanel
        returns={returns.map((r) => ({
          id: r.id, code: r.code, status: r.status, orderNumber: r.orderNumber,
          receivedAt: r.receivedAt as Date, totalPassQty: r.totalPassQty,
          refundCount: r.refundCount, refundTotal: r.refundTotal, refundFlag: r.refundFlag,
        }))}
        canManage={hasPermission(role, 'manage_returns')}
        searchOrders={async (q: string) => { 'use server'; return searchOrdersForReturn(q); }}
        loadOrderLines={async (orderId: string) => { 'use server'; return getOrderLinesForReturn(orderId); }}
      />
    </div>
  );
}
