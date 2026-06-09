'use client';

import { useMemo, useState, useTransition } from 'react';
import { resendBrandRequest } from '@/features/fulfillment/brand-actions';
import { isFollowUpDue } from '@/features/fulfillment/brand-logic';

type BrandRequestRow = {
  id: string;
  orderNumber: string | null;
  brandSlug: string | null;
  sku: string | null;
  qty: number;
  sendStatus: string;
  confirmStatus: string;
  expectedDeliveryDate: string | null;
  lastError: string | null;
  createdAt: Date | string | null;
};

interface Props {
  rows: BrandRequestRow[];
  canManage: boolean;
}

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return '—';
  const date = d instanceof Date ? d : new Date(d);
  if (isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function sendStatusBadge(s: string): { label: string; cls: string } {
  if (s === 'sent') return { label: 'Đã gửi', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' };
  if (s === 'failed') return { label: 'Lỗi', cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' };
  return { label: 'Chờ', cls: 'bg-muted text-muted-foreground' };
}

function confirmStatusBadge(s: string): { label: string; cls: string } {
  if (s === 'confirmed') return { label: 'Xác nhận', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' };
  if (s === 'rejected') return { label: 'Từ chối', cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' };
  return { label: 'Chờ xác nhận', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' };
}

function ResendButton({ id, disabled }: { id: string; disabled: boolean }) {
  const [isPending, startTransition] = useTransition();
  const busy = isPending || disabled;
  return (
    <button
      disabled={busy}
      onClick={() => startTransition(async () => { await resendBrandRequest(id); })}
      className="rounded border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
    >
      Gửi lại
    </button>
  );
}

export function BrandRequestsTable({ rows, canManage }: Props) {
  const todayIso = new Date().toISOString().slice(0, 10);
  const [confirmFilter, setConfirmFilter] = useState<string>('all');
  const [followUpOnly, setFollowUpOnly] = useState(false);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (confirmFilter !== 'all' && r.confirmStatus !== confirmFilter) return false;
      if (followUpOnly && !isFollowUpDue({ confirmStatus: r.confirmStatus, expectedDeliveryDate: r.expectedDeliveryDate }, todayIso)) return false;
      return true;
    });
  }, [rows, confirmFilter, followUpOnly, todayIso]);

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <select
          value={confirmFilter}
          onChange={(e) => setConfirmFilter(e.target.value)}
          className="rounded border border-border bg-background px-2 py-1"
        >
          <option value="all">Tất cả xác nhận</option>
          <option value="awaiting">Chờ xác nhận</option>
          <option value="confirmed">Xác nhận</option>
          <option value="rejected">Từ chối</option>
        </select>
        <label className="flex items-center gap-1.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={followUpOnly}
            onChange={(e) => setFollowUpOnly(e.target.checked)}
            className="rounded border-border"
          />
          Chỉ tới hạn follow-up
        </label>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Order #</th>
              <th className="px-3 py-2 text-left">Brand</th>
              <th className="px-3 py-2 text-left">SKU</th>
              <th className="px-3 py-2 text-right">SL</th>
              <th className="px-3 py-2 text-left">Gửi</th>
              <th className="px-3 py-2 text-left">Confirm</th>
              <th className="px-3 py-2 text-left">Ngày giao</th>
              <th className="px-3 py-2 text-left">Lỗi</th>
              <th className="px-3 py-2 text-left">Hành động</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const send = sendStatusBadge(r.sendStatus);
              const confirm = confirmStatusBadge(r.confirmStatus);
              return (
                <tr key={r.id} className="border-t border-border hover:bg-muted/30">
                  <td className="px-3 py-2 font-mono tabular-nums">{r.orderNumber ?? '—'}</td>
                  <td className="px-3 py-2">{r.brandSlug ?? '—'}</td>
                  <td className="px-3 py-2 font-mono text-xs">{r.sku ?? '—'}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{r.qty}</td>
                  <td className="px-3 py-2">
                    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${send.cls}`}>
                      {send.label}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${confirm.cls}`}>
                      {confirm.label}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-mono tabular-nums">
                    {r.expectedDeliveryDate ? fmtDate(r.expectedDeliveryDate) : '—'}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground max-w-[200px] truncate">
                    {r.lastError ?? ''}
                  </td>
                  <td className="px-3 py-2">
                    {canManage && r.sendStatus !== 'sent' && (
                      <ResendButton id={r.id} disabled={false} />
                    )}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-muted-foreground">
                  Chưa có yêu cầu brand nào.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
