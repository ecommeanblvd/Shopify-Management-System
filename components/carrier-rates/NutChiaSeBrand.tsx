'use client';

import { useTransition, useState } from 'react';
import { datChiaSeBrand } from '@/features/carrier-rates/postcodes-actions';

/**
 * Tick "gửi brand" cho một tệp bằng chứng.
 *
 * Nhãn nói rõ HẬU QUẢ chứ không nói trạng thái ("Đang gửi brand" / "Không gửi brand"), vì bật
 * nó là đẩy một tệp ra ngoài công ty — người bấm phải đọc được điều đó mà không cần đoán.
 */
export function NutChiaSeBrand({ id, bat, canManage }: { id: string; bat: boolean; canManage: boolean }) {
  const [pending, start] = useTransition();
  const [loi, setLoi] = useState<string | null>(null);

  if (!canManage) {
    return (
      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider ${
        bat ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400' : 'bg-muted text-muted-foreground'}`}>
        {bat ? 'Gửi brand' : 'Nội bộ'}
      </span>
    );
  }
  return (
    <span className="shrink-0">
      <button
        type="button"
        disabled={pending}
        title={bat ? 'Brand đang tải được tệp này' : 'Chỉ nội bộ thấy'}
        onClick={() => start(async () => {
          setLoi(null);
          const r = await datChiaSeBrand(id, !bat);
          if (!r.ok) setLoi(r.loi ?? 'Lỗi');
        })}
        className={`cursor-pointer rounded-full px-2.5 py-1 text-[10px] uppercase tracking-wider transition-colors disabled:opacity-50 ${
          bat
            ? 'bg-amber-500/15 text-amber-700 hover:bg-amber-500/25 dark:text-amber-400'
            : 'bg-muted text-muted-foreground hover:bg-muted/70'}`}
      >
        {pending ? '…' : bat ? 'Gửi brand' : 'Nội bộ'}
      </button>
      {loi && <span className="ml-2 text-[10px] text-red-600">{loi}</span>}
    </span>
  );
}
