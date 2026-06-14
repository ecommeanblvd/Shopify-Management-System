'use client';

import { Settings2, AlertCircle } from 'lucide-react';
import { Sheet, SheetTrigger, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';

interface Props {
  canManage: boolean;
  enabled: boolean;
  fxFormatted: string;
  fxAge: number;
  fxStale: boolean;
  costCurrency: string;
  displayCurrency: string;
  weightUnit: string;
  notes: string | null;
  toggleAction: () => Promise<void>;
  deleteAction: () => Promise<void>;
}

/** Nút (!) mở panel cấu hình + công cụ của carrier — gom toàn bộ setup khỏi
 *  trang chính (vốn ưu tiên công nợ). */
export function CarrierSetupSheet(props: Props) {
  return (
    <Sheet>
      <SheetTrigger className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted whitespace-nowrap">
        <Settings2 className="size-4" /> Cấu hình
      </SheetTrigger>
      <SheetContent side="right" className="w-[92vw] sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Cấu hình</SheetTitle>
        </SheetHeader>

        <div className="px-4 pb-6 space-y-6">
          {/* Metadata */}
          <div className="grid grid-cols-2 gap-px bg-border rounded-xl overflow-hidden border border-border">
            <Meta label="FX rate" value={fxLine(props.fxFormatted, props.costCurrency, props.displayCurrency)} warn={props.fxStale} />
            <Meta label="Cập nhật FX" value={`${props.fxAge} ngày trước`} warn={props.fxStale} />
            <Meta label="Đơn vị cân" value={props.weightUnit} />
            <Meta label="Phase" value="2a · live" />
          </div>
          {props.fxStale && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-300/50 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
              <AlertCircle className="size-3.5 shrink-0 mt-0.5" /> FX đã {props.fxAge} ngày — cập nhật trước khi push giá.
            </div>
          )}
          {props.notes && (
            <div className="space-y-1">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Ghi chú hợp đồng &amp; fuel</div>
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">{props.notes}</p>
            </div>
          )}

          {/* Danger zone */}
          {props.canManage && (
            <div className="flex items-center gap-2 border-t border-border pt-4">
              <form action={props.toggleAction}>
                <Button type="submit" variant="outline" size="sm">{props.enabled ? 'Disable' : 'Enable'}</Button>
              </form>
              <form action={props.deleteAction}>
                <Button type="submit" variant="ghost" size="sm" className="text-destructive hover:text-destructive hover:bg-destructive/10">Delete account</Button>
              </form>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function fxLine(fx: string, cost: string, display: string): string {
  return `${fx} ${cost}/1 ${display}`;
}

function Meta({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="bg-card p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={'mt-0.5 text-sm font-medium tabular-nums ' + (warn ? 'text-amber-600 dark:text-amber-400' : '')}>{value}</div>
    </div>
  );
}
