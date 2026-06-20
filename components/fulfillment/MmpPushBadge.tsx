'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { resendOrderToMmp, type MmpPushInfo } from '@/features/mmp/order-push-query';

interface Props {
  info: MmpPushInfo | null;
  orderId: string;
  canManage: boolean;
}

export function MmpPushBadge({ info, orderId, canManage }: Props) {
  const [isPending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();

  if (!info) return null;

  const handleResend = () => {
    startTransition(async () => {
      setErr(null);
      try {
        await resendOrderToMmp(orderId);
        router.refresh();
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Lỗi');
      }
    });
  };

  if (info.status === 'sent') {
    return (
      <span className="inline-block rounded px-2 py-0.5 text-xs font-medium bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
        Đã đẩy MMP
      </span>
    );
  }

  if (info.status === 'pending') {
    return (
      <span className="inline-flex items-center gap-2">
        <span className="inline-block rounded px-2 py-0.5 text-xs font-medium bg-muted text-muted-foreground">
          Đang đẩy MMP
        </span>
        {canManage && (
          <button
            onClick={handleResend}
            disabled={isPending}
            className="rounded border border-border px-2 py-0.5 text-xs hover:bg-muted disabled:opacity-50"
          >
            {isPending ? 'Đang đẩy…' : 'Đẩy lại MMP'}
          </button>
        )}
        {err && <span className="text-xs text-destructive">{err}</span>}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-2">
      <span
        className="inline-block rounded px-2 py-0.5 text-xs font-medium bg-amber-500/15 text-amber-600 dark:text-amber-400"
        title={info.lastError ?? ''}
      >
        Lỗi đẩy MMP
      </span>
      {canManage && (
        <button
          onClick={handleResend}
          disabled={isPending}
          className="rounded border border-border px-2 py-0.5 text-xs hover:bg-muted disabled:opacity-50"
        >
          {isPending ? 'Đang đẩy…' : 'Đẩy lại MMP'}
        </button>
      )}
      {err && <span className="text-xs text-destructive">{err}</span>}
    </span>
  );
}
