'use client';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { approvePartnerRequest, rejectPartnerRequest, resendPartnerCallback } from '@/features/ship-ho/partner-request-actions';

export function RequestRow({ id, status }: { id: string; status: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const approve = () => { const m = prompt('Markup % (≥30)?', '30'); if (!m) return; start(async () => { const r = await approvePartnerRequest(id, m); setMsg(r.ok ? 'Đã duyệt' : r.error ?? 'Lỗi'); }); };
  const reject = () => { const r0 = prompt('Lý do từ chối?'); if (!r0) return; start(async () => { const r = await rejectPartnerRequest(id, r0); setMsg(r.ok ? 'Đã từ chối' : r.error ?? 'Lỗi'); }); };
  const resend = () => start(async () => { const r = await resendPartnerCallback(id); setMsg(r.ok ? 'Đã gửi lại' : r.error ?? 'Lỗi'); });
  return (
    <div className="flex items-center gap-2">
      {status === 'pending' && <><Button variant="outline" size="sm" disabled={pending} onClick={approve}>Duyệt</Button><Button variant="outline" size="sm" disabled={pending} onClick={reject}>Từ chối</Button></>}
      {status !== 'pending' && <Button variant="outline" size="sm" disabled={pending} onClick={resend}>Gửi lại callback</Button>}
      {msg && <span className="text-xs text-muted-foreground">{msg}</span>}
    </div>
  );
}
