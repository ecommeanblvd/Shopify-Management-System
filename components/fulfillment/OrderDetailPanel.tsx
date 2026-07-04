'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { resendBrandRequest } from '@/features/fulfillment/brand-actions';
import { lineSource } from '@/features/warehouse/staging-logic';
import { SourceChip } from '@/components/fulfillment/SourceChip';

type OrderStatus =
  | 'received'
  | 'checking'
  | 'awaiting_brand'
  | 'ready_to_pick'
  | 'picking'
  | 'packed'
  | 'shipped';

type LineStatus =
  | 'pending_check'
  | 'in_stock'
  | 'out_of_stock'
  | 'picked'
  | 'packed'
  | 'shipped';

const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  received: 'Mới nhận',
  checking: 'Đang kiểm',
  awaiting_brand: 'Cần đặt brand',
  ready_to_pick: 'Chờ lấy',
  picking: 'Đang lấy',
  packed: 'Đã đóng gói',
  shipped: 'Đã giao carrier',
};

const LINE_STATUS_LABELS: Record<LineStatus, string> = {
  pending_check: 'Chờ kiểm',
  in_stock: 'Còn hàng',
  out_of_stock: 'Hết — cần brand',
  picked: 'Đã lấy',
  packed: 'Đã đóng gói',
  shipped: 'Đã giao carrier',
};

function orderStatusBadgeClass(status: string): string {
  if (status === 'awaiting_brand') return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
  if (status === 'shipped') return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400';
  return 'bg-muted text-muted-foreground';
}

type Line = {
  id: string;
  sku: string | null;
  qty: number;
  status: string;
  productTitle: string | null;
  variantTitle: string | null;
  warehouseInventoryId: string | null;
  warehouseCode: string | null;
  /** Kiện khu chờ (allocate_to_order, QC pass) gắn dòng này. */
  stagedCount: number;
  shelf: string | null;
  floor: string | null;
  bin: string | null;
  brandRequestId: string | null;
  brandSendStatus: string | null;
  brandConfirmStatus: string | null;
  brandExpectedDeliveryDate: string | null;
};

interface Props {
  status: string;
  lines: Line[];
  canManage: boolean;
}

function ResendLineButton({ id }: { id: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  return (
    <button
      disabled={isPending}
      onClick={() => startTransition(async () => { await resendBrandRequest(id); router.refresh(); })}
      className="ml-1.5 rounded border border-border px-1.5 py-0.5 text-xs hover:bg-muted disabled:opacity-50"
    >
      Gửi lại
    </button>
  );
}

function LocationCell({ line, canManage }: { line: Line; canManage: boolean }) {
  const locStatuses: LineStatus[] = ['in_stock', 'picked', 'packed', 'shipped'];
  if (line.status === 'out_of_stock') {
    return (
      <span className="inline-flex items-center gap-1">
        <span className="inline-block rounded px-2 py-0.5 text-xs font-medium bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
          Cần đặt brand
        </span>
        {canManage && line.brandSendStatus === 'failed' && line.brandRequestId && (
          <ResendLineButton id={line.brandRequestId} />
        )}
      </span>
    );
  }
  if (line.status === 'brand_requested') {
    return (
      <span className="inline-block rounded px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
        Đã gửi brand
      </span>
    );
  }
  if (line.status === 'brand_confirmed') {
    return (
      <span className="inline-flex items-center gap-1">
        <span className="inline-block rounded px-2 py-0.5 text-xs font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
          Brand xác nhận
        </span>
        {line.brandExpectedDeliveryDate && (
          <span className="font-mono text-xs text-muted-foreground">{line.brandExpectedDeliveryDate}</span>
        )}
      </span>
    );
  }
  if (line.status === 'brand_rejected') {
    return (
      <span className="inline-block rounded px-2 py-0.5 text-xs font-medium bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
        Brand từ chối
      </span>
    );
  }
  if (locStatuses.includes(line.status as LineStatus) && line.shelf && line.floor) {
    const loc = `Kệ ${line.shelf} · Tầng ${line.floor}${line.bin ? ` · ${line.bin}` : ''}`;
    return <span className="font-mono text-xs">{loc}</span>;
  }
  return <span className="text-muted-foreground">—</span>;
}

export function OrderDetailPanel({ status, lines, canManage }: Props) {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <span
          className={`inline-block rounded px-3 py-1 text-sm font-medium ${orderStatusBadgeClass(status)}`}
        >
          {ORDER_STATUS_LABELS[status as OrderStatus] ?? status}
        </span>
      </div>

      {/* Lines table */}
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">SKU</th>
              <th className="px-3 py-2 text-left">Tên</th>
              <th className="px-3 py-2 text-right">SL</th>
              <th className="px-3 py-2 text-left">Trạng thái</th>
              <th className="px-3 py-2 text-left">Nguồn</th>
              <th className="px-3 py-2 text-left">Vị trí</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.id} className="border-t border-border hover:bg-muted/30">
                <td className="px-3 py-2 font-mono text-xs">{line.sku ?? '—'}</td>
                <td className="px-3 py-2">
                  {line.productTitle ?? '—'}
                  {line.variantTitle ? (
                    <span className="text-muted-foreground"> — {line.variantTitle}</span>
                  ) : null}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{line.qty}</td>
                <td className="px-3 py-2">
                  <span className="inline-block rounded px-2 py-0.5 text-xs font-medium bg-muted text-muted-foreground">
                    {LINE_STATUS_LABELS[line.status as LineStatus] ?? line.status}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <SourceChip
                    source={lineSource({
                      status: line.status,
                      qty: line.qty,
                      stagedCount: line.stagedCount,
                      warehouseInventoryId: line.warehouseInventoryId,
                      warehouseCode: line.warehouseCode,
                    })}
                  />
                </td>
                <td className="px-3 py-2">
                  <LocationCell line={line} canManage={canManage} />
                </td>
              </tr>
            ))}
            {lines.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                  Không có dòng nào.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
