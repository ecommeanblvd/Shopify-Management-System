'use client';

import { useState } from 'react';
import { History } from 'lucide-react';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { formatDateVN, formatExclusiveEndVN } from '@/features/carrier-rates/lib';

export interface FuelHistoryEntry {
  value: string;
  /** ISO datetime strings (serialized from the surcharge window). */
  from: string | null;
  to: string | null;
  note: string | null;
}

/**
 * "View full history" modal for the fuel-surcharge section. The page shows
 * only the latest few rates inline; this dialog lists every weekly rate
 * (newest → oldest, the order they arrive in) in a scrollable table.
 */
export function FuelHistoryDialog({ count, rows }: { count: number; rows: FuelHistoryEntry[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors underline-offset-2 hover:underline"
      >
        <History className="size-3.5" />
        Xem toàn bộ lịch sử ({count})
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Lịch sử phụ phí xăng dầu</DialogTitle>
          <DialogDescription>{count} mức phí theo tuần, mới nhất ở trên.</DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto -mx-1 px-1">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-background">
              <tr className="text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">
                <th className="text-left font-medium py-2">Mức phí</th>
                <th className="text-left font-medium py-2">Hiệu lực</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r, i) => (
                <tr key={i}>
                  <td className="py-2 font-mono tabular-nums font-semibold whitespace-nowrap pr-4">
                    {Number(r.value)}%
                  </td>
                  <td className="py-2 font-mono text-xs text-muted-foreground whitespace-nowrap">
                    {formatDateVN(r.from, '…')} → {formatExclusiveEndVN(r.to, 'nay')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DialogContent>
      </Dialog>
    </>
  );
}
