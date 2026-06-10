import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { PackageCheck } from 'lucide-react';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { listReceipts, listAwaitingGoods } from '@/features/receiving/queries';
import { createReceipt, addReceiptItem } from '@/features/receiving/actions';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

export const dynamic = 'force-dynamic';

const SOURCE_LABEL: Record<string, string> = {
  retail_for_order: 'Retail (đi đơn)', consignment: 'Consignment (ký gửi)', po: 'PO',
};

async function newReceiptAction(formData: FormData) {
  'use server';
  const sourceType = String(formData.get('sourceType') ?? 'consignment') as 'retail_for_order' | 'consignment' | 'po';
  const vendor = String(formData.get('vendor') ?? '').trim() || null;
  const id = await createReceipt({ sourceType, vendor });
  redirect(`/f/fulfillment/receiving/${id}`);
}

async function receiveForOrderAction(formData: FormData) {
  'use server';
  const receiptId = await createReceipt({ sourceType: 'retail_for_order', vendor: String(formData.get('brandSlug') ?? '') || null });
  await addReceiptItem({
    receiptId,
    sku: String(formData.get('sku') ?? '') || null,
    brandRequestId: String(formData.get('brandRequestId') ?? '') || null,
    fulfillmentLineId: String(formData.get('lineId') ?? '') || null,
    orderId: String(formData.get('orderId') ?? '') || null,
  });
  redirect(`/f/fulfillment/receiving/${receiptId}`);
}

export default async function ReceivingPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_receiving')) {
    return <div className="px-6 py-16 text-center text-sm text-muted-foreground">Bạn không có quyền xem Nhập kho &amp; QC.</div>;
  }
  const canReceive = hasPermission(role, 'manage_receiving');
  const [receipts, awaiting] = await Promise.all([listReceipts(), listAwaitingGoods()]);

  return (
    <div className="px-6 md:px-10 py-8 md:py-12 space-y-10">
      <header className="space-y-2">
        <div className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <PackageCheck className="size-3.5" /> Vận hành đơn
        </div>
        <h1 className="text-4xl font-semibold tracking-tight">Nhập kho &amp; QC</h1>
      </header>

      {canReceive && (
        <Card>
          <CardContent className="p-5 space-y-4">
            <h2 className="text-sm font-semibold">Phiếu nhập mới</h2>
            <form action={newReceiptAction} className="flex flex-col sm:flex-row gap-2 sm:items-end">
              <div className="space-y-1.5">
                <label className="text-xs uppercase tracking-wider text-muted-foreground">Loại nguồn</label>
                <select name="sourceType" className="border border-input bg-input/30 rounded-md px-2 py-2 text-sm">
                  <option value="consignment">Consignment (ký gửi)</option>
                  <option value="po">PO</option>
                  <option value="retail_for_order">Retail (đi đơn)</option>
                </select>
              </div>
              <div className="flex-1 space-y-1.5">
                <label className="text-xs uppercase tracking-wider text-muted-foreground">Vendor</label>
                <input name="vendor" className="w-full border border-input bg-input/30 rounded-md px-3 py-2 text-sm" placeholder="Tên brand/nhà cung cấp" />
              </div>
              <Button type="submit" size="sm" className="h-9">Tạo phiếu</Button>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          <div className="px-5 py-4 border-b border-border text-sm font-semibold">Chờ hàng về ({awaiting.length})</div>
          <ul className="divide-y divide-border">
            {awaiting.map((a) => (
              <li key={a.lineId} className="px-5 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{a.orderNumber} · {a.sku ?? '—'}</div>
                  <div className="text-xs text-muted-foreground">{a.brandSlug ?? '—'} · SL {a.qty} · giao dự kiến {a.expectedDeliveryDate ?? '—'}</div>
                </div>
                {canReceive && (
                  <form action={receiveForOrderAction}>
                    <input type="hidden" name="brandRequestId" value={a.brandRequestId} />
                    <input type="hidden" name="lineId" value={a.lineId} />
                    <input type="hidden" name="orderId" value={a.orderId} />
                    <input type="hidden" name="sku" value={a.sku ?? ''} />
                    <input type="hidden" name="brandSlug" value={a.brandSlug ?? ''} />
                    <Button type="submit" size="sm" variant="outline" className="h-7 px-3 text-xs">Nhận hàng</Button>
                  </form>
                )}
              </li>
            ))}
            {awaiting.length === 0 && <li className="px-5 py-6 text-sm text-muted-foreground">Không có dòng nào chờ hàng.</li>}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="px-5 py-4 border-b border-border text-sm font-semibold">Phiếu nhập ({receipts.length})</div>
          <ul className="divide-y divide-border">
            {receipts.map((r) => (
              <li key={r.id} className="px-5 py-3 flex items-center justify-between gap-3 hover:bg-muted/30">
                <Link href={`/f/fulfillment/receiving/${r.id}`} className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{r.code} · {r.vendor ?? '—'}</div>
                  <div className="text-xs text-muted-foreground">{r.warehouseCode} · {String(r.receivedAt).slice(0, 10)}</div>
                </Link>
                <Badge variant="outline" className="h-5 text-[10px] uppercase tracking-wider">{SOURCE_LABEL[r.sourceType] ?? r.sourceType}</Badge>
              </li>
            ))}
            {receipts.length === 0 && <li className="px-5 py-6 text-sm text-muted-foreground">Chưa có phiếu nhập.</li>}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
