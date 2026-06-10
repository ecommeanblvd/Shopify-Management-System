import { headers } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { getReturnWithLines } from '@/features/returns/queries';
import { ReturnQcPanel } from '@/components/returns/ReturnQcPanel';

export const dynamic = 'force-dynamic';

export default async function ReturnDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_returns')) {
    return <div className="px-6 py-16 text-center text-sm text-muted-foreground">Bạn không có quyền xem Hàng hoàn.</div>;
  }
  const ret = await getReturnWithLines(id);
  if (!ret) notFound();

  return (
    <div className="px-6 md:px-10 py-8 md:py-12 space-y-8">
      <header className="space-y-1">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">Hàng hoàn · Đơn #{ret.orderNumber}</div>
        <h1 className="text-3xl font-semibold tracking-tight">{ret.code}</h1>
      </header>
      <ReturnQcPanel
        returnId={ret.id}
        status={ret.status}
        refundFlag={ret.refundFlag}
        refunds={ret.refunds.map((r) => ({ amount: r.amount, refundedAt: r.refundedAt as Date, reason: r.reason }))}
        lines={ret.lines.map((l) => ({
          id: l.id, shopifyLineId: l.shopifyLineId, sku: l.sku, productTitle: l.productTitle,
          variantTitle: l.variantTitle, returnedQty: l.returnedQty, passQty: l.passQty,
          failQty: l.failQty, failReason: l.failReason, restockedQty: l.restockedQty,
        }))}
        canManage={hasPermission(role, 'manage_returns')}
      />
    </div>
  );
}
