'use client';
import { useState } from 'react';
import Link from 'next/link';
// CHỈ import type — module giao-truoc-ngay-gui kéo db/schema (server). Tóm tắt tính ở page
// (RSC) rồi truyền xuống, giống UnmatchedBilledBanner.
import type { DongGiaoTruoc, TomTatGiaoTruoc } from '@/features/shipments/giao-truoc-ngay-gui';

const NGUON = { lark: 'Lark', fedex: 'FedEx', dhl: 'DHL', ups: 'UPS' } as const;
const tenNguon = (s: string) => (NGUON as Record<string, string>)[s] ?? s;

/**
 * Kiện ghi NGÀY GIAO trước NGÀY GỬI — không thể xảy ra thật, nên luôn là dữ liệu sai.
 * Nguyên nhân đã gặp hai lần: một dòng Lark ghi nhầm mã đơn, rồi ngày giao của kiện khác
 * bị đè lên kiện này. Vì vậy cột quan trọng nhất ở đây là MÃ DÒNG LARK — thứ cần sửa.
 *
 * Ẩn hoàn toàn khi không có ca nào: đây là phép kiểm im lặng, chỉ lên tiếng khi có việc.
 */
export function GiaoTruocNgayGuiBanner({ rows, tomTat }: { rows: DongGiaoTruoc[]; tomTat: TomTatGiaoTruoc }) {
  const [mo, setMo] = useState(false);
  if (rows.length === 0) return null;

  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-4 py-3">
      <button
        type="button"
        onClick={() => setMo((v) => !v)}
        aria-expanded={mo}
        className="flex w-full cursor-pointer items-center justify-between gap-3 text-left"
      >
        <span className="text-sm">
          <b className="text-amber-700 dark:text-amber-400">
            {tomTat.tong} kiện ghi ngày giao TRƯỚC ngày gửi
          </b>
          <span className="text-muted-foreground">
            {' '}— không thể xảy ra thật, nên là dữ liệu sai. Lệch tới {tomTat.lechLonNhat} ngày
            {tomTat.theoNguon.length > 0 && (
              <> · nguồn ngày giao: {tomTat.theoNguon.map((x) => `${tenNguon(x.nguon)} ${x.n}`).join(', ')}</>
            )}
          </span>
        </span>
        <span className="shrink-0 text-xs text-muted-foreground">{mo ? 'Đóng' : 'Xem'}</span>
      </button>

      {mo && (
        <div className="mt-3 overflow-x-auto">
          <p className="mb-2 text-xs text-muted-foreground">
            Đã gặp hai lần, cả hai đều do <b>một dòng Lark ghi nhầm mã đơn</b> rồi ngày giao của
            kiện khác bị đè lên kiện này. Sửa ở <b>mã dòng Lark</b>, không sửa ở hệ thống.
          </p>
          <table className="w-full text-left text-xs">
            <thead className="text-muted-foreground">
              <tr className="[&>th]:px-2 [&>th]:py-1 [&>th]:font-medium">
                <th>Đơn</th><th>Mã vận đơn</th><th>Dòng Lark</th>
                <th>Ngày gửi</th><th>Ngày giao</th><th className="text-right">Lệch</th><th>Nguồn</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.shipmentId} className="border-t border-border/60 [&>td]:px-2 [&>td]:py-1">
                  <td>
                    {r.orderNumber
                      /* Trỏ về CHÍNH trang này kèm ?q= — bộ lọc `q` của đối soát khớp mã đơn
                         (reconcile-filter). `/f/orders` KHÔNG đọc searchParams nên link sang đó
                         là link chết: vẫn điều hướng nhưng ra danh sách không lọc. */
                      ? <Link href={`/f/shipping-reconcile?q=${encodeURIComponent(r.orderNumber)}`} className="underline-offset-2 hover:underline">{r.orderNumber}</Link>
                      : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="font-mono">{r.tracking ?? <span className="font-sans text-muted-foreground">chưa có</span>}</td>
                  <td className="font-mono font-medium">{r.dongLark ?? <span className="font-sans font-normal text-muted-foreground">—</span>}</td>
                  <td className="tabular-nums">{r.ngayNhan}</td>
                  <td className="tabular-nums">{r.ngayGiao}</td>
                  <td className="text-right tabular-nums font-medium text-amber-700 dark:text-amber-400">{r.lechNgay} ngày</td>
                  <td className="text-muted-foreground">{tenNguon(r.deliverySource ?? '(không rõ)')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
