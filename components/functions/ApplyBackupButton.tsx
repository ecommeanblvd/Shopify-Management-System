'use client';

import type { MarketOps } from '@/features/markets/diff';
import type { BackupApplyAllResult } from '@/features/markets/actions';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { ApplyModal } from '@/components/markets/ApplyModal';
import { ApplyAllBackupButton } from '@/components/functions/ApplyAllBackupButton';

interface Store { id: string; name: string; shopDomain: string }

/** Một nút duy nhất mở Dialog: apply 1 store (chọn) HOẶC tất cả store. Gom thay
 *  cho tab store + accordion để gọn workspace. */
export function ApplyBackupButton({ stores, storeCount, onPreview, onApply, onApplyAll }: {
  stores: Store[];
  storeCount: number;
  onPreview: (storeId: string) => Promise<{ ops: MarketOps }>;
  onApply: (storeId: string) => Promise<{ errors: Array<{ step: string; error: string }> }>;
  onApplyAll: () => Promise<BackupApplyAllResult[]>;
}) {
  return (
    <Dialog>
      <DialogTrigger className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/60 bg-amber-500/5 px-4 py-2 text-sm font-medium text-amber-700 dark:text-amber-400 hover:bg-amber-500/10">
        ⚡ Apply backup lên Shopify
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Apply backup lên Shopify (khẩn cấp khi carrier API gãy)</DialogTitle>
        </DialogHeader>
        <div className="space-y-5">
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
            <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">Apply tất cả store cùng lúc</p>
            <ApplyAllBackupButton storeCount={storeCount} onApplyAll={onApplyAll} />
          </div>
          <div className="border-t border-border pt-4">
            <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">Hoặc chọn 1 store</p>
            <ApplyModal stores={stores} onPreview={onPreview} onApply={onApply} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
