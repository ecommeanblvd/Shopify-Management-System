'use client';

import { useState } from 'react';
import type { BackupApplyAllResult } from '@/features/markets/actions';

export function ApplyAllBackupButton({ storeCount, onApplyAll }: {
  storeCount: number;
  onApplyAll: () => Promise<BackupApplyAllResult[]>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<BackupApplyAllResult[] | null>(null);

  if (storeCount === 0) {
    return <p className="text-xs text-muted-foreground">Không có store active để apply.</p>;
  }

  return (
    <div className="space-y-2">
      {!confirming ? (
        <button type="button" onClick={() => { setConfirming(true); setResults(null); }}
          className="rounded-md border border-amber-500/60 px-4 py-2 text-sm font-medium text-amber-700 dark:text-amber-400 hover:bg-amber-500/10">
          ⚡ Apply backup lên TẤT CẢ {storeCount} store
        </button>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-amber-700 dark:text-amber-400">⚠ Sẽ apply lên {storeCount} store active. Xác nhận?</span>
          <button type="button" disabled={busy}
            onClick={async () => {
              setBusy(true);
              try { setResults(await onApplyAll()); setConfirming(false); }
              catch (e) { setResults([{ storeId: '-', storeName: '(lỗi)', ok: false, errors: [e instanceof Error ? e.message : String(e)] }]); }
              finally { setBusy(false); }
            }}
            className="rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50">
            {busy ? 'Đang apply…' : 'Xác nhận apply tất cả'}
          </button>
          <button type="button" disabled={busy} onClick={() => setConfirming(false)}
            className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground hover:bg-muted disabled:opacity-50">
            Hủy
          </button>
        </div>
      )}

      {results && (
        <div className="space-y-1 rounded-md border border-border p-3 text-sm">
          <div className="font-medium">
            Kết quả: {results.filter((r) => r.ok).length}/{results.length} store OK
          </div>
          {results.map((r) => (
            <div key={r.storeId} className={r.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}>
              {r.ok ? '✓' : '✗'} {r.storeName}
              {r.errors.length > 0 && <span className="text-muted-foreground"> — {r.errors.join('; ')}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
