'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { SearchIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { nhanKho } from '@/features/warehouse/ten-kho';
import { WAREHOUSE_PRIORITY } from '@/features/warehouse/allocation-logic';
import type { DonChoDong } from '@/features/dong-goi/queries';
import { ModalDongKien } from './ModalDongKien';

function ngay(s: string | null): string {
  if (!s) return '—';
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Bangkok',
  }).format(new Date(s));
}

export function BangDonChoDong({ don, kho }: { don: DonChoDong[]; kho: string }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [chon, setChon] = useState<DonChoDong | null>(null);

  const hien = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return don;
    return don.filter((d) => `${d.maDon}${d.store ?? ''}${d.nuoc ?? ''}`.toLowerCase().includes(t));
  }, [don, q]);

  const tongChiec = don.reduce((s, d) => s + d.soChiec, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Đóng hàng</h1>
          <p className="text-xs text-muted-foreground">
            {don.length} đơn · {tongChiec} chiếc đã QC đạt, chờ đóng kiện
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="flex h-8 w-[240px] items-center gap-2 rounded-lg border border-input bg-background px-2.5">
            <SearchIcon className="size-3.5 shrink-0 text-muted-foreground" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm mã đơn, store, nước…"
              className="min-w-0 flex-1 border-none bg-transparent text-xs outline-none" />
          </div>
          <select
            value={kho} aria-label="Kho"
            onChange={(e) => router.push(`/f/warehouse/dong-goi${e.target.value ? `?kho=${e.target.value}` : ''}`)}
            className="h-8 cursor-pointer rounded-lg border border-input bg-background px-2 text-xs"
          >
            <option value="">Tất cả kho</option>
            {WAREHOUSE_PRIORITY.map((k) => <option key={k} value={k}>Kho {nhanKho(k)}</option>)}
          </select>
        </div>
      </div>

      {hien.length === 0 ? (
        <p className="rounded-lg border border-border px-3 py-10 text-center text-sm text-muted-foreground">
          Không có đơn nào chờ đóng. Hàng phải QC đạt và được cấp cho đơn thì mới hiện ở đây.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Mã đơn</th>
                <th className="px-3 py-2 text-left font-medium">Store</th>
                <th className="px-3 py-2 text-left font-medium">Nước</th>
                <th className="px-3 py-2 text-left font-medium">Kho</th>
                <th className="px-3 py-2 text-center font-medium">Chiếc</th>
                <th className="px-3 py-2 text-left font-medium">Đặt ngày</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {hien.map((d) => (
                <tr key={d.orderId} className="border-b border-border last:border-b-0">
                  <td className="px-3 py-2 font-mono text-xs">{d.maDon}</td>
                  <td className="px-3 py-2 text-muted-foreground">{d.store ?? '—'}</td>
                  <td className="px-3 py-2 text-muted-foreground">{d.nuoc ?? '—'}</td>
                  <td className="px-3 py-2">
                    {d.kho
                      ? <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-xs text-sky-700 dark:text-sky-300">{d.kho}</span>
                      : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-3 py-2 text-center tabular-nums">{d.soChiec}</td>
                  <td className="px-3 py-2 tabular-nums text-muted-foreground">{ngay(d.datLuc)}</td>
                  <td className="px-3 py-2 text-right">
                    <Button type="button" size="sm" onClick={() => setChon(d)}>Đóng kiện</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ModalDongKien
        don={chon}
        onDong={() => { setChon(null); router.refresh(); }}
        onXong={() => router.refresh()}
      />
    </div>
  );
}
