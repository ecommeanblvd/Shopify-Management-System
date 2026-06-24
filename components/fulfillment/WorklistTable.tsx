'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Badge } from '@/features/fulfillment/worklist-status';

type OrderStatus =
  | 'received'
  | 'checking'
  | 'awaiting_brand'
  | 'ready_to_pick'
  | 'picking'
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

function statusBadgeClass(status: string): string {
  if (status === 'awaiting_brand') return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
  if (status === 'shipped') return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400';
  return 'bg-muted text-muted-foreground';
}

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return '—';
  const date = d instanceof Date ? d : new Date(d);
  if (isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

const TONE: Record<string, string> = {
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

type WorklistRow = {
  orderId: string;
  orderNumber: string | null;
  storeName: string | null;
  status: string;
  createdAtShopify: Date | string | null;
  addr: Badge;
  brand: Badge;
  kcs: Badge;
  delivery: Badge;
  packs: number;
};

interface Props {
  rows: WorklistRow[];
  canManage: boolean;
}

export function WorklistTable({ rows }: Props) {
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const filtered = useMemo(() => {
    if (statusFilter === 'all') return rows;
    return rows.filter((r) => r.status === statusFilter);
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
          {(Object.entries(ORDER_STATUS_LABELS) as [OrderStatus, string][]).map(([val, label]) => (
            <option key={val} value={val}>{label}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Ngày</th>
              <th className="px-3 py-2 text-left">Đơn</th>
              <th className="px-3 py-2 text-left">Địa chỉ</th>
              <th className="px-3 py-2 text-left">Brand</th>
              <th className="px-3 py-2 text-left">KCS</th>
              <th className="px-3 py-2 text-left">Đóng gói</th>
              <th className="px-3 py-2 text-left">Vận chuyển</th>
              <th className="px-3 py-2 text-left">Tình trạng</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr
                key={row.orderId}
                className="border-t border-border hover:bg-muted/30 cursor-pointer"
                onClick={() => router.push(`/f/fulfillment/${row.orderId}`)}
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
                </td>
                <td className="px-3 py-2">
                  <BadgeCell b={row.addr} />
                </td>
                <td className="px-3 py-2">
                  <BadgeCell b={row.brand} />
                </td>
                <td className="px-3 py-2">
                  <BadgeCell b={row.kcs} />
                </td>
                <td className="px-3 py-2">
                  {row.packs === 0 ? (
                    <span className="text-xs text-muted-foreground">Chưa</span>
                  ) : (
                    <span className="text-xs">{row.packs} kiện</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <BadgeCell b={row.delivery} />
                </td>
                <td className="px-3 py-2">
                  <span
                    className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${statusBadgeClass(row.status)}`}
                  >
                    {ORDER_STATUS_LABELS[row.status as OrderStatus] ?? row.status}
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
    </div>
  );
}
