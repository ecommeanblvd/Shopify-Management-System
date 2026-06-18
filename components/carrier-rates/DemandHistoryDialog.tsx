'use client';

import { useState } from 'react';
import { History } from 'lucide-react';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { formatDateVN, formatExclusiveEndVN } from '@/features/carrier-rates/lib';

export interface DemandHistoryEntry {
  /** Đã format sẵn (vd "12.345 VND/kg"). */
  value: string;
  /** Phạm vi áp dụng — danh sách nước, tier, hoặc "Toàn cầu". */
  scope: string;
  /** ISO datetime (từ cửa sổ hiệu lực). */
  from: string | null;
  to: string | null;
  active: boolean;
  note: string | null;
}

/**
 * "Xem toàn bộ lịch sử" cho mục Demand surcharge. Trang chỉ hiện 5 mức gần nhất
 * inline; modal này liệt kê MỌI mức (mọi vùng/kỳ) từ mới → cũ, cuộn được.
 */
export function DemandHistoryDialog({
  count,
  rows,
  title = 'Lịch sử phụ phí Demand',
}: {
  count: number;
  rows: DemandHistoryEntry[];
  /** Tiêu đề modal — mặc định giữ nguyên cho Demand; truyền khác để tái dùng (vd Markup). */
  title?: string;
}) {
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
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{count} mức phí theo vùng/kỳ, mới nhất ở trên.</DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto -mx-1 px-1">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-background">
                <tr className="text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">
                  <th className="text-left font-medium py-2 pr-4">Mức phí</th>
                  <th className="text-left font-medium py-2 pr-4">Phạm vi</th>
                  <th className="text-left font-medium py-2">Hiệu lực</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r, i) => (
                  <tr key={i} className={r.active ? '' : 'opacity-50'}>
                    <td className="py-2 font-mono tabular-nums font-semibold whitespace-nowrap pr-4">
                      {r.value}
                    </td>
                    <td className="py-2 text-xs text-muted-foreground pr-4 max-w-[18rem] break-words" title={r.scope}>
                      {r.scope}
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
