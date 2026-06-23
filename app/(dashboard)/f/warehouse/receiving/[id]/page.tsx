import { headers } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { getReceiptDetail } from '@/features/receiving/queries';
import { addReceiptItem } from '@/features/receiving/actions';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { QcActions } from '@/components/receiving/QcActions';

export const dynamic = 'force-dynamic';

async function addItemAction(receiptId: string, formData: FormData) {
  'use server';
  await addReceiptItem({
    receiptId,
    sku: String(formData.get('sku') ?? '') || null,
    productTitle: String(formData.get('productTitle') ?? '') || null,
  });
}

const QC_VARIANT: Record<string, 'default' | 'secondary' | 'outline'> = { pass: 'default', fail: 'secondary', pending: 'outline' };

export default async function ReceiptDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_receiving')) {
    return <div className="px-6 py-16 text-center text-sm text-muted-foreground">Không có quyền.</div>;
  }
  const canReceive = hasPermission(role, 'manage_receiving');
  const canQc = hasPermission(role, 'manage_qc');
  const detail = await getReceiptDetail(id);
  if (!detail) notFound();
  const { receipt, items } = detail;

  return (
    <div className="px-6 md:px-10 py-8 md:py-12 space-y-8">
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight">{receipt.code}</h1>
        <p className="text-sm text-muted-foreground">{receipt.sourceType} · {receipt.vendor ?? '—'} · {receipt.warehouseCode}</p>
      </header>

      {canReceive && (
        <Card>
          <CardContent className="p-5 space-y-3">
            <h2 className="text-sm font-semibold">Thêm đơn vị hàng</h2>
            <form action={addItemAction.bind(null, id)} className="flex flex-col sm:flex-row gap-2 sm:items-end">
              <div className="flex-1 space-y-1.5">
                <label className="text-xs uppercase tracking-wider text-muted-foreground">SKU</label>
                <input name="sku" className="w-full border border-input bg-input/30 rounded-md px-3 py-2 text-sm" />
              </div>
              <div className="flex-1 space-y-1.5">
                <label className="text-xs uppercase tracking-wider text-muted-foreground">Tên SP</label>
                <input name="productTitle" className="w-full border border-input bg-input/30 rounded-md px-3 py-2 text-sm" />
              </div>
              <Button type="submit" size="sm" className="h-9">Thêm</Button>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          <div className="px-5 py-4 border-b border-border text-sm font-semibold">Đơn vị hàng ({items.length})</div>
          <ul className="divide-y divide-border">
            {items.map((it) => (
              <li key={it.id} className="px-5 py-4 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{it.unitCode} · {it.sku ?? '—'}</div>
                    <div className="text-xs text-muted-foreground truncate">{it.productTitle ?? ''} · {it.disposition}</div>
                  </div>
                  <Badge variant={QC_VARIANT[it.qcResult]} className="h-5 text-[10px] uppercase tracking-wider">{it.qcResult}</Badge>
                </div>
                {it.qcResult === 'fail' && it.qcFailReason && (
                  <div className="text-xs text-amber-600">Lý do: {it.qcFailReason}</div>
                )}
                {canQc && it.qcResult === 'pending' && <QcActions itemId={it.id} />}
              </li>
            ))}
            {items.length === 0 && <li className="px-5 py-6 text-sm text-muted-foreground">Chưa có đơn vị hàng.</li>}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
