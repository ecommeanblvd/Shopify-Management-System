'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { rejectMmpOrder, requestInfoMmpOrder } from '@/features/ship-ho/orders-actions';

export function MmpOrderActions({ orderId }: { orderId: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  const doReject = () => {
    const r = prompt('Lý do từ chối?');
    if (!r) return;
    start(async () => {
      const res = await rejectMmpOrder(orderId, r);
      setMsg(res.ok ? 'Đã gửi từ chối cho brand' : res.error ?? 'Lỗi');
    });
  };

  const doNeed = () => {
    const r = prompt('Cần bổ sung gì?');
    if (!r) return;
    start(async () => {
      const res = await requestInfoMmpOrder(orderId, r);
      setMsg(res.ok ? 'Đã gửi yêu cầu bổ sung' : res.error ?? 'Lỗi');
    });
  };

  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="sm" disabled={pending} onClick={doReject}>Từ chối</Button>
      <Button variant="outline" size="sm" disabled={pending} onClick={doNeed}>Cần bổ sung</Button>
      {msg && <span className="text-xs text-muted-foreground">{msg}</span>}
    </div>
  );
}
