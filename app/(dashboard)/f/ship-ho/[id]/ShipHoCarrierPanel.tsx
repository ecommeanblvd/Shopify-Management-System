'use client';

import { useState, useTransition } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { getShipHoCarrierComparison, assignShipHoCarrier, type ShipHoCarrierComparison } from '@/features/ship-ho/carrier-select-actions';

const num = (n: number) => Math.round(n).toLocaleString('vi-VN');

/**
 * Chọn LINE SHIP cho đơn ship hộ — quote mọi carrier đang bật (không mặc định
 * FedEx), xếp rẻ→đắt, kèm MARGIN DỰ KIẾN từng line (giá thu brand cố định − chi
 * phí line). Carrier tạm ngưng: hiện giá nhưng không chọn được.
 */
export function ShipHoCarrierPanel({ orderId, currentKey, canManage }: {
  orderId: string;
  currentKey: string | null;
  canManage: boolean;
}) {
  const [data, setData] = useState<ShipHoCarrierComparison | null>(null);
  const [loading, startLoad] = useTransition();
  const [assigning, startAssign] = useTransition();
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => startLoad(async () => setData(await getShipHoCarrierComparison(orderId)));
  const choose = (key: string) => {
    setPendingKey(key); setError(null);
    startAssign(async () => {
      const r = await assignShipHoCarrier(orderId, key);
      if (!r.ok) setError(r.error ?? 'Lỗi');
      else setData((d) => (d ? { ...d, selectedKey: key } : d));
      setPendingKey(null);
    });
  };

  const now = Date.now();
  const canSelect = (r: { suspendedAt?: string | null }) => !r.suspendedAt || new Date(r.suspendedAt).getTime() > now;
  const okRows = data?.rows.filter((r) => r.ok) ?? [];
  const cheapest = okRows.find(canSelect) ?? okRows[0];
  const selectedKey = data?.selectedKey ?? currentKey;

  return (
    <Card><CardContent className="p-4 space-y-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Chọn line ship</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
            {currentKey && !data && <span>đang gắn: <b className="uppercase text-foreground">{currentKey}</b></span>}
            {data && !data.error && (
              <>
                <span>{data.country} · {data.weightKg}kg ({data.weightBasis === 'sms' ? 'Inecso đo' : 'brand khai'})</span>
                {selectedKey && <span className="rounded bg-emerald-500/15 px-1.5 py-px font-medium text-emerald-700 dark:text-emerald-400">đã chọn: {selectedKey}</span>}
              </>
            )}
          </div>
        </div>
        <button type="button" onClick={load} disabled={loading}
          className="rounded-md border border-border px-3 py-1 text-xs font-medium transition hover:bg-muted disabled:opacity-50">
          {loading ? 'Đang báo giá…' : data ? '↻ Tải lại' : 'So sánh line ship'}
        </button>
      </div>

      {!data && !loading && (
        <p className="text-xs text-muted-foreground">Bấm “So sánh line ship” để quote đơn này qua mọi carrier — chọn line phù hợp nhất thay vì mặc định FedEx.</p>
      )}
      {data?.error && <p className="text-xs text-amber-600 dark:text-amber-400">{data.error}</p>}
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

      {data && !data.error && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm tabular-nums">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-muted-foreground [&>th]:px-3 [&>th]:py-2 [&>th]:font-medium">
                <th className="text-left">Line</th>
                <th className="text-right">Chi phí (VND)</th>
                <th className="text-right" title="Giá thu brand cố định − chi phí line">Margin dự kiến</th>
                <th className="text-left">Zone</th>
                <th aria-label="Chọn"></th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => {
                const isCheap = r.carrierKey === cheapest?.carrierKey;
                const isSel = r.carrierKey === selectedKey;
                if (!r.ok) {
                  return (
                    <tr key={r.accountId} className="border-t border-border/60 text-muted-foreground">
                      <td className="px-3 py-2.5 font-semibold uppercase text-foreground/60">{r.carrierKey}</td>
                      <td colSpan={4} className="px-3 py-2.5 text-xs italic">Không báo giá được ({r.error})</td>
                    </tr>
                  );
                }
                const margin = data.chargedVnd != null && r.vndCost != null ? data.chargedVnd - r.vndCost : null;
                const selectable = canSelect(r);
                const suspFrom = r.suspendedAt ? new Date(r.suspendedAt).toLocaleDateString('vi-VN') : null;
                return (
                  <tr key={r.accountId}
                    className={`border-t border-border/60 ${isCheap ? 'bg-emerald-500/[0.06]' : ''} ${isSel ? 'ring-1 ring-inset ring-emerald-500/40' : ''}`}>
                    <td className="px-3 py-2.5">
                      <span className="font-semibold uppercase">{r.carrierKey}</span>
                      {isCheap && <span className="ml-1.5 rounded bg-emerald-500/15 px-1.5 py-px text-[10px] font-medium text-emerald-700 dark:text-emerald-400">rẻ nhất</span>}
                    </td>
                    <td className="px-3 py-2.5 text-right font-medium">{r.vndCost != null ? num(r.vndCost) : '—'}</td>
                    <td className="px-3 py-2.5 text-right">
                      {margin == null ? <span className="text-muted-foreground">—</span> : (
                        <span className={margin >= 0 ? 'font-medium text-emerald-600 dark:text-emerald-400' : 'font-medium text-red-600 dark:text-red-400'}>
                          {margin >= 0 ? '+' : ''}{num(margin)}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-left text-xs whitespace-nowrap text-muted-foreground">{r.zone}{r.tierUpperKg ? ` · ≤${r.tierUpperKg}kg` : ''}</td>
                    <td className="px-3 py-2.5 text-right">
                      {!canManage ? null : !selectable ? (
                        <button type="button" disabled title={`${r.suspendReason || 'Tạm ngưng'}${suspFrom ? ` · từ ${suspFrom}` : ''}`}
                          className="cursor-not-allowed rounded-md border border-border px-3 py-1 text-xs font-medium text-muted-foreground opacity-50">
                          Tạm ngưng
                        </button>
                      ) : (
                        <button type="button" disabled={assigning || isSel} onClick={() => choose(r.carrierKey)}
                          className={`rounded-md border px-3 py-1 text-xs font-medium transition disabled:opacity-60 ${isSel ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : 'border-border hover:bg-muted'}`}>
                          {isSel ? '✓ Đã chọn' : pendingKey === r.carrierKey ? '…' : 'Chọn'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Chọn line → cập nhật <b>chi phí dự tính + cấu trúc giá</b> của đơn theo line đó (giá thu brand giữ nguyên theo quote). Book với carrier xong nhớ “＋ Gắn tracking”.
          </p>
        </div>
      )}
    </CardContent></Card>
  );
}
