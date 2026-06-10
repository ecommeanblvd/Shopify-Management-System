import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { ArrowLeftRight } from 'lucide-react';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { listWarehouses, listTransfers } from '@/features/transfers/queries';
import { TransfersPanel } from '@/components/transfers/TransfersPanel';

export const dynamic = 'force-dynamic';

export default async function TransfersPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_transfers')) {
    return <div className="px-6 py-16 text-center text-sm text-muted-foreground">Bạn không có quyền xem Chuyển kho.</div>;
  }
  const [warehouses, transfers] = await Promise.all([listWarehouses(), listTransfers()]);
  return (
    <div className="px-6 md:px-10 py-8 md:py-12 space-y-8">
      <header className="space-y-2">
        <div className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <ArrowLeftRight className="size-3.5" /> Vận hành đơn
        </div>
        <h1 className="text-4xl font-semibold tracking-tight">Chuyển kho</h1>
      </header>
      <TransfersPanel
        warehouses={warehouses}
        transfers={transfers.map((t) => ({
          id: t.id, code: t.code, status: t.status, fromCode: t.fromCode, toCode: t.toCode,
          note: t.note, sentAt: t.sentAt as Date | null, receivedAt: t.receivedAt as Date | null,
          lines: t.lines.map((l) => ({ sku: l.sku, qty: l.qty, productTitle: l.productTitle })),
        }))}
        canManage={hasPermission(role, 'manage_transfers')}
      />
    </div>
  );
}
