'use client';

import { useState, useTransition } from 'react';
import { setStyleQuizEnabled, type StyleQuizStoreStatus } from '@/features/functions/style-quiz/admin-actions';

/**
 * Bật/tắt Style Quiz theo store (store_function_settings). Cảnh báo khi store
 * chưa bật Customer Account — vì quiz ship như module trong extension CA.
 */
export function StoreEnablement({ initial }: { initial: StyleQuizStoreStatus[] }) {
  const [rows, setRows] = useState(initial);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, start] = useTransition();

  const toggle = (storeId: string, next: boolean) => {
    setPendingId(storeId);
    start(async () => {
      try {
        await setStyleQuizEnabled(storeId, next);
        setRows((rs) => rs.map((r) => (r.storeId === storeId ? { ...r, enabled: next } : r)));
      } finally {
        setPendingId(null);
      }
    });
  };

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="border-b text-muted-foreground">
          <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-left">
            <th>Store</th><th>Customer Account</th><th className="text-right">Style Quiz</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.storeId} className="border-b last:border-0 [&>td]:px-3 [&>td]:py-2.5">
              <td>
                <div className="font-medium">{r.storeName}</div>
                <div className="text-xs text-muted-foreground">{r.shopDomain}</div>
              </td>
              <td>
                {r.customerAccountEnabled ? (
                  <span className="text-xs text-emerald-600 dark:text-emerald-400">✓ đang bật</span>
                ) : (
                  <span className="text-xs text-amber-600 dark:text-amber-400" title="Quiz ship trong extension Customer Account — cần bật CA để khách thấy quiz">
                    ⚠ chưa bật (quiz sẽ không hiện)
                  </span>
                )}
              </td>
              <td className="text-right">
                <button
                  type="button"
                  role="switch"
                  aria-checked={r.enabled}
                  disabled={pendingId === r.storeId}
                  onClick={() => toggle(r.storeId, !r.enabled)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition disabled:opacity-50 ${r.enabled ? 'bg-emerald-500' : 'bg-muted-foreground/30'}`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${r.enabled ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
