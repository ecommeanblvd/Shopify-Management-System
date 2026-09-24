'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { DangKiem } from '@/features/kho-nhan/types';
import { Button } from '@/components/ui/button';
import { OTimMonChoVe } from './OTimMonChoVe';
import { ModalQc } from './ModalQc';

function gio(d: Date): string {
  return new Intl.DateTimeFormat('vi-VN', {
    hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit',
    timeZone: 'Asia/Bangkok',
  }).format(new Date(d));
}

/** Màn nhận & kiểm: tìm món chờ về ở trên, danh sách đang kiểm ở dưới. */
export function BangDangKiem({ dangKiem, coStorage }: { dangKiem: DangKiem[]; coStorage: boolean }) {
  const router = useRouter();
  const [chon, setChon] = useState<DangKiem | null>(null);

  const lamMoi = () => router.refresh();

  return (
    <div className="space-y-6">
      <OTimMonChoVe onDaNhan={lamMoi} />

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">
          Đang kiểm{' '}
          <span className="font-normal text-muted-foreground">({dangKiem.length} chiếc)</span>
        </h2>

        {dangKiem.length === 0 ? (
          <p className="rounded-lg border border-border px-3 py-6 text-center text-sm text-muted-foreground">
            Chưa có chiếc nào chờ kiểm. Tìm món ở ô trên để ghi nhận hàng vừa về.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="border-b border-border text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Mã chiếc</th>
                  <th className="px-3 py-2 text-left font-medium">Sản phẩm</th>
                  <th className="px-3 py-2 text-left font-medium">Mã đơn</th>
                  <th className="px-3 py-2 text-left font-medium">Nhận lúc</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {dangKiem.map((c) => (
                  <tr key={c.id} className="border-b border-border last:border-b-0">
                    <td className="px-3 py-2 font-mono text-xs">{c.unitCode}</td>
                    <td className="max-w-[420px] px-3 py-2">
                      <span className="block truncate">{c.tenSanPham ?? c.sku}</span>
                      <span className="block truncate font-mono text-xs text-muted-foreground">{c.sku}</span>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{c.maDon ?? '—'}</td>
                    <td className="px-3 py-2 tabular-nums text-muted-foreground">{gio(c.taoLuc)}</td>
                    <td className="px-3 py-2 text-right">
                      <Button type="button" size="sm" onClick={() => setChon(c)}>Kiểm</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <ModalQc
        chiec={chon}
        coStorage={coStorage}
        onDong={() => setChon(null)}
        onXong={() => { setChon(null); lamMoi(); }}
      />
    </div>
  );
}
