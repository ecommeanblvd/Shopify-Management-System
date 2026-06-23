'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { verifyOrderAddressAction } from '@/features/fulfillment/actions';

export function AddressVerifyButton({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setMsg(null);
          startTransition(async () => {
            const r = await verifyOrderAddressAction(orderId);
            if (!r.ok) setMsg(r.error === 'no address' ? 'Chưa có địa chỉ đầy đủ.' : `Lỗi: ${r.error}`);
            else setMsg(r.deliverable ? '✓ Giao được' : `⚠ Không giao được${r.issue ? ` — ${r.issue}` : ''}`);
            router.refresh();
          });
        }}
        className="rounded border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
      >
        {pending ? 'Đang verify…' : 'Verify lại địa chỉ'}
      </button>
      {msg && <span className="text-xs text-muted-foreground">{msg}</span>}
    </div>
  );
}
