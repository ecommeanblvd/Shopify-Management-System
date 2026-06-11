'use client';

import Link from 'next/link';
import type { StagingOrderGroup } from '@/features/warehouse/staging-queries';
import { SourceChip } from '@/components/fulfillment/SourceChip';

const fmtDate = (d: Date) =>
  new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);

/** Tuổi chờ = now − kiện về sớm nhất. */
function waitAge(oldestStagedAt: Date): string {
  const ms = Date.now() - new Date(oldestStagedAt).getTime();
  const days = Math.floor(ms / 86_400_000);
  if (days >= 1) return `chờ ${days} ngày`;
  const hours = Math.floor(ms / 3_600_000);
  return hours >= 1 ? `chờ ${hours} giờ` : 'mới về';
}

interface Props {
  groups: StagingOrderGroup[];
}

export function StagingBoard({ groups }: Props) {
  const totalStaged = groups.reduce((s, g) => s + g.stagedTotal, 0);

  if (groups.length === 0) {
    return (
      <div className="rounded-lg border border-border p-10 text-center text-sm text-muted-foreground">
        Không có hàng nào trong khu chờ.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Tổng quan */}
      <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
        <span>
          <span className="font-mono font-medium text-foreground tabular-nums">{new Intl.NumberFormat('vi-VN').format(groups.length)}</span>{' '}
          đơn đang chờ
        </span>
        <span>
          <span className="font-mono font-medium text-foreground tabular-nums">{new Intl.NumberFormat('vi-VN').format(totalStaged)}</span>{' '}
          kiện đã về
        </span>
      </div>

      {groups.map((g) => (
        <div key={g.orderId} className="rounded-lg border border-border">
          {/* Header đơn */}
          <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
            <Link
              href={`/f/fulfillment/${g.orderId}`}
              className="font-mono text-sm font-semibold hover:underline"
            >
              {g.orderNumber}
            </Link>
            <span className="text-xs text-muted-foreground">{fmtDate(new Date(g.processedAt))}</span>
            <span className="text-xs text-muted-foreground">·</span>
            <span className="text-xs text-muted-foreground">{waitAge(g.oldestStagedAt)}</span>
            <span className="ml-auto">
              {g.readyToGo ? (
                <span className="inline-block rounded px-2 py-0.5 text-xs font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                  Sẵn sàng đi
                </span>
              ) : (
                <span className="inline-block rounded px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                  Còn thiếu
                </span>
              )}
            </span>
          </div>

          {/* Dòng đơn */}
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left">SKU</th>
                <th className="px-3 py-2 text-right">Cần</th>
                <th className="px-3 py-2 text-right">Đã về</th>
                <th className="px-4 py-2 text-left">Nguồn</th>
              </tr>
            </thead>
            <tbody>
              {g.lines.map((l) => (
                <tr key={l.lineId} className="border-t border-border">
                  <td className="px-4 py-2 font-mono text-xs">{l.sku ?? '—'}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{l.qty}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {l.stagedCount > 0 ? l.stagedCount : <span className="text-muted-foreground">0</span>}
                  </td>
                  <td className="px-4 py-2"><SourceChip source={l.source} /></td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Kiện chi tiết */}
          <details className="border-t border-border">
            <summary className="cursor-pointer px-4 py-2 text-xs text-muted-foreground hover:bg-muted/30">
              Kiện trong khu chờ ({g.stagedTotal})
            </summary>
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left">Phiếu nhập</th>
                  <th className="px-3 py-2 text-left">Mã kiện</th>
                  <th className="px-3 py-2 text-left">SKU</th>
                  <th className="px-3 py-2 text-left">Ảnh</th>
                  <th className="px-4 py-2 text-left">QC</th>
                </tr>
              </thead>
              <tbody>
                {g.items.map((it) => (
                  <tr key={it.itemId} className="border-t border-border">
                    <td className="px-4 py-2 font-mono text-xs">{it.receiptCode}</td>
                    <td className="px-3 py-2 font-mono text-xs">{it.unitCode}</td>
                    <td className="px-3 py-2 font-mono text-xs">{it.sku ?? '—'}</td>
                    <td className="px-3 py-2">
                      {it.photoUrl ? (
                        <a href={it.photoUrl} target="_blank" rel="noreferrer">
                          {/* eslint-disable-next-line @next/next/no-img-element -- signed S3 URL, không qua next/image */}
                          <img src={it.photoUrl} alt={`Ảnh kiện ${it.unitCode}`} className="h-10 w-10 rounded border border-border object-cover" />
                        </a>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-xs text-emerald-600 dark:text-emerald-400">Pass</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </div>
      ))}
    </div>
  );
}
