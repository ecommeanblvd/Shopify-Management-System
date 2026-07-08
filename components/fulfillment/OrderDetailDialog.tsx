'use client';

import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { getOrderDetailModal, type OrderModalData } from '@/features/fulfillment/order-modal';
import { CarrierComparePanel } from './CarrierComparePanel';

function fmtDate(iso: string | null): string {
  if (!iso || iso.length < 10) return '—';
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

export function OrderDetailDialog({ orderId, onClose }: { orderId: string | null; onClose: () => void }) {
  // Mount fresh per order (parent đặt key={orderId}) → data/loading khởi tạo đúng,
  // không cần setState đồng bộ trong effect (lint: cascading renders) và không flash
  // dữ liệu đơn cũ khi mở đơn mới.
  const [data, setData] = useState<OrderModalData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!orderId) return;
    let active = true;
    getOrderDetailModal(orderId)
      .then((d) => { if (active) setData(d); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [orderId]);

  const s = data?.summary;
  return (
    <Dialog open={orderId != null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-3xl lg:max-w-5xl">
        <DialogHeader>
          <DialogTitle>
            {s ? `${s.orderNumber ?? orderId}` : 'Chi tiết đơn'}
            {s?.storeName ? <span className="ml-2 text-sm font-normal text-muted-foreground">{s.storeName}</span> : null}
          </DialogTitle>
        </DialogHeader>

        {loading && <p className="text-sm text-muted-foreground">Đang tải…</p>}
        {!loading && !s && <p className="text-sm text-muted-foreground">Không tìm thấy đơn.</p>}

        {s && (
          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
              <span>Ngày: {fmtDate(s.createdAtShopify)}</span>
              <span>Tình trạng: {s.status}</span>
            </div>

            {s.address && (
              <div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground">Địa chỉ</div>
                <div>{s.address.line ?? '—'}</div>
                {s.address.verifiedAt && (
                  <span className={`mt-1 inline-block rounded px-2 py-0.5 text-xs font-medium ${s.address.deliverable === false ? 'bg-red-500/15 text-red-700 dark:text-red-400' : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'}`}>
                    {s.address.deliverable === false ? '⚠ Không giao được' : '✓ Giao được'}
                  </span>
                )}
              </div>
            )}

            {s.lines.length > 0 && (
              <div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground">Sản phẩm</div>
                <table className="w-full">
                  <tbody>
                    {s.lines.map((l, i) => (
                      <tr key={i} className="border-t border-border/50">
                        <td className="py-1 pr-2 font-mono text-xs">{l.sku ?? '—'}</td>
                        <td className="py-1 pr-2">{l.productTitle ?? '—'}</td>
                        <td className="py-1 pr-2 text-right">×{l.qty}</td>
                        <td className="py-1 text-right text-xs text-muted-foreground">{l.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {s.packs.length > 0 && (
              <div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground">Kiện / Vận chuyển</div>
                {s.packs.map((p, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-2 border-t border-border/50 py-1">
                    <span className="text-xs">{p.code ?? '—'}</span>
                    {p.carrierKey && <span className="text-xs text-muted-foreground">{p.carrierKey}</span>}
                    {p.trackingNumber && <span className="font-mono text-xs">{p.trackingNumber}</span>}
                    {p.deliveryStatus === 'delivered' && <span className="text-xs text-emerald-600 dark:text-emerald-400">Đã giao{p.deliveredAt ? ` · ${fmtDate(p.deliveredAt).slice(0, 5)}` : ''}</span>}
                    {p.weightKg && <span className="text-xs text-muted-foreground">{p.weightKg}kg</span>}
                  </div>
                ))}
              </div>
            )}

            {orderId && <CarrierComparePanel orderId={orderId} />}

            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Lark (vận hành)</div>
              {data!.larkFields.length === 0 ? (
                <p className="text-muted-foreground">Không có dữ liệu Lark.</p>
              ) : (
                <dl className="divide-y divide-border/50">
                  {data!.larkFields.map((f) => (
                    <div key={f.label} className="flex gap-3 py-1">
                      <dt className="w-2/5 shrink-0 text-muted-foreground">{f.label}</dt>
                      <dd className="flex-1 break-words">{f.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
