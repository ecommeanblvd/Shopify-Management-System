'use client';

import { useState, useTransition } from 'react';
import { setShipHoTracking } from '@/features/ship-ho/tracking-actions';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

const DELIVERY_LABEL: Record<string, string> = {
  in_transit: 'Đang vận chuyển', out_for_delivery: 'Đang giao', delivered: 'Đã giao',
  exception: 'Sự cố', unknown: 'Chưa rõ',
};

export function TrackingCard({
  orderId, trackingNumber, carrierKey, deliveryStatus, deliveredAt,
}: {
  orderId: string; trackingNumber: string | null; carrierKey: string | null;
  deliveryStatus: string | null; deliveredAt: Date | null;
}) {
  const [pending, start] = useTransition();
  const [tn, setTn] = useState(trackingNumber ?? '');
  const [carrier, setCarrier] = useState(carrierKey ?? '');
  const [err, setErr] = useState<string | null>(null);

  const save = () =>
    start(async () => {
      setErr(null);
      const r = await setShipHoTracking(orderId, {
        trackingNumber: tn,
        carrierKey: carrier === 'fedex' || carrier === 'dhl' ? carrier : null,
      });
      if (!r.ok) setErr(r.error ?? 'Lỗi');
    });

  return (
    <Card><CardContent className="p-4 space-y-2 text-sm">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">Vận đơn &amp; giao hàng</div>
      <div className="flex gap-2">
        <select className="border rounded px-2 py-1" value={carrier} onChange={(e) => setCarrier(e.target.value)}>
          <option value="">carrier</option><option value="fedex">fedex</option><option value="dhl">dhl</option>
        </select>
        <input className="border rounded px-2 py-1 flex-1" placeholder="Tracking number" value={tn} onChange={(e) => setTn(e.target.value)} />
        <Button onClick={save} disabled={pending}>Lưu</Button>
      </div>
      {err && <p className="text-red-600 text-xs">{err}</p>}
      <div className="flex justify-between border-t pt-2">
        <span>Trạng thái giao</span>
        <span className="font-medium">{deliveryStatus ? (DELIVERY_LABEL[deliveryStatus] ?? deliveryStatus) : '—'}{deliveredAt ? ` · ${new Date(deliveredAt).toLocaleDateString('vi-VN')}` : ''}</span>
      </div>
    </CardContent></Card>
  );
}
