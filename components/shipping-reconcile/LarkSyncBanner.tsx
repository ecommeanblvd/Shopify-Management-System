'use client';
import { useState } from 'react';
// CHỈ import type — sync.ts kéo db/schema (server). Banner 'use client' nên
// import VALUE sẽ lôi db vào client bundle. RSC (page) đọc run rồi truyền xuống.
import type { LarkRunRow } from '@/features/lark/sync';

export function LarkSyncBanner({ latest }: { latest: LarkRunRow | null }) {
  const [open, setOpen] = useState(false);
  if (!latest) return null;
  const when = new Date(latest.ranAt).toLocaleString('vi-VN');

  if (latest.error) {
    return (
      <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-400">
        Đồng bộ Lark LỖI ({when}): {latest.error}
      </div>
    );
  }

  const hasUnmatched = latest.unmatched.length > 0;
  return (
    <div className="rounded-lg border border-sky-500/40 bg-sky-500/10 p-3 text-sm">
      <button
        type="button"
        onClick={() => hasUnmatched && setOpen((v) => !v)}
        className={`text-left font-medium text-sky-700 dark:text-sky-400 ${hasUnmatched ? '' : 'cursor-default'}`}
      >
        Đồng bộ Lark {when}: tạo {latest.created} · cập nhật {latest.updated} · không khớp {latest.unmatchedCount} · bỏ qua {latest.skippedCount}
        {hasUnmatched ? ` ${open ? '▲' : '▼'}` : ''}
      </button>
      {open && hasUnmatched && (
        <ul className="mt-2 max-h-48 space-y-0.5 overflow-y-auto text-xs text-muted-foreground">
          {latest.unmatched.map((u, i) => (
            <li key={`${u.orderNumber}-${i}`}>{u.orderNumber} — {u.reason}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
