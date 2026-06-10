'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createReturn } from '@/features/returns/actions';

type ReturnRow = {
  id: string; code: string; status: string; orderNumber: string;
  receivedAt: Date; totalPassQty: number;
  refundCount: number; refundTotal: string; refundFlag: 'refunded' | 'awaiting_refund' | 'none';
};
type OrderHit = { id: string; orderNumber: string; financialStatus: string };
type OrderLine = {
  shopifyLineId: string; sku: string | null; productTitle: string; variantTitle: string | null;
  quantity: number; alreadyReturned: number; returnableQty: number;
};

interface Props {
  returns: ReturnRow[];
  canManage: boolean;
  searchOrders: (q: string) => Promise<OrderHit[]>;
  loadOrderLines: (orderId: string) => Promise<OrderLine[]>;
}

const STATUS_LABEL: Record<string, string> = { open: 'Đang mở', completed: 'Đã QC', cancelled: 'Đã huỷ' };
const FLAG_LABEL: Record<string, string> = { refunded: 'Đã refund', awaiting_refund: 'Chờ refund', none: '—' };
const FLAG_CLASS: Record<string, string> = {
  refunded: 'text-emerald-600',
  awaiting_refund: 'text-amber-600 font-medium',
  none: 'text-muted-foreground',
};

export function ReturnsPanel({ returns, canManage, searchOrders, loadOrderLines }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<OrderHit[]>([]);
  const [order, setOrder] = useState<OrderHit | null>(null);
  const [lines, setLines] = useState<OrderLine[]>([]);
  const [picked, setPicked] = useState<Record<string, string>>({}); // shopifyLineId -> qty string
  const [note, setNote] = useState('');

  const doSearch = () => startTransition(async () => { setHits(await searchOrders(query)); });
  const pickOrder = (o: OrderHit) => startTransition(async () => {
    setOrder(o); setHits([]); setPicked({});
    setLines(await loadOrderLines(o.id));
  });
  const handleCreate = () => startTransition(async () => {
    if (!order) return;
    const payloadLines = Object.entries(picked)
      .map(([shopifyLineId, qty]) => ({ shopifyLineId, returnedQty: Number(qty) }))
      .filter((l) => l.returnedQty > 0);
    if (payloadLines.length === 0) return;
    const id = await createReturn({ orderId: order.id, note: note || null, lines: payloadLines });
    setOrder(null); setLines([]); setPicked({}); setNote(''); setQuery('');
    router.push(`/f/returns/${id}`);
  });

  return (
    <div className="space-y-8">
      {canManage && (
        <div className="rounded-lg border border-border p-4 space-y-3">
          <h2 className="text-sm font-semibold">Tạo phiếu hoàn</h2>
          {!order ? (
            <>
              <div className="flex items-center gap-2">
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Tìm số đơn Shopify…"
                  className="flex-1 border border-input bg-input/30 rounded-md px-3 py-1.5 text-sm" />
                <button onClick={doSearch} disabled={isPending}
                  className="rounded-md border border-border px-3 py-1.5 text-sm">Tìm</button>
              </div>
              {hits.length > 0 && (
                <ul className="divide-y divide-border rounded-md border border-border">
                  {hits.map((o) => (
                    <li key={o.id}>
                      <button onClick={() => pickOrder(o)} className="w-full text-left px-3 py-2 text-sm hover:bg-muted/50">
                        #{o.orderNumber} · {o.financialStatus}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Đơn #{order.orderNumber}</span>
                <button onClick={() => { setOrder(null); setLines([]); setPicked({}); }}
                  className="text-xs text-muted-foreground underline">Chọn đơn khác</button>
              </div>
              <div className="space-y-2">
                {lines.map((l) => (
                  <div key={l.shopifyLineId} className="flex items-center gap-3 text-sm">
                    <div className="flex-1">
                      <div>{l.productTitle}{l.variantTitle ? ` · ${l.variantTitle}` : ''}</div>
                      <div className="text-xs text-muted-foreground">
                        SKU {l.sku ?? '—'} · đặt {l.quantity} · đã hoàn {l.alreadyReturned} · còn {l.returnableQty}
                      </div>
                    </div>
                    <input
                      type="number" min={0} max={l.returnableQty}
                      value={picked[l.shopifyLineId] ?? ''}
                      onChange={(e) => setPicked((p) => ({ ...p, [l.shopifyLineId]: e.target.value }))}
                      placeholder="0"
                      className="w-20 border border-input bg-input/30 rounded-md px-2 py-1 text-sm"
                      disabled={l.returnableQty <= 0}
                    />
                  </div>
                ))}
              </div>
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ghi chú"
                className="w-full border border-input bg-input/30 rounded-md px-3 py-1.5 text-sm" />
              <button onClick={handleCreate} disabled={isPending}
                className="rounded-md bg-primary text-primary-foreground px-4 py-1.5 text-sm font-medium">
                Tạo phiếu
              </button>
            </div>
          )}
        </div>
      )}

      <div className="rounded-lg border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="text-left px-3 py-2">Mã</th>
              <th className="text-left px-3 py-2">Đơn</th>
              <th className="text-left px-3 py-2">Ngày nhận</th>
              <th className="text-left px-3 py-2">Trạng thái</th>
              <th className="text-right px-3 py-2">Restock</th>
              <th className="text-left px-3 py-2">Refund</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {returns.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">Chưa có phiếu hoàn.</td></tr>
            )}
            {returns.map((r) => (
              <tr key={r.id} className="hover:bg-muted/30">
                <td className="px-3 py-2">
                  <Link href={`/f/returns/${r.id}`} className="font-medium underline">{r.code}</Link>
                </td>
                <td className="px-3 py-2">#{r.orderNumber}</td>
                <td className="px-3 py-2">{new Date(r.receivedAt).toLocaleDateString('vi-VN')}</td>
                <td className="px-3 py-2">{STATUS_LABEL[r.status] ?? r.status}</td>
                <td className="px-3 py-2 text-right">{r.totalPassQty}</td>
                <td className={`px-3 py-2 ${FLAG_CLASS[r.refundFlag]}`}>
                  {FLAG_LABEL[r.refundFlag]}{r.refundCount > 0 ? ` · ${r.refundTotal}` : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
