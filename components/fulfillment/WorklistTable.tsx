'use client';

import { useMemo, useState } from 'react';
import type { Badge, BadgeTone } from '@/features/fulfillment/worklist-status';
import { OrderDetailDialog } from './OrderDetailDialog';
import { formatTrackingStatus, carrierTrackingUrl } from '@/features/fulfillment/worklist-status';
import { STAGE_ORDER, stageLabel, type OrderStage } from '@/features/fulfillment/order-stage';

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return '—';
  const date = d instanceof Date ? d : new Date(d);
  if (isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

const TONE: Record<BadgeTone, string> = {
  ok: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  warn: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  bad: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  info: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400',
  muted: 'bg-muted text-muted-foreground',
};

function BadgeCell({ b }: { b: Badge }) {
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${TONE[b.tone]}`}>
      {b.label}
    </span>
  );
}

function EditFlag({ row }: { row: WorklistRow }) {
  if (row.editedAfterFulfilledAt) {
    return (
      <div className="mt-0.5" title={`Đơn bị sửa sau khi đã lên vận đơn — ${fmtDate(row.editedAfterFulfilledAt)}`}>
        <span className="inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
          ⚠️ Sửa sau khi ship · {fmtDate(row.editedAfterFulfilledAt)}
        </span>
      </div>
    );
  }
  if (row.editedAt) {
    return (
      <div className="mt-0.5" title={`Đơn đã được chỉnh sửa — ${fmtDate(row.editedAt)}`}>
        <span className="inline-block rounded px-1.5 py-0.5 text-[10px] font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
          ✏️ Đã sửa · {fmtDate(row.editedAt)}
        </span>
      </div>
    );
  }
  return null;
}

function ddmmyyyy(iso: string): string {
  // 'YYYY-MM-DD' → 'dd/MM/yyyy' bằng cắt chuỗi (không Date/timezone)
  if (!iso || iso.length < 10) return iso || '—';
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

type WorklistRow = {
  orderId: string;
  orderNumber: string | null;
  storeName: string | null;
  status: string;
  stage: OrderStage;
  createdAtShopify: Date | string | null;
  editedAt: Date | string | null;
  editedAfterFulfilledAt: Date | string | null;
  updatedAtShopify: Date | string | null;
  addr: Badge;
  kcs: Badge;
  delivery: Badge;
  packs: number;
  tracks: Array<{ trackingNumber: string; carrierKey: string | null; deliveryStatus: string | null; deliveredAt: string | null }>;
  lark: { dispatchStatus: string | null; cxFfStatus: string | null; deliveryStatus: string | null; expectedDeliveryDate: string | null } | null;
};

interface Props {
  rows: WorklistRow[];
  canManage: boolean;
}

export function WorklistTable({ rows }: Props) {
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [openOrderId, setOpenOrderId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (statusFilter === 'all') return rows;
    return rows.filter((r) => r.stage.key === statusFilter);
  }, [rows, statusFilter]);

  return (
    <div className="space-y-4">
      {/* Filter */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded border border-border bg-background px-2 py-1"
        >
          <option value="all">Tất cả trạng thái</option>
          {STAGE_ORDER.map((key) => (
            <option key={key} value={key}>{stageLabel(key)}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="overflow-auto max-h-[calc(100vh-16rem)] min-h-[280px] rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-background text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Ngày</th>
              <th className="px-3 py-2 text-left">Đơn</th>
              <th className="px-3 py-2 text-left">Địa chỉ</th>
              <th className="px-3 py-2 text-left">KCS</th>
              <th className="px-3 py-2 text-left">Đóng gói</th>
              <th className="px-3 py-2 text-left">Vận chuyển</th>
              <th className="px-3 py-2 text-left">Lark (vận hành)</th>
              <th className="px-3 py-2 text-left">Tình trạng</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr
                key={row.orderId}
                className="border-t border-border hover:bg-muted/30 cursor-pointer"
                tabIndex={0}
                role="link"
                aria-label={`Mở đơn ${row.orderNumber ?? row.orderId}`}
                onClick={() => setOpenOrderId(row.orderId)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    if (e.key === ' ') e.preventDefault();
                    setOpenOrderId(row.orderId);
                  }
                }}
              >
                <td className="px-3 py-2 font-mono tabular-nums whitespace-nowrap">
                  {fmtDate(row.createdAtShopify)}
                </td>
                <td className="px-3 py-2">
                  <a
                    href={`/f/fulfillment/${row.orderId}`}
                    className="font-mono text-primary underline-offset-2 hover:underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {row.orderNumber ?? row.orderId}
                  </a>
                  {row.storeName && (
                    <div className="text-xs text-muted-foreground">{row.storeName}</div>
                  )}
                  <EditFlag row={row} />
                </td>
                <td className="px-3 py-2">
                  <BadgeCell b={row.addr} />
                </td>
                <td className="px-3 py-2">
                  {row.kcs.tone === 'muted' ? null : <BadgeCell b={row.kcs} />}
                </td>
                <td className="px-3 py-2">
                  {row.packs === 0 ? (
                    <span className="text-xs text-muted-foreground">Chưa</span>
                  ) : (
                    <span className="text-xs">{row.packs} kiện</span>
                  )}
                </td>
                <td className="px-3 py-2 align-top">
                  {row.tracks.length === 0 ? (
                    <BadgeCell b={row.delivery} />
                  ) : (
                    <div className="flex flex-col gap-1">
                      {row.tracks.map((t) => {
                        const st = formatTrackingStatus(t.deliveryStatus);
                        const url = carrierTrackingUrl(t.carrierKey, t.trackingNumber);
                        const label = (t.deliveryStatus === 'delivered' && t.deliveredAt && t.deliveredAt.length >= 10)
                          ? `${st.label} · ${t.deliveredAt.slice(8, 10)}/${t.deliveredAt.slice(5, 7)}`
                          : st.label;
                        return (
                          <div key={t.trackingNumber} className="flex items-center gap-2">
                            {url === '#' ? (
                              <span className="font-mono text-xs">{t.trackingNumber}</span>
                            ) : (
                              <a href={url} target="_blank" rel="noopener noreferrer"
                                 className="font-mono text-xs text-primary underline-offset-2 hover:underline"
                                 onClick={(e) => e.stopPropagation()}>
                                {t.trackingNumber}
                              </a>
                            )}
                            <BadgeCell b={{ label, tone: st.tone }} />
                          </div>
                        );
                      })}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2 align-top">
                  {row.lark ? (
                    <div className="flex flex-col gap-0.5 text-xs text-gray-500">
                      {row.lark.dispatchStatus && <span>{row.lark.dispatchStatus}</span>}
                      {row.lark.cxFfStatus && <span>{row.lark.cxFfStatus}</span>}
                      {row.lark.deliveryStatus && <span>{row.lark.deliveryStatus}</span>}
                      {row.lark.expectedDeliveryDate && <span>Dự kiến: {ddmmyyyy(row.lark.expectedDeliveryDate)}</span>}
                    </div>
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${TONE[row.stage.tone]}`}>
                    {row.stage.label}
                  </span>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">
                  Không có đơn nào.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <OrderDetailDialog key={openOrderId ?? 'none'} orderId={openOrderId} onClose={() => setOpenOrderId(null)} />
    </div>
  );
}
