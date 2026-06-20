'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { resendOrderToMmp, type MmpPushInfo } from '@/features/mmp/order-push-query';

interface Props {
  info: MmpPushInfo | null;
  orderId: string;
  canManage: boolean;
}

export function MmpPushBadge({ info, orderId, canManage }: Props) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  if (!info) return null;

  const handleResend = () => {
    startTransition(async () => {
      await resendOrderToMmp(orderId);
      router.refresh();
    });
  };

  if (info.status === 'sent') {
    return (
      <span className="inline-block rounded px-2 py-0.5 text-xs font-medium bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
        Đã đẩy MMP
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
    </span>
  );
}
