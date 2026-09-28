'use client';

import { nhanBoPhan } from '@/features/to-chuc/bo-phan';
import { nhanLoaiChiPhi, nhanNguyenNhan } from '@/features/su-co/phan-loai';
import { chuoiTongTien } from '@/features/dispute/tong-tien';
import type { TongHopThietHai } from '@/features/su-co/queries';
import type { NhomThietHai } from '@/features/su-co/tong-hop';

/**
 * Khối tổng hợp thiệt hại — giá trị chính của module.
 *
 * Mọi số TÁCH THEO ĐƠN VỊ TIỀN. Tổng theo bộ phận luôn bằng tổng thật vì mỗi dòng
 * chi phí thuộc đúng một bộ phận (xem features/su-co/tong-hop.ts).
 */
export function KhoiTongHop({ th }: { th: TongHopThietHai }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2 rounded-lg border border-border p-4">
        <div>
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Sự cố</p>
          <p className="text-sm font-medium tabular-nums">{th.soSuCo}</p>
        </div>
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Tổng thiệt hại</p>
          <p className="text-sm font-medium tabular-nums">{chuoiTongTien(th.tong)}</p>
        </div>
        {th.soCanXemLai > 0 && (
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Cần xem lại</p>
            <p className="text-sm font-medium tabular-nums text-amber-600 dark:text-amber-400">
              {th.soCanXemLai}
            </p>
          </div>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Bang tieuDe="Theo bộ phận chịu" nhom={th.theoBoPhan} nhan={nhanBoPhan} />
        <Bang tieuDe="Theo loại chi phí" nhom={th.theoLoai} nhan={nhanLoaiChiPhi} />
        <Bang tieuDe="Theo nguyên nhân" nhom={th.theoNguyenNhan} nhan={nhanNguyenNhan} max={8} />
      </div>
    </div>
  );
}

function Bang({
  tieuDe, nhom, nhan, max,
}: {
  tieuDe: string; nhom: NhomThietHai[]; nhan: (ma: string | null) => string; max?: number;
}) {
  const hien = max ? nhom.slice(0, max) : nhom;
  const con = nhom.length - hien.length;
  return (
    <section className="rounded-lg border border-border">
      <h3 className="border-b border-border px-3 py-2 text-xs uppercase tracking-wider text-muted-foreground">
        {tieuDe}
      </h3>
      {nhom.length === 0 ? (
        <p className="px-3 py-4 text-sm text-muted-foreground">Chưa có khoản chi phí nào.</p>
      ) : (
        <ul className="divide-y divide-border">
          {hien.map((n) => (
            <li key={n.khoa} className="px-3 py-2">
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate text-sm">
                  {n.khoa === '(chưa ghi)' ? (
                    <span className="text-muted-foreground">chưa ghi</span>
                  ) : nhan(n.khoa)}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {n.soSuCo} ca
                </span>
              </div>
              <p className="text-sm font-medium tabular-nums">{chuoiTongTien(n.tong)}</p>
            </li>
          ))}
          {con > 0 && (
            <li className="px-3 py-2 text-xs text-muted-foreground">còn {con} nhóm nữa</li>
          )}
        </ul>
      )}
    </section>
  );
}
