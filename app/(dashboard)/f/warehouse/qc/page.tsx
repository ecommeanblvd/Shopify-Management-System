import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { listPendingQcItems } from '@/features/receiving/queries';
import { QcActions } from '@/components/receiving/QcActions';
import { Card, CardContent } from '@/components/ui/card';

export const dynamic = 'force-dynamic';

export default async function QcQueuePage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_receiving')) {
    return <div className="px-6 py-16 text-center text-sm text-muted-foreground">Không có quyền.</div>;
  }
  const canQc = hasPermission(role, 'manage_qc');
  const items = await listPendingQcItems();

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Chờ KCS</h1>
        <p className="text-sm text-muted-foreground">{items.length} đơn vị hàng đang chờ kiểm chất lượng (cũ nhất trước).</p>
      </div>
      <Card>
        <CardContent className="p-0">
          <ul className="divide-y divide-border">
            {items.map((it) => (
              <li key={it.id} className="px-5 py-4 flex flex-wrap items-center gap-3">
                {it.photoUrl && <img src={it.photoUrl} alt="" className="h-12 w-12 rounded object-cover" />}
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{it.unitCode} · {it.sku ?? '—'}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    {it.productTitle ?? ''}{it.variantTitle ? ` · ${it.variantTitle}` : ''}
                    {' · '}phiếu {it.receiptCode ?? '—'}{it.sourceType ? ` (${it.sourceType})` : ''}
                    {it.orderNumber ? ` · đơn ${it.orderNumber}` : ''}{it.brandSlug ? ` · ${it.brandSlug}` : ''}
                  </div>
                </div>
                {canQc && <QcActions itemId={it.id} />}
              </li>
            ))}
            {items.length === 0 && <li className="px-5 py-10 text-center text-sm text-muted-foreground">Không có hàng chờ KCS.</li>}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
