'use client';

import { useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ChevronDown, ChevronRight, Settings2 } from 'lucide-react';
import type { UnknownChargeRow } from '@/features/carrier-rates/ap/detect-surcharges';

interface Props {
  accountId: string;
  currency: string;
  rows: UnknownChargeRow[];
}

/**
 * Cảnh báo các khoản phí billed mà hệ thống CHƯA nhận diện (chưa map bucket cước,
 * không phải thuế/duty) → gợi ý set up surcharge mới. Ẩn hẳn nếu không có khoản lạ.
 */
export function NewSurchargesReport({ accountId, currency, rows }: Props) {
  const [open, setOpen] = useState(true);
  const fmt = (n: number) => Math.round(n).toLocaleString('vi-VN');
  if (rows.length === 0) return null;

  return (
    <section className="rounded-xl border border-amber-300/60 bg-amber-50/60 dark:border-amber-500/30 dark:bg-amber-500/5">
      <button type="button" onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left">
        <span className="flex items-center gap-2 text-sm font-semibold text-amber-800 dark:text-amber-300">
          <AlertTriangle className="size-4" />
          Phí mới chưa cấu hình ({rows.length})
        </span>
        <span className="flex items-center gap-3">
          <Link href={`/f/carrier-rates/${accountId}/surcharges`}
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1.5 rounded-md border border-amber-400/60 px-2.5 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-500/10">
            <Settings2 className="size-3.5" /> Set up surcharge
          </Link>
          {open ? <ChevronDown className="size-4 text-amber-700 dark:text-amber-400" /> : <ChevronRight className="size-4 text-amber-700 dark:text-amber-400" />}
        </span>
      </button>

      {open && (
        <div className="px-4 pb-3">
          <p className="mb-2 text-xs text-amber-700/90 dark:text-amber-400/80">
            Các khoản này xuất hiện trong hoá đơn nhưng chưa được map vào cước hay thuế/duty — kiểm tra & thêm vào cấu hình surcharge nếu là phí cần tính.
          </p>
          <div className="overflow-x-auto rounded-lg border border-amber-200/70 dark:border-amber-500/20">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-amber-100/60 text-[11px] uppercase tracking-wider text-amber-800/80 dark:bg-amber-500/10 dark:text-amber-300/80">
                  <th className="px-3 py-2 text-left font-medium">Mã</th>
                  <th className="px-3 py-2 text-left font-medium">Tên khoản</th>
                  <th className="px-2 py-2 text-right font-medium">Số dòng</th>
                  <th className="px-2 py-2 text-right font-medium">Tổng phí</th>
                  <th className="px-2 py-2 text-right font-medium">VAT</th>
                  <th className="px-3 py-2 text-left font-medium">Kỳ thấy</th>
                  <th className="px-3 py-2 text-left font-medium">Hoá đơn mẫu</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-amber-200/60 dark:divide-amber-500/15">
                {rows.map((r) => (
                  <tr key={`${r.code} ${r.name}`} className="hover:bg-amber-100/40 dark:hover:bg-amber-500/5">
                    <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{r.code || '—'}</td>
                    <td className="px-3 py-2">{r.name || '—'}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{r.count}</td>
                    <td className="px-2 py-2 text-right tabular-nums font-medium">{fmt(r.totalCharge)} {currency}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">{fmt(r.totalTax)}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-xs text-muted-foreground">
                      {r.firstPeriod === r.lastPeriod ? r.firstPeriod : `${r.firstPeriod} → ${r.lastPeriod}`}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {r.sampleBillNumbers.length ? r.sampleBillNumbers.join(', ') : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
